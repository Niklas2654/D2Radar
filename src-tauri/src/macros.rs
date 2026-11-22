//! Macros the player builds themself (Makros tab): a hotkey plays a list of
//! steps in the game: keys, mouse buttons, the game's own actions (the keys
//! bound to them in Destiny's cvars.xml, so "Super" works whatever key it is
//! on) and waits. Stored in macros.json; their hotkeys are taken with the
//! other ones (hotkeys.rs), so only while the game has the focus.
//!
//! Keys go out only while Destiny's window is in front (checked before every
//! step); a macro stops the moment it isn't, and lets go of what it held.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, MAPVK_VSC_TO_VK_EX, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT,
    MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};

use crate::i18n::tr;

/// A key or button pressed and let go, only pressed, or only let go.
#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Press {
    #[default]
    Tap,
    Down,
    Up,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Step {
    /// A keyboard key, by its KeyboardEvent.code ("KeyQ", "Space", "ShiftLeft").
    Key {
        code: String,
        #[serde(default)]
        press: Press,
        /// The wait before the next block when there's no standard delay
        /// (ms); none = the usual 50.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<u32>,
    },
    /// "left", "right", "middle", "x1", "x2", "wheelup", "wheeldown".
    Mouse {
        button: String,
        #[serde(default)]
        press: Press,
        /// The wait before the next block when there's no standard delay
        /// (ms); none = the usual 50.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<u32>,
    },
    /// One of the game's actions ("super", "grenade" …): its key in cvars.xml.
    Game {
        action: String,
        #[serde(default)]
        press: Press,
        /// The wait before the next block when there's no standard delay
        /// (ms); none = the usual 50.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        after: Option<u32>,
    },
    Wait { ms: u32 },
}

/// The wait between two blocks when the standard delay is off and none was set.
const LINK_DELAY: u32 = 50;

impl Step {
    /// The wait set between this block and the next (no standard delay).
    fn after(&self) -> Option<u32> {
        match self {
            Step::Key { after, .. } | Step::Mouse { after, .. } | Step::Game { after, .. } => *after,
            Step::Wait { .. } => None,
        }
    }
}

/// How the hotkey plays the macro.
#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Once per press.
    #[default]
    Once,
    /// Over and over while the hotkey is held.
    Hold,
    /// Over and over until the hotkey is pressed again.
    Toggle,
    /// Three parts: `press_steps` once on pressing, `steps` over and over
    /// while held, `release_steps` once on letting go.
    Sequence,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Macro {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// Hotkey string as in hotkeys.rs ("F5", "Alt+Digit1"); "" = none.
    pub hotkey: String,
    pub mode: Mode,
    pub steps: Vec<Step>,
    /// Sequence only: played once when the hotkey goes down.
    pub press_steps: Vec<Step>,
    /// Sequence only: played once when the hotkey is let go.
    pub release_steps: Vec<Step>,
    /// Wait after every key step (ms) unless a wait of its own follows; 0 = none.
    pub delay: u32,
    /// Only while Destiny has the focus (its hotkey too); off: anywhere.
    pub focused: bool,
}

impl Default for Macro {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: true,
            hotkey: String::new(),
            mode: Mode::Once,
            steps: Vec::new(),
            press_steps: Vec::new(),
            release_steps: Vec::new(),
            delay: 50,
            focused: true,
        }
    }
}

static MACROS: Mutex<Option<Vec<Macro>>> = Mutex::new(None);

fn path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("macros.json")
}

pub fn all(app: &AppHandle) -> Vec<Macro> {
    MACROS
        .lock()
        .unwrap()
        .get_or_insert_with(|| {
            std::fs::read_to_string(path(app))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        })
        .clone()
}

fn store(app: &AppHandle, macros: Vec<Macro>) {
    if let Some(dir) = path(app).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&macros) {
        let _ = std::fs::write(path(app), json);
    }
    *MACROS.lock().unwrap() = Some(macros.clone());
    let _ = app.emit("macros-changed", macros);
}

/// The hotkeys of the macros that are on and play anywhere, not only with
/// Destiny in front: taken out of the game too.
pub fn free_hotkeys(app: &AppHandle) -> Vec<String> {
    all(app)
        .into_iter()
        .filter(|m| m.enabled && !m.focused && !m.hotkey.is_empty())
        .map(|m| m.hotkey)
        .collect()
}

/// The macros on a side button of the mouse: (button, index, only with
/// Destiny in front).
pub fn mouse_bindings(app: &AppHandle) -> Vec<(u16, usize, bool)> {
    all(app)
        .into_iter()
        .enumerate()
        .filter(|(_, m)| m.enabled)
        .filter_map(|(i, m)| crate::mousekeys::button(&m.hotkey).map(|b| (b, i, m.focused)))
        .collect()
}

/// The hotkeys of the macros that are on: (index, keys).
pub fn hotkeys(app: &AppHandle) -> Vec<(usize, String)> {
    all(app)
        .into_iter()
        .enumerate()
        .filter(|(_, m)| m.enabled && !m.hotkey.is_empty())
        .map(|(i, m)| (i, m.hotkey))
        .collect()
}

#[tauri::command]
pub fn macros_get(app: AppHandle) -> Vec<Macro> {
    all(&app)
}

