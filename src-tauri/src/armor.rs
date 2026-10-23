//! An armor piece inspected in game (see weapons.rs: the same screen
//! reading finds armor names too): its exotic perks and set bonuses, with
//! exact numbers where the community has measured them.

use std::collections::HashMap;

use serde::Serialize;
use tauri::AppHandle;

use crate::fireteam::{armor_sets, definition, definition_in, item, item_with_plugs, ArmorSet, ItemInfo};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorDetail {
    /// The piece, with its exotic perks (as on the player's copy if they
    /// own one; an exotic class item's spirits depend on the copy).
    item: ItemInfo,
    /// Its set and both bonuses (2 and 4 pieces).
    sets: Vec<ArmorSet>,
    /// Perks read from the player's own copy.
    from_copy: bool,
    /// Every version of it (by name), to find the player's copy later
    /// (and its mods, see `armor_mods`).
    versions: Vec<u32>,
}

impl ArmorDetail {
    /// For the detection log: what was found.
    pub(crate) fn summary(&self) -> String {
        format!(
            "'{}' from {}: {} perks, {} sets",
            self.item.name,
            if self.from_copy { "own copy" } else { "definition" },
            self.item.perks().len(),
            self.sets.len()
        )
    }
}

/// What to show for armor named like `hashes` (reissues share a name): only
/// exotics and set pieces (nothing to tell about the rest).
pub(crate) async fn identify(app: &AppHandle, hashes: &[u32]) -> Option<ArmorDetail> {
    // The first exotic or set version (all versions of a name are alike in
    // that). Quick: definitions only.
    let mut found = None;
    for &h in hashes {
        if let Some(info) = item(app, h as u64).await {
            if info.exotic || info.set_hash().is_some() {
                found = Some((h, info));
                break;
            }
        }
    }
    let (first, base) = found?;
    if !base.exotic {
        // A set piece shows its set's bonuses: no inventory, no plugs needed
        // (loading those took seconds).
        let sets = armor_sets(app, std::slice::from_ref(&base)).await;
        return Some(ArmorDetail { item: base, sets, from_copy: false, versions: hashes.to_vec() });
    }
    // An exotic: its perks as on the player's copy (equipped first; an
    // exotic class item's spirits depend on the copy), else the definition's.
    let owned = crate::inventory::owned_items_quick(app).await.unwrap_or_default();
    let copy = owned
        .iter()
        .filter(|o| hashes.contains(&o.item_hash))
        .min_by_key(|o| match o.location {
            "equipped" => 0,
            "inventory" => 1,
            _ => 2,
        });
    let hash = copy.map_or(first, |o| o.item_hash);
    let plugs: Vec<u64> = match copy {
        Some(o) => o.socket_plugs.iter().map(|&p| p as u64).collect(),
        None => definition(app, "DestinyInventoryItemDefinition", hash as u64)
            .await
            .map(|d| {
                d["sockets"]["socketEntries"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|e| e["singleInitialItemHash"].as_u64().unwrap_or(0))
                    .collect()
            })
            .unwrap_or_default(),
    };
    let item = item_with_plugs(app, hash as u64, &plugs).await.unwrap_or(base);
    let sets = armor_sets(app, std::slice::from_ref(&item)).await;
    Some(ArmorDetail { item, sets, from_copy: copy.is_some(), versions: hashes.to_vec() })
}

/// What can be hovered on the piece's inspect screen: the mods in the
/// player's copy, and an exotic's perks. Loaded on the first hover (it
/// takes a moment: the inventory and every mod's definition).
pub(crate) async fn hover_plugs(app: &AppHandle, detail: &ArmorDetail) -> Vec<ItemInfo> {
    let owned = crate::inventory::owned_items_quick(app).await.unwrap_or_default();
    let copy = owned
        .iter()
        .filter(|o| detail.versions.contains(&o.item_hash))
        .min_by_key(|o| match o.location {
            "equipped" => 0,
            "inventory" => 1,
            _ => 2,
        });
    let Some(copy) = copy else { return detail.item.perks().to_vec() };
    let plugs: Vec<u64> = copy.socket_plugs.iter().map(|&p| p as u64).collect();
    let Some(info) = item_with_plugs(app, copy.item_hash as u64, &plugs).await else {
        return detail.item.perks().to_vec();
    };
    info.perks().iter().chain(info.mods()).cloned().collect()
}

