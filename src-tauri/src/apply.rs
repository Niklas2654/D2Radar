//! Putting a loadout on the current character through Bungie's API: move
//! its items over, equip them, plug subclass setup and armor mods, and
//! optionally save the result as one of the game's loadout slots
//! (SnapshotLoadout), so it can be swapped to in game, even in activities.
//! Bungie only allows equipping in orbit, social spaces or offline.

use std::collections::HashMap;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::bungie::class_name;
use crate::fireteam::{item, ARMOR_BUCKETS};
use crate::i18n::tr;
use crate::inventory::{action_error, own_profile, owned_items, pick_character, post_action, session, OwnedItem, Session};

/// Destiny's "any class" (DestinyClass.Unknown).
const ANY_CLASS: i64 = 3;

pub(crate) struct PlanItem {
    /// Instance id; None for items found by hash (e.g. a subclass).
    pub id: Option<String>,
    pub hash: u32,
    /// Socket index -> plug to put in (subclass setup, ornaments, …).
    pub overrides: Vec<(usize, u32)>,
}

/// What to put on the character.
pub(crate) struct Plan {
    pub class_type: i64,
    pub equipped: Vec<PlanItem>,
    /// Armor mods to fit onto the armor wherever they fit.
    pub mods: Vec<u32>,
    /// Mods for one armor piece (bucket hash).
    pub mods_by_bucket: Vec<(u64, Vec<u32>)>,
    /// Empty mod sockets that get no mod from the plan.
    pub clear_mods: bool,
    /// In-game loadout name / color / icon hashes, if the plan has them.
    pub identifiers: Option<(u32, u32, u32)>,
    /// Artifact perks the loadout wants (Bungie's API can't set them; the
    /// player is told which to change).
    pub artifact: Vec<u32>,
}

/// Why a plug couldn't go in.
pub(crate) enum PlugError {
    /// Bungie only allows it in game (e.g. some Prismatic plugs).
    InGameOnly,
    Other(String),
}

fn progress(app: &AppHandle, text: &str) {
    let _ = app.emit("loadout-progress", text);
}

/// Moving failed because the destination is full.
const NO_ROOM: &str = "DestinyNoRoomInDestination";

async fn transfer(app: &AppHandle, s: &Session, o: &OwnedItem, character: &str, to_vault: bool) -> Result<(), String> {
    transfer_status(app, s, o, character, to_vault).await.map_err(|(status, message)| {
        if status == NO_ROOM {
            tr("kein Platz im Inventar", "no room in the inventory").to_string()
        } else {
            action_error((status, message))
        }
    })
}

async fn transfer_status(app: &AppHandle, s: &Session, o: &OwnedItem, character: &str, to_vault: bool) -> Result<(), (String, String)> {
    let body = json!({
        "itemReferenceHash": o.item_hash,
        "stackSize": 1,
        "transferToVault": to_vault,
        "itemId": o.instance_id,
        "characterId": character,
        "membershipType": s.membership_type,
    });
    post_action(app, s, "Items/TransferItem/", body).await.map(|_| ())
}

/// Move `o` to `character`; its slot there (`bucket`: the item's own, not
/// the vault's it sits in) full, first one of the items in that slot that
/// isn't equipped nor wanted (`keep`) goes to the vault, as DIM does.
#[allow(clippy::too_many_arguments)]
async fn fetch_to(
    app: &AppHandle,
    s: &Session,
    owned: &[OwnedItem],
    o: &OwnedItem,
    bucket: u64,
    character: &str,
    keep: &[String],
    moved_out: &mut Vec<String>,
) -> Result<(), String> {
    match transfer_status(app, s, o, character, false).await {
        Ok(()) => return Ok(()),
        Err((status, _)) if status == NO_ROOM => {}
        Err(e) => return Err(action_error(e)),
    }
    let room = owned.iter().find(|x| {
        x.character_id.as_deref() == Some(character)
            && x.location == "inventory"
            && x.bucket == bucket
            && bucket != 0
            && !keep.contains(&x.instance_id)
            && !moved_out.contains(&x.instance_id)
    });
    let Some(room) = room else { return Err(tr("kein Platz im Inventar", "no room in the inventory").into()) };
    progress(app, &format!("{} {} …", tr("Mache Platz:", "Making room:"), name_of(app, room.item_hash).await));
    transfer(app, s, room, character, true).await.map_err(|e| format!("{} ({e})", tr("kein Platz im Inventar", "no room in the inventory")))?;
    moved_out.push(room.instance_id.clone());
    transfer(app, s, o, character, false).await
}