/// Save a macro (new or changed, by id). Rejects a hotkey that isn't
/// supported, is bound already (another macro, one of Radar's own) or that
/// another program uses; nothing is saved then.
#[tauri::command]
pub fn macro_save(app: AppHandle, mut item: Macro) -> Result<Vec<Macro>, String> {
    item.hotkey = item.hotkey.trim().to_string();
    item.name = item.name.trim().chars().take(60).collect();
    if item.id.is_empty() {
        item.id = format!("m{}", chrono::Utc::now().timestamp_millis());
    }
    let previous = all(&app);
    if crate::mousekeys::button(&item.hotkey).is_some() {
        // A side button of the mouse: Radar's own actions take keys only.
        // Several macros may share it (all of them play).
    } else if !item.hotkey.is_empty() {
        let shortcut = crate::hotkeys::parse(&item.hotkey)
            .ok_or(tr("Diese Taste wird nicht unterstützt", "This key isn't supported"))?;
        // Other macros on the same key are fine: they all play together.
        if crate::hotkeys::taken_by_radar(&app, shortcut.id()) {
            return Err(tr("Schon für eine Radar-Aktion vergeben", "Already used for a Radar action").into());
        }
    }
    let mut next = previous.clone();
    match next.iter_mut().find(|m| m.id == item.id) {
        Some(m) => *m = item.clone(),
        None => next.push(item.clone()),
    }
    *MACROS.lock().unwrap() = Some(next.clone());
    let failed = crate::hotkeys::register_all(&app);
    if item.enabled
        && !item.hotkey.is_empty()
        && failed.iter().any(|f| f.starts_with(&format!("{}:", item.hotkey)))
    {
        *MACROS.lock().unwrap() = Some(previous);
        crate::hotkeys::register_all(&app);
        return Err(tr(
            "Diese Kombination benutzt schon ein anderes Programm",
            "Another program already uses this combination",
        )
        .into());
    }
    // A changed macro that's playing stops (it would go on with the old steps).
    stop(&item.id);
    store(&app, next.clone());
    Ok(next)
}

#[tauri::command]
pub fn macro_delete(app: AppHandle, id: String) -> Vec<Macro> {
    stop(&id);
    let next: Vec<Macro> = all(&app).into_iter().filter(|m| m.id != id).collect();
    *MACROS.lock().unwrap() = Some(next.clone());
    crate::hotkeys::register_all(&app);
    store(&app, next.clone());
    next
}

/// The game's key bindings (cvars.xml) for the actions a macro can use.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBindings {
    /// cvars.xml was found (Destiny has run on this PC), or one was uploaded.
    found: bool,
    /// The bindings are from an uploaded cvars.xml (the game's isn't here).
    uploaded: bool,
    /// action → its keys as the game names them ("f", "left mouse button");
    /// empty when not bound.
    actions: Vec<(String, Vec<String>)>,
    /// action → its two places in the game's settings (primary, secondary),
    /// "" when free.
    slots: Vec<(String, [String; 2])>,
    /// The game's cvars.xml is read-only (Destiny can't reset keys in it).
    locked: bool,
}

/// The game's actions offered as steps, in the order of the bar.
const GAME_ACTIONS: &[&str] = &[
    "super",
    "grenade",
    "melee",
    "melee_charged",
    "melee_uncharged",
    "class_ability",
    "utility_ability",
    "equipment_ability",
    "fire",
    "toggle_zoom",
    "hold_zoom",
    "reload",
    "switch_weapons",
    "primary_weapon",
    "special_weapon",
    "heavy_weapon",
    "next_weapon",
    "previous_weapon",
    "jump",
    "air_move",
    "hold_crouch",
    "toggle_crouch",
    "toggle_sprint",
    "hold_sprint",
    "move_forward",
    "move_backward",
    "move_left",
    "move_right",
    "vehicle_boost",
    "vehicle_brake",
    "vehicle_zoom",
    "vehicle_dodge_left",
    "vehicle_dodge_right",
    "vehicle_biped_dodge",
    "vehicle_fire_primary",
    "vehicle_fire_secondary",
    "vehicle_exit",
    "vehicle_jump",
    "vehicle_honk",
    "ui_open_director",
    "ui_open_director_map_tab",
    "ui_open_director_destinations_tab",
    "ui_open_director_pursuits_tab",
    "ui_open_director_world_tab",
    "ui_open_director_roster_tab",
    "ui_open_director_seasons_tab",
    "ui_open_director_curator_tab",
    "ui_open_director_mtx_tab",
    "ui_open_start_menu_alternative",
    "ui_open_start_menu_inventory_tab",
    "ui_open_start_menu_records_tab",
    "ui_open_start_menu_collections_tab",
    "ui_open_start_menu_clan_tab",
    "ui_open_start_menu_settings_tab",
    "ui_gamepad_button_back",
    "ui_text_chat_toggle_state",
    "ui_abort_activity",
    "ui_open_exit_dialog_confirm",
    "interact",
    "highlight_player",
    "emote_1",
    "emote_2",
    "emote_3",
    "emote_4",
    "light_attack",
    "heavy_attack",
    "block",
    "stasis_breakout",
    "push_to_talk",
    "death_cam_zoom_in",
    "death_cam_zoom_out",
    "screenshot",
];

