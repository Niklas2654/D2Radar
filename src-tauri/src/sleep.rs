//! Sleeping pages: DIM's and Discord's keep running while hidden (measured:
//! a tenth of a core each, hundreds of MB), though nobody sees them most of
//! the time. Hidden a while, they are suspended (WebView2's TrySuspend: no
//! timers, scripts or drawing, its memory given back, like a sleeping tab
//! in Edge). Shown again, a tab wakes by itself; a window over the game is
//! woken before it shows (see `wake_window`).
//!
//! Asleep, a page doesn't run what it is asked to (DIM's "reload the
//! inventory"): it does when it wakes. Discord reconnects then (voice runs
//! in the Discord app, not here).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
use webview2_com::TrySuspendCompletedHandler;
use windows::core::Interface;

/// The pages put to sleep: DIM's and Discord's tabs and windows over the game.
const LABELS: [&str; 4] = ["dim", "discord", "dim-game", "discord-game"];
/// How often they are looked at; hidden on two looks in a row (so a while,
/// not a quick switch between tabs), one goes to sleep.
const LOOK: Duration = Duration::from_secs(15);
const LOOKS_HIDDEN: u32 = 2;

/// Per page: looks in a row it was hidden on.
static HIDDEN: Mutex<Option<HashMap<&'static str, u32>>> = Mutex::new(None);

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(LOOK).await;
            for label in LABELS {
                look(&app, label);
            }
        }
    });
}

fn look(app: &AppHandle, label: &'static str) {
    let Some(webview) = app.get_webview(label) else { return };
    // A window over the game is hidden as a window: its page isn't told.
    let window_hidden = label.ends_with("-game") && !webview.window().is_visible().unwrap_or(true);
    let _ = webview.with_webview(move |platform| unsafe {
        let controller = platform.controller();
        let mut visible = windows::core::BOOL(0);
        if controller.IsVisible(&mut visible).is_err() {
            return;
        }
        let hidden = !visible.as_bool() || window_hidden;
        let looks = {
            let mut map = HIDDEN.lock().unwrap();
            let n = map.get_or_insert_default().entry(label).or_insert(0);
            *n = if hidden { *n + 1 } else { 0 };
            *n
        };
        if looks < LOOKS_HIDDEN {
            return;
        }
        let Ok(core) = controller.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_3>()) else { return };
        let mut asleep = windows::core::BOOL(0);
        if core.IsSuspended(&mut asleep).is_ok() && asleep.as_bool() {
            return;
        }
        // (It must be invisible to sleep: a hidden window's page made so.)
        if visible.as_bool() {
            let _ = controller.SetIsVisible(false);
        }
        let handler = TrySuspendCompletedHandler::create(Box::new(|_, _| Ok(())));
        let _ = core.TrySuspend(&handler);
    });
}

/// Before a window over the game shows: its page visible, and so awake.
pub fn wake_window(window: &tauri::WebviewWindow) {
    if let Some(label) = LABELS.iter().find(|l| **l == window.label()) {
        HIDDEN.lock().unwrap().get_or_insert_default().insert(label, 0);
    }
    let _ = window.with_webview(|platform| unsafe {
        let controller = platform.controller();
        let _ = controller.SetIsVisible(true);
        if let Ok(core) = controller.CoreWebView2().and_then(|c| c.cast::<ICoreWebView2_3>()) {
            let _ = core.Resume();
        }
    });
}
