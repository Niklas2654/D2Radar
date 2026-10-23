//! The inspect page over the game (hotkey, like DIM's and Discord's): the
//! weapon or armor piece Radar recognized last, and a search for any
//! other. While it is open the screen isn't read (nothing to recognize
//! under it); closing it starts again.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "inspect-game";

/// Whether the page is shown over the game.
pub fn open_in_game(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Hide it (another window opens over the game, or the game lost the
/// front); recognizing goes on.
pub fn hide_in_game(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    crate::weapons::PAUSED.store(false, Ordering::SeqCst);
}

/// Hotkey: open the page over the game, or close it and hand the focus
/// back to the game. Created on first use and kept (hidden) afterwards.
pub fn toggle_in_game(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let window = match app.get_webview_window(LABEL) {
            Some(window) if window.is_visible().unwrap_or(false) => {
                close(&app);
                return;
            }
            Some(window) => window,
            None => {
                let built = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?inspect".into()))
                    .title("Radar – Inspect")
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .disable_drag_drop_handler()
                    .build();
                match built {
                    Ok(window) => window,
                    Err(e) => {
                        eprintln!("[inspect] window: {e}");
                        return;
                    }
                }
            }
        };
        // Nothing to read under it: recognizing pauses while it is open.
        crate::weapons::PAUSED.store(true, Ordering::SeqCst);
        crate::dim::place_over_game(&app, &window);
        // One window over the game at a time.
        crate::dim::hide_in_game(&app);
        crate::discord::hide_in_game(&app);
        // The page shows what was recognized last (it may be new).
        let _ = app.emit_to(LABEL, "inspect-open", ());
        let _ = window.show();
        let _ = window.set_focus();
    });
}

/// Back to the front with the focus (after an action the game reacts to,
/// e.g. a mod changed on the equipped armor, it may take the front).
#[tauri::command]
pub fn inspect_focus(app: AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL).filter(|w| w.is_visible().unwrap_or(false)) {
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    }
}

/// Close the page and hand the game the focus: the game first, while the
/// page still has the front (once hidden, Windows gives the front to some
/// other window, and a window not in front may not take it: the game
/// stayed behind, and with it the recognizing and the overlay).
fn close(app: &AppHandle) {
    crate::screen::focus_game();
    hide_in_game(app);
}

/// The page's own close button (and Escape, on its release).
#[tauri::command]
pub fn inspect_close(app: AppHandle) {
    close(&app);
}