#[tauri::command]
pub fn macro_game_bindings(app: AppHandle) -> GameBindings {
    let read = read_cvars(&app);
    let uploaded = matches!(read, Some((_, true)));
    let read = read.map(|(c, _)| c);
    GameBindings {
        found: read.is_some(),
        uploaded,
        actions: GAME_ACTIONS
            .iter()
            .map(|a| {
                let keys = read
                    .as_ref()
                    .and_then(|c| c.iter().find(|(n, _)| n == a))
                    .map(|(_, v)| bound_keys(v))
                    .unwrap_or_default();
                (a.to_string(), keys)
            })
            .collect(),
        slots: GAME_ACTIONS
            .iter()
            .map(|a| {
                let value = read
                    .as_ref()
                    .and_then(|c| c.iter().find(|(n, _)| n == a))
                    .map(|(_, v)| v.as_str())
                    .unwrap_or("");
                let mut parts = value
                    .split('!')
                    .map(|k| if unbound(k) { String::new() } else { k.trim().to_string() });
                (a.to_string(), [parts.next().unwrap_or_default(), parts.next().unwrap_or_default()])
            })
            .collect(),
        locked: cvars_path().is_some_and(|p| read_only(&p)),
    }
}

/// The official icons of the armor stats named like the abilities (Super,
/// Granate, Nahkampf, Klasse) for those blocks: action → icon path on
/// bungie.net. The same whatever subclass is on.
#[tauri::command]
pub async fn macro_ability_icons(app: AppHandle) -> Vec<(String, String)> {
    const STATS: [(&str, u64); 6] = [
        ("super", 144602215),
        ("grenade", 1735777505),
        ("melee", 4244567218),
        ("melee_charged", 4244567218),
        ("melee_uncharged", 4244567218),
        ("class_ability", 1943323491),
    ];
    let defs = futures::future::join_all(
        STATS.iter().map(|&(_, hash)| crate::fireteam::definition(&app, "DestinyStatDefinition", hash)),
    )
    .await;
    STATS
        .iter()
        .zip(defs)
        .filter_map(|(&(action, _), def)| {
            let icon = def?["displayProperties"]["icon"].as_str()?.to_string();
            (!icon.is_empty()).then(|| (action.to_string(), icon))
        })
        .collect()
}

fn cvars_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Bungie\DestinyPC\prefs\cvars.xml"))
}

/// A cvars.xml uploaded on the macros page, for when the game's isn't found.
fn uploaded_cvars_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("cvars.xml")
}

/// Every `<cvar name="…" value="…">` in the game's settings file, else in
/// the uploaded one (true: from that).
fn read_cvars(app: &AppHandle) -> Option<(Vec<(String, String)>, bool)> {
    let read = |path: PathBuf| {
        std::fs::read_to_string(path)
            .ok()
            .map(|xml| parse_cvars(&xml))
            .filter(|c| !c.is_empty())
    };
    cvars_path()
        .and_then(read)
        .map(|c| (c, false))
        .or_else(|| read(uploaded_cvars_path(app)).map(|c| (c, true)))
}

/// Keeps a cvars.xml picked on the macros page (the game's isn't found):
/// its bindings from now on. Only one with key bindings in it.
#[tauri::command]
pub fn macro_import_cvars(app: AppHandle, xml: String) -> Result<GameBindings, String> {
    let cvars = parse_cvars(&xml);
    if !cvars.iter().any(|(name, _)| GAME_ACTIONS.contains(&name.as_str())) {
        return Err("no_bindings".into());
    }
    let path = uploaded_cvars_path(&app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, xml).map_err(|e| e.to_string())?;
    Ok(macro_game_bindings(app))
}

fn parse_cvars(xml: &str) -> Vec<(String, String)> {
    let attr = |tag: &str, name: &str| -> Option<String> {
        let start = tag.find(&format!("{name}=\""))? + name.len() + 2;
        let end = start + tag[start..].find('"')?;
        Some(
            tag[start..end]
                .replace("&quot;", "\"")
                .replace("&apos;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&"),
        )
    };
    xml.split("<cvar ")
        .skip(1)
        .filter_map(|tag| {
            let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
            Some((attr(tag, "name")?, attr(tag, "value")?))
        })
        .collect()
}

/// Radar's copy of the game's cvars.xml from before it first changed a key
/// (to put back by hand if ever needed).
fn backup_cvars_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("cvars-original.xml")
}

/// The keys Radar writes into the game's settings: those it knows the
/// game's names of.
fn writable_game_key(key: &str) -> bool {
    let b = key.as_bytes();
    (b.len() == 1 && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit()))
        || key.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=12).contains(&n))
        || matches!(
            key,
            "space"
                | "tab"
                | "backspace"
                | "shift"
                | "control"
                | "alt"
                | "left mouse button"
                | "right mouse button"
                | "middle mouse button"
                | "extra mouse button 1"
                | "extra mouse button 2"
                | "mouse wheel up"
                | "mouse wheel down"
                | "insert"
                | "delete"
                | "home"
                | "end"
                | "page up"
                | "page down"
                | "up"
                | "down"
                | "left"
                | "right"
                // By their place on a US keyboard ("=" is ´ on a German one).
                // Not "-" (ß on a German one): Destiny writes it but drops it
                // when it loads its settings, the key is free after a restart.
                | "="
                | "`"
                | "["
                | "]"
                | "\\"
                | ";"
                | "'"
                | ","
                | "."
                | "/"
        )
}

