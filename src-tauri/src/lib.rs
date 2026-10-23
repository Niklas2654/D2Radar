//! Radar: a control window ("main") plus a transparent, always-on-top,
//! click-through HUD window ("overlay") that covers the primary monitor.
//!
//! Hotkeys (global, work while Destiny 2 has focus in borderless mode; set
//! in the settings, see hotkeys.rs). Defaults:
//!   F8 – show / hide the overlay (hidden while another app is in front on
//!        the game's monitor)
//!   F9 – toggle edit mode (overlay becomes interactive so widgets can be moved)
//!   F10 – show / hide the perks of the weapon on the inspect screen
//!   F7 – DIM over the game (semi-transparent), again to close it
//!   (none) – equip an in-game loadout slot

mod apply;
mod armor;
mod seasons;
mod bungie;
mod clarity;
mod nameocr;
mod raidtags;
mod feats;
mod runreport;
mod compendium;
mod clears;
mod dim;
mod dimsync;
mod discord;
mod edit;
mod fireteam;
mod hotkeys;
mod inspect;
mod i18n;
mod inventory;
mod launch;
mod loadouts;
mod oauth;
mod presets;
mod screen;
mod session;
mod sleep;
mod sets;
mod usage;
mod weapons;

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

static EDIT_MODE: AtomicBool = AtomicBool::new(false);
/// The user's overlay switch (F8); the overlay shows only while the game is
/// in front on its monitor, so it doesn't cover other apps there (apps on a
/// second monitor don't hide it).
static WANTED: AtomicBool = AtomicBool::new(true);
static GAME_RUNNING: AtomicBool = AtomicBool::new(false);
static GAME_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Whether the hotkeys are taken now (see `watch_game`).
static HOTKEYS_ON: AtomicBool = AtomicBool::new(false);
/// The overlay's window handle (0 until set up).
static OVERLAY_HWND: AtomicIsize = AtomicIsize::new(0);
/// How often to check whether Destiny 2 is in front (alt-tab should feel instant)…
const FOCUS_CHECK: Duration = Duration::from_millis(250);
/// …and every how many focus checks whether it runs at all.
const RUNNING_EVERY: u32 = 8;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayState {
    /// The user's switch, not whether the window is on screen right now.
    visible: bool,
    edit: bool,
    game_running: bool,
}

fn overlay(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("overlay")
}

fn current_state() -> OverlayState {
    OverlayState {
        visible: WANTED.load(Ordering::SeqCst),
        edit: EDIT_MODE.load(Ordering::SeqCst),
        game_running: GAME_RUNNING.load(Ordering::SeqCst),
    }
}

/// Tell both windows about the new visibility / edit-mode state.
fn broadcast(app: &AppHandle) {
    let _ = app.emit("overlay-state", current_state());
}

/// Stretch the overlay over the whole primary monitor.
fn fit_to_monitor(w: &WebviewWindow) {
    if let Ok(Some(m)) = w.primary_monitor() {
        let _ = w.set_position(*m.position());
        let mut size = *m.size();
        // Only the part with the widgets (a window over the game costs it
        // frames, a smaller one fewer: measured 360–410 fps with one over
        // the whole screen, 380–410 with one only as tall as the widgets
        // reach, 390–470 without Radar). Whole for placing them.
        let frame = *OVERLAY_FRAME.lock().unwrap();
        if let (Some(f), false) = (frame, EDIT_MODE.load(Ordering::SeqCst)) {
            let x = (f.x.max(0.0) as u32).min(size.width.saturating_sub(1));
            let y = (f.y.max(0.0) as u32).min(size.height.saturating_sub(1));
            let at = tauri::PhysicalPosition::new(m.position().x + x as i32, m.position().y + y as i32);
            size = tauri::PhysicalSize::new((f.w as u32).clamp(1, size.width - x), (f.h as u32).clamp(1, size.height - y));
            let _ = w.set_position(at);
        }
        let _ = w.set_size(size);
    }
}

/// The part of the screen the overlay's widgets are in (screen pixels,
/// from the monitor's corner), as the page says; None: the whole screen.
static OVERLAY_FRAME: std::sync::Mutex<Option<screen::Rect>> = std::sync::Mutex::new(None);