pub(crate) async fn insert_plug(app: &AppHandle, s: &Session, character: &str, item: &str, socket: usize, plug: u32) -> Result<(), PlugError> {
    let body = json!({
        "plug": { "socketIndex": socket, "socketArrayType": 0, "plugItemHash": plug },
        "itemId": item,
        "characterId": character,
        "membershipType": s.membership_type,
    });
    match post_action(app, s, "Items/InsertSocketPlugFree/", body).await {
        Ok(_) => Ok(()),
        Err((status, message)) => match status.as_str() {
            // It's in there already: nothing to do.
            "DestinySocketAlreadyHasPlug" => Ok(()),
            "DestinyItemActionForbidden" | "DestinySocketActionNotAllowed" => Err(PlugError::InGameOnly),
            "DestinyFailedPlugInsertionRules" => Err(PlugError::Other(
                tr(
                    "Voraussetzungen fehlen (z. B. Rüstungsenergie oder Fragment-Plätze)",
                    "requirements not met (e.g. armor energy or fragment slots)",
                )
                .into(),
            )),
            // Bungie's answer for a plug this item doesn't offer, e.g. a
            // tuning for another stat.
            "DestinyCannotAffordMaterialRequirements" => Err(PlugError::Other(
                tr(
                    "auf diesem Teil nicht verfügbar (z. B. anderes Tuning)",
                    "not available on this piece (e.g. different tuning)",
                )
                .into(),
            )),
            _ => Err(PlugError::Other(action_error((status, message)))),
        },
    }
}

/// Subclass setups and other overrides are sets per kind of plug (aspects,
/// fragments, …): sockets already holding a wanted plug keep it, wherever
/// it sits; the missing plugs go into the other sockets. Moving a plug to
/// another socket while it is still plugged would fail.
fn arrange(sockets: &Value, id: &str, group: &[(usize, u32)]) -> Vec<Target> {
    let mut wanted: Vec<u32> = group.iter().map(|(_, plug)| *plug).collect();
    let mut free = Vec::new();
    for &(index, _) in group {
        let found = current_plug(sockets, id, index).and_then(|c| wanted.iter().position(|w| *w == c));
        match found {
            Some(pos) => {
                wanted.remove(pos);
            }
            None => free.push(index),
        }
    }
    free.into_iter().zip(wanted).map(|(index, plug)| (id.to_string(), index, plug, None)).collect()
}

async fn name_of(app: &AppHandle, hash: u32) -> String {
    item(app, hash as u64).await.map(|i| i.name).unwrap_or_else(|| format!("#{hash}"))
}

/// The owned copy of a plan item: by instance id; else (re-acquired item,
/// subclass) by hash, preferring one on `character`.
pub(crate) fn find_owned<'a>(owned: &'a [OwnedItem], it: &PlanItem, character: &str) -> Option<&'a OwnedItem> {
    it.id
        .as_ref()
        .and_then(|id| owned.iter().find(|o| &o.instance_id == id))
        .or_else(|| owned.iter().find(|o| o.item_hash == it.hash && o.character_id.as_deref() == Some(character)))
        .or_else(|| owned.iter().find(|o| o.item_hash == it.hash))
}

/// The plug in socket `index` of item `id` (profile with component 305).
fn current_plug(sockets: &Value, id: &str, index: usize) -> Option<u32> {
    sockets["itemComponents"]["sockets"]["data"][id]["sockets"][index]["plugHash"].as_u64().map(|h| h as u32)
}

/// One socket to set: (item instance, socket index, plug, the socket's empty plug if it's a mod socket).
type Target = (String, usize, u32, Option<u32>);

/// An armor piece mods can go on.
pub(crate) struct ArmorPiece {
    id: String,
    bucket: u64,
    hash: u32,
    /// Energy capacity; None = unknown (not checked).
    capacity: Option<u32>,
    /// The plug in each socket now, by socket index.
    current: Vec<u32>,
    /// Sockets with a fixed choice of plugs (e.g. tuning): index -> plugs.
    options: Vec<(usize, Vec<u32>)>,
}

impl ArmorPiece {
    fn from_owned(o: &OwnedItem, bucket: u64) -> Self {
        ArmorPiece {
            id: o.instance_id.clone(),
            bucket,
            hash: o.item_hash,
            capacity: o.energy_capacity,
            current: o.socket_plugs.clone(),
            options: o.socket_options.clone(),
        }
    }

    /// Whether `plug` may go into socket `index` (sockets without a fixed
    /// choice take any plug of their category).
    fn allows(&self, index: usize, plug: u32) -> bool {
        self.options.iter().find(|(i, _)| *i == index).is_none_or(|(_, plugs)| plugs.contains(&plug))
    }
}