/// The settings file with one place of an action's binding changed (`key`
/// "" frees it). None: the action isn't in there.
fn with_game_key(xml: &str, action: &str, slot: usize, key: &str) -> Option<String> {
    let tag = format!("<cvar name=\"{action}\" value=\"");
    let start = xml.find(&tag)? + tag.len();
    let end = start + xml[start..].find('"')?;
    let mut parts: Vec<String> = xml[start..end].split('!').map(String::from).collect();
    parts.resize(parts.len().max(2), "unused".into());
    parts[slot] = if key.is_empty() { "unused".into() } else { key.into() };
    Some(format!("{}{}{}", &xml[..start], parts.join("!"), &xml[end..]))
}

fn read_only(path: &PathBuf) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.permissions().readonly())
}

fn set_read_only(path: &PathBuf, on: bool) -> Result<(), String> {
    let mut perms = std::fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    if perms.readonly() != on {
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(on);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Puts the game's settings file in place (a new file renamed over it),
/// read-only after when `lock`: Destiny then can't reset keys in it when
/// it starts or quits.
fn write_game_cvars(path: &PathBuf, xml: &str, lock: bool) -> Result<(), String> {
    let was_locked = read_only(path);
    let temp = path.with_extension("xml.radar");
    std::fs::write(&temp, xml).map_err(|e| e.to_string())?;
    // A read-only file can't be replaced: unlocked for the moment.
    if was_locked {
        set_read_only(path, false)?;
    }
    if let Err(e) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        if was_locked {
            let _ = set_read_only(path, true);
        }
        return Err(e.to_string());
    }
    set_read_only(path, lock)?;
    lock_old_cvars(path, lock);
    Ok(())
}

/// Destiny's copy of its cvars.xml (cvars.old) takes the read-only flag
/// along; while it keeps it, Destiny can't save its settings at all, so it
/// follows the cvars.xml's.
fn lock_old_cvars(path: &PathBuf, on: bool) {
    let old = path.with_extension("old");
    if old.exists() {
        let _ = set_read_only(&old, on);
    }
}

/// Destiny keeps its settings in memory and writes them back when it
/// closes: a change while it runs would be undone.
fn game_closed() -> Result<(), String> {
    if crate::screen::destiny_running() {
        return Err(tr(
            "Schließe zuerst Destiny, sonst überschreibt das Spiel die Änderung beim Beenden",
            "Close Destiny first, else the game overwrites the change when it quits",
        )
        .into());
    }
    Ok(())
}

/// Binds a key to one of the game's actions in its own settings (cvars.xml):
/// `slot` 0 the primary, 1 the secondary place; `key` as the game names it,
/// "" frees the place. The first change keeps a copy of the file before.
#[tauri::command]
pub fn macro_set_game_key(app: AppHandle, action: String, slot: usize, key: String) -> Result<GameBindings, String> {
    if !GAME_ACTIONS.contains(&action.as_str()) || slot > 1 {
        return Err("unknown action".into());
    }
    if !key.is_empty() && !writable_game_key(&key) {
        return Err(tr("Diese Taste kann Radar nicht ins Spiel schreiben", "Radar can't write this key into the game").into());
    }
    game_closed()?;
    let path = cvars_path().filter(|p| p.exists()).ok_or(tr(
        "Destinys cvars.xml wurde auf diesem PC nicht gefunden",
        "Destiny's cvars.xml wasn't found on this PC",
    ))?;
    let xml = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let next = with_game_key(&xml, &action, slot, &key).ok_or(tr(
        "Diese Aktion steht nicht in deiner cvars.xml",
        "This action isn't in your cvars.xml",
    ))?;
    let backup = backup_cvars_path(&app);
    if !backup.exists() {
        if let Some(dir) = backup.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&backup, &xml).map_err(|e| e.to_string())?;
    }
    write_game_cvars(&path, &next, true)?;
    Ok(macro_game_bindings(app))
}

/// Makes the game's cvars.xml read-only (Destiny can't reset the keys, but
/// doesn't keep changed graphics or sound settings either) or writable again.
#[tauri::command]
pub fn macro_lock_cvars(app: AppHandle, locked: bool) -> Result<GameBindings, String> {
    let path = cvars_path().filter(|p| p.exists()).ok_or(tr(
        "Destinys cvars.xml wurde auf diesem PC nicht gefunden",
        "Destiny's cvars.xml wasn't found on this PC",
    ))?;
    set_read_only(&path, locked)?;
    lock_old_cvars(&path, locked);
    Ok(macro_game_bindings(app))
}

/// A place with no key: "unused", or "escape", which Destiny writes for
/// places it shows empty (Esc can't be bound in game).
fn unbound(key: &str) -> bool {
    matches!(key.trim(), "" | "unused" | "escape")
}

/// "f!unused" → ["f"]: the primary and secondary keys that are set.
fn bound_keys(value: &str) -> Vec<String> {
    value
        .split('!')
        .map(str::trim)
        .filter(|k| !unbound(k))
        .map(String::from)
        .collect()
}

