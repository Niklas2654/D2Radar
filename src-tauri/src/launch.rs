//! "Start with Destiny 2": Radar starts hidden with Windows (autostart with
//! `--with-destiny`) and waits; when the game starts, it appears minimized
//! in the taskbar (the overlay is on), without taking the focus from the
//! game. Starting Radar by hand meanwhile shows the waiting one instead of
//! a second copy.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

/// The argument the autostart entry passes.
pub const ARG: &str = "--with-destiny";

/// Started in the background and not shown yet.
static WAITING: AtomicBool = AtomicBool::new(false);

const TRAY_ID: &str = "radar";

/// The tray icon: shows that Radar runs (also while it waits invisibly for
/// the game); a click opens it, its menu opens or quits it.
fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", crate::i18n::tr("Radar öffnen", "Open Radar"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", crate::i18n::tr("Beenden", "Quit"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => second_start(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                second_start(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn tooltip() -> String {
    if WAITING.load(Ordering::SeqCst) {
        crate::i18n::tr("Radar – wartet auf Destiny 2", "Radar – waiting for Destiny 2").to_string()
    } else {
        "Radar".to_string()
    }
}

fn update_tooltip(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip()));
    }
}

/// A build run from the project's build folder (target\debug, target\release),
/// not the installed app: it must not own the autostart entry. (One set from
/// a debug build stayed: Windows started that one, which can't load its page
/// without the dev server, and the real Radar then only woke it up.)
fn dev_build() -> bool {
    std::env::current_exe().is_ok_and(|p| p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target")))
}

/// "Start with Destiny 2" on: the entry points at this copy (the installed
/// app may have moved, or an old entry name another copy).
fn refresh_autostart(app: &AppHandle) {
    if dev_build() {
        return;
    }
    let autolaunch = app.autolaunch();
    if autolaunch.is_enabled().unwrap_or(false) {
        if let Err(e) = autolaunch.enable() {
            eprintln!("[launch] autostart entry: {e}");
        }
    }
}

/// Show the main window at start, or wait for the game when started by the
/// autostart entry.
pub fn on_start(app: &AppHandle) {
    refresh_autostart(app);
    let background = std::env::args().any(|a| a == ARG);
    WAITING.store(background, Ordering::SeqCst);
    if let Err(e) = tray(app) {
        eprintln!("[launch] tray icon: {e}");
    }
    if background {
        println!("[launch] waiting for Destiny 2");
        // Already running (Radar started after the game): appear right away.
        if crate::screen::destiny_running() {
            game_started(app);
        }
    } else if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Destiny 2 has started: a waiting Radar appears, minimized and without
/// taking the focus.
pub fn game_started(app: &AppHandle) {
    if !WAITING.swap(false, Ordering::SeqCst) {
        return;
    }
    println!("[launch] Destiny 2 started – showing Radar");
    update_tooltip(app);
    if let Some(hwnd) = app.get_window("main").and_then(|w| w.hwnd().ok()) {
        crate::screen::show_minimized(hwnd.0 as isize);
        SHOWN_BEHIND_TAURI.store(true, Ordering::SeqCst);
    }
}

/// Shown minimized straight through Windows (no focus taken from the game),
/// so Tauri still thinks the window hidden and keeps its page invisible.
static SHOWN_BEHIND_TAURI: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The window was brought up (taskbar click): show it through Tauri too,
/// once, so its page is drawn.
pub fn window_brought_up(window: &tauri::Window) {
    if SHOWN_BEHIND_TAURI.swap(false, Ordering::SeqCst) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Radar was started again (by hand): bring the running one forward.
pub fn second_start(app: &AppHandle) {
    WAITING.store(false, Ordering::SeqCst);
    update_tooltip(app);
    // Queued on the event loop: the single-instance plugin calls this from
    // inside the window message it received.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // The window, not a "webview window": DIM and Discord, preloaded
        // as webviews of their own in it, make it more than one webview,
        // and then it isn't found as one (a Radar started with Windows
        // never came up).
        if let Some(w) = handle.get_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    });
}

#[tauri::command]
pub fn launch_with_destiny_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn launch_with_destiny_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    if on && dev_build() {
        return Err(crate::i18n::tr(
            "Nur in der installierten App (ein Entwicklungs-Build würde sonst mit Windows starten)",
            "Only in the installed app (a development build would start with Windows otherwise)",
        )
        .into());
    }
    if on {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    Ok(autolaunch.is_enabled().unwrap_or(false))
}
