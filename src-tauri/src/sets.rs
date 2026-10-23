//! Presets: bundles of DIM loadouts, each assigned to one of the game's
//! loadout slots (e.g. "Raid": one loadout per encounter). Writing a preset
//! puts every loadout into its slot, so a whole set of in-game loadouts can
//! be swapped at once. Stored locally (loadout-presets.json).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::i18n::tr;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEntry {
    /// In-game loadout slot (0-based).
    slot: usize,
    /// DIM loadout id.
    loadout_id: String,
    /// In-game name / color / icon for the slot (0 = keep / the loadout's).
    #[serde(default)]
    name_hash: u32,
    #[serde(default)]
    color_hash: u32,
    #[serde(default)]
    icon_hash: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadoutSet {
    /// Empty for a new preset (an id is assigned on save).
    #[serde(default)]
    id: String,
    name: String,
    /// 0 Titan, 1 Hunter, 2 Warlock.
    class_type: i64,
    entries: Vec<SetEntry>,
}

static SETS: Mutex<Option<Vec<LoadoutSet>>> = Mutex::new(None);

fn path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("loadout-presets.json")
}

fn all(app: &AppHandle) -> Vec<LoadoutSet> {
    SETS.lock()
        .unwrap()
        .get_or_insert_with(|| {
            std::fs::read_to_string(path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
        })
        .clone()
}

fn store(app: &AppHandle, sets: Vec<LoadoutSet>) -> Result<Vec<LoadoutSet>, String> {
    if let Some(dir) = path(app).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(&sets).map_err(|e| e.to_string())?;
    std::fs::write(path(app), json).map_err(|e| e.to_string())?;
    *SETS.lock().unwrap() = Some(sets.clone());
    Ok(sets)
}

#[tauri::command]
pub fn loadout_sets(app: AppHandle) -> Vec<LoadoutSet> {
    all(&app)
}

/// Create (empty id) or update a preset; returns all presets and the id.
#[tauri::command]
pub fn loadout_set_save(app: AppHandle, mut set: LoadoutSet) -> Result<(Vec<LoadoutSet>, String), String> {
    set.name = set.name.trim().to_string();
    if set.name.is_empty() {
        return Err(tr("Gib dem Preset einen Namen", "Give the preset a name").into());
    }
    set.entries.sort_by_key(|e| e.slot);
    set.entries.dedup_by_key(|e| e.slot);
    let mut sets = all(&app);
    if set.id.is_empty() {
        set.id = crate::presets::uuid();
        sets.push(set.clone());
    } else if let Some(existing) = sets.iter_mut().find(|s| s.id == set.id) {
        *existing = set.clone();
    } else {
        sets.push(set.clone());
    }
    Ok((store(&app, sets)?, set.id))
}

#[tauri::command]
pub fn loadout_set_delete(app: AppHandle, id: String) -> Result<Vec<LoadoutSet>, String> {
    let sets = all(&app).into_iter().filter(|s| s.id != id).collect();
    store(&app, sets)
}