// --- Playing ---------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Input {
    Key(u16),
    Mouse(Button),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Button {
    Left,
    Right,
    Middle,
    X1,
    X2,
    WheelUp,
    WheelDown,
}

/// Keys a key code is on with the extended bit (arrows, Insert … , right Ctrl/Alt).
fn extended(vk: u16) -> bool {
    matches!(vk, 0x21..=0x28 | 0x2C | 0x2D | 0x2E | 0x5B | 0x5C | 0x6F | 0x90 | 0xA3 | 0xA5)
}

/// Where a key that types a character sits (KeyboardEvent.code names the
/// place on a US keyboard): its scan code. "KeyY" is the key right of T,
/// "Z" on a German keyboard; that one, not the one with "Y" on it.
fn scan_for_code(code: &str) -> Option<u32> {
    const ROWS: [(&str, u32); 4] = [
        ("Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal", 0x02),
        ("KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight", 0x10),
        ("KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backquote", 0x1E),
        ("Backslash KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash", 0x2B),
    ];
    if code == "IntlBackslash" {
        return Some(0x56);
    }
    ROWS.iter().find_map(|(keys, first)| keys.split(' ').position(|k| k == code).map(|i| first + i as u32))
}

/// Virtual key for a KeyboardEvent.code: for the keys that type characters
/// the one on that place in the keyboard layout in use.
fn vk_for_code(code: &str) -> Option<u16> {
    if let Some(scan) = scan_for_code(code) {
        let vk = unsafe { MapVirtualKeyW(scan, MAPVK_VSC_TO_VK_EX) } as u16;
        if vk != 0 {
            return Some(vk);
        }
    }
    if let Some(c) = code.strip_prefix("Key").filter(|c| c.len() == 1) {
        let c = c.as_bytes()[0];
        return c.is_ascii_uppercase().then_some(c as u16);
    }
    if let Some(d) = code.strip_prefix("Digit").filter(|d| d.len() == 1) {
        let d = d.as_bytes()[0];
        return d.is_ascii_digit().then_some(d as u16);
    }
    if let Some(n) = code.strip_prefix("Numpad").and_then(|n| n.parse::<u16>().ok()) {
        return (n <= 9).then_some(0x60 + n);
    }
    if let Some(n) = code.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
        return (1..=24).contains(&n).then_some(0x6F + n);
    }
    Some(match code {
        "Space" => 0x20,
        "Enter" | "NumpadEnter" => 0x0D,
        "Tab" => 0x09,
        "Escape" => 0x1B,
        "Backspace" => 0x08,
        "CapsLock" => 0x14,
        "ShiftLeft" => 0xA0,
        "ShiftRight" => 0xA1,
        "ControlLeft" => 0xA2,
        "ControlRight" => 0xA3,
        "AltLeft" => 0xA4,
        "AltRight" => 0xA5,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "End" => 0x23,
        "Home" => 0x24,
        "PrintScreen" => 0x2C,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "NumpadMultiply" => 0x6A,
        "NumpadAdd" => 0x6B,
        "NumpadSubtract" => 0x6D,
        "NumpadDecimal" => 0x6E,
        "NumpadDivide" => 0x6F,
        "NumLock" => 0x90,
        "ScrollLock" => 0x91,
        "Pause" => 0x13,
        "Semicolon" => 0xBA,
        "Equal" => 0xBB,
        "Comma" => 0xBC,
        "Minus" => 0xBD,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Backquote" => 0xC0,
        "BracketLeft" => 0xDB,
        "Backslash" => 0xDC,
        "BracketRight" => 0xDD,
        "Quote" => 0xDE,
        "IntlBackslash" => 0xE2,
        _ => return None,
    })
}

fn button_for(name: &str) -> Option<Button> {
    Some(match name {
        "left" => Button::Left,
        "right" => Button::Right,
        "middle" => Button::Middle,
        "x1" => Button::X1,
        "x2" => Button::X2,
        "wheelup" => Button::WheelUp,
        "wheeldown" => Button::WheelDown,
        _ => return None,
    })
}