struct ModSocket {
    piece: usize,
    index: usize,
    empty: u32,
    category: String,
    assigned: Option<u32>,
}

/// Fit the plan's armor mods into the armor's mod sockets: a mod goes into a
/// socket whose empty plug has the same plug category, on the piece with the
/// most energy left (mods pinned to a piece go there). Mods that don't fit
/// are reported in `problems`.
async fn place_mods(app: &AppHandle, plan: &Plan, armor: &[ArmorPiece], problems: &mut Vec<String>) -> Vec<Target> {
    let mut sockets: Vec<ModSocket> = Vec::new();
    let mut cost: HashMap<u32, u32> = HashMap::new();
    for (piece, a) in armor.iter().enumerate() {
        let Some(info) = item(app, a.hash as u64).await else { continue };
        for &(index, empty) in &info.mod_sockets {
            let Some(empty_def) = item(app, empty).await else { continue };
            let category = empty_def.plug_category.clone();
            if category.is_empty() || category.contains("masterworks") || category.contains("crafting") {
                continue;
            }
            if let Some(&now) = a.current.get(index) {
                if let Some(def) = item(app, now as u64).await {
                    cost.insert(now, def.energy_cost);
                }
            }
            sockets.push(ModSocket { piece, index, empty: empty as u32, category, assigned: None });
        }
    }
    // Pinned to an armor piece first, then the ones that fit anywhere,
    // most expensive first.
    let mut defs: HashMap<u32, (String, String)> = HashMap::new();
    for &m in plan.mods.iter().chain(plan.mods_by_bucket.iter().flat_map(|(_, mods)| mods.iter())) {
        if let Some(def) = item(app, m as u64).await {
            cost.insert(m, def.energy_cost);
            defs.insert(m, (def.name, def.plug_category));
        }
    }
    let mut wanted: Vec<(Option<u64>, u32)> = Vec::new();
    for (bucket, mods) in &plan.mods_by_bucket {
        let mut mods = mods.clone();
        mods.sort_by_key(|m| std::cmp::Reverse(cost.get(m).copied().unwrap_or(0)));
        wanted.extend(mods.into_iter().map(|m| (Some(*bucket), m)));
    }
    // A piece the loadout lists its own mods for (DIM's modsByBucket: all of
    // that piece's mods) has them replaced: what it holds now doesn't count
    // against its energy (it did, so a fitting loadout read "not enough").
    let replaced: Vec<bool> = armor
        .iter()
        .map(|a| plan.mods_by_bucket.iter().any(|(bucket, mods)| *bucket == a.bucket && !mods.is_empty()))
        .collect();
    let mut general = plan.mods.clone();
    general.sort_by_key(|m| std::cmp::Reverse(cost.get(m).copied().unwrap_or(0)));
    wanted.extend(general.into_iter().map(|m| (None, m)));

    let cost_of = |plug: u32| cost.get(&plug).copied().unwrap_or(0);
    for (bucket, plug) in wanted {
        let Some((name, category)) = defs.get(&plug).cloned() else { continue };
        // Energy left on a piece: what's assigned, plus its tuning. Its other
        // mods now don't count: they come out where the loadout's need the
        // room, as DIM does (see the end).
        let left = |sockets: &[ModSocket], piece: usize| -> i64 {
            let Some(capacity) = armor[piece].capacity else { return i64::MAX };
            let used: u32 = sockets
                .iter()
                .filter(|s| s.piece == piece)
                .map(|s| match s.assigned {
                    Some(p) => cost_of(p),
                    None if s.category.contains("tuning") => cost_of(armor[piece].current.get(s.index).copied().unwrap_or(0)),
                    None => 0,
                })
                .sum();
            capacity as i64 - used as i64
        };
        let same_kind: Vec<usize> = sockets
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                s.assigned.is_none() && s.category == category && bucket.is_none_or(|b| armor[s.piece].bucket == b)
            })
            .map(|(i, _)| i)
            .collect();
        // Some sockets only take certain plugs: an armor piece's tuning
        // depends on the stat it is tuned for.
        // (Only checked for tuning: other mod sockets take any mod you own.)
        let fitting: Vec<usize> = same_kind
            .iter()
            .copied()
            .filter(|&i| {
                let s = &sockets[i];
                !s.category.contains("tuning") || armor[s.piece].allows(s.index, plug)
            })
            .collect();
        if fitting.is_empty() {
            if !same_kind.is_empty() {
                // For a look at it later (detect.log): what each piece offers there.
                let offered: Vec<String> = same_kind
                    .iter()
                    .map(|&i| {
                        let s = &sockets[i];
                        let opts = armor[s.piece].options.iter().find(|(x, _)| *x == s.index).map(|(_, p)| p.clone());
                        format!("piece {} socket {}: {:?}", armor[s.piece].hash, s.index, opts)
                    })
                    .collect();
                crate::weapons::log_to_file(&format!("[loadout] tuning {plug} ({name}) fits none: {}", offered.join("; ")));
                problems.push(format!(
                    "{name}: {}",
                    tr("passt zu keinem deiner Rüstungsteile (Tuning)", "doesn't fit any of your armor pieces (tuning)")
                ));
            } else if bucket.is_none() || category.contains("enhancements") {
                // Cosmetics in modsByBucket (shaders, ornaments) aren't mod sockets.
                problems.push(format!("{name}: {}", tr("kein passender Mod-Platz", "no fitting mod socket")));
            }
            continue;
        }
        // Putting it in: what the socket holds now goes (a tuning socket's
        // plug counts in `left`, so that is given back).
        let after = |i: usize| {
            let s = &sockets[i];
            let freed = if s.category.contains("tuning") { cost_of(armor[s.piece].current.get(s.index).copied().unwrap_or(0)) } else { 0 };
            left(&sockets, s.piece) + freed as i64 - cost_of(plug) as i64
        };
        // Into the socket with the most energy left. Not reported when the
        // count says it won't fit: the game's costs differ from the plugs'
        // listed ones (the artifact lowers some), DIM checked the loadout
        // with the real ones, and the game itself refuses what doesn't fit
        // (that error is shown when equipping).
        if let Some(i) = fitting.iter().copied().max_by_key(|&i| after(i)) {
            if after(i) < 0 {
                let room: Vec<String> = (0..armor.len())
                    .map(|p| format!("{} cap {:?} left {}", armor[p].hash, armor[p].capacity, left(&sockets, p)))
                    .collect();
                crate::weapons::log_to_file(&format!("[loadout] energy: {name} ({plug}) costs {}; {}", cost_of(plug), room.join("; ")));
            }
            sockets[i].assigned = Some(plug);
        }
    }
    // The pieces' other mods: kept where they still fit next to the
    // loadout's, else taken out (the costliest first), as DIM does. All of
    // them go with "clear other mods", or on a piece the loadout lists its own
    // mods for (DIM's modsByBucket: all of that piece's mods). Tuning stays
    // (it is set apart, by the item's socket overrides).
    let mut clear = vec![false; sockets.len()];
    for piece in 0..armor.len() {
        let mine: Vec<usize> = (0..sockets.len()).filter(|&i| sockets[i].piece == piece).collect();
        let others: Vec<usize> = mine
            .iter()
            .copied()
            .filter(|&i| {
                let s = &sockets[i];
                s.assigned.is_none() && !s.category.contains("tuning") && armor[piece].current.get(s.index).is_some_and(|&p| p != 0 && p != s.empty)
            })
            .collect();
        if plan.clear_mods || replaced[piece] {
            others.iter().for_each(|&i| clear[i] = true);
            continue;
        }
        let Some(capacity) = armor[piece].capacity else { continue };
        let current = |i: usize| cost_of(armor[piece].current.get(sockets[i].index).copied().unwrap_or(0)) as i64;
        let mut used: i64 = mine
            .iter()
            .map(|&i| match sockets[i].assigned {
                Some(p) => cost_of(p) as i64,
                None => current(i),
            })
            .sum();
        let mut by_cost = others.clone();
        by_cost.sort_by_key(|&i| std::cmp::Reverse(current(i)));
        for i in by_cost {
            if used <= capacity as i64 {
                break;
            }
            used -= current(i);
            clear[i] = true;
        }
    }
    sockets
        .into_iter()
        .enumerate()
        .filter_map(|(i, s)| {
            let id = armor[s.piece].id.clone();
            match s.assigned {
                Some(plug) => Some((id, s.index, plug, Some(s.empty))),
                None if plan.clear_mods && s.category.contains("tuning") => Some((id, s.index, s.empty, Some(s.empty))),
                None if clear[i] => Some((id, s.index, s.empty, Some(s.empty))),
                None => None,
            }
        })
        .collect()
}

