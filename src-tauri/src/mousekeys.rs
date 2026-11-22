//! The mouse's side buttons (Mouse4 / Mouse5) as macro hotkeys. Global
//! shortcuts only know keyboard keys, so a low-level mouse hook watches the
//! two buttons while a macro is bound to one; the click is taken (the game
//! doesn't get it). Our own played input (SendInput) is let through.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
    LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_QUIT, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

/// The side button of a hotkey string: 1 = Mouse4 (XBUTTON1), 2 = Mouse5.
pub fn button(keys: &str) -> Option<u16> {
    match keys {
        "Mouse4" => Some(1),
        "Mouse5" => Some(2),
        _ => None,
    }
}

/// The bound buttons: (button, macro index, only with Destiny in front).
/// Kept here so the hook reads no files.
static BINDINGS: Mutex<Vec<(u16, usize, bool)>> = Mutex::new(Vec::new());
/// A button whose press was taken: its letting go is taken too.
static HELD: [AtomicBool; 2] = [AtomicBool::new(false), AtomicBool::new(false)];
/// The hook thread (0: none).
static THREAD: AtomicU32 = AtomicU32::new(0);
/// Presses go to a worker, the hook itself must return at once.
static EVENTS: OnceLock<Mutex<Sender<(usize, bool)>>> = OnceLock::new();

/// Set the bound buttons (from hotkeys::register_all). The hook runs only
/// while at least one is bound.
pub fn update(app: &AppHandle, bindings: Vec<(u16, usize, bool)>) {
    let any = !bindings.is_empty();
    *BINDINGS.lock().unwrap() = bindings;
    let running = THREAD.load(Ordering::SeqCst);
    if any && running == 0 {
        start(app);
    } else if !any && running != 0 {
        THREAD.store(0, Ordering::SeqCst);
        unsafe {
            let _ = PostThreadMessageW(running, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

fn start(app: &AppHandle) {
    EVENTS.get_or_init(|| {
        let (tx, rx) = channel::<(usize, bool)>();
        let app = app.clone();
        std::thread::spawn(move || {
            for (index, pressed) in rx {
                crate::macros::on_hotkey(&app, index, pressed);
            }
        });
        Mutex::new(tx)
    });
    let (ready_tx, ready_rx) = channel::<u32>();
    std::thread::spawn(move || unsafe {
        let Ok(hook) = SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), None, 0) else {
            let _ = ready_tx.send(0);
            return;
        };
        let _ = ready_tx.send(GetCurrentThreadId());
        let mut msg = MSG::default();
        // The hook is called on this thread while it waits for messages.
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        let _ = UnhookWindowsHookEx(hook);
    });
    if let Ok(id) = ready_rx.recv() {
        THREAD.store(id, Ordering::SeqCst);
    }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    if code == HC_ACTION as i32 && (message == WM_XBUTTONDOWN || message == WM_XBUTTONUP) {
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let button = (info.mouseData >> 16) as u16;
        if info.flags & LLMHF_INJECTED == 0 && (button == 1 || button == 2) {
            let held = &HELD[button as usize - 1];
            let pressed = message == WM_XBUTTONDOWN;
            if pressed {
                let bound = BINDINGS.lock().unwrap().iter().find(|(b, _, _)| *b == button).copied();
                if let Some((_, index, focused)) = bound {
                    if !focused || crate::hotkeys::is_active() {
                        held.store(true, Ordering::SeqCst);
                        send(index, true);
                        return LRESULT(1);
                    }
                }
            } else if held.swap(false, Ordering::SeqCst) {
                let bound = BINDINGS.lock().unwrap().iter().find(|(b, _, _)| *b == button).copied();
                if let Some((_, index, _)) = bound {
                    send(index, false);
                }
                return LRESULT(1);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn send(index: usize, pressed: bool) {
    if let Some(tx) = EVENTS.get() {
        let _ = tx.lock().unwrap().send((index, pressed));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn side_buttons() {
        assert_eq!(super::button("Mouse4"), Some(1));
        assert_eq!(super::button("Mouse5"), Some(2));
        assert_eq!(super::button("Ctrl+Mouse4"), None);
        assert_eq!(super::button("F4"), None);
    }
}