/// One key as Destiny names it in cvars.xml ("f", "space", "left mouse
/// button", "extra mouse button 1", "page up" …).
fn input_for_game_key(name: &str) -> Option<Input> {
    let name = name.trim().to_lowercase();
    let mouse = |b| Some(Input::Mouse(b));
    match name.as_str() {
        "left mouse button" | "mouse 1" => return mouse(Button::Left),
        "right mouse button" | "mouse 2" => return mouse(Button::Right),
        "middle mouse button" | "mouse 3" => return mouse(Button::Middle),
        "extra mouse button 1" | "mouse 4" => return mouse(Button::X1),
        "extra mouse button 2" | "mouse 5" => return mouse(Button::X2),
        "mouse wheel up" => return mouse(Button::WheelUp),
        "mouse wheel down" => return mouse(Button::WheelDown),
        _ => {}
    }
    let bytes = name.as_bytes();
    if bytes.len() == 1 && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit()) {
        return Some(Input::Key(bytes[0].to_ascii_uppercase() as u16));
    }
    if let Some(n) = name.strip_prefix('f').and_then(|n| n.parse::<u16>().ok()) {
        return (1..=24).contains(&n).then_some(Input::Key(0x6F + n));
    }
    for prefix in ["numpad ", "num ", "keypad ", "numpad"] {
        if let Some(n) = name.strip_prefix(prefix).and_then(|n| n.trim().parse::<u16>().ok()) {
            return (n <= 9).then_some(Input::Key(0x60 + n));
        }
    }
    let code = match name.as_str() {
        "space" | "spacebar" => "Space",
        "enter" | "return" => "Enter",
        "tab" => "Tab",
        "escape" | "esc" => "Escape",
        "backspace" => "Backspace",
        "caps lock" | "capslock" => "CapsLock",
        "shift" | "left shift" | "lshift" => "ShiftLeft",
        "right shift" | "rshift" => "ShiftRight",
        "control" | "ctrl" | "left control" | "left ctrl" | "lcontrol" => "ControlLeft",
        "right control" | "right ctrl" | "rcontrol" => "ControlRight",
        "alt" | "left alt" | "lalt" => "AltLeft",
        "right alt" | "ralt" => "AltRight",
        "left" | "left arrow" => "ArrowLeft",
        "right" | "right arrow" => "ArrowRight",
        "up" | "up arrow" => "ArrowUp",
        "down" | "down arrow" => "ArrowDown",
        "page up" | "pageup" => "PageUp",
        "page down" | "pagedown" => "PageDown",
        "home" => "Home",
        "end" => "End",
        "insert" => "Insert",
        "delete" => "Delete",
        "print screen" => "PrintScreen",
        "pause" => "Pause",
        "scroll lock" => "ScrollLock",
        "num lock" => "NumLock",
        "`" | "~" | "tilde" | "grave" => "Backquote",
        "-" | "minus" => "Minus",
        "=" | "equals" => "Equal",
        "[" | "left bracket" => "BracketLeft",
        "]" | "right bracket" => "BracketRight",
        "\\" | "backslash" => "Backslash",
        ";" | "semicolon" => "Semicolon",
        "'" | "apostrophe" | "quote" => "Quote",
        "," | "comma" => "Comma",
        "." | "period" => "Period",
        "/" | "slash" => "Slash",
        _ => return None,
    };
    vk_for_code(code).map(Input::Key)
}

/// A game key binding ("shift+escape") as the inputs to press together.
fn inputs_for_binding(binding: &str) -> Option<Vec<Input>> {
    binding.split('+').map(input_for_game_key).collect()
}

fn send(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn key_input(vk: u16, up: bool) -> INPUT {
    let mut flags = if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) };
    if extended(vk) {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                // The scan code too: games read the keyboard by it.
                wScan: unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn mouse_input(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: data as _,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Press (`up` false) or let go of one input. The wheel turns one notch on
/// a press and does nothing on letting go.
fn press(input: Input, up: bool) {
    let event = match input {
        Input::Key(vk) => key_input(vk, up),
        Input::Mouse(button) => {
            let (down_flag, up_flag, data) = match button {
                Button::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 0),
                Button::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, 0),
                Button::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, 0),
                Button::X1 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 1),
                Button::X2 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 2),
                Button::WheelUp | Button::WheelDown => {
                    if up {
                        return;
                    }
                    let notch = if button == Button::WheelUp { 120 } else { -120 };
                    send(&[mouse_input(MOUSEEVENTF_WHEEL, notch)]);
                    return;
                }
            };
            mouse_input(if up { up_flag } else { down_flag }, data)
        }
    };
    send(&[event]);
}

/// How long a tapped key stays down.
const TAP: Duration = Duration::from_millis(30);

/// Stop flags of the macros playing now, by id.
/// Playing now: (id, only with Destiny in front, stop flag).
static PLAYING: Mutex<Vec<(String, bool, Arc<AtomicBool>)>> = Mutex::new(Vec::new());

fn playing(id: &str) -> bool {
    PLAYING.lock().unwrap().iter().any(|(i, _, _)| i == id)
}

