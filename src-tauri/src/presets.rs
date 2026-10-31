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
    /// Where it comes from (English, lower case), for searching by it.
    #[serde(skip_serializing_if = "String::is_empty")]
    source: String,
    /// Its gear tier (1–5; 0: none).
    tier: u8,
    /// Its armor set (0: none).
    set: u32,
    /// A weapon's slot, ammo and element as words in the app's language
    /// (English, or German), for searching by them ("special energy
    /// sniper") and completing them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
    /// The same in the other language: found too, not suggested.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    aliases: Vec<String>,
    /// An exotic class item's two spirits (plug hashes, in column order).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    perk_hashes: Vec<u32>,
    /// A weapon's perks (all it can switch to), frame, origin trait and mod;
    /// an exotic class item's two spirits: their names, for searching by them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    perks: Vec<String>,
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
        source: String::new(),
        tier: o.gear_tier,
        set: g.set,
        tags: Vec::new(),
        aliases: Vec::new(),
        perk_hashes: Vec::new(),
        perks: Vec::new(),
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
    // Where each comes from (the searches find them by it too).
    let hashes: Vec<u32> = list.iter().map(|c| c.hash).collect();
    let sources = crate::weapons::source_of(&app, &hashes).await;
    // Weapons: slot, ammo and element as words (searched too).
    let weapon = crate::fireteam::WEAPON_BUCKETS.contains(&bucket);
    let ammo = if weapon { crate::weapons::weapon_ammo(&app, &hashes).await } else { HashMap::new() };
    let instances = if weapon { own_profile(&app, &s, "300").await.ok() } else { None };
    // (English words, German words.)
    let slot_words: (&[&str], &[&str]) = match bucket {
        1498876634 => (&["kinetic"], &["kinetisch"]),
        2465295065 => (&["energy"], &["energie"]),
        953998645 => (&["power", "heavy"], &["schwer"]),
        _ => (&[], &[]),
    };
    let german = !crate::i18n::english();
    for c in &mut list {
        if let Some(src) = sources.get(&c.hash) {
            c.source = src.clone();
        }
        // A weapon: every perk it has or can switch to, its frame, origin
        // trait and mod, its slot, ammo and element (searched too).
        if weapon {
            let ammo_words: (&[&str], &[&str]) = match ammo.get(&c.hash) {
                Some(1) => (&["primary"], &["primär"]),
                Some(2) => (&["special"], &["spezial"]),
                Some(3) => (&["heavy"], &["schwer"]),
                _ => (&[], &[]),
            };
            let element = instances.as_ref().and_then(|p| p["itemComponents"]["instances"]["data"][&c.id]["damageType"].as_i64());
            let element_words: (&[&str], &[&str]) = match element {
                Some(1) => (&["kinetic"], &["kinetisch"]),
                Some(2) => (&["arc"], &["arkus"]),
                Some(3) => (&["solar"], &["solar"]),
                Some(4) => (&["void"], &["leere"]),
                Some(6) => (&["stasis"], &["stasis"]),
                Some(7) => (&["strand"], &["strang"]),
                _ => (&[], &[]),
            };
            for (en, de) in [slot_words, ammo_words, element_words] {
                let (mine, other) = if german { (de, en) } else { (en, de) };
                for w in mine {
                    if !c.tags.iter().any(|t| t == w) {
                        c.tags.push(w.to_string());
                    }
                }
                c.aliases.extend(other.iter().filter(|w| !mine.contains(w)).map(|w| w.to_string()));
            }
            if let Some(o) = owned.iter().find(|o| o.instance_id == c.id) {
                c.perks = crate::weapons::plug_names(&app, &o.options).await;
            }
            continue;
        }
        // An exotic class item: its spirits' names (searched too).
        if c.exotic && bucket == 1585787867 {
            let Some(o) = owned.iter().find(|o| o.instance_id == c.id) else { continue };
            let Some(at) = crate::optimizer::spirit_sockets(&app, c.hash).await else { continue };
            for i in at {
                if let Some(&plug) = o.socket_plugs.get(i).filter(|&&p| p != 0) {
                    c.perk_hashes.push(plug);
                    if let Some(info) = item(&app, plug as u64).await {
                        c.perks.push(info.name.clone());
                    }
                }
            }
        }
    }
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
/// With `stat_mods` its stat mods (general and artifice socket) are left
/// out: those are given (the tuning too, when one is given for the piece).
async fn armor_mods(app: &AppHandle, o: &OwnedItem, stat_mods: bool) -> (Vec<u32>, Vec<(usize, u32)>) {
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
        } else if stat_mods && (c == "enhancements.v2_general" || c == "enhancements.artifice") {
            continue;
        } else if !c.contains("masterworks") && !c.contains("crafting") && !c.contains("empty") {
            mods.push(plug);
        }
    }
    (mods, tuning)
}

