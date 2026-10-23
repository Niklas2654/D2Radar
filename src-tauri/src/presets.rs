//! Building loadout presets in Radar: pick an item per slot (from everything
//! the player owns), name it and save it to DIM, where the Loadouts tab
//! picks it up (equip / write to an in-game slot).

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::bungie::class_name;
use crate::fireteam::{item, ARMOR_BUCKETS, SUBCLASS};
use crate::i18n::tr;
use crate::inventory::{own_profile, owned_items, pick_character, session, OwnedItem};
use crate::weapons::{gear, Gear};

/// The slots of a loadout, in the game's order: subclass, kinetic, energy,
/// power, helmet, gauntlets, chest, legs, class item.
const SLOTS: [u64; 9] = [
    SUBCLASS, 1498876634, 2465295065, 953998645, 3448274439, 3551918588, 14239492, 20886954, 1585787867,
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// Item instance id.
    id: String,
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    exotic: bool,
    watermark: Option<String>,
    /// Where it is: "Vault", "Hunter", "Hunter · equipped" …
    location: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    bucket: u64,
    item: Option<Choice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    class_type: i64,
    class_name: String,
    slots: Vec<Slot>,
}

fn location(o: &OwnedItem, classes: &HashMap<String, i64>) -> String {
    match &o.character_id {
        None => tr("Tresor", "Vault").into(),
        Some(c) => {
            let class = class_name(classes.get(c).copied().unwrap_or(-1));
            if o.location == "equipped" {
                format!("{class} · {}", tr("ausgerüstet", "equipped"))
            } else {
                class.into()
            }
        }
    }
}

fn choice(o: &OwnedItem, gear: &Gear, classes: &HashMap<String, i64>) -> Option<Choice> {
    let g = gear.get(o.item_hash)?;
    Some(Choice {
        id: o.instance_id.clone(),
        hash: o.item_hash,
        name: g.name.clone(),
        icon: g.icon.clone(),
        type_name: g.type_name.clone(),
        exotic: g.exotic,
        watermark: g.watermark.clone(),
        location: location(o, classes),
    })
}

/// Character id -> class type, from a profile with component 200.
fn classes(profile: &Value) -> HashMap<String, i64> {
    profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, c)| (id.clone(), c["classType"].as_i64().unwrap_or(-1)))
        .collect()
}

/// A new preset for a character, starting from what it has equipped.
#[tauri::command]
pub async fn preset_draft(app: AppHandle, character_id: Option<String>) -> Result<Draft, String> {
    let s = session(&app).await?;
    crate::inventory::invalidate();
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let (character, class_type) = pick_character(&profile, character_id.as_deref())?;
    let classes = classes(&profile);
    let slots = SLOTS
        .iter()
        .map(|&bucket| Slot {
            bucket,
            item: owned
                .iter()
                .filter(|o| o.location == "equipped" && o.character_id.as_deref() == Some(character.as_str()))
                .find(|o| gear.get(o.item_hash).is_some_and(|g| g.bucket == bucket))
                .and_then(|o| choice(o, &gear, &classes)),
        })
        .collect();
    Ok(Draft { class_type, class_name: class_name(class_type).into(), slots })
}

/// Everything the player owns that fits `bucket` on the character
/// (subclasses only from that character itself).
#[tauri::command]
pub async fn preset_candidates(app: AppHandle, character_id: Option<String>, bucket: u64) -> Result<Vec<Choice>, String> {
    let s = session(&app).await?;
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let (character, class_type) = pick_character(&profile, character_id.as_deref())?;
    let classes = classes(&profile);
    let mut list: Vec<Choice> = owned
        .iter()
        .filter(|o| {
            gear.get(o.item_hash).is_some_and(|g| g.bucket == bucket && (g.class_type == 3 || g.class_type == class_type))
                && (bucket != SUBCLASS || o.character_id.as_deref() == Some(character.as_str()))
        })
        .filter_map(|o| choice(o, &gear, &classes))
        .collect();
    // Exotics first, then by name.
    list.sort_by(|a, b| b.exotic.cmp(&a.exotic).then_with(|| a.name.cmp(&b.name)));
    Ok(list)
}

