//! Which season a weapon version is from: its icon's watermark, mapped to the
//! season's number by DIM's table (data/watermark-to-season.json, from
//! github.com/DestinyItemManager/d2-additional-info, MIT License), and the
//! number to the season's name in the app's language by Bungie's manifest.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use reqwest::Method;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::bungie::{api, BungieState};

static WATERMARKS: LazyLock<HashMap<String, u32>> =
    LazyLock::new(|| serde_json::from_str(include_str!("../data/watermark-to-season.json")).unwrap_or_default());

/// Season number -> name, per language (loaded once).
static NAMES: Mutex<Option<(String, HashMap<u32, String>)>> = Mutex::new(None);

async fn names(app: &AppHandle) -> Option<HashMap<u32, String>> {
    let locale = crate::i18n::locale().to_string();
    if let Some((l, names)) = NAMES.lock().unwrap().as_ref() {
        if *l == locale {
            return Some(names.clone());
        }
    }
    let state = app.state::<BungieState>();
    let key = state.api_key().ok()?;
    let manifest = api(&state.http, &key, Method::GET, "/Destiny2/Manifest/", None).await.ok()?;
    let path = manifest["jsonWorldComponentContentPaths"][&locale]["DestinySeasonDefinition"].as_str()?.to_string();
    let table: Value = state.http.get(format!("https://www.bungie.net{path}")).send().await.ok()?.json().await.ok()?;
    let names: HashMap<u32, String> = table
        .as_object()?
        .values()
        .filter_map(|s| {
            let number = s["seasonNumber"].as_u64()? as u32;
            let name = s["displayProperties"]["name"].as_str().filter(|n| !n.is_empty())?;
            Some((number, name.to_string()))
        })
        .collect();
    *NAMES.lock().unwrap() = Some((locale, names.clone()));
    Some(names)
}

/// The season of a weapon version by its watermark: its name ("Season of
/// the Wish"), or "Season 23" when the manifest has none for it.
#[tauri::command]
pub async fn season_name(app: AppHandle, watermark: String) -> Option<String> {
    let number = *WATERMARKS.get(&watermark)?;
    match names(&app).await.and_then(|n| n.get(&number).cloned()) {
        Some(name) => Some(name),
        None => Some(format!("{} {number}", crate::i18n::tr("Saison", "Season"))),
    }
}
