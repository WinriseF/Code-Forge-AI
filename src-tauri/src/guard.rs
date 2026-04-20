use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager, Wry};

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GuardConfig {
    pub enabled: bool,
    pub idle_timeout_secs: u64,
    pub prevent_sleep: bool,
    pub keep_display_on: bool,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            idle_timeout_secs: 180,
            prevent_sleep: true,
            keep_display_on: false,
        }
    }
}

pub struct GuardState {
    config: Mutex<GuardConfig>,
    #[cfg(target_os = "windows")]
    runtime: windows_impl::GuardRuntime,
}

impl Default for GuardState {
    fn default() -> Self {
        Self {
            config: Mutex::new(GuardConfig::default()),
            #[cfg(target_os = "windows")]
            runtime: windows_impl::GuardRuntime::new(),
        }
    }
}

impl GuardState {
    pub fn initialize(&self, app: &AppHandle<Wry>) {
        let config = load_guard_config(app);
        if let Ok(mut current) = self.config.lock() {
            *current = config.clone();
        }

        #[cfg(target_os = "windows")]
        self.runtime.initialize(app.clone(), config);
    }

    pub fn refresh(&self, app: &AppHandle<Wry>) {
        let config = load_guard_config(app);
        if let Ok(mut current) = self.config.lock() {
            *current = config.clone();
        }

        #[cfg(target_os = "windows")]
        self.runtime.refresh_config(app, config);
    }

    pub fn release(&self, app: &AppHandle<Wry>) -> crate::error::Result<()> {
        #[cfg(target_os = "windows")]
        {
            return self.runtime.release(app);
        }

        #[allow(unreachable_code)]
        Ok(())
    }

    pub fn activate_now(&self, app: &AppHandle<Wry>) -> crate::error::Result<()> {
        #[cfg(target_os = "windows")]
        {
            return self.runtime.activate(app);
        }

        #[allow(unreachable_code)]
        Ok(())
    }
}

fn load_guard_config(app: &AppHandle<Wry>) -> GuardConfig {
    let mut config = GuardConfig::default();

    if let Some(state) = crate::app_config::load_app_config_state(app) {
        if let Some(guard_settings) = state.guard_settings {
            if let Some(enabled) = guard_settings.enabled {
                config.enabled = enabled;
            }
            if let Some(idle_timeout_secs) = guard_settings.idle_timeout_secs {
                config.idle_timeout_secs = idle_timeout_secs.max(15);
            }
            if let Some(prevent_sleep) = guard_settings.prevent_sleep {
                config.prevent_sleep = prevent_sleep;
            }
            if let Some(keep_display_on) = guard_settings.keep_display_on {
                config.keep_display_on = keep_display_on;
            }
        }

        if let Some(enabled) = state.guard_enabled {
            config.enabled = enabled;
        }
        if let Some(idle_timeout_secs) = state.guard_idle_timeout_secs {
            config.idle_timeout_secs = idle_timeout_secs.max(15);
        }
        if let Some(prevent_sleep) = state.guard_prevent_sleep {
            config.prevent_sleep = prevent_sleep;
        }
        if let Some(keep_display_on) = state.guard_keep_display_on {
            config.keep_display_on = keep_display_on;
        }
    }

    if !config.prevent_sleep {
        config.keep_display_on = false;
    }

    config
}

#[tauri::command]
pub fn refresh_guard_service(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        if let Some(state) = app.try_state::<GuardState>() {
            state.refresh(&app);
        }
    });
}