fn dedupe(list: Vec<String>) -> Vec<String> {
    let mut unique: Vec<String> = Vec::new();
    for w in list {
        if !unique.contains(&w) {
            unique.push(w);
        }
    }
    unique
}

/// What would go wrong putting `plan` on `character` (a dry run): items no
/// longer owned or equipped on another character, mods that don't fit.
pub(crate) async fn validate(app: &AppHandle, plan: &Plan, character: &str, class_type: i64, owned: &[OwnedItem]) -> Vec<String> {
    let mut problems = Vec::new();
    if plan.class_type != ANY_CLASS && plan.class_type != class_type {
        problems.push(format!("{} {}", tr("Loadout für", "Loadout for"), class_name(plan.class_type)));
    }
    let mut armor = Vec::new();
    for it in &plan.equipped {
        let info = item(app, it.hash as u64).await;
        let name = info.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| format!("#{}", it.hash));
        match find_owned(owned, it, character) {
            None => problems.push(format!("{name}: {}", tr("nicht mehr vorhanden", "not owned anymore"))),
            Some(o) if o.location == "equipped" && o.character_id.as_deref() != Some(character) => {
                problems.push(format!("{name}: {}", tr("auf einem anderen Charakter ausgerüstet", "equipped on another character")))
            }
            Some(o) => {
                if let Some(info) = info.filter(|i| ARMOR_BUCKETS.contains(&i.bucket)) {
                    armor.push(ArmorPiece::from_owned(o, info.bucket));
                }
            }
        }
    }
    place_mods(app, plan, &armor, &mut problems).await;
    dedupe(problems)
}