/* ---------- The mods on the player's copy ---------- */

/// A mod socket of the player's copy and what is in it (None: empty).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSlot {
    socket: usize,
    plug: Option<ModPlug>,
}

/// A mod: its name, icon, what it does (with exact numbers where known)
/// and the energy it costs.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModPlug {
    item: ItemInfo,
    cost: u32,
    /// What it adds to the armor stats: (stat hash, value).
    stats: Vec<(u64, i64)>,
    /// Its element, by its English name (sorting): 0 kinetic … 6
    /// harmonic, 9 none.
    #[serde(skip)]
    element: u8,
}

/// The elements in the order mods list them, by a word of their English
/// name ("Arc Siphon", "Solar Weapon Surge").
const ELEMENTS: [&str; 7] = ["kinetic", "arc", "solar", "void", "stasis", "strand", "harmonic"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorMods {
    item_hash: u32,
    instance_id: String,
    /// The character holding it (None: in the vault).
    character_id: Option<String>,
    /// Its armor energy (None: unknown).
    energy: Option<u32>,
    slots: Vec<ModSlot>,
    /// Held by the character played last (in an activity Bungie locks
    /// that character's mods; the vault's and the others' stay free).
    on_active: bool,
}

/// The player's copy among `hashes` (equipped first, then carried).
async fn own_copy(app: &AppHandle, hashes: &[u32]) -> Option<crate::inventory::OwnedItem> {
    let owned = crate::inventory::owned_items_quick(app).await.unwrap_or_default();
    owned
        .into_iter()
        .filter(|o| hashes.contains(&o.item_hash))
        .min_by_key(|o| match o.location {
            "equipped" => 0,
            "inventory" => 1,
            _ => 2,
        })
}

/// A plug as a mod, with exact numbers by its English name (Compendium).
async fn mod_plug(app: &AppHandle, hash: u64) -> Option<ModPlug> {
    let item = item(app, hash).await?;
    // Its stat bonus (a stat mod's +10, a tuning's +5 / -5).
    let stats: Vec<(u64, i64)> = definition(app, "DestinyInventoryItemDefinition", hash)
        .await
        .map(|d| {
            d["investmentStats"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|s| s["isConditionallyActive"].as_bool() != Some(true))
                .filter_map(|s| Some((s["statTypeHash"].as_u64()?, s["value"].as_i64()?)))
                .filter(|(h, v)| ARMOR_STATS.contains(h) && *v != 0)
                .collect()
        })
        .unwrap_or_default();
    let english = definition_in(app, "DestinyInventoryItemDefinition", hash, "en")
        .await
        .and_then(|d| d["displayProperties"]["name"].as_str().map(String::from));
    let cost = item.energy_cost;
    let element = english
        .as_deref()
        .map(|n| n.to_lowercase())
        .and_then(|n| ELEMENTS.iter().position(|e| n.split(|c: char| !c.is_alphanumeric()).any(|w| w == *e)))
        .map_or(9, |i| i as u8);
    Some(ModPlug { item: item.with_exact(english.and_then(|n| crate::compendium::mod_exact(&n))), cost, stats, element })
}

/// The mods in the player's copy of the piece (named like `hashes`); None
/// without a copy (or without login).
#[tauri::command]
pub async fn armor_mods(app: AppHandle, hashes: Vec<u32>, instance_id: Option<String>) -> Result<Option<ArmorMods>, String> {
    let copy = match instance_id {
        // That copy (picked among the player's).
        Some(id) => crate::inventory::owned_items_quick(&app).await.unwrap_or_default().into_iter().find(|o| o.instance_id == id),
        None => own_copy(&app, &hashes).await,
    };
    let Some(copy) = copy else { return Ok(None) };
    let Some(info) = item(&app, copy.item_hash as u64).await else { return Ok(None) };
    let slots = futures::future::join_all(info.mod_sockets.iter().map(|&(socket, empty)| {
        let plugged = copy.socket_plugs.get(socket).copied().map(u64::from).filter(|&h| h != 0 && h != empty);
        let app = &app;
        async move {
            // The masterwork ("Upgrade Armor") sits among the mod sockets
            // but isn't one.
            let kind = item(app, plugged.unwrap_or(empty)).await.map(|i| i.plug_category).unwrap_or_default();
            if kind.contains("masterwork") {
                return None;
            }
            let plug = match plugged {
                Some(h) => mod_plug(app, h).await,
                None => None,
            };
            // The general mod first, its tuning right after it, then the rest.
            let order = if kind == "enhancements.v2_general" {
                0
            } else if kind.contains("tuning") {
                1
            } else {
                2
            };
            Some((order, ModSlot { socket, plug }))
        }
    }))
    .await
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    let mut slots = slots;
    slots.sort_by_key(|(order, slot)| (*order, slot.socket));
    let slots: Vec<ModSlot> = slots.into_iter().map(|(_, slot)| slot).collect();
    let active = match crate::inventory::session(&app).await {
        Ok(session) => crate::inventory::own_profile(&app, &session, "200")
            .await
            .ok()
            .and_then(|p| crate::inventory::current_character(&p).ok())
            .map(|(id, _)| id),
        Err(_) => None,
    };
    let on_active = copy.character_id.is_some() && copy.character_id == active;
    Ok(Some(ArmorMods {
        on_active,
        item_hash: copy.item_hash,
        instance_id: copy.instance_id,
        character_id: copy.character_id,
        energy: copy.energy_capacity,
        slots,
    }))
}

/// Every mod a socket of the piece takes (its plug set), the empty one
/// first (to take a mod out).
#[tauri::command]
pub async fn armor_mod_options(
    app: AppHandle,
    item_hash: u32,
    socket: usize,
    instance_id: Option<String>,
) -> Result<Vec<ModPlug>, String> {
    let def = definition(&app, "DestinyInventoryItemDefinition", item_hash as u64)
        .await
        .ok_or(crate::i18n::tr("Rüstung nicht gefunden", "Armor not found"))?;
    let entry = &def["sockets"]["socketEntries"][socket];
    let empty = entry["singleInitialItemHash"].as_u64().filter(|&h| h != 0);
    let set = entry["reusablePlugSetHash"].as_u64().filter(|&h| h != 0).or(entry["randomizedPlugSetHash"].as_u64());
    // Most pieces share their sockets' sets: a set's list is made once a
    // while. (Not a socket whose choice is the copy's own: its tuning.)
    static LISTS: std::sync::Mutex<Option<HashMap<(u64, u64), (std::time::Instant, Vec<ModPlug>)>>> = std::sync::Mutex::new(None);
    let own = match &instance_id {
        Some(id) => crate::inventory::owned_items_quick(&app)
            .await
            .unwrap_or_default()
            .into_iter()
            .find(|o| &o.instance_id == id)
            .and_then(|o| o.socket_options.into_iter().find(|(i, _)| *i == socket).map(|(_, plugs)| plugs)),
        None => None,
    };
    let list_key = (set.unwrap_or(0), empty.unwrap_or(0));
    if own.is_none() {
        if let Some((_, list)) = LISTS
            .lock()
            .unwrap()
            .get_or_insert_default()
            .get(&list_key)
            .filter(|(at, _)| at.elapsed() < std::time::Duration::from_secs(600))
        {
            return Ok(list.clone());
        }
    }
    let mut hashes: Vec<u64> = match set {
        Some(set) => definition(&app, "DestinyPlugSetDefinition", set)
            .await
            .map(|d| {
                d["reusablePlugItems"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|p| p["plugItemHash"].as_u64())
                    .collect()
            })
            .unwrap_or_default(),
        None => Vec::new(),
    };
    hashes.retain(|&h| Some(h) != empty);
    hashes.sort_unstable();
    hashes.dedup();
    // What the player can put in now, as Bungie lists it for the account
    // (and its characters): the definition's list is both out of date
    // (missing newer mods) and full of old versions (a season's 1-energy
    // surges, an artifact's cheaper ones) no account can insert.
    if let Some(set) = set {
        if let Some(usable) = usable_plugs(&app, set).await {
            hashes = usable.into_iter().filter(|&h| Some(h) != empty).collect();
            hashes.sort_unstable();
        }
    }
    // A socket whose choice is the piece's own (its tuning): as Bungie
    // lists it for the copy.
    if let Some(own) = &own {
        hashes = own.iter().map(|&h| h as u64).filter(|&h| Some(h) != empty).collect();
        hashes.sort_unstable();
        hashes.dedup();
    }
    let mut list: Vec<ModPlug> =
        futures::future::join_all(hashes.into_iter().map(|h| mod_plug(&app, h))).await.into_iter().flatten().filter(|m| !m.item.name.is_empty()).collect();
    // Out-of-date placeholders aren't mods to pick.
    list.retain(|m| m.item.icon_present() && !m.item.plug_category.contains("empty"));
    // The dearest first (the full mods, then the minor ones); within each
    // cost by element (kinetic, arc, solar, void, stasis, strand,
    // harmonic, then the rest), then by name.
    list.sort_by(|a, b| b.cost.cmp(&a.cost).then(a.element.cmp(&b.element)).then_with(|| a.item.name.cmp(&b.item.name)));
    if let Some(empty) = empty {
        if let Some(plug) = mod_plug(&app, empty).await {
            list.insert(0, plug);
        }
    }
    if own.is_none() {
        LISTS.lock().unwrap().get_or_insert_default().insert(list_key, (std::time::Instant::now(), list.clone()));
    }
    Ok(list)
}

/// The plugs of a plug set the player can insert now (account-wide and
/// on any character); None when Bungie can't be asked.
async fn usable_plugs(app: &AppHandle, set: u64) -> Option<std::collections::HashSet<u64>> {
    // One fetch of the (big) profile for every socket asking, kept a few
    // minutes: what an account can insert hardly changes.
    static CACHE: tokio::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<serde_json::Value>)>> =
        tokio::sync::Mutex::const_new(None);
    let profile = {
        let mut cache = CACHE.lock().await;
        match cache.as_ref().filter(|(at, _)| at.elapsed() < std::time::Duration::from_secs(300)) {
            Some((_, p)) => p.clone(),
            None => {
                let session = crate::inventory::session(app).await.ok()?;
                // The plug sets come with the sockets component.
                let p = std::sync::Arc::new(crate::inventory::own_profile(app, &session, "305").await.ok()?);
                *cache = Some((std::time::Instant::now(), p.clone()));
                p
            }
        }
    };
    let key = set.to_string();
    let lists = std::iter::once(&profile["profilePlugSets"]["data"]["plugs"][&key]).chain(
        profile["characterPlugSets"]["data"]
            .as_object()
            .into_iter()
            .flat_map(|chars| chars.values())
            .map(|c| &c["plugs"][&key]),
    );
    let usable: std::collections::HashSet<u64> = lists
        .flat_map(|list| list.as_array().into_iter().flatten())
        .filter(|p| p["canInsert"].as_bool() == Some(true) && p["enabled"].as_bool() != Some(false))
        .filter_map(|p| p["plugItemHash"].as_u64())
        .collect();
    // Nothing listed at all: not an answer to go by.
    (!usable.is_empty()).then_some(usable)
}