/// A loadout (item instance ids, one per slot) as DIM stores it. Subclass
/// setup, armor mods and tuning are taken from how those items are set up
/// right now, the artifact from the character's active perks; with
/// `stat_mods` (armor bucket -> mod items, e.g. the optimizer's) those in
/// place of the armor's own stat mods, each on its piece (DIM's
/// modsByBucket).
async fn build_loadout(
    app: &AppHandle,
    s: &crate::inventory::Session,
    profile: &Value,
    owned: &[OwnedItem],
    gear: &Gear,
    character_id: Option<&str>,
    name: &str,
    items: &[String],
    stat_mods: Option<&HashMap<u64, Vec<u32>>>,
    subclass_plugs: Option<&HashMap<usize, u32>>,
    artifact: Option<&[u32]>,
    weapon_plugs: Option<&HashMap<String, HashMap<usize, u32>>>,
) -> Result<Value, String> {
    let (_, class_type) = pick_character(&profile, character_id)?;

    let mut equipped = Vec::new();
    let mut mods = Vec::new();
    let mut by_bucket = serde_json::Map::new();
    for id in items {
        let Some(o) = owned.iter().find(|o| &o.instance_id == id) else { continue };
        let bucket = gear.get(o.item_hash).map(|g| g.bucket).unwrap_or(0);
        let mut entry = json!({ "id": o.instance_id, "hash": o.item_hash });
        if bucket == SUBCLASS {
            // Super, abilities, aspects and fragments as set up now, or as
            // picked (`subclass_plugs`: socket index -> plug).
            let mut overrides: serde_json::Map<String, Value> = o
                .socket_plugs
                .iter()
                .enumerate()
                .filter(|(_, &plug)| plug != 0)
                .map(|(index, &plug)| (index.to_string(), json!(plug)))
                .collect();
            for (index, &plug) in subclass_plugs.into_iter().flatten() {
                overrides.insert(index.to_string(), json!(plug));
            }
            entry["socketOverrides"] = Value::Object(overrides);
        }
        // A weapon's perks and mods as picked (socket index -> plug).
        if let Some(picked) = weapon_plugs.and_then(|w| w.get(&o.instance_id)).filter(|p| !p.is_empty()) {
            entry["socketOverrides"] = Value::Object(picked.iter().map(|(i, p)| (i.to_string(), json!(p))).collect());
        }
        if ARMOR_BUCKETS.contains(&bucket) {
            let (mut piece_mods, mut tuning) = armor_mods(app, o, stat_mods.is_some()).await;
            match stat_mods {
                // All of this piece's mods, its stat mods as given.
                Some(given) => {
                    let given: Vec<u32> = given.get(&bucket).into_iter().flatten().copied().filter(|&h| h != 0).collect();
                    // The optimizer's tuning in place of the piece's own.
                    let mut tuned = false;
                    for &h in &given {
                        if item(app, h as u64).await.is_some_and(|d| d.plug_category.contains("tuning")) {
                            tuned = true;
                        }
                    }
                    if tuned {
                        tuning.clear();
                    }
                    piece_mods.extend(given);
                    by_bucket.insert(bucket.to_string(), json!(piece_mods));
                }
                None => mods.extend(piece_mods),
            }
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
    // The artifact perks picked, else those in the character's artifact now
    // (DIM's format for them), and the artifact itself, equipped with them.
    let (character, _) = pick_character(&profile, character_id)?;
    let defs = crate::weapons::artifact_defs(app).await;
    let worn = owned.iter().find(|o| o.bucket == crate::weapons::ARTIFACT_BUCKET && o.location == "equipped" && o.character_id.as_deref() == Some(character.as_str()));
    let artifact = match artifact {
        Some(picked) => picked.to_vec(),
        None => match worn.and_then(|w| defs.iter().find(|d| d.hash == w.item_hash).map(|d| (w, d))) {
            Some((w, d)) => w.socket_plugs.iter().copied().filter(|&p| d.tier_of(p).is_some()).collect(),
            None => crate::apply::active_artifact(app, &s, &character).await,
        },
    };
    if let Some(d) = crate::weapons::artifact_for(&defs, &artifact) {
        let copy = owned
            .iter()
            .find(|o| o.item_hash == d.hash && o.character_id.as_deref() == Some(character.as_str()))
            .or_else(|| owned.iter().find(|o| o.item_hash == d.hash));
        let mut entry = json!({ "hash": d.hash });
        if let Some(c) = copy {
            entry["id"] = json!(c.instance_id);
        }
        equipped.push(entry);
    }
    let mut parameters = json!({ "mods": mods });
    if !by_bucket.is_empty() {
        parameters["modsByBucket"] = Value::Object(by_bucket);
    }
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
pub async fn preset_save(
    app: AppHandle,
    character_id: Option<String>,
    name: String,
    items: Vec<String>,
    stat_mods: Option<HashMap<u64, Vec<u32>>>,
    subclass_plugs: Option<HashMap<usize, u32>>,
    id: Option<String>,
    artifact: Option<Vec<u32>>,
    weapon_plugs: Option<HashMap<String, HashMap<usize, u32>>>,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(tr("Gib dem Preset einen Namen", "Give the preset a name").into());
    }
    let s = session(&app).await?;
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let mut loadout = build_loadout(&app, &s, &profile, &owned, &gear, character_id.as_deref(), name, &items, stat_mods.as_ref(), subclass_plugs.as_ref(), artifact.as_deref(), weapon_plugs.as_ref()).await?;
    // An edit: in place of the old one (made when that was).
    if let Some(old) = id.as_deref().and_then(|id| crate::dimsync::local_loadout(&app, &s, id)) {
        loadout["id"] = old["id"].clone();
        if old["createdAt"].is_number() {
            loadout["createdAt"] = old["createdAt"].clone();
        }
    }
    let id = loadout["id"].as_str().unwrap_or_default().to_string();
    crate::dimsync::save_loadout(&app, &s, loadout).await?;
    Ok(id)
}

/// A saved loadout opened again in the builder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    name: String,
    slots: Vec<Slot>,
    /// Armor bucket -> its stat mods (none saved apart: the armor's own).
    stat_mods: Option<HashMap<u64, Vec<u32>>>,
    /// The subclass's setup (socket index -> plug).
    subclass_plugs: Option<HashMap<usize, u32>>,
    /// For the optimizer: its exotic (-1 none), an exotic class item's
    /// perks, the stats it reaches (optimizer order).
    exotic: i64,
    perks: [u32; 2],
    stats: [i32; 6],
    /// The set bonuses its armor has: (set, pieces).
    sets: Vec<(u32, usize)>,
    /// Its artifact perks (none saved: the character's own).
    artifact: Option<Vec<u32>>,
    /// Its weapons' perks and mods as saved (instance id -> socket index -> plug).
    weapon_plugs: HashMap<String, HashMap<usize, u32>>,
}

/// A saved loadout (`id`) as the builder and the optimizer start from it.
#[tauri::command]
pub async fn preset_edit(app: AppHandle, character_id: Option<String>, id: String) -> Result<Edit, String> {
    let s = session(&app).await?;
    let saved = crate::dimsync::local_loadout(&app, &s, &id).ok_or(tr("Loadout nicht gefunden", "Loadout not found"))?;
    let (profile, owned, gear) = futures::join!(own_profile(&app, &s, "200"), owned_items(&app), gear(&app));
    let profile = profile?;
    let gear = gear?;
    let owned = owned.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    let classes = classes(&profile);
    let equipped: Vec<(&OwnedItem, &Value)> = saved["equipped"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| Some((owned.iter().find(|o| Some(o.instance_id.as_str()) == e["id"].as_str())?, e)))
        .collect();
    let bucket_of = |o: &OwnedItem| gear.get(o.item_hash).map(|g| g.bucket).unwrap_or(0);
    let slots = SLOTS
        .iter()
        .map(|&bucket| Slot { bucket, item: equipped.iter().find(|(o, _)| bucket_of(o) == bucket).and_then(|(o, _)| choice(o, &gear, &classes)) })
        .collect();
    // The stat mods (general socket) of each piece, if saved by piece.
    let mut stat_mods = None;
    if let Some(by_bucket) = saved["parameters"]["modsByBucket"].as_object() {
        let mut out = HashMap::new();
        for (bucket, list) in by_bucket {
            let Ok(bucket) = bucket.parse::<u64>() else { continue };
            let mut mods = Vec::new();
            for h in list.as_array().into_iter().flatten().filter_map(|h| h.as_u64()) {
                if item(&app, h).await.is_some_and(|d| d.plug_category == "enhancements.v2_general") {
                    mods.push(h as u32);
                }
            }
            out.insert(bucket, mods);
        }
        stat_mods = Some(out);
    }
    let subclass_plugs: Option<HashMap<usize, u32>> = equipped
        .iter()
        .find(|(o, _)| bucket_of(o) == SUBCLASS)
        .and_then(|(_, e)| e["socketOverrides"].as_object())
        .map(|m| m.iter().filter_map(|(i, p)| Some((i.parse().ok()?, p.as_u64()? as u32))).collect());
    let armor: Vec<String> =
        equipped.iter().filter(|(o, _)| ARMOR_BUCKETS.contains(&bucket_of(o))).map(|(o, _)| o.instance_id.clone()).collect();
    let mods: Vec<u32> = stat_mods.iter().flat_map(|m| m.values().flatten().copied()).collect();
    let plugs: Vec<u32> = subclass_plugs.iter().flat_map(|m| m.values().copied()).collect();
    let (exotic, perks, stats, sets) = crate::optimizer::edit_start(&app, character_id, &armor, &mods, &plugs).await;
    Ok(Edit {
        name: saved["name"].as_str().unwrap_or_default().to_string(),
        slots,
        stat_mods,
        subclass_plugs,
        exotic,
        perks,
        stats,
        sets,
        weapon_plugs: equipped
            .iter()
            .filter(|(o, _)| crate::fireteam::WEAPON_BUCKETS.contains(&bucket_of(o)))
            .filter_map(|(o, e)| {
                let plugs: HashMap<usize, u32> =
                    e["socketOverrides"].as_object()?.iter().filter_map(|(i, p)| Some((i.parse().ok()?, p.as_u64()? as u32))).collect();
                (!plugs.is_empty()).then(|| (o.instance_id.clone(), plugs))
            })
            .collect(),
        artifact: saved["parameters"]["artifactUnlocks"]["unlockedItemHashes"]
            .as_array()
            .map(|a| a.iter().filter_map(|h| h.as_u64().map(|h| h as u32)).collect()),
    })
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
pub async fn preset_preview(
    app: AppHandle,
    character_id: Option<String>,
    items: Vec<String>,
    stat_mods: Option<HashMap<u64, Vec<u32>>>,
    subclass_plugs: Option<HashMap<usize, u32>>,
    artifact: Option<Vec<u32>>,
    weapon_plugs: Option<HashMap<String, HashMap<usize, u32>>>,
) -> Result<PresetPreview, String> {
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
    let draft = build_loadout(&app, &s, &profile, &owned, &gear, character_id.as_deref(), "", &items, stat_mods.as_ref(), subclass_plugs.as_ref(), artifact.as_deref(), weapon_plugs.as_ref()).await;
    let loadout = match draft {
        Ok(l) => l,
        // Nothing picked yet: an empty loadout.
        Err(_) => json!({ "equipped": [], "classType": class_type, "parameters": {} }),
    };
    let loadout = crate::dimsync::describe(&app, &loadout, &character, class_type, &owned).await;
    Ok(PresetPreview { loadout, weapons, armor_sets })
}