#[tauri::command]
fn overlay_set_frame(app: AppHandle, frame: Option<screen::Rect>) {
    *OVERLAY_FRAME.lock().unwrap() = frame;
    refit_overlay(&app);
}

/// The overlay's size again (its widgets moved or changed, compact test).
pub(crate) fn refit_overlay(app: &AppHandle) {
    if let Some(w) = overlay(app) {
        if w.is_visible().unwrap_or(false) {
            fit_to_monitor(&w);
        }
    }
}

/// Show the overlay window only in game: switched on and Destiny 2 in front
/// on its monitor (see `screen::destiny_active`). Editing the layout needs
/// the game only running: it is switched on from Radar's window, which may
/// lie over the game then. Else hide it.
fn sync_window(app: &AppHandle) {
    let Some(w) = overlay(app) else { return };
    let Ok(hwnd) = w.hwnd() else { return };
    let hwnd = hwnd.0 as isize;
    let edit = EDIT_MODE.load(Ordering::SeqCst) && GAME_RUNNING.load(Ordering::SeqCst);
    let show = edit || (WANTED.load(Ordering::SeqCst) && GAME_ACTIVE.load(Ordering::SeqCst));
    if show {
        if !screen::window_visible(hwnd) {
            fit_to_monitor(&w);
            // Without taking the focus (except for editing): the app in
            // front (e.g. on the second monitor) has to stay there, or the
            // overlay would hide itself again.
            screen::set_window_shown(hwnd, true, edit);
        }
        if edit {
            // Tauri's own show too: it keeps its own idea of whether the
            // window is visible and puts that back on focus / style changes
            // (it hid the edit overlay again right away without the game).
            let _ = w.show();
        }
        let _ = w.set_ignore_cursor_events(!edit);
    } else {
        let _ = w.set_ignore_cursor_events(true);
        let _ = w.hide();
        screen::set_window_shown(hwnd, false, false);
    }
}

fn apply_edit_mode(app: &AppHandle, on: bool) {
    let was_on = EDIT_MODE.swap(on, Ordering::SeqCst);
    // Placing widgets (hotkey or the app's button): no window over the
    // game, it would cover them.
    if on {
        dim::hide_in_game(app);
        discord::hide_in_game(app);
        inspect::hide_in_game(app);
    }
    sync_window(app);
    // (The compact test's window: whole for placing widgets.)
    refit_overlay(app);
    if on {
        if let Some(w) = overlay(app) {
            let _ = w.set_focus();
        }
    } else if was_on && GAME_RUNNING.load(Ordering::SeqCst) {
        // Done editing (F9 / Done): back to the game, which the editor took
        // the focus from.
        screen::focus_game();
    }
    broadcast(app);
}

fn apply_visible(app: &AppHandle, visible: bool) {
    WANTED.store(visible, Ordering::SeqCst);
    if !visible {
        EDIT_MODE.store(false, Ordering::SeqCst);
    }
    sync_window(app);
    broadcast(app);
}

/// Shows / hides the overlay as Destiny 2 gains and loses focus (alt-tab,
/// start, quit).
fn watch_game(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut tick = 0u32;
        // Checks in a row with another app in front while DIM / Discord is
        // open over the game.
        let mut other_in_front = 0u32;
        loop {
            let (active, why) = screen::destiny_active(OVERLAY_HWND.load(Ordering::SeqCst));
            let mut changed = GAME_ACTIVE.swap(active, Ordering::SeqCst) != active;
            if changed {
                println!("[overlay] {} – {why}", if active { "show" } else { "hide" });
            }
            if tick.is_multiple_of(RUNNING_EVERY) || active {
                let running = active || screen::destiny_running();
                let was_running = GAME_RUNNING.swap(running, Ordering::SeqCst);
                changed |= was_running != running;
                if running && !was_running {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || launch::game_started(&handle));
                }
            }
            if changed {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    sync_window(&handle);
                    broadcast(&handle);
                });
            }
            // DIM / Discord over the game: gone once another app comes to the
            // front (a browser over the game), not only on the hotkey. Twice
            // in a row, so a moment between windows doesn't close it.
            if over_game(&app) && screen::other_app_in_front() == Some(true) {
                other_in_front += 1;
                if other_in_front == 2 {
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        dim::hide_in_game(&handle);
                        discord::hide_in_game(&handle);
                        inspect::hide_in_game(&handle);
                    });
                }
            } else {
                other_in_front = 0;
            }
            // Hotkeys only while the game has the focus (or a Radar window
            // over it / the layout editor): elsewhere the keys stay free.
            let keys_on =
                screen::destiny_in_foreground() || EDIT_MODE.load(Ordering::SeqCst) || over_game(&app);
            if HOTKEYS_ON.swap(keys_on, Ordering::SeqCst) != keys_on {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || hotkeys::set_active(&handle, keys_on));
            }
            tick = tick.wrapping_add(1);
            std::thread::sleep(FOCUS_CHECK);
        }
    });
}

