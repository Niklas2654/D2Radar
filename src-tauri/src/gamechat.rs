//! A chat command into Destiny 2 ("/join Name#1234"), as the player would
//! type it: the command to the clipboard, the game to the front, then
//! Enter (opens the chat; Destiny has no setting for that key: it isn't
//! among the key bindings in its cvars.xml), Ctrl+V and Enter.
//!
//! Only ever typed while the game's own window has the front (checked before
//! every key), and only where the player turned it on (Discord tab: join
//! buttons typing themselves, and the search that joins by itself). The
//! game's process is never opened; these are ordinary key presses.

use std::time::{Duration, Instant};

use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_RETURN, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

/// Clipboard format: UTF-16 text.
const CF_UNICODETEXT: u32 = 13;

/// Text to the clipboard (from the background too, where a page can't).
pub fn copy(text: &str) -> bool {
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        // Another app may hold the clipboard for a moment.
        let mut open = false;
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() {
                open = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        if !open {
            return false;
        }
        let done = (|| -> windows::core::Result<()> {
            EmptyClipboard()?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2)?;
            let target = GlobalLock(memory) as *mut u16;
            if target.is_null() {
                return Err(windows::core::Error::from_thread());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
            let _ = GlobalUnlock(memory);
            // The clipboard owns the memory from here.
            SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0)))?;
            Ok(())
        })();
        let _ = CloseClipboard();
        done.is_ok()
    }
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                // The scan code too: games read the keyboard by it.
                wScan: unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn send(keys: &[INPUT]) {
    unsafe {
        SendInput(keys, std::mem::size_of::<INPUT>() as i32);
    }
}

/// A key pressed and let go, as long as a finger would.
fn tap(vk: VIRTUAL_KEY) {
    send(&[key(vk, false)]);
    std::thread::sleep(Duration::from_millis(35));
    send(&[key(vk, true)]);
}

/// The game's window to the front (restored if minimized), from the
/// background too. Some(whether it had the front already); None if it isn't
/// open or Windows wouldn't hand it over.
fn game_to_front() -> Option<bool> {
    if crate::screen::destiny_in_foreground() {
        return Some(true);
    }
    unsafe {
        let game: HWND = FindWindowW(w!("Tiger D3D Window"), None)
            .ok()
            .filter(|g| !g.is_invalid())?;
        if IsIconic(game).as_bool() {
            let _ = ShowWindow(game, SW_RESTORE);
        }
        // Windows lets a background app bring a window forward only while
        // Alt is held (its own rule against windows stealing the front).
        send(&[key(VK_MENU, false)]);
        let _ = SetForegroundWindow(game);
        send(&[key(VK_MENU, true)]);
    }
    let asked = Instant::now();
    while asked.elapsed() < Duration::from_secs(3) {
        if crate::screen::destiny_in_foreground() {
            return Some(false);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

/// One at a time: keys of two senders must not mix (Alt of one with the
/// Enter of another).
static KEYS: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// The game's window to the front from the background, if it isn't there
/// (see `game_to_front`; a minimized game is left alone). Doesn't wait.
pub(crate) fn pull_game_front() {
    let _keys = KEYS.lock().unwrap_or_else(|e| e.into_inner());
    if crate::screen::destiny_in_foreground() {
        return;
    }
    unsafe {
        let Some(game) = FindWindowW(w!("Tiger D3D Window"), None)
            .ok()
            .filter(|g| !g.is_invalid())
        else {
            return;
        };
        if IsIconic(game).as_bool() {
            return;
        }
        send(&[key(VK_MENU, false)]);
        let _ = SetForegroundWindow(game);
        send(&[key(VK_MENU, true)]);
    }
}

/// Copy the command and send it in the game's chat. Blocks for a second or
/// two (waits between the keys): not for the main thread. Err: why not
/// (the command is in the clipboard all the same, to paste by hand).
/// `just_switched`: the game got the front only now (by the caller).
pub fn send_in_game(command: &str, just_switched: bool) -> Result<(), &'static str> {
    if !copy(command) {
        return Err("clipboard");
    }
    let _keys = KEYS.lock().unwrap_or_else(|e| e.into_inner());
    let Some(was_front) = game_to_front() else {
        return Err("game not in front");
    };
    // Coming back from another window, the game takes a moment to listen.
    std::thread::sleep(Duration::from_millis(if was_front && !just_switched {
        120
    } else {
        900
    }));
    let in_front = crate::screen::destiny_in_foreground;
    if !in_front() {
        return Err("game not in front");
    }
    tap(VK_RETURN);
    // The chat line opens.
    std::thread::sleep(Duration::from_millis(350));
    if !in_front() {
        return Err("game not in front");
    }
    send(&[key(VK_CONTROL, false)]);
    std::thread::sleep(Duration::from_millis(30));
    tap(VK_V);
    std::thread::sleep(Duration::from_millis(30));
    send(&[key(VK_CONTROL, true)]);
    std::thread::sleep(Duration::from_millis(200));
    if !in_front() {
        return Err("game not in front");
    }
    tap(VK_RETURN);
    Ok(())
}
