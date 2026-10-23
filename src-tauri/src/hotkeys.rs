//! Configurable global hotkeys (stored in hotkeys.json), plus the opacity of
//! DIM in game, which is opened by one of them.
//!
//! Keys are strings like "F8" or "Ctrl+Shift+D" (the global-hotkey syntax;
//! the settings page builds them from a pressed key).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::i18n::tr;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Show / hide the overlay.
    Overlay,
    /// Overlay edit mode.
    Edit,
    /// Show / hide the inspected weapon.
    Weapon,
    /// DIM over the game.
    Dim,
    /// Discord over the game.
    Discord,
    /// Equip in-game loadout slot n (0-based).
    Loadout(usize),
}

/// Loadout slots that can get a hotkey.
const MAX_LOADOUTS: usize = 12;

/// Every action with its name in the settings ("loadout0" … for slots).
fn actions() -> Vec<(Action, String)> {
    let fixed = [(Action::Overlay, "overlay"), (Action::Edit, "edit"), (Action::Weapon, "weapon"), (Action::Dim, "dim"), (Action::Discord, "discord")];
    fixed
        .into_iter()
        .map(|(a, name)| (a, name.to_string()))
        .chain((0..MAX_LOADOUTS).map(|i| (Action::Loadout(i), format!("loadout{i}"))))
        .collect()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HotkeyConfig {
    overlay: String,
    edit: String,
    weapon: String,
    dim: String,
    discord: String,
    /// Per loadout slot; "" = none.
    loadouts: Vec<String>,
    /// Opacity of DIM in game (0.2–1).
    dim_opacity: f64,
    /// Opacity of Discord in game (0.2–1).
    discord_opacity: f64,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            overlay: "F8".into(),
            edit: "F9".into(),
            weapon: "F10".into(),
            dim: "F7".into(),
            discord: "F6".into(),
            loadouts: Vec::new(),
            dim_opacity: 0.5,
            discord_opacity: 0.85,
        }
    }
}

impl HotkeyConfig {
    fn keys_mut(&mut self, action: Action) -> &mut String {
        match action {
            Action::Overlay => &mut self.overlay,
            Action::Edit => &mut self.edit,
            Action::Weapon => &mut self.weapon,
            Action::Dim => &mut self.dim,
            Action::Discord => &mut self.discord,
            Action::Loadout(i) => {
                if self.loadouts.len() <= i {
                    self.loadouts.resize(i + 1, String::new());
                }
                &mut self.loadouts[i]
            }
        }
    }

    fn keys(&self, action: Action) -> &str {
        match action {
            Action::Overlay => &self.overlay,
            Action::Edit => &self.edit,
            Action::Weapon => &self.weapon,
            Action::Dim => &self.dim,
            Action::Discord => &self.discord,
            Action::Loadout(i) => self.loadouts.get(i).map(String::as_str).unwrap_or(""),
        }
    }
}

static CONFIG: Mutex<Option<HotkeyConfig>> = Mutex::new(None);

fn path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("hotkeys.json")
}

pub fn config(app: &AppHandle) -> HotkeyConfig {
    CONFIG
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

fn save(app: &AppHandle, config: HotkeyConfig) {
    if let Some(dir) = path(app).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(path(app), json);
    }
    *CONFIG.lock().unwrap() = Some(config.clone());
    let _ = app.emit("hotkeys-changed", config);
}

fn parse(keys: &str) -> Option<Shortcut> {
    keys.parse().ok()
}

/// Whether the hotkeys are taken now: only while the game has the focus
/// (or a Radar window over it, or the layout is edited), so the keys stay
/// free for other programs otherwise. Set by lib.rs's game watch.
static ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Take the hotkeys (`on`) or let them go.
pub fn set_active(app: &AppHandle, on: bool) {
    ACTIVE.store(on, std::sync::atomic::Ordering::SeqCst);
    register_all(app);
}

/// (Re)register every configured hotkey. Returns the ones that failed
/// (taken by another program), as "keys: error". While not active they are
/// let go again right after (registering still finds conflicts).
pub fn register_all(app: &AppHandle) -> Vec<String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let config = config(app);
    let mut failed = Vec::new();
    for (action, _) in actions() {
        let keys = config.keys(action);
        // Loadout hotkeys are no longer offered; old bindings stay off.
        if keys.is_empty() || matches!(action, Action::Loadout(_)) {
            continue;
        }
        match parse(keys).map(|s| shortcuts.register(s)) {
            Some(Ok(())) => {}
            Some(Err(e)) => failed.push(format!("{keys}: {e}")),
            None => failed.push(format!("{keys}: {}", tr("unbekannte Taste", "unknown key"))),
        }
    }
    if !ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = shortcuts.unregister_all();
    }
    failed
}