/// Destiny 2 runs and is in front on its monitor.
fn in_game() -> bool {
    GAME_ACTIVE.load(Ordering::SeqCst)
}

/// DIM's or Discord's window is open over the game (it covers the game, so
/// that doesn't count as in front then).
fn over_game(app: &AppHandle) -> bool {
    dim::open_in_game(app) || discord::open_in_game(app) || inspect::open_in_game(app)
}

#[tauri::command]
fn get_overlay_state() -> OverlayState {
    current_state()
}

#[tauri::command]
fn set_overlay_visible(app: AppHandle, visible: bool) {
    apply_visible(&app, visible);
}

#[tauri::command]
fn set_edit_mode(app: AppHandle, on: bool) {
    apply_edit_mode(&app, on);
}

/// Bring Destiny 2 to the front (only the window: Radar never sends input
/// to the game). False if it isn't running.
#[tauri::command]
fn focus_destiny() -> bool {
    if !screen::destiny_running() {
        return false;
    }
    screen::focus_game();
    true
}

pub fn run() {
    tauri::Builder::default()
        // Radar's page reloading (F5): DIM's and Discord's webviews lie over
        // it (not part of it) and would stay on top of the fresh page.
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                let app = webview.app_handle();
                dim::hide_tab(app);
                discord::hide_tab(app);
            }
        })
        // Started again while running (e.g. waiting for Destiny 2): show
        // the running one. Registered first, so the second copy quits early.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| launch::second_start(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![launch::ARG]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    match hotkeys::action_for(app, shortcut) {
                        Some(hotkeys::Action::Overlay) => apply_visible(app, !WANTED.load(Ordering::SeqCst)),
                        Some(hotkeys::Action::Edit) => apply_edit_mode(app, !EDIT_MODE.load(Ordering::SeqCst)),
                        // While the layout is edited no window over the game
                        // opens (their hotkeys do nothing then).
                        Some(hotkeys::Action::Weapon | hotkeys::Action::Dim | hotkeys::Action::Discord)
                            if EDIT_MODE.load(Ordering::SeqCst) => {}
                        // In-game windows open only in game (closing them always works).
                        // The inspect page (what was recognized; search).
                        Some(hotkeys::Action::Weapon) if in_game() || over_game(app) => inspect::toggle_in_game(app),
                        // (Also from one window over the game to the other.)
                        Some(hotkeys::Action::Dim) if in_game() || over_game(app) => dim::toggle_in_game(app),
                        Some(hotkeys::Action::Discord) if in_game() || over_game(app) => discord::toggle_in_game(app),
                        Some(hotkeys::Action::Loadout(index)) => loadouts::equip_from_hotkey(app, index),
                        // Out of game: an in-game window's hotkey does nothing.
                        Some(hotkeys::Action::Weapon | hotkeys::Action::Dim | hotkeys::Action::Discord) | None => {}
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle();
            for failed in hotkeys::register_all(handle) {
                eprintln!("[hotkeys] not registered: {failed}");
            }
            GAME_RUNNING.store(screen::destiny_running(), Ordering::SeqCst);
            if let Some(hwnd) = overlay(handle).and_then(|w| w.hwnd().ok()) {
                OVERLAY_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
            }
            GAME_ACTIVE.store(screen::destiny_active(OVERLAY_HWND.load(Ordering::SeqCst)).0, Ordering::SeqCst);
            apply_visible(handle, true);
            launch::on_start(handle);
            watch_game(handle);

            app.manage(bungie::BungieState::load(handle));
            bungie::start(handle);
            weapons::start_detection(handle);
            // DIM and Discord asleep while hidden a while.
            sleep::start(handle);
            clarity::preload(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "bungie-login" {
                if let WindowEvent::Destroyed = event {
                    oauth::login_window_closed();
                }
            }
            // Closing the control window quits the whole app, overlay included.
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { .. } => window.app_handle().exit(0),
                    // Restored from the taskbar after a start with the game.
                    WindowEvent::Focused(true) => launch::window_brought_up(window),
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_overlay_state,
            launch::launch_with_destiny_get,
            launch::launch_with_destiny_set,
            set_overlay_visible,
            set_edit_mode,
            focus_destiny,
            bungie::bungie_snapshot,
            bungie::bungie_set_api_key,
            bungie::bungie_find_player,
            bungie::bungie_clear_player,
            bungie::bungie_refresh,
            bungie::bungie_reset_session,
            bungie::set_language,
            dim::dim_show,
            dim::dim_hide,
            dim::dim_preload,
            dim::dim_set_accent,
            discord::discord_preload,
            discord::webviews_ready,
            discord::own_join_name,
            dim::dim_refresh,
            dim::dim_home,
            dim::dim_snapshot,
            dim::dim_hide_now,
            discord::discord_show,
            discord::discord_hide_now,
            discord::discord_snapshot,
            discord::discord_open,
            discord::discord_current,
            discord::discord_config,
            discord::discord_save_pins,
            discord::discord_set_game_language,
            seasons::season_name,
            discord::discord_set_focus,
            discord::discord_set_accent,
            hotkeys::hotkeys_get,
            hotkeys::hotkey_set,
            hotkeys::dim_game_set_opacity,
            hotkeys::discord_game_set_opacity,
            loadouts::loadouts_list,
            loadouts::loadout_clear,
            loadouts::loadout_identifiers,
            inventory::own_characters,
            dimsync::dim_status,
            dimsync::dim_connect,
            dimsync::dim_loadout_list,
            dimsync::dim_loadout_details,
            dimsync::dim_loadout_delete,
            dimsync::artifact_layout,
            dimsync::dim_loadout_apply,
            presets::preset_draft,
            presets::preset_candidates,
            presets::preset_save,
            presets::preset_preview,
            edit::loadout_item_sockets,
            edit::loadout_set_plug,
            sets::loadout_sets,
            sets::loadout_set_save,
            sets::loadout_set_delete,
            fireteam::fireteam_player,
            fireteam::fireteam_search,
            fireteam::fireteam_suggest,
            fireteam::fireteam_player_card,
            clears::fullclears_stats,
            clears::activity_runs,
            runreport::run_report,
            session::session_team,
            weapons::weapons_search,
            weapons::inspect_last,
            weapons::armor_search,
            weapons::armor_detail,
            weapons::gear_search,
            weapons::gear_sources,
            armor::armor_mods,
            loadouts::loadout_to_dim,
            armor::armor_copies,
            armor::armor_pull,
            armor::armor_compare,
            fireteam::guardian_candidates,
            armor::armor_mod_options,
            armor::armor_set_mod,
            inspect::inspect_close,
            inspect::inspect_focus,
            clarity::clarity_perks,
            clarity::clarity_items,
            weapons::weapon_detail,
            weapons::weapon_pull,
            usage::weapon_usage,
            overlay_set_frame,
            weapons::artifact_detail,
            weapons::weapon_detect_config,
            weapons::weapon_set_auto,
            weapons::weapon_set_region,
            weapons::weapon_capture,
            weapons::weapon_test,
            oauth::oauth_status,
            oauth::oauth_set_client,
            oauth::oauth_login,
            oauth::oauth_logout,
            screen::overlay_set_areas,
            screen::overlay_set_capture_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running Radar");
}