/// Put `plan` on a character (default: the one played last); with `slot`,
/// then save it as that in-game loadout slot. Characters not being played
/// are "offline", so Bungie allows this for them any time. Returns warnings
/// for parts that didn't work.
pub(crate) async fn apply(app: &AppHandle, plan: &Plan, slot: Option<usize>, character: Option<&str>) -> Result<Vec<String>, String> {
    let s = session(app).await?;
    // Equipping starts from the profile as it is now, not as kept.
    crate::inventory::invalidate();
    let profile = own_profile(app, &s, "200,206").await?;
    let (character, class_type) = pick_character(&profile, character)?;
    if plan.class_type != ANY_CLASS && plan.class_type != class_type {
        return Err(format!(
            "{} {} – {}",
            tr("Dieses Loadout ist für", "This loadout is for"),
            class_name(plan.class_type),
            tr("wechsle erst den Charakter", "switch characters first")
        ));
    }
    let owned = owned_items(app)
        .await
        .ok_or(tr("Erst in den Einstellungen mit Bungie einloggen", "Log in with Bungie in the settings first"))?;
    let mut warnings = Vec::new();

    // The artifact its perks are from (an older loadout names only the perks).
    let artifacts = crate::weapons::artifact_defs(app).await;
    let artifact = crate::weapons::artifact_for(&artifacts, &plan.artifact).cloned();
    let has_artifact_item = artifact.as_ref().is_some_and(|d| plan.equipped.iter().any(|it| it.hash == d.hash));
    let artifact_item = artifact.as_ref().filter(|_| !has_artifact_item).map(|d| PlanItem { id: None, hash: d.hash, overrides: Vec::new() });
    let wanted_ids: Vec<String> = plan.equipped.iter().filter_map(|it| find_owned(&owned, it, &character)).map(|o| o.instance_id.clone()).collect();
    let mut moved_out: Vec<String> = Vec::new();

    // 1. Move the items to the character.
    progress(app, tr("Items werden geholt …", "Fetching items …"));
    let mut to_equip: Vec<(String, bool)> = Vec::new();
    let mut placed: Vec<(String, u32, &PlanItem)> = Vec::new();
    let mut armor: Vec<ArmorPiece> = Vec::new();
    // Another artifact the loadout lists (saved when the wrong one was
    // picked for its perks): left out, the perks' own one goes on.
    let other_artifact = |it: &PlanItem| artifact.as_ref().is_some_and(|d| it.hash != d.hash && artifacts.iter().any(|a| a.hash == it.hash));
    for it in plan.equipped.iter().filter(|it| !other_artifact(it)).chain(artifact_item.iter()) {
        let info = item(app, it.hash as u64).await;
        let name = info.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| format!("#{}", it.hash));
        let Some(o) = find_owned(&owned, it, &character) else {
            warnings.push(format!("{name}: {}", tr("nicht mehr vorhanden", "not owned anymore")));
            continue;
        };
        if o.character_id.as_deref() != Some(character.as_str()) {
            progress(app, &format!("{} {name} …", tr("Hole", "Fetching")));
            if o.location == "equipped" {
                warnings.push(format!("{name}: {}", tr("auf einem anderen Charakter ausgerüstet", "equipped on another character")));
                continue;
            }
            if let Some(other) = &o.character_id {
                if let Err(e) = transfer(app, &s, o, other, true).await {
                    warnings.push(format!("{name}: {e}"));
                    continue;
                }
            }
            let bucket = info.as_ref().map(|i| i.bucket).unwrap_or(0);
            if let Err(e) = fetch_to(app, &s, &owned, o, bucket, &character, &wanted_ids, &mut moved_out).await {
                warnings.push(format!("{name}: {e}"));
                continue;
            }
        }
        to_equip.push((o.instance_id.clone(), info.as_ref().is_some_and(|i| i.exotic)));
        placed.push((o.instance_id.clone(), o.item_hash, it));
        if let Some(info) = info.filter(|i| ARMOR_BUCKETS.contains(&i.bucket)) {
            armor.push(ArmorPiece::from_owned(o, info.bucket));
        }
    }

    // 2. Equip; exotics last, so the old exotic is already replaced.
    progress(app, &format!("{} ({}) …", tr("Rüste aus", "Equipping"), to_equip.len()));
    to_equip.sort_by_key(|(_, exotic)| *exotic);
    if !to_equip.is_empty() {
        let ids: Vec<&String> = to_equip.iter().map(|(id, _)| id).collect();
        let body = json!({ "itemIds": ids, "characterId": character, "membershipType": s.membership_type });
        let result = post_action(app, &s, "Items/EquipItems/", body).await.map_err(action_error)?;
        for r in result["equipResults"].as_array().into_iter().flatten() {
            if r["equipStatus"].as_i64().is_some_and(|code| code != 1) {
                let id = r["itemInstanceId"].as_str().unwrap_or_default();
                if let Some((_, hash, _)) = placed.iter().find(|(i, _, _)| i == id) {
                    warnings.push(format!("{}: {}", name_of(app, *hash).await, tr("nicht ausgerüstet", "not equipped")));
                }
            }
        }
    }

    // 3. Subclass setup, ornaments and armor mods.
    progress(app, tr("Subklasse und Mods werden gesetzt …", "Setting subclass and mods …"));
    let sockets = own_profile(app, &s, "305").await?;
    let mut targets: Vec<Target> = Vec::new();
    let mut artifact_set = false;
    for (id, hash, it) in &placed {
        // The artifact: its perks into the sockets that take them.
        if let Some(d) = artifact.as_ref().filter(|d| d.hash == *hash) {
            let current: Vec<u32> = (0..d.sockets.iter().map(|s| s.0 + 1).max().unwrap_or(0)).map(|i| current_plug(&sockets, id, i).unwrap_or(0)).collect();
            let wanted: Vec<u32> = plan.artifact.iter().copied().filter(|&p| d.tier_of(p).is_some()).collect();
            match crate::weapons::place_artifact(d, &current, &wanted, false) {
                Some(list) => targets.extend(list.into_iter().map(|(i, plug)| (id.clone(), i, plug, None))),
                None => {
                    // Not around what's in: empty them all, then place anew.
                    for &(i, _, empty) in &d.sockets {
                        if current.get(i).is_some_and(|&c| c != empty) {
                            let _ = insert_plug(app, &s, &character, id, i, empty).await;
                        }
                    }
                    if let Some(list) = crate::weapons::place_artifact(d, &[], &wanted, true) {
                        targets.extend(list.into_iter().filter(|&(i, plug)| d.sockets.iter().all(|s| s.0 != i || s.2 != plug)).map(|(i, plug)| (id.clone(), i, plug, None)));
                    }
                }
            }
            artifact_set = true;
            continue;
        }
        let def = crate::fireteam::definition(app, "DestinyInventoryItemDefinition", *hash as u64).await;
        let default_plug = |index: usize| {
            def.as_ref()
                .and_then(|d| d["sockets"]["socketEntries"][index]["singleInitialItemHash"].as_u64())
                .map(|h| h as u32)
        };
        // An empty socket (e.g. a fragment slot) can't be "set"; it is
        // emptied by the other plugs moving anyway.
        let mut overrides: Vec<(usize, u32)> =
            it.overrides.iter().copied().filter(|&(index, plug)| default_plug(index) != Some(plug)).collect();
        overrides.sort_by_key(|(index, _)| *index);
        // Grouped by plug category, in socket order (aspects before fragments).
        let mut groups: Vec<(String, Vec<(usize, u32)>)> = Vec::new();
        let subclass = def.as_ref().and_then(|d| d["inventory"]["bucketTypeHash"].as_u64()) == Some(crate::fireteam::SUBCLASS);
        for (index, plug) in overrides {
            let category = item(app, plug as u64).await.map(|d| d.plug_category).unwrap_or_default();
            let category = if subclass { category } else { format!("{category}#{index}") };
            match groups.iter_mut().find(|(c, _)| *c == category) {
                Some((_, group)) => group.push((index, plug)),
                None => groups.push((category, vec![(index, plug)])),
            }
        }
        for (_, group) in groups {
            targets.extend(arrange(&sockets, id, &group));
        }
    }
    targets.extend(place_mods(app, plan, &armor, &mut warnings).await);

    let changes: Vec<&Target> =
        targets.iter().filter(|(id, index, plug, _)| current_plug(&sockets, id, *index) != Some(*plug)).collect();
    // Empty the mod sockets that change first, so armor energy is free for the new mods.
    for (id, index, _, empty) in &changes {
        if let Some(empty) = empty {
            if current_plug(&sockets, id, *index).is_some_and(|c| c != *empty) {
                let _ = insert_plug(app, &s, &character, id, *index, *empty).await;
            }
        }
    }
    let mut in_game_only = Vec::new();
    let total = changes.iter().filter(|(_, _, plug, empty)| Some(*plug) != *empty).count();
    let mut done = 0;
    // Artifact perks refused: tried again once the rest is in (the game may
    // want them in an order).
    let is_artifact_perk = |plug: u32| artifact.as_ref().is_some_and(|d| d.tier_of(plug).is_some());
    let mut retry: Vec<&Target> = Vec::new();
    for t @ (id, index, plug, empty) in &changes {
        if Some(*plug) == *empty {
            continue; // already emptied above
        }
        done += 1;
        progress(app, &format!("{} {} ({done}/{total}) …", tr("Setze", "Setting"), name_of(app, *plug).await));
        match insert_plug(app, &s, &character, id, *index, *plug).await {
            Ok(()) => {}
            Err(_) if is_artifact_perk(*plug) => retry.push(t),
            Err(PlugError::InGameOnly) => in_game_only.push(name_of(app, *plug).await),
            Err(PlugError::Other(e)) => warnings.push(format!("{}: {e}", name_of(app, *plug).await)),
        }
    }
    for (id, index, plug, _) in retry {
        if insert_plug(app, &s, &character, id, *index, *plug).await.is_err() {
            warnings.push(format!(
                "{}: {}",
                name_of(app, *plug).await,
                tr(
                    "Artefakt-Perk nicht gesetzt (Platz noch gesperrt oder Perk nicht freigeschaltet?)",
                    "artifact perk not set (slot still locked or perk not unlocked?)"
                )
            ));
        }
    }
    if !in_game_only.is_empty() {
        in_game_only.dedup();
        warnings.push(format!("{}: {}", tr("Nur im Spiel einstellbar", "Only settable in game"), in_game_only.join(", ")));
    }

    // Artifact perks of an artifact not found: say which to change in game.
    if !plan.artifact.is_empty() && !artifact_set {
        let active = active_artifact(app, &s, &character).await;
        let mut missing = Vec::new();
        for &perk in &plan.artifact {
            if !active.contains(&perk) {
                missing.push(name_of(app, perk).await);
            }
        }
        if !missing.is_empty() {
            warnings.push(format!(
                "{}: {}",
                tr("Artefakt im Spiel umstellen", "Change the artifact in game"),
                missing.join(", ")
            ));
        }
    }

    // 4. Save as an in-game loadout slot.
    if let Some(index) = slot {
        progress(app, tr("Wird im Ingame-Slot gespeichert …", "Saving to the in-game slot …"));
        let existing = &profile["characterLoadouts"]["data"][&character]["loadouts"][index];
        let hash = |key: &str| existing[key].as_u64().unwrap_or(0) as u32;
        let (mut name, mut color, mut icon) =
            plan.identifiers.unwrap_or((hash("nameHash"), hash("colorHash"), hash("iconHash")));
        // An empty slot has no look yet, and Bungie rejects 0: pick one.
        if name == 0 || color == 0 || icon == 0 {
            if let Ok(ids) = crate::loadouts::identifiers(app).await {
                let (n, c, i) = ids.pick(index);
                name = if name == 0 { n } else { name };
                color = if color == 0 { c } else { color };
                icon = if icon == 0 { i } else { icon };
            }
        }
        let body = json!({
            "loadoutIndex": index,
            "characterId": character,
            "membershipType": s.membership_type,
            "nameHash": name,
            "colorHash": color,
            "iconHash": icon,
        });
        post_action(app, &s, "Loadouts/SnapshotLoadout/", body).await.map_err(action_error)?;
        crate::loadouts::slot_written(&character, index);
    }
    crate::inventory::invalidate();
    progress(app, "");
    // The same problem for several plugs is listed once.
    Ok(dedupe(warnings))
}

