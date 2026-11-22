//! The mouse's side buttons (Mouse4 / Mouse5) and Ctrl, Alt or Shift on
//! their own as macro hotkeys. Global shortcuts need a key that isn't one of
//! these, so low-level hooks watch them while a macro is bound to one. A side
//! button's click is taken (the game doesn't get it); Ctrl/Alt/Shift go on as
//! with a combo like Alt+1 (else Alt+Tab would be gone). Our own played input
//! (SendInput) is let through.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};

use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
    KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN,
    WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

/// The hooked input of a hotkey string: 1 = Mouse4 (XBUTTON1), 2 = Mouse5,
/// 3 = Ctrl, 4 = Alt, 5 = Shift (each on its own, left or right).
pub fn button(keys: &str) -> Option<u16> {
    match keys {
        "Mouse4" => Some(1),
        "Mouse5" => Some(2),
        "Ctrl" => Some(3),
        "Alt" => Some(4),
        "Shift" => Some(5),
        _ => None,
    }
}

/// The input of a key code: left or right Ctrl, Alt, Shift.
fn modifier(vk: u32) -> Option<u16> {
    match vk {
        0xA2 | 0xA3 => Some(3), // VK_LCONTROL, VK_RCONTROL
        0xA4 | 0xA5 => Some(4), // VK_LMENU, VK_RMENU
        0xA0 | 0xA1 => Some(5), // VK_LSHIFT, VK_RSHIFT
        _ => None,
    }
}

/// The bound inputs: (input, macro index, only with Destiny in front).
/// Kept here so the hooks read no files.
static BINDINGS: Mutex<Vec<(u16, usize, bool)>> = Mutex::new(Vec::new());
/// An input whose press played: its letting go stops it, and a key held
/// (which repeats) doesn't play again.
static HELD: [AtomicBool; 5] =
    [AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false), AtomicBool::new(false)];
/// The hook thread (0: none).
static THREAD: AtomicU32 = AtomicU32::new(0);
/// Presses go to a worker, the hook itself must return at once.
static EVENTS: OnceLock<Mutex<Sender<(usize, bool)>>> = OnceLock::new();

/// Set the bound inputs (from hotkeys::register_all). The hooks run only
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
        // (Without it the side buttons still work.)
        let keys = SetWindowsHookExW(WH_KEYBOARD_LL, Some(key_proc), None, 0).ok();
        let _ = ready_tx.send(GetCurrentThreadId());
        let mut msg = MSG::default();
        // The hooks are called on this thread while it waits for messages.
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        let _ = UnhookWindowsHookEx(hook);
        if let Some(keys) = keys {
            let _ = UnhookWindowsHookEx(keys);
        }
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
        if info.flags & LLMHF_INJECTED == 0 && (button == 1 || button == 2) && input(button, message == WM_XBUTTONDOWN) {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn key_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    let down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
    if code == HC_ACTION as i32 && (down || message == WM_KEYUP || message == WM_SYSKEYUP) {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if (info.flags & LLKHF_INJECTED).0 == 0 {
            if let Some(key) = modifier(info.vkCode) {
                // Ctrl/Alt/Shift are never taken.
                input(key, down);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Input `key` went down (`pressed`) or up: its macro plays or stops.
/// Whether it was one of ours (a side button's click is then taken).
fn input(key: u16, pressed: bool) -> bool {
    let held = &HELD[key as usize - 1];
    let bound = || BINDINGS.lock().unwrap().iter().find(|(b, _, _)| *b == key).copied();
    if pressed {
        if held.load(Ordering::SeqCst) {
            return true;
        }
        let Some((_, index, focused)) = bound() else { return false };
        if focused && !crate::hotkeys::is_active() {
            return false;
        }
        held.store(true, Ordering::SeqCst);
        send(index, true);
        true
    } else if held.swap(false, Ordering::SeqCst) {
        if let Some((_, index, _)) = bound() {
            send(index, false);
        }
        true
    } else {
        false
    }
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

    #[test]
    fn modifiers_on_their_own() {
        assert_eq!(super::button("Alt"), Some(4));
        assert_eq!(super::button("Alt+Digit1"), None);
        // Left and right are the same.
        assert_eq!(super::modifier(0xA4), super::modifier(0xA5));
        assert_eq!(super::modifier(0xA2), Some(3));
        assert_eq!(super::modifier(0xA0), Some(5));
        assert_eq!(super::modifier(0x41), None);
    }
}