/// Put a mod into a socket of the player's copy. Bungie allows it only out
/// of activities (in orbit, a social space, or offline).
#[tauri::command]
pub async fn armor_set_mod(
    app: AppHandle,
    instance_id: String,
    character_id: Option<String>,
    socket: usize,
    plug: u32,
) -> Result<(), String> {
    let session = crate::inventory::session(&app).await?;
    let character = match character_id {
        Some(c) => c,
        // In the vault: any character can do it; one not played right now
        // (the one in an activity is locked out of mod changes).
        None => {
            let profile = crate::inventory::own_profile(&app, &session, "200").await?;
            let (active, _) = crate::inventory::current_character(&profile)?;
            profile["characters"]["data"]
                .as_object()
                .and_then(|c| c.keys().find(|id| **id != active).cloned())
                .unwrap_or(active)
        }
    };
    let result = crate::apply::insert_plug(&app, &session, &character, &instance_id, socket, plug).await;
    crate::inventory::invalidate();
    result.map_err(|e| match e {
        crate::apply::PlugError::InGameOnly => crate::i18n::tr(
            "Bungie lässt das gerade nicht zu (der Charakter ist in einer Aktivität)",
            "Bungie doesn't allow it right now (the character is in an activity)",
        )
        .to_string(),
        crate::apply::PlugError::Other(message) => message,
    })
}