/// The artifact perks active on a character (component 202).
pub(crate) async fn active_artifact(app: &AppHandle, s: &Session, character: &str) -> Vec<u32> {
    let Ok(profile) = own_profile(app, s, "202").await else { return Vec::new() };
    profile["characterProgressions"]["data"][character]["seasonalArtifact"]["tiers"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|tier| tier["items"].as_array().cloned().unwrap_or_default())
        .filter(|item| item["isActive"].as_bool() == Some(true))
        .filter_map(|item| item["itemHash"].as_u64().map(|h| h as u32))
        .collect()
}

/// A DIM loadout (api.destinyitemmanager.com shape) as a plan.
pub(crate) fn plan_from_dim(loadout: &Value) -> Plan {
    let num = |v: &Value| v.as_u64().map(|n| n as u32);
    let equipped = loadout["equipped"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| {
            Some(PlanItem {
                id: i["id"].as_str().filter(|id| *id != "0").map(Into::into),
                hash: num(&i["hash"])?,
                overrides: i["socketOverrides"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter_map(|(index, plug)| Some((index.parse().ok()?, num(plug)?)))
                    .collect(),
            })
        })
        .collect();
    let params = &loadout["parameters"];
    let ids = &params["inGameIdentifiers"];
    Plan {
        class_type: loadout["classType"].as_i64().unwrap_or(ANY_CLASS),
        equipped,
        mods: params["mods"].as_array().into_iter().flatten().filter_map(num).collect(),
        mods_by_bucket: params["modsByBucket"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(bucket, mods)| {
                Some((bucket.parse().ok()?, mods.as_array()?.iter().filter_map(num).collect()))
            })
            .collect(),
        clear_mods: params["clearMods"].as_bool().unwrap_or(false),
        artifact: params["artifactUnlocks"]["unlockedItemHashes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(num)
            .collect(),
        identifiers: num(&ids["nameHash"]).map(|name| {
            (name, num(&ids["colorHash"]).unwrap_or(0), num(&ids["iconHash"]).unwrap_or(0))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_plugs_that_only_sit_elsewhere() {
        // Aspects A, B in sockets 5, 6; the loadout wants B (in 5) and C (in 6).
        let sockets = serde_json::json!({ "itemComponents": { "sockets": { "data": { "sub": { "sockets": [
            {}, {}, {}, {}, {}, { "plugHash": 1 }, { "plugHash": 2 }
        ] } } } } });
        let targets = arrange(&sockets, "sub", &[(5, 2), (6, 3)]);
        // B stays where it is; only A is swapped for C.
        assert_eq!(targets, [("sub".to_string(), 5, 3, None)]);
        // Already all there (just in other order): nothing to do.
        assert!(arrange(&sockets, "sub", &[(5, 2), (6, 1)]).is_empty());
    }

    #[test]
    fn reads_a_dim_loadout() {
        let loadout = serde_json::json!({
            "id": "abc", "name": "Raid", "classType": 1,
            "equipped": [
                { "id": "6917529", "hash": 2453357042u32, "socketOverrides": { "7": 1111, "0": 2222 } },
                { "id": "0", "hash": 12345 },
                { "hash": 999 }
            ],
            "parameters": {
                "mods": [11, 22, 22],
                "modsByBucket": { "3448274439": [33] },
                "clearMods": true,
                "inGameIdentifiers": { "nameHash": 5, "colorHash": 6, "iconHash": 7 },
                "artifactUnlocks": { "unlockedItemHashes": [41, 42], "seasonNumber": 27 }
            }
        });
        let plan = plan_from_dim(&loadout);
        assert_eq!(plan.class_type, 1);
        assert_eq!(plan.equipped.len(), 3);
        assert_eq!(plan.equipped[0].id.as_deref(), Some("6917529"));
        let mut overrides = plan.equipped[0].overrides.clone();
        overrides.sort();
        assert_eq!(overrides, [(0, 2222), (7, 1111)]);
        assert!(plan.equipped[1].id.is_none() && plan.equipped[2].id.is_none());
        assert_eq!(plan.mods, [11, 22, 22]);
        assert_eq!(plan.mods_by_bucket, [(3448274439, vec![33])]);
        assert!(plan.clear_mods);
        assert_eq!(plan.identifiers, Some((5, 6, 7)));
        assert_eq!(plan.artifact, [41, 42]);
        // No parameters: nothing to plug, keep the slot's identifiers.
        let bare = plan_from_dim(&serde_json::json!({ "classType": 3, "equipped": [] }));
        assert!(bare.mods.is_empty() && !bare.clear_mods && bare.identifiers.is_none() && bare.artifact.is_empty());
    }
}