/// A random UUID (v4 layout), as DIM wants for loadout ids.
pub(crate) fn uuid() -> String {
    let random = || {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        h.finish()
    };
    let (a, b) = (random(), random());
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xfff,
        0x8000 | (b >> 48) & 0x3fff,
        b & 0xffff_ffff_ffff
    )
}

/// The armor mods plugged into an owned armor piece (no empty sockets,
/// masterwork or crafting plugs), and apart from them its tuning (the
/// "+5 / -5" stat plug): that belongs to this very piece (not every piece
/// takes every tuning), so it is kept with the piece as socket index -> plug.
async fn armor_mods(app: &AppHandle, o: &OwnedItem) -> (Vec<u32>, Vec<(usize, u32)>) {
    let Some(info) = item(app, o.item_hash as u64).await else { return (Vec::new(), Vec::new()) };
    let (mut mods, mut tuning) = (Vec::new(), Vec::new());
    for &(index, empty) in &info.mod_sockets {
        let Some(&plug) = o.socket_plugs.get(index) else { continue };
        if plug == 0 || plug as u64 == empty {
            continue;
        }
        let Some(def) = item(app, plug as u64).await else { continue };
        let c = &def.plug_category;
        if c.contains("tuning") {
            tuning.push((index, plug));
        } else if !c.contains("masterworks") && !c.contains("crafting") && !c.contains("empty") {
            mods.push(plug);
        }
    }
    (mods, tuning)
}

/// A loadout (item instance ids, one per slot) as DIM stores it. Subclass
/// setup, armor mods and tuning are taken from how those items are set up
/// right now, the artifact from the character's active perks.
async fn build_loadout(
    app: &AppHandle,
    s: &crate::inventory::Session,
    profile: &Value,
    owned: &[OwnedItem],
    gear: &Gear,
    character_id: Option<&str>,
    name: &str,
    items: &[String],
) -> Result<Value, String> {
    let (_, class_type) = pick_character(&profile, character_id)?;

    let mut equipped = Vec::new();
    let mut mods = Vec::new();
    for id in items {
        let Some(o) = owned.iter().find(|o| &o.instance_id == id) else { continue };
        let bucket = gear.get(o.item_hash).map(|g| g.bucket).unwrap_or(0);
        let mut entry = json!({ "id": o.instance_id, "hash": o.item_hash });
        if bucket == SUBCLASS {
            // Super, abilities, aspects and fragments as set up now.
            let overrides: serde_json::Map<String, Value> = o
                .socket_plugs
                .iter()
                .enumerate()
                .filter(|(_, &plug)| plug != 0)
                .map(|(index, &plug)| (index.to_string(), json!(plug)))
                .collect();
            entry["socketOverrides"] = Value::Object(overrides);
        }
        if ARMOR_BUCKETS.contains(&bucket) {
            let (piece_mods, tuning) = armor_mods(app, o).await;
            mods.extend(piece_mods);
            if !tuning.is_empty() {
                let overrides: serde_json::Map<String, Value> =
                    tuning.into_iter().map(|(index, plug)| (index.to_string(), json!(plug))).collect();
                entry["socketOverrides"] = Value::Object(overrides);
            }
        }
        equipped.push(entry);
    }
    if equipped.is_empty() {
        return Err(tr("Wähle mindestens ein Item", "Pick at least one item").into());
    }
    // The character's artifact perks, in DIM's format (DIM shows them; they
    // can only be set in game).
    let (character, _) = pick_character(&profile, character_id)?;
    let artifact = crate::apply::active_artifact(app, &s, &character).await;
    let mut parameters = json!({ "mods": mods });
    if !artifact.is_empty() {
        let season = match own_profile(app, &s, "100").await {
            Ok(p) => match p["profile"]["data"]["currentSeasonHash"].as_u64() {
                Some(hash) => crate::fireteam::definition(app, "DestinySeasonDefinition", hash)
                    .await
                    .and_then(|d| d["seasonNumber"].as_u64())
                    .unwrap_or(0),
                None => 0,
            },
            Err(_) => 0,
        };
        parameters["artifactUnlocks"] = json!({ "unlockedItemHashes": artifact, "seasonNumber": season });
    }
    let now = chrono::Utc::now().timestamp_millis();
    Ok(json!({
        "id": uuid(),
        "name": name,
        "classType": class_type,
        "equipped": equipped,
        "unequipped": [],
        "parameters": parameters,
        "createdAt": now,
        "lastUpdatedAt": now,
    }))
}

