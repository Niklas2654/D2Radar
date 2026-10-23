//! In-game loadouts of the current character: listed in the settings and
//! equipped by hotkey (Bungie only allows that in orbit, social spaces or
//! offline).

use std::collections::HashMap;
use std::sync::Mutex;

use futures::future::join_all;
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::bungie::{api, class_name, BungieState};
use crate::fireteam::definition;
use crate::i18n::{locale, tr};
use crate::inventory::{action_error, current_character, own_profile, pick_character, post_action, session};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadoutOut {
    /// Slot index, as Bungie's EquipLoadout expects it.
    index: usize,
    name: String,
    icon: Option<String>,
    /// Background image of the loadout's color.
    color: Option<String>,
    /// Nothing saved in this slot.
    empty: bool,
    name_hash: u32,
    color_hash: u32,
    icon_hash: u32,
    /// Subclass, weapons and armor saved in it (those still owned).
    items: Vec<crate::fireteam::ItemInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadoutsOut {
    class_name: String,
    loadouts: Vec<LoadoutOut>,
}

fn is_empty(loadout: &Value) -> bool {
    loadout["items"]
        .as_array()
        .is_none_or(|items| items.iter().all(|i| i["itemInstanceId"].as_str().is_none_or(|id| id == "0")))
}

/// A loadout slot as shown; `owned` maps instance ids to item hashes (for
/// its items; empty: no items).
async fn describe(app: &AppHandle, index: usize, loadout: &Value, owned: &HashMap<String, u64>) -> LoadoutOut {
    let items = join_all(
        loadout["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| owned.get(i["itemInstanceId"].as_str()?).copied())
            .map(|hash| crate::fireteam::item(app, hash)),
    )
    .await
    .into_iter()
    .flatten()
    .collect();
    let hash = |key: &str| loadout[key].as_u64().filter(|&h| h != 0);
    let (name, icon, color) = futures::join!(
        async {
            match hash("nameHash") {
                Some(h) => definition(app, "DestinyLoadoutNameDefinition", h).await,
                None => None,
            }
        },
        async {
            match hash("iconHash") {
                Some(h) => definition(app, "DestinyLoadoutIconDefinition", h).await,
                None => None,
            }
        },
        async {
            match hash("colorHash") {
                Some(h) => definition(app, "DestinyLoadoutColorDefinition", h).await,
                None => None,
            }
        },
    );
    LoadoutOut {
        index,
        name: name
            .and_then(|d| d["name"].as_str().filter(|n| !n.is_empty()).map(Into::into))
            .unwrap_or_else(|| format!("Loadout {}", index + 1)),
        icon: icon.and_then(|d| d["iconImagePath"].as_str().map(Into::into)),
        color: color.and_then(|d| d["colorImagePath"].as_str().map(Into::into)),
        empty: is_empty(loadout),
        name_hash: hash("nameHash").unwrap_or(0) as u32,
        color_hash: hash("colorHash").unwrap_or(0) as u32,
        icon_hash: hash("iconHash").unwrap_or(0) as u32,
        items,
    }
}

/// Slots cleared here lately: (character, slot, when). Bungie's profile
/// keeps showing a cleared slot's loadout for a while: until it says empty
/// too (or a while passed), it is shown empty.
static CLEARED: Mutex<Vec<(String, usize, std::time::Instant)>> = Mutex::new(Vec::new());
const CLEARED_FOR: std::time::Duration = std::time::Duration::from_secs(600);

/// Something saved into a slot: no longer one cleared.
pub(crate) fn slot_written(character: &str, index: usize) {
    CLEARED.lock().unwrap().retain(|(c, i, _)| !(c == character && *i == index));
}

/// The in-game loadouts of a character (default: the one played last).
#[tauri::command]
pub async fn loadouts_list(app: AppHandle, character_id: Option<String>) -> Result<LoadoutsOut, String> {
    let session = session(&app).await?;
    // 200 characters, 206 character loadouts
    let profile = own_profile(&app, &session, "200,206").await?;
    let (character_id, class_type) = pick_character(&profile, character_id.as_deref())?;
    let raw = profile["characterLoadouts"]["data"][&character_id]["loadouts"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    // Instance id -> item hash, for the items in the slots.
    let owned: HashMap<String, u64> = crate::inventory::owned_items_quick(&app)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|o| (o.instance_id, o.item_hash as u64))
        .collect();
    let mut loadouts = join_all(raw.iter().enumerate().map(|(i, l)| describe(&app, i, l, &owned))).await;
    // Cleared here, still filled in Bungie's answer: empty (Bungie catches
    // up a little later); Bungie empty too: no longer needed.
    {
        let mut cleared = CLEARED.lock().unwrap();
        cleared.retain(|(_, _, at)| at.elapsed() < CLEARED_FOR);
        cleared.retain(|(c, i, _)| {
            if *c != character_id {
                return true;
            }
            match loadouts.get_mut(*i) {
                Some(l) if !l.empty => {
                    *l = LoadoutOut {
                        index: *i,
                        name: format!("Loadout {}", i + 1),
                        icon: None,
                        color: None,
                        empty: true,
                        name_hash: 0,
                        color_hash: 0,
                        icon_hash: 0,
                        items: Vec::new(),
                    };
                    true
                }
                _ => false,
            }
        });
    }
    Ok(LoadoutsOut { class_name: class_name(class_type).into(), loadouts })
}

/// Equip loadout slot `index` on the current character; returns its name.
pub async fn equip(app: &AppHandle, index: usize) -> Result<String, String> {
    let session = session(app).await?;
    let profile = own_profile(app, &session, "200,206").await?;
    let (character_id, _) = current_character(&profile)?;
    let loadout = &profile["characterLoadouts"]["data"][&character_id]["loadouts"][index];
    if loadout.is_null() || is_empty(loadout) {
        return Err(format!("{} {}", tr("Leerer Loadout-Slot", "Empty loadout slot"), index + 1));
    }
    let name = describe(app, index, loadout, &HashMap::new()).await.name;
    let body = json!({
        "loadoutIndex": index,
        "characterId": character_id,
        "membershipType": session.membership_type,
    });
    post_action(app, &session, "Loadouts/EquipLoadout/", body).await.map_err(action_error)?;
    crate::inventory::invalidate();
    Ok(name)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identifier {
    hash: u32,
    /// Name, or for colors / icons the image path.
    value: String,
}

/// What an in-game loadout slot can be called and look like, in the
/// game's order.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identifiers {
    names: Vec<Identifier>,
    colors: Vec<Identifier>,
    icons: Vec<Identifier>,
}

static IDENTIFIERS: Mutex<Option<(String, Identifiers)>> = Mutex::new(None);

impl Identifiers {
    /// A valid (name, color, icon) for slot `slot`, from the game's lists.
    pub(crate) fn pick(&self, slot: usize) -> (u32, u32, u32) {
        let at = |list: &[Identifier]| if list.is_empty() { 0 } else { list[slot % list.len()].hash };
        (at(&self.names), at(&self.colors), at(&self.icons))
    }
}

#[tauri::command]
pub async fn loadout_identifiers(app: AppHandle) -> Result<Identifiers, String> {
    identifiers(&app).await
}

pub(crate) async fn identifiers(app: &AppHandle) -> Result<Identifiers, String> {
    let lc = locale().to_string();
    if let Some((cached_lc, ids)) = IDENTIFIERS.lock().unwrap().as_ref() {
        if *cached_lc == lc {
            return Ok(ids.clone());
        }
    }
    let state = app.state::<BungieState>();
    let key = state.api_key()?;
    let manifest = api(&state.http, &key, Method::GET, "/Destiny2/Manifest/", None).await?;
    let paths = &manifest["jsonWorldComponentContentPaths"][&lc];
    let table = |name: &str| {
        let url = paths[name].as_str().map(|p| format!("https://www.bungie.net{p}"));
        let http = state.http.clone();
        async move {
            let url = url.ok_or(tr("Manifest-Pfad fehlt", "Manifest path missing"))?;
            http.get(url).send().await.map_err(|e| e.to_string())?.json::<HashMap<String, Value>>().await.map_err(|e| e.to_string())
        }
    };
    let (constants, names, colors, icons) = futures::try_join!(
        table("DestinyLoadoutConstantsDefinition"),
        table("DestinyLoadoutNameDefinition"),
        table("DestinyLoadoutColorDefinition"),
        table("DestinyLoadoutIconDefinition"),
    )?;
    let constants = constants.into_values().next().unwrap_or(Value::Null);
    let pick = |list: &str, table: &HashMap<String, Value>, field: &str| -> Vec<Identifier> {
        constants[list]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|h| {
                let hash = h.as_u64()? as u32;
                let value = table.get(&hash.to_string())?[field].as_str()?.to_string();
                Some(Identifier { hash, value })
            })
            .collect()
    };
    let ids = Identifiers {
        names: pick("loadoutNameHashes", &names, "name"),
        colors: pick("loadoutColorHashes", &colors, "colorImagePath"),
        icons: pick("loadoutIconHashes", &icons, "iconImagePath"),
    };
    *IDENTIFIERS.lock().unwrap() = Some((lc, ids.clone()));
    Ok(ids)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Equipped {
    ok: bool,
    /// Loadout name, or the error.
    message: String,
}

/// Hotkey: equip a loadout and tell the overlay how it went.
pub fn equip_from_hotkey(app: &AppHandle, index: usize) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let event = match equip(&app, index).await {
            Ok(name) => Equipped { ok: true, message: name },
            Err(error) => Equipped { ok: false, message: error },
        };
        let _ = app.emit("loadout-equipped", event);
    });
}