/// The action bound to a pressed shortcut.
pub fn action_for(app: &AppHandle, pressed: &Shortcut) -> Option<Action> {
    let config = config(app);
    actions()
        .into_iter()
        .find(|(action, _)| parse(config.keys(*action)).is_some_and(|s| s.id() == pressed.id()))
        .map(|(action, _)| action)
}

#[tauri::command]
pub fn hotkeys_get(app: AppHandle) -> HotkeyConfig {
    config(&app)
}

/// Bind `keys` (empty = none) to `action`; rejects unknown keys, keys bound
/// to another action, and keys another program already uses.
#[tauri::command]
pub fn hotkey_set(app: AppHandle, action: String, keys: String) -> Result<HotkeyConfig, String> {
    let all = actions();
    let (action, _) = all
        .iter()
        .find(|(_, name)| *name == action)
        .cloned()
        .ok_or(tr("Unbekannte Aktion", "Unknown action"))?;
    let keys = keys.trim().to_string();
    let previous = config(&app);
    if !keys.is_empty() {
        let shortcut = parse(&keys).ok_or(tr("Diese Taste wird nicht unterstützt", "This key isn't supported"))?;
        let taken = all.iter().any(|(other, _)| {
            *other != action && parse(previous.keys(*other)).is_some_and(|s| s.id() == shortcut.id())
        });
        if taken {
            return Err(tr("Schon für eine andere Aktion vergeben", "Already used for another action").into());
        }
    }
    let mut next = previous.clone();
    *next.keys_mut(action) = keys.clone();
    *CONFIG.lock().unwrap() = Some(next.clone());
    let failed = register_all(&app);
    if !keys.is_empty() && failed.iter().any(|f| f.starts_with(&format!("{keys}:"))) {
        // Taken by another program: keep the old binding.
        *CONFIG.lock().unwrap() = Some(previous);
        register_all(&app);
        return Err(tr(
            "Diese Kombination benutzt schon ein anderes Programm",
            "Another program already uses this combination",
        )
        .into());
    }
    save(&app, next.clone());
    Ok(next)
}

/// Opacity of DIM in game; applied right away if it's open.
#[tauri::command]
pub fn dim_game_set_opacity(app: AppHandle, opacity: f64) -> HotkeyConfig {
    let mut next = config(&app);
    next.dim_opacity = opacity.clamp(0.2, 1.0);
    save(&app, next.clone());
    crate::dim::apply_game_opacity(&app, next.dim_opacity);
    next
}

/// Opacity of Discord in game; applied right away if it's open.
#[tauri::command]
pub fn discord_game_set_opacity(app: AppHandle, opacity: f64) -> HotkeyConfig {
    let mut next = config(&app);
    next.discord_opacity = opacity.clamp(0.2, 1.0);
    save(&app, next.clone());
    crate::discord::apply_game_opacity(&app, next.discord_opacity);
    next
}

pub fn discord_opacity(app: &AppHandle) -> f64 {
    config(app).discord_opacity
}

pub fn dim_opacity(app: &AppHandle) -> f64 {
    config(app).dim_opacity
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_keys_from_the_settings_page() {
        for keys in ["F7", "Ctrl+Z", "Ctrl+Shift+D", "Alt+Digit1", "Shift+Backquote", "Ctrl+Numpad5", "Space"] {
            assert!(parse(keys).is_some(), "{keys}");
        }
        assert_eq!(parse("Ctrl+Shift+D").unwrap().id(), parse("shift+ctrl+KeyD").unwrap().id());
        assert!(parse("Ctrl+").is_none());
    }

    #[test]
    fn loadout_slots_get_their_own_keys() {
        let mut config = HotkeyConfig::default();
        *config.keys_mut(Action::Loadout(3)) = "Alt+Digit4".into();
        assert_eq!(config.loadouts, ["", "", "", "Alt+Digit4"]);
        assert_eq!(config.keys(Action::Loadout(3)), "Alt+Digit4");
        assert_eq!(config.keys(Action::Loadout(7)), "");
        let names: Vec<String> = actions().into_iter().map(|(_, n)| n).collect();
        assert!(names.contains(&"loadout0".to_string()) && names.contains(&"loadout11".to_string()));
        // Older hotkeys.json files without loadouts still load.
        let old: HotkeyConfig = serde_json::from_str(r#"{"overlay":"F8","dim":"F7"}"#).unwrap();
        assert!(old.loadouts.is_empty() && old.weapon == "F10");
    }
}