/// Save a loadout (item instance ids, one per slot) to DIM; it then shows
/// up among the DIM loadouts. Returns the new loadout's id.
#[tauri::command]
pub async fn preset_save(app: AppHandle, character_id: Option<String>, name: String, items: Vec<String>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr("Gib dem Preset einen Namen", "Give the preset a name").into());
    }
    let s = session(&app).await?;
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let loadout = build_loadout(&app, &s, &profile, &owned, &gear, character_id.as_deref(), name, &items).await?;
    let id = loadout["id"].as_str().unwrap_or_default().to_string();
    crate::dimsync::save_loadout(&app, &s, loadout).await?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_uuids() {
        let (a, b) = (uuid(), uuid());
        assert_ne!(a, b);
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12]);
        assert!(parts[2].starts_with('4'));
        assert!(matches!(parts[3].chars().next(), Some('8' | '9' | 'a' | 'b')));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetPreview {
    /// Shown like a saved DIM loadout (mods on armor, subclass, artifact).
    loadout: crate::dimsync::DimLoadoutOut,
    /// Weapons with the perks and mods they have right now.
    weapons: Vec<crate::fireteam::ItemInfo>,
    /// Set bonuses of the chosen armor.
    armor_sets: Vec<crate::fireteam::ArmorSet>,
}

/// Everything a loadout of these items would save, for the builder.
#[tauri::command]
pub async fn preset_preview(app: AppHandle, character_id: Option<String>, items: Vec<String>) -> Result<PresetPreview, String> {
    let s = session(&app).await?;
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let (character, class_type) = pick_character(&profile, character_id.as_deref())?;
    let picked: Vec<&OwnedItem> = items.iter().filter_map(|id| owned.iter().find(|o| &o.instance_id == id)).collect();
    let with_plugs = |o: &OwnedItem| {
        let plugs: Vec<u64> = o.socket_plugs.iter().map(|&p| p as u64).collect();
        let hash = o.item_hash as u64;
        let app = app.clone();
        async move { crate::fireteam::item_with_plugs(&app, hash, &plugs).await }
    };
    let bucket_of = |o: &OwnedItem| gear.get(o.item_hash).map(|g| g.bucket).unwrap_or(0);
    let weapon_items = picked.iter().filter(|o| crate::fireteam::WEAPON_BUCKETS.contains(&bucket_of(o))).map(|o| with_plugs(o));
    let armor_items = picked.iter().filter(|o| ARMOR_BUCKETS.contains(&bucket_of(o))).map(|o| with_plugs(o));
    let (weapons, armor) = futures::join!(futures::future::join_all(weapon_items), futures::future::join_all(armor_items));
    let weapons: Vec<_> = weapons.into_iter().flatten().collect();
    let armor: Vec<_> = armor.into_iter().flatten().collect();
    let armor_sets = crate::fireteam::armor_sets(&app, &armor).await;
    let draft = build_loadout(&app, &s, &profile, &owned, &gear, character_id.as_deref(), "", &items).await;
    let loadout = match draft {
        Ok(l) => l,
        // Nothing picked yet: an empty loadout.
        Err(_) => json!({ "equipped": [], "classType": class_type, "parameters": {} }),
    };
    let loadout = crate::dimsync::describe(&app, &loadout, &character, class_type, &owned).await;
    Ok(PresetPreview { loadout, weapons, armor_sets })
}