/* ---------- The player's copies of a piece (vault included) ---------- */

/// The armor stats as the character screen lists them: health, melee,
/// grenade, super, class, weapons.
const ARMOR_STATS: [u64; 6] = [392767087, 4244567218, 1735777505, 144602215, 1943323491, 2996146975];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyStat {
    hash: u64,
    name: String,
    icon: Option<String>,
    value: i64,
}

/// One of the player's copies: where it is, its roll.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorCopy {
    instance_id: String,
    item_hash: u32,
    /// "equipped", "inventory" or "vault".
    location: &'static str,
    /// The class of the character holding it (None: in the vault).
    class_name: Option<String>,
    character_id: Option<String>,
    power: Option<i64>,
    /// Its tier (1–5 stars; None on older armor).
    tier: Option<i64>,
    energy: Option<i64>,
    stats: Vec<CopyStat>,
    total: i64,
    /// The piece itself (icon, name, type) as this copy's version.
    item: Option<ItemInfo>,
    /// Its archetype ("Gunner": which stats it favors), if it has one.
    archetype: Option<ItemInfo>,
    /// Its general mod (a stat mod: "+5 Weapons") and its tuning ("+5
    /// Weapons / -5 Health"), with what they add.
    general: Option<ModPlug>,
    tuning: Option<ModPlug>,
}