#[tauri::command]
pub fn guard_request_release(app: tauri::AppHandle) -> crate::error::Result<()> {
    if let Some(state) = app.try_state::<GuardState>() {
        state.release(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn activate_guard_now(app: tauri::AppHandle) -> crate::error::Result<()> {
    if let Some(state) = app.try_state::<GuardState>() {
        state.activate_now(&app)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::sync::Arc;
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
    use std::time::Duration;

    use tauri::window::Color;
    use tauri::{
        AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, Wry,
    };
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::Power::{
        ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, EXECUTION_STATE,
        SetThreadExecutionState,
    };
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_CONTROL, VK_ESCAPE, VK_F4, VK_LWIN,
        VK_MENU, VK_RWIN, VK_SPACE, VK_TAB,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GA_ROOT, GetAncestor, GetForegroundWindow, GetMessageW,
        GetSystemMetrics, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, SM_CXVIRTUALSCREEN,
        SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOOWNERZORDER, SWP_NOZORDER, SetWindowPos, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDBLCLK,
        WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDBLCLK, WM_MBUTTONDOWN, WM_MBUTTONUP,
        WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDBLCLK, WM_RBUTTONDOWN,
        WM_RBUTTONUP, WM_SYSKEYDOWN, WindowFromPoint,
    };

    use super::GuardConfig;

    const GUARD_WINDOW_LABEL: &str = "guard";
    const KEEP_AWAKE_REFRESH_INTERVAL: Duration = Duration::from_secs(15);

    struct GuardRuntimeInner {
        active: AtomicBool,
        enabled: AtomicBool,
        prevent_sleep: AtomicBool,
        keep_display_on: AtomicBool,
        idle_timeout_secs: AtomicU64,
        guard_hwnd: AtomicI64,
        monitor_started: AtomicBool,
        hook_started: AtomicBool,
        last_keep_awake_refresh_ms: AtomicU64,
    }

    pub struct GuardRuntime {
        inner: Arc<GuardRuntimeInner>,
    }

    static HOOK_RUNTIME: OnceLock<Arc<GuardRuntimeInner>> = OnceLock::new();

    impl GuardRuntime {
        pub fn new() -> Self {
            Self {
                inner: Arc::new(GuardRuntimeInner {
                    active: AtomicBool::new(false),
                    enabled: AtomicBool::new(false),
                    prevent_sleep: AtomicBool::new(true),
                    keep_display_on: AtomicBool::new(false),
                    idle_timeout_secs: AtomicU64::new(180),
                    guard_hwnd: AtomicI64::new(0),
                    monitor_started: AtomicBool::new(false),
                    hook_started: AtomicBool::new(false),
                    last_keep_awake_refresh_ms: AtomicU64::new(0),
                }),
            }
        }

        pub fn initialize(&self, app: AppHandle<Wry>, config: GuardConfig) {
            let _ = HOOK_RUNTIME.get_or_init(|| self.inner.clone());
            self.apply_config(config);
            self.start_hook_thread();
            self.start_monitor_thread(app);
        }

        pub fn refresh_config(&self, app: &AppHandle<Wry>, config: GuardConfig) {
            self.apply_config(config.clone());

            if !config.enabled && self.inner.active.load(Ordering::SeqCst) {
                let _ = self.release(app);
                return;
            }

            if self.inner.active.load(Ordering::SeqCst) {
                let _ = apply_keep_awake(&self.inner);
                let _ = ensure_guard_window(app, &self.inner);
            }
        }

        pub fn activate(&self, app: &AppHandle<Wry>) -> crate::error::Result<()> {
            if self.inner.active.load(Ordering::SeqCst) {
                focus_guard_window(app, &self.inner)?;
                return Ok(());
            }

            ensure_guard_window(app, &self.inner)?;
            focus_guard_window(app, &self.inner)?;
            apply_keep_awake(&self.inner)?;
            self.inner.active.store(true, Ordering::SeqCst);
            Ok(())
        }

        pub fn release(&self, app: &AppHandle<Wry>) -> crate::error::Result<()> {
            self.inner.active.store(false, Ordering::SeqCst);
            self.inner
                .last_keep_awake_refresh_ms
                .store(0, Ordering::SeqCst);

            clear_keep_awake();

            if let Some(window) = app.get_webview_window(GUARD_WINDOW_LABEL) {
                let _ = window.hide();
            }

            Ok(())
        }

        fn apply_config(&self, config: GuardConfig) {
            self.inner.enabled.store(config.enabled, Ordering::SeqCst);
            self.inner
                .prevent_sleep
                .store(config.prevent_sleep, Ordering::SeqCst);
            self.inner.keep_display_on.store(
                config.prevent_sleep && config.keep_display_on,
                Ordering::SeqCst,
            );
            self.inner
                .idle_timeout_secs
                .store(config.idle_timeout_secs.max(15), Ordering::SeqCst);
        }

        fn start_monitor_thread(&self, app: AppHandle<Wry>) {
            if self.inner.monitor_started.swap(true, Ordering::SeqCst) {
                return;
            }

            let inner = self.inner.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(1));

                    if inner.active.load(Ordering::SeqCst) {
                        if let Some(window) = app.get_webview_window(GUARD_WINDOW_LABEL) {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }

                        let _ = ensure_guard_window(&app, &inner);
                        let _ = refresh_keep_awake_if_needed(&inner);
                        continue;
                    }

                    if !inner.enabled.load(Ordering::SeqCst) {
                        continue;
                    }

                    let idle_timeout_secs = inner.idle_timeout_secs.load(Ordering::SeqCst);
                    if idle_timeout_secs == 0 {
                        continue;
                    }

                    let Some(idle_ms) = current_idle_ms() else {
                        continue;
                    };

                    if idle_ms >= idle_timeout_secs.saturating_mul(1000) {
                        if ensure_guard_window(&app, &inner).is_err() {
                            continue;
                        }
                        if focus_guard_window(&app, &inner).is_err() {
                            continue;
                        }

                        inner.active.store(true, Ordering::SeqCst);
                        let _ = apply_keep_awake(&inner);
                    }
                }
            });
        }

        fn start_hook_thread(&self) {
            if self.inner.hook_started.swap(true, Ordering::SeqCst) {
                return;
            }

            std::thread::spawn(move || unsafe {
                let keyboard_hook =
                    match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), None, 0) {
                        Ok(hook) => hook,
                        Err(err) => {
                            eprintln!("[Guard] Failed to install keyboard hook: {err}");
                            return;
                        }
                    };

                let mouse_hook =
                    match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0) {
                        Ok(hook) => hook,
                        Err(err) => {
                            let _ = UnhookWindowsHookEx(keyboard_hook);
                            eprintln!("[Guard] Failed to install mouse hook: {err}");
                            return;
                        }
                    };

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).into() {
                    let _ = TranslateMessage(&msg);
                    let _ = DispatchMessageW(&msg);
                }

                let _ = UnhookWindowsHookEx(mouse_hook);
                let _ = UnhookWindowsHookEx(keyboard_hook);
            });
        }
    }

    fn current_runtime() -> Option<&'static Arc<GuardRuntimeInner>> {
        HOOK_RUNTIME.get()
    }

    unsafe extern "system" fn keyboard_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code < 0 {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let Some(runtime) = current_runtime() else {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        };

        if !runtime.active.load(Ordering::SeqCst) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let message = wparam.0 as u32;
        let data = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let vk = data.vkCode;

        if (message == WM_SYSKEYDOWN || message == WM_KEYDOWN) && is_guard_escape_shortcut(vk) {
            return LRESULT(1);
        }

        if is_guard_foreground(runtime) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        LRESULT(1)
    }

    unsafe extern "system" fn mouse_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code < 0 {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let Some(runtime) = current_runtime() else {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        };

        if !runtime.active.load(Ordering::SeqCst) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let message = wparam.0 as u32;
        if !matches!(
            message,
            WM_MOUSEMOVE
                | WM_LBUTTONDOWN
                | WM_LBUTTONUP
                | WM_LBUTTONDBLCLK
                | WM_RBUTTONDOWN
                | WM_RBUTTONUP
                | WM_RBUTTONDBLCLK
                | WM_MBUTTONDOWN
                | WM_MBUTTONUP
                | WM_MBUTTONDBLCLK
                | WM_MOUSEWHEEL
                | WM_MOUSEHWHEEL
        ) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if is_guard_target(runtime, data.pt) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        LRESULT(1)
    }

    fn is_guard_escape_shortcut(vk: u32) -> bool {
        let alt_down = unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } < 0;
        let ctrl_down = unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } < 0;

        vk == VK_LWIN.0 as u32
            || vk == VK_RWIN.0 as u32
            || (alt_down
                && matches!(
                    vk,
                    key if key == VK_TAB.0 as u32
                        || key == VK_ESCAPE.0 as u32
                        || key == VK_F4.0 as u32
                        || key == VK_SPACE.0 as u32
                ))
            || (ctrl_down && vk == VK_ESCAPE.0 as u32)
    }

    fn is_guard_foreground(runtime: &GuardRuntimeInner) -> bool {
        let hwnd = guard_hwnd(runtime);
        if hwnd.0.is_null() {
            return false;
        }

        let foreground = unsafe { GetForegroundWindow() };
        !foreground.0.is_null() && root_window(foreground) == hwnd
    }

    fn is_guard_target(runtime: &GuardRuntimeInner, point: POINT) -> bool {
        let hwnd = guard_hwnd(runtime);
        if hwnd.0.is_null() {
            return false;
        }

        let target = unsafe { WindowFromPoint(point) };
        !target.0.is_null() && root_window(target) == hwnd
    }

    fn root_window(hwnd: HWND) -> HWND {
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        if root.0.is_null() { hwnd } else { root }
    }

    fn guard_hwnd(runtime: &GuardRuntimeInner) -> HWND {
        HWND(runtime.guard_hwnd.load(Ordering::SeqCst) as *mut _)
    }

    fn ensure_guard_window(
        app: &AppHandle<Wry>,
        runtime: &Arc<GuardRuntimeInner>,
    ) -> crate::error::Result<()> {
        let window = if let Some(existing) = app.get_webview_window(GUARD_WINDOW_LABEL) {
            existing
        } else {
            let builder = WebviewWindowBuilder::new(
                app,
                GUARD_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("Guard")
            .decorations(false)
            .resizable(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .visible(false)
            .background_color(Color(0, 0, 0, 0))
            .use_https_scheme(true);

            #[cfg(not(target_os = "macos"))]
            let builder = builder.transparent(true);

            let window = builder.build().map_err(|e| e.to_string())?;
            crate::window_styling::configure_guard_window(&window);
            window
        };

        let bounds = virtual_screen_bounds();
        let _ = window.set_position(PhysicalPosition::new(bounds.0, bounds.1));
        let _ = window.set_size(PhysicalSize::new(bounds.2, bounds.3));

        if let Ok(hwnd) = window.hwnd() {
            runtime
                .guard_hwnd
                .store(hwnd.0 as isize as i64, Ordering::SeqCst);

            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    None,
                    bounds.0,
                    bounds.1,
                    bounds.2 as i32,
                    bounds.3 as i32,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER | SWP_FRAMECHANGED,
                );
            }
        }

        Ok(())
    }

    fn focus_guard_window(
        app: &AppHandle<Wry>,
        runtime: &Arc<GuardRuntimeInner>,
    ) -> crate::error::Result<()> {
        ensure_guard_window(app, runtime)?;

        let Some(window) = app.get_webview_window(GUARD_WINDOW_LABEL) else {
            return Err("Guard window is unavailable".into());
        };

        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        Ok(())
    }

    fn virtual_screen_bounds() -> (i32, i32, u32, u32) {
        unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as u32;
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as u32;
            (x, y, width, height)
        }
    }

    fn current_idle_ms() -> Option<u64> {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            ..Default::default()
        };

        unsafe {
            if !GetLastInputInfo(&mut info).as_bool() {
                return None;
            }

            let now = GetTickCount64();
            Some(now.saturating_sub(info.dwTime as u64))
        }
    }

    fn refresh_keep_awake_if_needed(inner: &Arc<GuardRuntimeInner>) -> crate::error::Result<()> {
        if !inner.prevent_sleep.load(Ordering::SeqCst) {
            return Ok(());
        }

        let now = unsafe { GetTickCount64() };
        let last = inner.last_keep_awake_refresh_ms.load(Ordering::SeqCst);
        if now.saturating_sub(last) >= KEEP_AWAKE_REFRESH_INTERVAL.as_millis() as u64 {
            apply_keep_awake(inner)?;
        }

        Ok(())
    }

    fn apply_keep_awake(inner: &Arc<GuardRuntimeInner>) -> crate::error::Result<()> {
        if !inner.prevent_sleep.load(Ordering::SeqCst) {
            clear_keep_awake();
            return Ok(());
        }

        let state = if inner.keep_display_on.load(Ordering::SeqCst) {
            ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED | ES_CONTINUOUS
        } else {
            ES_SYSTEM_REQUIRED | ES_CONTINUOUS
        };

        unsafe {
            if SetThreadExecutionState(state) == EXECUTION_STATE(0) {
                return Err("Failed to update execution state".into());
            }
        }

        inner
            .last_keep_awake_refresh_ms
            .store(unsafe { GetTickCount64() }, Ordering::SeqCst);
        Ok(())
    }

    fn clear_keep_awake() {
        unsafe {
            let _ = SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}
