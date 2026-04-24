use std::sync::Mutex;

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Wry};

#[cfg(target_os = "windows")]
use tauri::{Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder, window::Color};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeekOpenPayload {
    pub session_id: u64,
    pub paths: Vec<String>,
    pub active_index: usize,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct PeekRequest {
    paths: Vec<String>,
    active_index: usize,
}

#[derive(Default)]
pub struct PeekState {
    latest_request: Mutex<Option<PeekOpenPayload>>,
    #[cfg(target_os = "windows")]
    session_counter: AtomicU64,
}

impl PeekState {
    #[cfg(target_os = "windows")]
    fn publish(&self, request: PeekRequest) -> PeekOpenPayload {
        let session_id = self.session_counter.fetch_add(1, Ordering::SeqCst) + 1;
        let payload = PeekOpenPayload {
            session_id,
            paths: request.paths,
            active_index: request.active_index,
        };

        if let Ok(mut latest_request) = self.latest_request.lock() {
            *latest_request = Some(payload.clone());
        }

        payload
    }

    fn current(&self) -> Option<PeekOpenPayload> {
        self.latest_request
            .lock()
            .ok()
            .and_then(|request| request.clone())
    }

    fn clear(&self) {
        if let Ok(mut latest_request) = self.latest_request.lock() {
            *latest_request = None;
        }
    }
}

#[tauri::command]
pub fn peek_get_request(state: State<'_, PeekState>) -> Option<PeekOpenPayload> {
    state.current()
}

#[tauri::command]
pub fn peek_clear_request(state: State<'_, PeekState>) {
    state.clear();
}

pub fn clear_pending_request(app: &AppHandle<Wry>) {
    app.state::<PeekState>().clear();
}

#[cfg(target_os = "windows")]
pub fn initialize(app: &AppHandle<Wry>) {
    windows_impl::initialize(app.clone());
}

#[cfg(not(target_os = "windows"))]
pub fn initialize(_app: &AppHandle<Wry>) {}

#[cfg(target_os = "windows")]
fn ensure_peek_window(app: &AppHandle<Wry>) -> Option<tauri::WebviewWindow<Wry>> {
    if let Some(window) = app.get_webview_window("peek") {
        return Some(window);
    }

    let builder = WebviewWindowBuilder::new(app, "peek", WebviewUrl::App("index.html".into()))
        .title("Peek")
        .inner_size(1100.0, 760.0)
        .background_color(Color(0, 0, 0, 0))
        .center()
        .decorations(false)
        .resizable(true)
        .shadow(false)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .focused(true)
        .use_https_scheme(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    match builder.build() {
        Ok(window) => {
            configure_peek_window(&window);
            Some(window)
        }
        Err(err) => {
            eprintln!("[Peek] Failed to create window: {err}");
            app.get_webview_window("peek")
        }
    }
}

#[cfg(target_os = "windows")]
fn open_peek_window(app: &AppHandle<Wry>, request: PeekRequest) {
    let Some(window) = ensure_peek_window(app) else {
        return;
    };

    let payload = {
        let state = app.state::<PeekState>();
        state.publish(request)
    };

    let _ = window.emit("peek:open", payload);
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(target_os = "windows")]
fn configure_peek_window(window: &WebviewWindow) {
    let _ = window.set_shadow(false);
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    windows_style::apply_peek_window_style(window);
}

#[cfg(target_os = "windows")]
mod windows_style {
    use std::mem::size_of_val;

    use tauri::WebviewWindow;
    use windows::Win32::Graphics::Dwm::{
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        DwmSetWindowAttribute,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos,
    };

    pub fn apply_peek_window_style(window: &WebviewWindow) {
        let Ok(hwnd) = window.hwnd() else {
            return;
        };

        unsafe {
            let corner_preference = DWMWCP_ROUND;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &corner_preference as *const _ as _,
                size_of_val(&corner_preference) as u32,
            );

            let border_color = DWMWA_COLOR_NONE;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &border_color as *const _ as _,
                size_of_val(&border_color) as u32,
            );

            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::{PeekRequest, open_peek_window};
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{SyncSender, sync_channel};
    use std::thread;

    use tauri::{AppHandle, Wry};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
    };
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, GetFocus, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::Shell::{
        FolderItem, FolderItems, IShellFolderViewDual, IShellWindows, IWebBrowserApp, ShellWindows,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GUITHREADINFO, GetClassNameW, GetForegroundWindow,
        GetGUIThreadInfo, GetMessageW, GetParent, GetWindowThreadProcessId, KBDLLHOOKSTRUCT, MSG,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, WH_KEYBOARD_LL, WM_KEYDOWN,
        WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };
    use windows::core::Interface;

    static TRIGGER_TX: OnceLock<SyncSender<()>> = OnceLock::new();
    static SPACE_IS_DOWN: AtomicBool = AtomicBool::new(false);

    const SPACE_VK: u32 = 0x20;
    const EXPLORER_CLASSES: &[&str] = &["CabinetWClass", "ExploreWClass"];
    const BLOCKED_FOCUS_CLASSES: &[&str] = &[
        "Edit",
        "ComboBox",
        "ComboBoxEx32",
        "SearchEditBox",
        "Windows.UI.Core.CoreWindow",
        "RichEditD2DPT",
        "RichEdit50W",
    ];

    pub fn initialize(app: AppHandle<Wry>) {
        let (tx, rx) = sync_channel(1);
        let _ = TRIGGER_TX.set(tx);

        let worker_app = app.clone();
        thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            }

            while rx.recv().is_ok() {
                match resolve_foreground_request() {
                    Ok(Some(request)) => open_peek_window(&worker_app, request),
                    Ok(None) => {}
                    Err(err) => eprintln!("[Peek] Failed to resolve Explorer selection: {err}"),
                }
            }
        });

        thread::spawn(move || unsafe {
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), None, 0) {
                Ok(hook) => hook,
                Err(err) => {
                    eprintln!("[Peek] Failed to install keyboard hook: {err}");
                    return;
                }
            };

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                let _ = TranslateMessage(&msg);
                let _ = DispatchMessageW(&msg);
            }

            let _ = UnhookWindowsHookEx(hook);
        });
    }

    unsafe extern "system" fn keyboard_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code < 0 {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        let msg = wparam.0 as u32;
        let key = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };

        if key.vkCode != SPACE_VK {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        if matches!(msg, WM_KEYUP | WM_SYSKEYUP) {
            SPACE_IS_DOWN.store(false, Ordering::SeqCst);
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        if !matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        if SPACE_IS_DOWN.swap(true, Ordering::SeqCst) {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        if has_modifier_key_pressed() || !is_foreground_explorer_ready() {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        if let Some(tx) = TRIGGER_TX.get() {
            let _ = tx.try_send(());
        }

        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn has_modifier_key_pressed() -> bool {
        [
            VK_CONTROL.0 as i32,
            VK_MENU.0 as i32,
            VK_SHIFT.0 as i32,
            VK_LWIN.0 as i32,
            VK_RWIN.0 as i32,
        ]
        .into_iter()
        .any(|vk| unsafe { GetAsyncKeyState(vk) } < 0)
    }

    fn is_foreground_explorer_ready() -> bool {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.0.is_null() || !is_explorer_window(hwnd) {
            return false;
        }

        !focus_is_editing(hwnd)
    }

    fn is_explorer_window(hwnd: HWND) -> bool {
        let class_name = window_class_name(hwnd);
        EXPLORER_CLASSES
            .iter()
            .any(|candidate| class_name == *candidate)
    }

    fn focus_is_editing(hwnd: HWND) -> bool {
        let mut pid = 0;
        let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if thread_id == 0 {
            return false;
        }

        let Some(mut current) = focused_control(thread_id) else {
            return false;
        };

        for _ in 0..6 {
            let class_name = window_class_name(current);
            if BLOCKED_FOCUS_CLASSES
                .iter()
                .any(|blocked| class_name.eq_ignore_ascii_case(blocked))
                || class_name.contains("Edit")
            {
                return true;
            }

            let Ok(parent) = (unsafe { GetParent(current) }) else {
                break;
            };

            if parent.0.is_null() {
                break;
            }
            current = parent;
        }

        false
    }

    fn focused_control(thread_id: u32) -> Option<HWND> {
        attached_focus_control(thread_id).or_else(|| gui_thread_focus_control(thread_id))
    }

    fn attached_focus_control(thread_id: u32) -> Option<HWND> {
        let current_thread_id = unsafe { GetCurrentThreadId() };
        let attached = if current_thread_id == thread_id {
            false
        } else {
            unsafe { AttachThreadInput(current_thread_id, thread_id, true) }.as_bool()
        };

        let focused = unsafe { GetFocus() };

        if attached {
            let _ = unsafe { AttachThreadInput(current_thread_id, thread_id, false) };
        }

        if focused.0.is_null() {
            None
        } else {
            Some(focused)
        }
    }

    fn gui_thread_focus_control(thread_id: u32) -> Option<HWND> {
        let mut info = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };

        if unsafe { GetGUIThreadInfo(thread_id, &mut info) }.is_err() || info.hwndFocus.0.is_null()
        {
            None
        } else {
            Some(info.hwndFocus)
        }
    }

    fn window_class_name(hwnd: HWND) -> String {
        let mut buffer = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
        String::from_utf16_lossy(&buffer[..len as usize])
    }

    fn resolve_foreground_request() -> windows::core::Result<Option<PeekRequest>> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0.is_null() {
            return Ok(None);
        }

        let shell_windows: IShellWindows =
            unsafe { CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)? };
        let count = unsafe { shell_windows.Count()? };

        for index in 0..count {
            let browser = match unsafe { shell_windows.Item(&variant_i32(index)) } {
                Ok(dispatch) => match dispatch.cast::<IWebBrowserApp>() {
                    Ok(browser) => browser,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };

            let browser_hwnd = HWND(unsafe { browser.HWND()?.0 as *mut _ });
            if browser_hwnd != foreground {
                continue;
            }

            let document = match unsafe { browser.Document() } {
                Ok(document) => document,
                Err(_) => continue,
            };
            let view = match document.cast::<IShellFolderViewDual>() {
                Ok(view) => view,
                Err(_) => continue,
            };

            let selected_items = unsafe { view.SelectedItems()? };
            let mut paths = collect_file_paths(&selected_items)?;

            if paths.is_empty()
                && let Some(focused_path) = read_item_path(unsafe { view.FocusedItem().ok() })?
            {
                paths.push(focused_path);
            }

            if paths.is_empty() {
                return Ok(None);
            }

            let focused_path = read_item_path(unsafe { view.FocusedItem().ok() })?;
            let active_index = focused_path
                .as_ref()
                .and_then(|path| paths.iter().position(|item| item == path))
                .unwrap_or(0);

            return Ok(Some(PeekRequest {
                paths,
                active_index,
            }));
        }

        Ok(None)
    }

    fn collect_file_paths(items: &FolderItems) -> windows::core::Result<Vec<String>> {
        let count = unsafe { items.Count()? };
        let mut paths = Vec::with_capacity(count.max(0) as usize);

        for index in 0..count {
            let item = unsafe { items.Item(&variant_i32(index)) }?;
            if let Some(path) = read_item_path(Some(item))?
                && !paths.iter().any(|existing| existing == &path)
            {
                paths.push(path);
            }
        }

        Ok(paths)
    }

    fn read_item_path(item: Option<FolderItem>) -> windows::core::Result<Option<String>> {
        let Some(item) = item else {
            return Ok(None);
        };

        if unsafe { item.IsFileSystem()?.as_bool() } {
            let path = unsafe { item.Path()? }.to_string();
            if !path.is_empty() && (!unsafe { item.IsFolder()?.as_bool() } || is_archive_extension(&path)) {
                return Ok(Some(path));
            }
        }

        Ok(None)
    }

    fn is_archive_extension(path: &str) -> bool {
        let lower = path.to_ascii_lowercase();
        [".zip", ".tar", ".gz", ".tgz"].iter().any(|ext| lower.ends_with(ext))
    }

    fn variant_i32(value: i32) -> VARIANT {
        VARIANT::from(value)
    }
}