/// Every copy the player owns of the piece (named like `hashes`), with
/// its stats: on the characters and in the vault, the equipped first,
/// then the highest total.
#[tauri::command]
pub async fn armor_copies(app: AppHandle, hashes: Vec<u32>) -> Result<Vec<ArmorCopy>, String> {
    let session = crate::inventory::session(&app).await?;
    let profile = crate::inventory::own_profile(&app, &session, "102,200,201,205,300,304,305").await?;
    let classes: std::collections::HashMap<String, String> = profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, c)| (id.clone(), crate::bungie::class_name(c["classType"].as_i64().unwrap_or(-1)).to_string()))
        .collect();
    // (item, location, character)
    let mut found: Vec<(serde_json::Value, &'static str, Option<String>)> = Vec::new();
    let mut take = |items: &serde_json::Value, location: &'static str, character: Option<&str>| {
        for item in items.as_array().into_iter().flatten() {
            let hash = item["itemHash"].as_u64().unwrap_or(0) as u32;
            if hashes.contains(&hash) && item["itemInstanceId"].is_string() {
                found.push((item.clone(), location, character.map(String::from)));
            }
        }
    };
    take(&profile["profileInventory"]["data"]["items"], "vault", None);
    for (id, inv) in profile["characterInventories"]["data"].as_object().into_iter().flatten() {
        take(&inv["items"], "inventory", Some(id));
    }
    for (id, inv) in profile["characterEquipment"]["data"].as_object().into_iter().flatten() {
        take(&inv["items"], "equipped", Some(id));
    }
    // The stats' names and icons (in the app's language).
    let names = futures::future::join_all(ARMOR_STATS.iter().map(|&h| definition(&app, "DestinyStatDefinition", h))).await;
    let components = &profile["itemComponents"];
    let mut copies: Vec<ArmorCopy> = found
        .iter()
        .map(|(item, location, character)| {
            let (location, character) = (*location, character.clone());
            let id = item["itemInstanceId"].as_str().unwrap_or_default().to_string();
            let instance = &components["instances"]["data"][&id];
            let stats_of = &components["stats"]["data"][&id]["stats"];
            let stats: Vec<CopyStat> = ARMOR_STATS
                .iter()
                .zip(&names)
                .map(|(hash, def)| CopyStat {
                    hash: *hash,
                    name: def.as_ref().and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or_default().to_string(),
                    icon: def.as_ref().and_then(|d| d["displayProperties"]["icon"].as_str()).map(String::from),
                    value: stats_of[hash.to_string()]["value"].as_i64().unwrap_or(0),
                })
                .collect();
            let total = stats.iter().map(|s| s.value).sum();
            ArmorCopy {
                class_name: character.as_ref().and_then(|c| classes.get(c).cloned()),
                character_id: character,
                instance_id: id,
                item_hash: item["itemHash"].as_u64().unwrap_or(0) as u32,
                location,
                power: instance["primaryStat"]["value"].as_i64(),
                tier: instance["gearTier"].as_i64().filter(|&t| t > 0),
                energy: instance["energy"]["energyCapacity"].as_i64(),
                stats,
                total,
                item: None,
                archetype: None,
                general: None,
                tuning: None,
            }
        })
        .collect();
    // Each copy's piece and archetype (a plug in one of its sockets).
    for copy in &mut copies {
        copy.item = item(&app, copy.item_hash as u64).await;
        let plugs: Vec<u64> = components["sockets"]["data"][&copy.instance_id]["sockets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| s["plugHash"].as_u64())
            .collect();
        for plug in plugs {
            let Some(info) = item(&app, plug).await else { continue };
            let category = info.plug_category.clone();
            if category.contains("archetype") {
                copy.archetype = Some(info);
            } else if category == "enhancements.v2_general" || category.contains("tuning") {
                // (An empty socket's plug adds nothing: left out.)
                if let Some(m) = mod_plug(&app, plug).await.filter(|m| !m.stats.is_empty()) {
                    if category.contains("tuning") {
                        copy.tuning = Some(m);
                    } else {
                        copy.general = Some(m);
                    }
                }
            }
        }
    }
    copies.sort_by(|a, b| (b.location == "equipped").cmp(&(a.location == "equipped")).then(b.total.cmp(&a.total)));
    Ok(copies)
}