fn stop(id: &str) {
    for (i, _, flag) in PLAYING.lock().unwrap().iter() {
        if i == id {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Every macro stops (the game lost the front, Radar quits …).
/// Stops the macros that play only with Destiny in front (it isn't now).
pub fn stop_focused() {
    for (_, focused, flag) in PLAYING.lock().unwrap().iter() {
        if *focused {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Two hotkey strings name the same key (or the same side button).
fn same_key(a: &str, b: &str) -> bool {
    if a.is_empty() || b.is_empty() {
        return false;
    }
    match (crate::hotkeys::parse(a), crate::hotkeys::parse(b)) {
        (Some(x), Some(y)) => x.id() == y.id(),
        _ => a == b,
    }
}

/// The hotkey of macro `index` went down (`pressed`) or up: every macro
/// that's on and shares that key plays.
pub fn on_hotkey(app: &AppHandle, index: usize, pressed: bool) {
    let list = all(app);
    let Some(hit) = list.get(index) else {
        return;
    };
    let keys = hit.hotkey.clone();
    for item in list.into_iter().filter(|m| m.enabled && same_key(&m.hotkey, &keys)) {
        on_one(app, item, pressed);
    }
}

fn on_one(app: &AppHandle, item: Macro, pressed: bool) {
    let on = playing(&item.id);
    match (item.mode, pressed) {
        (Mode::Once, true) if !on => start(app, item, false),
        (Mode::Hold | Mode::Sequence, true) if !on => start(app, item, true),
        (Mode::Hold | Mode::Sequence, false) => stop(&item.id),
        (Mode::Toggle, true) if on => stop(&item.id),
        (Mode::Toggle, true) => start(app, item, true),
        _ => {}
    }
}

fn start(app: &AppHandle, item: Macro, looped: bool) {
    let empty = if item.mode == Mode::Sequence {
        item.steps.is_empty() && item.press_steps.is_empty() && item.release_steps.is_empty()
    } else {
        item.steps.is_empty()
    };
    if empty {
        return;
    }
    let flag = Arc::new(AtomicBool::new(false));
    PLAYING.lock().unwrap().push((item.id.clone(), item.focused, flag.clone()));
    let _ = app.emit("macro-playing", (&item.id, true));
    let app = app.clone();
    std::thread::spawn(move || {
        play(&app, &item, looped, &flag);
        PLAYING.lock().unwrap().retain(|(_, _, f)| !Arc::ptr_eq(f, &flag));
        let _ = app.emit("macro-playing", (&item.id, false));
    });
}

/// Stopped, or (`focused`: only with Destiny in front) Destiny isn't.
fn halted(stop: &AtomicBool, focused: bool) -> bool {
    stop.load(Ordering::SeqCst) || (focused && !crate::screen::destiny_in_foreground())
}

/// Wait `ms`, in small bits so a stop is quick. False: stopped meanwhile.
fn wait(ms: u32, stop: &AtomicBool, focused: bool) -> bool {
    let mut left = ms as u64;
    while left > 0 {
        if halted(stop, focused) {
            return false;
        }
        let bit = left.min(15);
        std::thread::sleep(Duration::from_millis(bit));
        left -= bit;
    }
    true
}

/// The inputs of a step (none if its key is unknown or the game action isn't bound).
fn inputs(step: &Step, bindings: &[(String, String)]) -> Vec<Input> {
    match step {
        Step::Key { code, .. } => vk_for_code(code).map(Input::Key).into_iter().collect(),
        Step::Mouse { button, .. } => button_for(button).map(Input::Mouse).into_iter().collect(),
        Step::Game { action, .. } => bindings
            .iter()
            .find(|(n, _)| n == action)
            .and_then(|(_, v)| bound_keys(v).into_iter().find_map(|k| inputs_for_binding(&k)))
            .unwrap_or_default(),
        Step::Wait { .. } => Vec::new(),
    }
}

fn play(app: &AppHandle, item: &Macro, looped: bool, stop: &AtomicBool) {
    // The game's bindings as they are now (read once per start).
    let bindings = read_cvars(app).map(|(c, _)| c).unwrap_or_default();
    if item.mode != Mode::Sequence {
        play_steps(item, &item.steps, &bindings, looped, stop);
        return;
    }
    // Pressing: its part plays to the end even when let go meanwhile.
    let never = AtomicBool::new(false);
    play_steps(item, &item.press_steps, &bindings, false, &never);
    // Held: over and over until let go.
    if !item.steps.is_empty() {
        play_steps(item, &item.steps, &bindings, true, stop);
    } else {
        while wait(20, stop, item.focused) {}
    }
    // Let go (not when Destiny lost the front: nothing goes there then).
    if !item.focused || crate::screen::destiny_in_foreground() {
        play_steps(item, &item.release_steps, &bindings, false, &never);
    }
}

fn play_steps(item: &Macro, steps: &[Step], bindings: &[(String, String)], looped: bool, stop: &AtomicBool) {
    if steps.is_empty() {
        return;
    }
    // Down and not let go yet: let go at the end, whatever happens.
    let mut held: Vec<Input> = Vec::new();
    'passes: loop {
        let mut waited = false;
        for (n, step) in steps.iter().enumerate() {
            if halted(stop, item.focused) {
                break 'passes;
            }
            let how = match step {
                Step::Wait { ms } => {
                    waited |= *ms > 0;
                    if !wait(*ms, stop, item.focused) {
                        break 'passes;
                    }
                    continue;
                }
                Step::Key { press, .. } | Step::Mouse { press, .. } | Step::Game { press, .. } => *press,
            };
            let keys = inputs(step, bindings);
            match how {
                Press::Tap => {
                    for k in &keys {
                        press(*k, false);
                    }
                    std::thread::sleep(TAP);
                    for k in keys.iter().rev() {
                        press(*k, true);
                    }
                }
                Press::Down => {
                    for k in &keys {
                        press(*k, false);
                        held.push(*k);
                    }
                }
                Press::Up => {
                    for k in keys.iter().rev() {
                        press(*k, true);
                        held.retain(|h| h != k);
                    }
                }
            }
            // The wait after it, unless one of its own follows: the standard
            // one after every block, else the one set between it and the next.
            let gap = match steps.get(n + 1) {
                Some(Step::Wait { .. }) => 0,
                _ if item.delay > 0 => item.delay,
                Some(_) => step.after().unwrap_or(LINK_DELAY),
                None => 0,
            };
            if gap > 0 {
                waited = true;
                if !wait(gap, stop, item.focused) {
                    break 'passes;
                }
            }
        }
        if !looped {
            break;
        }
        // A loop without any wait would flood the game: a breath between passes.
        if !waited && !wait(20, stop, item.focused) {
            break;
        }
    }
    for k in held.iter().rev() {
        press(*k, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_one_game_key() {
        let xml = r#"<cvar name="melee" value="c!unused" /><cvar name="melee_charged" value="c!unused" />"#;
        assert_eq!(
            with_game_key(xml, "melee", 1, "f4").as_deref(),
            Some(r#"<cvar name="melee" value="c!f4" /><cvar name="melee_charged" value="c!unused" />"#)
        );
        assert_eq!(
            with_game_key(xml, "melee_charged", 0, "").as_deref(),
            Some(r#"<cvar name="melee" value="c!unused" /><cvar name="melee_charged" value="unused!unused" />"#)
        );
        assert_eq!(with_game_key(xml, "super", 0, "f"), None);
        assert!(writable_game_key("extra mouse button 2") && writable_game_key("f12") && writable_game_key("7"));
        assert!(writable_game_key("page up") && writable_game_key("=") && writable_game_key("`"));
        assert!(!writable_game_key("-"));
        assert!(!writable_game_key("f13") && !writable_game_key("numpad 1") && !writable_game_key("shift+escape"));
    }

    #[test]
    fn writes_over_a_read_only_file() {
        let dir = std::env::temp_dir().join(format!("radar-cvars-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cvars.xml");
        std::fs::write(&path, "old").unwrap();
        set_read_only(&path, true).unwrap();
        write_game_cvars(&path, "new", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert!(read_only(&path));
        let old = dir.join("cvars.old");
        std::fs::write(&old, "copy").unwrap();
        set_read_only(&old, true).unwrap();
        write_game_cvars(&path, "back", false).unwrap();
        assert!(!read_only(&path) && !read_only(&old));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_the_games_bindings() {
        let xml = r#"<body><namespace name="controls"><cvar name="super" value="f!unused" />
            <cvar name="fire" value="left mouse button!p" /><cvar name="emote_3" value="unused!unused" />
            <cvar name="ui_open_exit_dialog_confirm" value="shift+escape!unused" /></namespace></body>"#;
        let cvars = parse_cvars(xml);
        assert_eq!(cvars.len(), 4);
        assert_eq!(bound_keys(&cvars[0].1), ["f"]);
        assert_eq!(bound_keys(&cvars[1].1), ["left mouse button", "p"]);
        assert!(bound_keys(&cvars[2].1).is_empty());
        assert_eq!(bound_keys("backspace!escape"), ["backspace"]);
        assert!(bound_keys("escape!escape").is_empty());
        assert_eq!(inputs_for_binding("shift+escape"), Some(vec![Input::Key(0xA0), Input::Key(0x1B)]));
        assert_eq!(input_for_game_key("extra mouse button 1"), Some(Input::Mouse(Button::X1)));
        assert_eq!(input_for_game_key("f"), Some(Input::Key(b'F' as u16)));
        assert_eq!(input_for_game_key("f5"), Some(Input::Key(0x74)));
        assert_eq!(input_for_game_key("7"), Some(Input::Key(b'7' as u16)));
        assert_eq!(input_for_game_key("space"), Some(Input::Key(0x20)));
        assert_eq!(input_for_game_key("something new"), None);
    }

    #[test]
    fn maps_recorded_keys() {
        assert_eq!(scan_for_code("KeyQ"), Some(0x10));
        assert_eq!(scan_for_code("Backquote"), Some(0x29));
        assert_eq!(scan_for_code("Slash"), Some(0x35));
        assert_eq!(scan_for_code("F5"), None);
        assert_eq!(vk_for_code("KeyQ"), Some(b'Q' as u16));
        assert_eq!(vk_for_code("Digit4"), Some(b'4' as u16));
        assert_eq!(vk_for_code("F12"), Some(0x7B));
        assert_eq!(vk_for_code("Numpad5"), Some(0x65));
        assert_eq!(vk_for_code("ShiftLeft"), Some(0xA0));
        assert_eq!(vk_for_code("Fn"), None);
        assert!(extended(0x26) && !extended(0x41));
    }

    #[test]
    fn macros_round_trip() {
        let json = r#"[{"id":"m1","name":"Super","hotkey":"F5","mode":"toggle","steps":[
            {"kind":"game","action":"super"},{"kind":"wait","ms":200},
            {"kind":"key","code":"KeyQ","press":"down"},{"kind":"mouse","button":"left"}]}]"#;
        let macros: Vec<Macro> = serde_json::from_str(json).unwrap();
        let m = &macros[0];
        assert!(m.enabled && m.delay == 50 && m.mode == Mode::Toggle);
        assert!(matches!(&m.steps[0], Step::Game { action, press: Press::Tap, .. } if action == "super"));
        assert!(matches!(m.steps[2], Step::Key { press: Press::Down, .. }));
        let back = serde_json::to_string(&macros).unwrap();
        assert!(back.contains(r#""kind":"wait","ms":200"#));
    }
}
