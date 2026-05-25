use crate::browser::{TabSession, launch_debug_browser};
use crate::models::{ActionTarget, AutomatorAction, MouseButton, Workflow, WorkflowGraph};
use crate::screen;
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

pub struct AutomatorState {
    pub is_running: Arc<AtomicBool>,
}

impl Default for AutomatorState {
    fn default() -> Self {
        Self::new()
    }
}

impl AutomatorState {
    pub fn new() -> Self {
        Self {
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn try_start(&self) -> bool {
        self.is_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Target resolution helpers
// ---------------------------------------------------------------------------

async fn resolve_coords_with_timeout(target: &ActionTarget) -> (i32, i32) {
    let t_clone = target.clone();

    let task = tauri::async_runtime::spawn_blocking(move || {
        crate::inspector::resolve_target_to_coords(&t_clone)
    });

    match tokio::time::timeout(Duration::from_secs(15), task).await {
        Ok(Ok(Ok((x, y)))) => (x, y),
        _ => extract_fallback(target),
    }
}

fn extract_fallback(target: &ActionTarget) -> (i32, i32) {
    match target {
        ActionTarget::Coordinate { x, y } => (*x, *y),
        ActionTarget::Semantic {
            fallback_x,
            fallback_y,
            ..
        } => (*fallback_x, *fallback_y),
        ActionTarget::WebSelector {
            fallback_x,
            fallback_y,
            ..
        } => (*fallback_x, *fallback_y),
    }
}

// ---------------------------------------------------------------------------
// Browser-assisted action helpers
// ---------------------------------------------------------------------------

fn push_selector_candidate(candidates: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim();
    if trimmed.is_empty() || candidates.iter().any(|existing| existing == trimmed) {
        return;
    }
    candidates.push(trimmed.to_string());
}

fn collect_selector_candidates(primary: Option<&str>, extras: Option<&[String]>) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(value) = primary {
        push_selector_candidate(&mut candidates, value);
    }
    if let Some(values) = extras {
        for value in values {
            push_selector_candidate(&mut candidates, value);
        }
    }
    candidates
}

fn timeout_per_candidate(timeout_ms: Option<u64>, candidate_count: usize) -> Option<u64> {
    let total_ms = timeout_ms?;
    if total_ms == 0 {
        return None;
    }
    if candidate_count <= 1 {
        return Some(total_ms);
    }
    Some((total_ms / candidate_count as u64).max(300))
}

/// Try to click an element via CDP. Returns true if successful.
async fn try_browser_click(
    selector: &str,
    selector_candidates: Option<&[String]>,
    url_filter: Option<&str>,
) -> bool {
    let candidates = collect_selector_candidates(Some(selector), selector_candidates);
    if candidates.is_empty() {
        return false;
    }

    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => {
            for candidate in candidates {
                if session.click_element(&candidate).await.is_ok() {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}

/// Try to type into an element via CDP. Returns true if successful.
async fn try_browser_type(
    selector: &str,
    selector_candidates: Option<&[String]>,
    text: &str,
    url_filter: Option<&str>,
) -> bool {
    let candidates = collect_selector_candidates(Some(selector), selector_candidates);
    if candidates.is_empty() {
        return false;
    }

    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => {
            for candidate in candidates {
                if session.type_into_element(&candidate, text).await.is_ok() {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}

/// Try to press a key via CDP. Returns true if successful.
async fn try_browser_key(key: &str, url_filter: Option<&str>) -> bool {
    // Browser-chrome shortcuts (e.g. Ctrl+T) are not handled by page-level CDP key dispatch.
    // Force physical fallback for those combos.
    if should_fallback_to_physical_key_in_web_mode(key) {
        // Best effort: focus target browser tab before physical fallback sends OS-level shortcuts.
        let _ = TabSession::connect_and_find(url_filter).await;
        return false;
    }

    let session = match TabSession::connect_and_find(url_filter).await {
        Ok(s) => s,
        Err(_) => return false,
    };
    // Try as combo first (e.g. "Ctrl+A"), fall back to single key
    if key.contains('+') {
        session.press_key_combo(key).await.is_ok()
    } else {
        session.press_key(key).await.is_ok()
    }
}

fn duration_from_timeout_ms(timeout_ms: Option<u64>) -> Option<Duration> {
    timeout_ms
        .and_then(|ms| if ms == 0 { None } else { Some(ms) })
        .map(Duration::from_millis)
}

fn sanitized_optional_str(raw: Option<&str>) -> Option<&str> {
    raw.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

async fn try_browser_navigate(
    url: &str,
    wait_until: Option<&str>,
    timeout_ms: Option<u64>,
    url_filter: Option<&str>,
) -> bool {
    let timeout = duration_from_timeout_ms(timeout_ms);
    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => session.navigate_to(url, wait_until, timeout).await.is_ok(),
        Err(_) => false,
    }
}

async fn try_browser_new_tab(url: Option<&str>) -> bool {
    TabSession::open_new_tab(url).await.is_ok()
}

async fn try_browser_switch_tab(
    strategy: Option<&str>,
    index: Option<u32>,
    value: Option<&str>,
) -> bool {
    TabSession::switch_tab(strategy, index, value).await.is_ok()
}

fn is_index_tab_switch_strategy(strategy: Option<&str>) -> bool {
    matches!(
        strategy
            .unwrap_or("lastOpened")
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "index"
    )
}

fn tab_switch_shortcut_for_index(index: u32) -> String {
    // One-based index: 1..8 jump to tab 1..8, 9+ jumps to last tab.
    // Keep compatibility: legacy 0 is treated as 1.
    let normalized = if index <= 1 { 1 } else { index };
    let digit = if normalized >= 9 { 9 } else { normalized };
    let modifier = if cfg!(target_os = "macos") {
        "Cmd"
    } else {
        "Ctrl"
    };
    format!("{}+{}", modifier, digit)
}

async fn try_shortcut_switch_tab_by_index(enigo: &mut Enigo, index: u32) -> bool {
    // Best effort: bring a browser tab to front before sending OS-level shortcut.
    let _ = TabSession::focus_current_tab(None).await;
    tokio::time::sleep(Duration::from_millis(80)).await;

    let shortcut = tab_switch_shortcut_for_index(index);
    execute_key_combination(enigo, &shortcut);
    tokio::time::sleep(Duration::from_millis(120)).await;

    true
}

async fn try_browser_wait_for_selector(
    selector: &str,
    selector_candidates: Option<&[String]>,
    state: Option<&str>,
    timeout_ms: Option<u64>,
    url_filter: Option<&str>,
) -> bool {
    let candidates = collect_selector_candidates(Some(selector), selector_candidates);
    if candidates.is_empty() {
        return false;
    }
    let per_candidate_timeout = timeout_per_candidate(timeout_ms, candidates.len());
    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => {
            for candidate in candidates {
                let timeout = duration_from_timeout_ms(per_candidate_timeout);
                if session
                    .wait_for_selector_state(&candidate, state, timeout)
                    .await
                    .is_ok()
                {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}

async fn try_browser_wait_for_url(
    value: &str,
    mode: Option<&str>,
    timeout_ms: Option<u64>,
    url_filter: Option<&str>,
) -> bool {
    let timeout = duration_from_timeout_ms(timeout_ms);
    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => session
            .wait_for_url_match(value, mode, timeout)
            .await
            .is_ok(),
        Err(_) => false,
    }
}

async fn try_browser_fill(
    selector: &str,
    selector_candidates: Option<&[String]>,
    text: &str,
    clear: bool,
    url_filter: Option<&str>,
) -> bool {
    let candidates = collect_selector_candidates(Some(selector), selector_candidates);
    if candidates.is_empty() {
        return false;
    }

    match TabSession::connect_and_find(url_filter).await {
        Ok(session) => {
            for candidate in candidates {
                if session.fill_element(&candidate, text, clear).await.is_ok() {
                    return true;
                }
            }
            false
        }
        Err(_) => false,
    }
}

async fn try_browser_assert(
    kind: &str,
    selector: Option<&str>,
    selector_candidates: Option<&[String]>,
    value: Option<&str>,
    timeout_ms: Option<u64>,
    url_filter: Option<&str>,
) -> bool {
    let session = match TabSession::connect_and_find(url_filter).await {
        Ok(s) => s,
        Err(_) => return false,
    };

    match kind.trim().to_ascii_lowercase().as_str() {
        "selectorexists" | "selector_exists" | "selector-exists" => {
            let selectors =
                collect_selector_candidates(sanitized_optional_str(selector), selector_candidates);
            if selectors.is_empty() {
                return false;
            }
            let per_candidate_timeout =
                duration_from_timeout_ms(timeout_per_candidate(timeout_ms, selectors.len()));
            for selector in selectors {
                if session
                    .assert_selector_exists(&selector, per_candidate_timeout)
                    .await
                    .unwrap_or(false)
                {
                    return true;
                }
            }
            false
        }
        "textcontains" | "text_contains" | "text-contains" => {
            let Some(expected) = sanitized_optional_str(value) else {
                return false;
            };
            let selectors =
                collect_selector_candidates(sanitized_optional_str(selector), selector_candidates);
            if selectors.is_empty() {
                return session
                    .assert_text_contains(None, expected)
                    .await
                    .unwrap_or(false);
            }
            for selector in selectors {
                if session
                    .assert_text_contains(Some(&selector), expected)
                    .await
                    .unwrap_or(false)
                {
                    return true;
                }
            }
            false
        }
        "urlcontains" | "url_contains" | "url-contains" => {
            let Some(expected) = sanitized_optional_str(value) else {
                return false;
            };
            session
                .assert_url_matches(expected, Some("contains"))
                .await
                .unwrap_or(false)
        }
        "urlequals" | "url_equals" | "url-equals" => {
            let Some(expected) = sanitized_optional_str(value) else {
                return false;
            };
            session
                .assert_url_matches(expected, Some("equals"))
                .await
                .unwrap_or(false)
        }
        "urlregex" | "url_regex" | "url-regex" => {
            let Some(expected) = sanitized_optional_str(value) else {
                return false;
            };
            session
                .assert_url_matches(expected, Some("regex"))
                .await
                .unwrap_or(false)
        }
        _ => false,
    }
}

fn should_fallback_to_physical_key_in_web_mode(key: &str) -> bool {
    let normalized_parts: Vec<String> = key
        .split('+')
        .map(normalize_shortcut_part)
        .filter(|part| !part.is_empty())
        .collect();

    if normalized_parts.is_empty() {
        return false;
    }

    let has_part = |name: &str| normalized_parts.iter().any(|part| part == name);
    let has_ctrl_or_cmd = has_part("ctrl") || has_part("cmd") || has_part("meta");
    let has_alt = has_part("alt");
    let main_key = normalized_parts.iter().find(|part| !is_modifier_key(part));

    if matches!(main_key.map(String::as_str), Some("f5")) {
        return true;
    }

    if has_alt && matches!(main_key.map(String::as_str), Some("left" | "right")) {
        return true;
    }

    if has_ctrl_or_cmd
        && matches!(
            main_key.map(String::as_str),
            Some(
                "t" | "n"
                    | "w"
                    | "l"
                    | "r"
                    | "tab"
                    | "1"
                    | "2"
                    | "3"
                    | "4"
                    | "5"
                    | "6"
                    | "7"
                    | "8"
                    | "9"
            )
        )
    {
        return true;
    }

    false
}

fn normalize_shortcut_part(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "control" => "ctrl".to_string(),
        "command" => "cmd".to_string(),
        "option" => "alt".to_string(),
        "return" => "enter".to_string(),
        "escape" => "esc".to_string(),
        "arrowup" => "up".to_string(),
        "arrowdown" => "down".to_string(),
        "arrowleft" => "left".to_string(),
        "arrowright" => "right".to_string(),
        other => other.to_string(),
    }
}

fn is_modifier_key(part: &str) -> bool {
    matches!(part, "ctrl" | "alt" | "shift" | "meta" | "cmd")
}

// ---------------------------------------------------------------------------
// Smart action executor — browser-first with physical input fallback
// ---------------------------------------------------------------------------

async fn execute_smart_action(enigo: &mut Enigo, action: &AutomatorAction) -> bool {
    match action {
        AutomatorAction::MoveTo { target } => {
            let (x, y) = resolve_coords_with_timeout(target).await;
            let _ = enigo.move_mouse(x, y, Coordinate::Abs);
            true
        }

        AutomatorAction::Click { button, target } => {
            let mut handled = false;

            if let Some(ActionTarget::WebSelector {
                selector,
                selector_candidates,
                url_contain,
                ..
            }) = target
            {
                let sel = selector.clone();
                let selector_candidates = selector_candidates.clone();
                let filter = url_contain.clone();
                handled = try_browser_click(
                    &sel,
                    Some(selector_candidates.as_slice()),
                    filter.as_deref(),
                )
                .await;
            }

            if !handled && let Some(t) = target {
                let (x, y) = resolve_coords_with_timeout(t).await;
                if x == 0 && y == 0 {
                    return false;
                }
                let _ = enigo.move_mouse(x, y, Coordinate::Abs);
                tokio::time::sleep(Duration::from_millis(100)).await;
                let _ = enigo.button(map_button(button), Direction::Click);
            }

            true
        }

        AutomatorAction::DoubleClick { button, target } => {
            if let Some(t) = target {
                let (x, y) = resolve_coords_with_timeout(t).await;
                let _ = enigo.move_mouse(x, y, Coordinate::Abs);
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let btn = map_button(button);
            let _ = enigo.button(btn, Direction::Click);
            tokio::time::sleep(Duration::from_millis(50)).await;
            let _ = enigo.button(btn, Direction::Click);
            true
        }

        AutomatorAction::Type { text, target } => {
            let mut handled = false;

            if let Some(ActionTarget::WebSelector {
                selector,
                selector_candidates,
                url_contain,
                ..
            }) = target
            {
                let sel = selector.clone();
                let selector_candidates = selector_candidates.clone();
                let txt = text.clone();
                let filter = url_contain.clone();
                handled = try_browser_type(
                    &sel,
                    Some(selector_candidates.as_slice()),
                    &txt,
                    filter.as_deref(),
                )
                .await;
            }

            if !handled {
                if let Some(t) = target {
                    let (x, y) = resolve_coords_with_timeout(t).await;
                    if x == 0 && y == 0 {
                        return false;
                    }
                    let _ = enigo.move_mouse(x, y, Coordinate::Abs);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    let _ = enigo.button(Button::Left, Direction::Click);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                let _ = enigo.text(text);
            }

            true
        }

        AutomatorAction::KeyPress { key, target } => {
            let mut handled = false;

            if let Some(ActionTarget::WebSelector { url_contain, .. }) = target {
                let k = key.clone();
                let filter = url_contain.clone();
                handled = try_browser_key(&k, filter.as_deref()).await;
            }

            if !handled {
                execute_key_combination(enigo, key);
            }

            true
        }

        AutomatorAction::Navigate {
            url,
            wait_until,
            timeout_ms,
            url_contain,
        } => {
            let u = url.trim();
            if u.is_empty() {
                return false;
            }
            try_browser_navigate(
                u,
                wait_until.as_deref(),
                *timeout_ms,
                sanitized_optional_str(url_contain.as_deref()),
            )
            .await
        }

        AutomatorAction::NewTab { url } => {
            try_browser_new_tab(sanitized_optional_str(url.as_deref())).await
        }

        AutomatorAction::SwitchTab {
            strategy,
            value,
            index,
        } => {
            if is_index_tab_switch_strategy(strategy.as_deref()) {
                return try_shortcut_switch_tab_by_index(enigo, index.unwrap_or(1)).await;
            }

            try_browser_switch_tab(
                strategy.as_deref(),
                *index,
                sanitized_optional_str(value.as_deref()),
            )
            .await
        }

        AutomatorAction::WaitForSelector {
            selector,
            selector_candidates,
            state,
            timeout_ms,
            url_contain,
        } => {
            let sel = selector.trim();
            if sel.is_empty() {
                return false;
            }
            try_browser_wait_for_selector(
                sel,
                Some(selector_candidates.as_slice()),
                state.as_deref(),
                *timeout_ms,
                sanitized_optional_str(url_contain.as_deref()),
            )
            .await
        }

        AutomatorAction::WaitForURL {
            value,
            mode,
            timeout_ms,
            url_contain,
        } => {
            let target = value.trim();
            if target.is_empty() {
                return false;
            }
            try_browser_wait_for_url(
                target,
                mode.as_deref(),
                *timeout_ms,
                sanitized_optional_str(url_contain.as_deref()),
            )
            .await
        }

        AutomatorAction::Fill {
            selector,
            selector_candidates,
            text,
            clear,
            url_contain,
        } => {
            let sel = selector.trim();
            if sel.is_empty() {
                return false;
            }
            try_browser_fill(
                sel,
                Some(selector_candidates.as_slice()),
                text,
                clear.unwrap_or(true),
                sanitized_optional_str(url_contain.as_deref()),
            )
            .await
        }

        AutomatorAction::Assert {
            kind,
            selector,
            selector_candidates,
            value,
            timeout_ms,
            url_contain,
        } => {
            try_browser_assert(
                kind,
                sanitized_optional_str(selector.as_deref()),
                Some(selector_candidates.as_slice()),
                sanitized_optional_str(value.as_deref()),
                *timeout_ms,
                sanitized_optional_str(url_contain.as_deref()),
            )
            .await
        }

        AutomatorAction::Scroll { delta } => {
            let _ = enigo.scroll(*delta, Axis::Vertical);
            true
        }

        AutomatorAction::Wait { ms } => {
            tokio::time::sleep(Duration::from_millis(*ms)).await;
            true
        }

        AutomatorAction::CheckColor { .. } => true,
        AutomatorAction::Iterate { .. } => true,

        AutomatorAction::LaunchBrowser {
            browser,
            url,
            use_temp_profile,
        } => {
            let is_edge = browser.to_lowercase() == "edge";
            let url_clone = url.clone();
            let use_temp = *use_temp_profile;
            let res = tauri::async_runtime::spawn_blocking(move || {
                launch_debug_browser(is_edge, url_clone, use_temp)
            })
            .await;

            if res.is_ok() {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            res.is_ok()
        }
    }
}

pub fn run_workflow_task<R: Runtime>(
    app: AppHandle<R>,
    workflow: Workflow,
    running_flag: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => e,
            Err(_e) => {
                running_flag.store(false, Ordering::SeqCst);
                let _ = app.emit("automator:status", false);
                return;
            }
        };

        let mut current_loop = 0;

        'outer: while running_flag.load(Ordering::SeqCst) {
            if workflow.repeat_count > 0 && current_loop >= workflow.repeat_count {
                break 'outer;
            }

            for (index, action) in workflow.actions.iter().enumerate() {
                if !running_flag.load(Ordering::SeqCst) {
                    break 'outer;
                }

                let _ = app.emit("automator:step", index);

                let action_ok = execute_smart_action(&mut enigo, action).await;
                if !action_ok {
                    break 'outer;
                }

                tokio::time::sleep(Duration::from_millis(100)).await;
            }

            current_loop += 1;
            let _ = app.emit("automator:loop_count", current_loop);
        }

        reset_all_inputs_surgical(&mut enigo);

        running_flag.store(false, Ordering::SeqCst);
        let _ = app.emit("automator:status", false);
    });
}

fn map_button(btn: &MouseButton) -> Button {
    match btn {
        MouseButton::Left => Button::Left,
        MouseButton::Right => Button::Right,
        MouseButton::Middle => Button::Middle,
    }
}

fn map_key(key_str: &str) -> Option<Key> {
    let trimmed = key_str.trim();
    let normalized = trimmed.to_lowercase();

    match normalized.as_str() {
        "enter" | "return" => Some(Key::Return),
        "space" => Some(Key::Space),
        "backspace" => Some(Key::Backspace),
        "tab" => Some(Key::Tab),
        "escape" | "esc" => Some(Key::Escape),
        "delete" | "del" => Some(Key::Delete),
        "home" => Some(Key::Home),
        "end" => Some(Key::End),
        "pageup" | "page up" => Some(Key::PageUp),
        "pagedown" | "page down" => Some(Key::PageDown),
        "up" | "arrowup" | "arrow up" => Some(Key::UpArrow),
        "down" | "arrowdown" | "arrow down" => Some(Key::DownArrow),
        "left" | "arrowleft" | "arrow left" => Some(Key::LeftArrow),
        "right" | "arrowright" | "arrow right" => Some(Key::RightArrow),
        "f1" => Some(Key::F1),
        "f2" => Some(Key::F2),
        "f3" => Some(Key::F3),
        "f4" => Some(Key::F4),
        "f5" => Some(Key::F5),
        "f6" => Some(Key::F6),
        "f7" => Some(Key::F7),
        "f8" => Some(Key::F8),
        "f9" => Some(Key::F9),
        "f10" => Some(Key::F10),
        "f11" => Some(Key::F11),
        "f12" => Some(Key::F12),
        "f13" => Some(Key::F13),
        "f14" => Some(Key::F14),
        "f15" => Some(Key::F15),
        "f16" => Some(Key::F16),
        "f17" => Some(Key::F17),
        "f18" => Some(Key::F18),
        "f19" => Some(Key::F19),
        "f20" => Some(Key::F20),
        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        "f21" => Some(Key::F21),
        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        "f22" => Some(Key::F22),
        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        "f23" => Some(Key::F23),
        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        "f24" => Some(Key::F24),
        _ => {
            let mut chars = trimmed.chars();
            match (chars.next(), chars.next()) {
                (Some(ch), None) => Some(Key::Unicode(ch)),
                _ => None,
            }
        }
    }
}

fn execute_key_combination(enigo: &mut Enigo, key_combo: &str) {
    let parts: Vec<&str> = key_combo.split('+').collect();
    let mut modifiers = Vec::new();
    let mut main_key = None;

    for part in parts {
        let part_trimmed = part.trim();
        let part_lower = part_trimmed.to_lowercase();
        match part_lower.as_str() {
            "control" | "ctrl" => modifiers.push(Key::Control),
            "alt" => modifiers.push(Key::Alt),
            "shift" => modifiers.push(Key::Shift),
            "meta" | "command" | "cmd" => modifiers.push(Key::Meta),
            _ => {
                if let Some(k) = map_key(part_trimmed) {
                    main_key = Some(k);
                }
            }
        }
    }

    for m in &modifiers {
        let _ = enigo.key(*m, Direction::Press);
    }
    if let Some(k) = main_key {
        let _ = enigo.key(k, Direction::Click);
    } else if modifiers.is_empty() {
    } else if let Some(m) = modifiers.first() {
        let _ = enigo.key(*m, Direction::Click);
    }
    for m in modifiers.iter().rev() {
        let _ = enigo.key(*m, Direction::Release);
    }
}

fn reset_all_inputs_surgical(enigo: &mut Enigo) {
    let buttons = [Button::Left, Button::Right, Button::Middle];
    for btn in buttons {
        let _ = enigo.button(btn, Direction::Release);
    }
    let modifiers = [Key::Alt, Key::Control, Key::Shift, Key::Meta];
    for key in modifiers {
        let _ = enigo.key(key, Direction::Release);
    }
}

fn color_match(actual: &str, expected: &str, tolerance: u32) -> bool {
    if actual.len() != 7 || expected.len() != 7 {
        return false;
    }
    if !actual.starts_with('#') || !expected.starts_with('#') {
        return false;
    }
    let parse = |s: &str| u32::from_str_radix(s, 16).unwrap_or(0);
    let ar = parse(&actual[1..3]);
    let ag = parse(&actual[3..5]);
    let ab = parse(&actual[5..7]);
    let er = parse(&expected[1..3]);
    let eg = parse(&expected[3..5]);
    let eb = parse(&expected[5..7]);
    let diff_r = (ar as i32 - er as i32).unsigned_abs();
    let diff_g = (ag as i32 - eg as i32).unsigned_abs();
    let diff_b = (ab as i32 - eb as i32).unsigned_abs();
    diff_r <= tolerance && diff_g <= tolerance && diff_b <= tolerance
}

pub fn run_graph_task<R: Runtime>(
    app: AppHandle<R>,
    graph: WorkflowGraph,
    running_flag: Arc<AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        let mut enigo = match Enigo::new(&Settings::default()) {
            Ok(e) => e,
            Err(_e) => {
                running_flag.store(false, Ordering::SeqCst);
                let _ = app.emit("automator:status", false);
                return;
            }
        };

        let mut node_counters: HashMap<String, u32> = HashMap::new();
        let mut current_id = Some(graph.start_node_id.clone());
        let mut execution_count = 0u32;
        const MAX_EXECUTION_COUNT: u32 = 10000;

        while let Some(id) = current_id {
            execution_count += 1;
            if execution_count > MAX_EXECUTION_COUNT {
                break;
            }

            if !running_flag.load(Ordering::SeqCst) {
                break;
            }

            let node = match graph.nodes.get(&id) {
                Some(n) => n,
                None => {
                    break;
                }
            };

            let _ = app.emit("automator:step", &id);

            match &node.action {
                AutomatorAction::CheckColor {
                    x,
                    y,
                    expected_hex,
                    tolerance,
                } => {
                    let x_coord = *x;
                    let y_coord = *y;
                    let expected_hex_clone = expected_hex.clone();
                    let tolerance_clone = *tolerance;

                    let color_res = tauri::async_runtime::spawn_blocking(move || {
                        screen::get_color_at(x_coord, y_coord)
                    })
                    .await;

                    match color_res {
                        Ok(Ok(actual_color)) => {
                            let is_match =
                                color_match(&actual_color, &expected_hex_clone, tolerance_clone);
                            current_id = if is_match {
                                node.true_id.clone()
                            } else {
                                node.false_id.clone()
                            };
                        }
                        Ok(Err(_e)) => {
                            current_id = node.false_id.clone();
                        }
                        Err(_e) => {
                            break;
                        }
                    }
                }

                AutomatorAction::Iterate { target_count } => {
                    let count = node_counters.entry(id.clone()).or_insert(0);

                    if *count < *target_count {
                        *count += 1;
                        current_id = node.true_id.clone();
                    } else {
                        *count = 0;
                        current_id = node.false_id.clone();
                    }
                }

                _ => {
                    let action_ok = execute_smart_action(&mut enigo, &node.action).await;
                    if !action_ok {
                        break;
                    }
                    current_id = node.next_id.clone();
                }
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        reset_all_inputs_surgical(&mut enigo);

        running_flag.store(false, Ordering::SeqCst);
        let _ = app.emit("automator:status", false);
    });
}

#[cfg(test)]
mod tests {
    use super::{map_key, AutomatorState};
    use enigo::Key;

    #[test]
    fn automator_state_try_start_is_atomic() {
        let state = AutomatorState::new();

        assert!(state.try_start());
        assert!(!state.try_start());

        state.stop();
        assert!(state.try_start());
    }

    #[test]
    fn map_key_supports_named_function_keys_and_single_characters() {
        assert!(matches!(map_key("enter"), Some(Key::Return)));
        assert!(matches!(map_key("F13"), Some(Key::F13)));
        assert!(matches!(map_key("f20"), Some(Key::F20)));
        assert!(matches!(map_key("A"), Some(Key::Unicode('A'))));
        assert!(matches!(map_key("?"), Some(Key::Unicode('?'))));
        assert!(matches!(map_key("7"), Some(Key::Unicode('7'))));
        assert!(matches!(map_key("ab"), None));

        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        {
            assert!(matches!(map_key("f21"), Some(Key::F21)));
            assert!(matches!(map_key("F24"), Some(Key::F24)));
        }
    }
}