/* ---------- Pull a copy, and the stats with it on ---------- */

/// The character of `class_type` played last (from a profile with 200).
fn character_of_class(profile: &serde_json::Value, class_type: i64) -> Option<String> {
    profile["characters"]["data"]
        .as_object()?
        .iter()
        .filter(|(_, c)| c["classType"].as_i64() == Some(class_type))
        .max_by_key(|(_, c)| c["dateLastPlayed"].as_str().unwrap_or("").to_string())
        .map(|(id, _)| id.clone())
}

/// Bring a copy to a character of its class (the one played last): from
/// the vault, or from another character through the vault. Resolves to
/// that character's class.
#[tauri::command]
pub async fn armor_pull(app: AppHandle, instance_id: String, item_hash: u32, from: Option<String>) -> Result<String, String> {
    use crate::i18n::tr;
    let session = crate::inventory::session(&app).await?;
    let profile = crate::inventory::own_profile(&app, &session, "200").await?;
    let class_type = definition(&app, "DestinyInventoryItemDefinition", item_hash as u64)
        .await
        .and_then(|d| d["classType"].as_i64())
        .unwrap_or(3);
    let target = if class_type == 3 {
        crate::inventory::current_character(&profile)?.0
    } else {
        character_of_class(&profile, class_type).ok_or(tr("Kein Charakter dieser Klasse", "No character of this class"))?
    };
    if from.as_deref() == Some(target.as_str()) {
        return Ok(crate::bungie::class_name(profile["characters"]["data"][&target]["classType"].as_i64().unwrap_or(-1)).into());
    }
    let transfer = |to_vault: bool, character: String| {
        let body = serde_json::json!({
            "itemReferenceHash": item_hash,
            "stackSize": 1,
            "transferToVault": to_vault,
            "itemId": instance_id,
            "characterId": character,
            "membershipType": session.membership_type,
        });
        let (app, session) = (&app, &session);
        async move { crate::inventory::post_action(app, session, "Items/TransferItem/", body).await.map(|_| ()) }
    };
    let message = |e: (String, String)| -> String {
        match e.0.as_str() {
            "DestinyNoRoomInDestination" => {
                tr("Kein Platz im Inventar für dieses Teil – mach erst einen Slot frei", "No room in the inventory for this piece – free a slot first").into()
            }
            "DestinyItemNotFound" => tr("Nicht mehr da – schon verschoben?", "Not there any more – already moved?").into(),
            _ => crate::inventory::action_error(e),
        }
    };
    // On another character: to the vault first.
    if let Some(from) = from {
        transfer(true, from).await.map_err(message)?;
    }
    let result = transfer(false, target.clone()).await.map_err(message);
    crate::inventory::invalidate();
    result?;
    Ok(crate::bungie::class_name(profile["characters"]["data"][&target]["classType"].as_i64().unwrap_or(-1)).into())
}