/// Empty an in-game loadout slot of a character.
#[tauri::command]
pub async fn loadout_clear(app: AppHandle, character_id: Option<String>, index: usize) -> Result<(), String> {
    let session = session(&app).await?;
    let profile = own_profile(&app, &session, "200").await?;
    let (character_id, _) = pick_character(&profile, character_id.as_deref())?;
    let body = json!({
        "loadoutIndex": index,
        "characterId": character_id,
        "membershipType": session.membership_type,
    });
    post_action(&app, &session, "Loadouts/ClearLoadout/", body).await.map_err(action_error)?;
    // Shown empty from now on, whatever Bungie's profile still says.
    slot_written(&character_id, index);
    CLEARED.lock().unwrap().push((character_id, index, std::time::Instant::now()));
    Ok(())
}

/// Save an in-game loadout slot to DIM, under its name: its items as they
/// are now (their current mods and perks). Returns the new DIM loadout's id.
#[tauri::command]
pub async fn loadout_to_dim(
    app: AppHandle,
    character_id: Option<String>,
    index: usize,
    name: Option<String>,
) -> Result<String, String> {
    let session = session(&app).await?;
    let profile = own_profile(&app, &session, "200,206").await?;
    let (character_id, _) = pick_character(&profile, character_id.as_deref())?;
    let loadout = &profile["characterLoadouts"]["data"][&character_id]["loadouts"][index];
    if loadout.is_null() || is_empty(loadout) {
        return Err(format!("{} {}", tr("Leerer Loadout-Slot", "Empty loadout slot"), index + 1));
    }
    let items: Vec<String> = loadout["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| i["itemInstanceId"].as_str())
        .filter(|id| *id != "0")
        .map(String::from)
        .collect();
    // The name given, else the slot's.
    let name = match name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
        Some(n) => n,
        None => describe(&app, index, loadout, &HashMap::new()).await.name,
    };
    crate::presets::preset_save(app, Some(character_id), name, items).await
}