/// What a copy would change: the character it goes on (its class's played
/// last), its stats now, and the stats of the piece it wears in that slot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorCompare {
    class_name: String,
    /// The character's stats now, in `ARMOR_STATS` order.
    character: Vec<i64>,
    /// The worn piece in the slot (None: nothing there).
    equipped_id: Option<String>,
    equipped_name: Option<String>,
    /// Its stats, in the same order.
    equipped: Vec<i64>,
}

#[tauri::command]
pub async fn armor_compare(app: AppHandle, item_hash: u32) -> Result<Option<ArmorCompare>, String> {
    let session = crate::inventory::session(&app).await?;
    let profile = crate::inventory::own_profile(&app, &session, "200,205,304").await?;
    let Some(def) = definition(&app, "DestinyInventoryItemDefinition", item_hash as u64).await else { return Ok(None) };
    let class_type = def["classType"].as_i64().unwrap_or(3);
    let bucket = def["inventory"]["bucketTypeHash"].as_u64().unwrap_or(0);
    let character = if class_type == 3 {
        crate::inventory::current_character(&profile).ok().map(|(id, _)| id)
    } else {
        character_of_class(&profile, class_type)
    };
    let Some(character) = character else { return Ok(None) };
    let c = &profile["characters"]["data"][&character];
    let stats_now: Vec<i64> = ARMOR_STATS.iter().map(|h| c["stats"][h.to_string()].as_i64().unwrap_or(0)).collect();
    // The worn piece in the slot: the equipped item of that bucket.
    let mut worn: Option<(String, u64)> = None;
    for item in profile["characterEquipment"]["data"][&character]["items"].as_array().into_iter().flatten() {
        if item["bucketHash"].as_u64() == Some(bucket) {
            if let (Some(id), Some(hash)) = (item["itemInstanceId"].as_str(), item["itemHash"].as_u64()) {
                worn = Some((id.to_string(), hash));
            }
        }
    }
    let (equipped_id, equipped_name, equipped) = match &worn {
        Some((id, hash)) => {
            let s = &profile["itemComponents"]["stats"]["data"][id]["stats"];
            let values = ARMOR_STATS.iter().map(|h| s[h.to_string()]["value"].as_i64().unwrap_or(0)).collect();
            (Some(id.clone()), item(&app, *hash).await.map(|i| i.name), values)
        }
        None => (None, None, vec![0; ARMOR_STATS.len()]),
    };
    Ok(Some(ArmorCompare {
        class_name: crate::bungie::class_name(c["classType"].as_i64().unwrap_or(-1)).into(),
        character: stats_now,
        equipped_id,
        equipped_name,
        equipped,
    }))
}

/// What to show for armor named like `hashes`: as `identify`, and a plain
/// piece too (no perks, no set: its copies and mods are still worth it).
pub(crate) async fn identify_or_plain(app: &AppHandle, hashes: &[u32]) -> Option<ArmorDetail> {
    if let Some(found) = identify(app, hashes).await {
        return Some(found);
    }
    for &h in hashes {
        if let Some(info) = item(app, h as u64).await {
            return Some(ArmorDetail { item: info, sets: Vec::new(), from_copy: false, versions: hashes.to_vec() });
        }
    }
    None
}
