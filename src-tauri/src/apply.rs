//! Putting a loadout on the current character through Bungie's API: move
//! its items over, equip them, plug subclass setup and armor mods, and
//! optionally save the result as one of the game's loadout slots
//! (SnapshotLoadout), so it can be swapped to in game, even in activities.
//! Bungie only allows equipping in orbit, social spaces or offline.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::bungie::class_name;
use crate::fireteam::{definition, item, ARMOR_BUCKETS, SUBCLASS, WEAPON_BUCKETS};
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

/// Unequipped items a character holds per slot at most.
const SLOT_ROOM: usize = 9;

/// An item of this slot can be taken off a character and moved to another
/// (a subclass and the artifact are the character's own).
fn movable(bucket: u64) -> bool {
    bucket != 0 && bucket != SUBCLASS && bucket != crate::weapons::ARTIFACT_BUCKET
}

/// What kind of item a hash is: its own slot (not the vault's, when it sits
/// there), the class it is for, whether it's exotic, and its type's name.
async fn kind_of(app: &AppHandle, hash: u32) -> Option<(u64, i64, bool, String)> {
    let def = definition(app, "DestinyInventoryItemDefinition", hash as u64).await?;
    if def["nonTransferrable"].as_bool() == Some(true) {
        return None;
    }
    Some((
        def["inventory"]["bucketTypeHash"].as_u64()?,
        def["classType"].as_i64().unwrap_or(ANY_CLASS),
        def["inventory"]["tierType"].as_i64() == Some(6),
        def["itemTypeDisplayName"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    ))
}

/// Moving a loadout's items: where everything is as fetched (`owned`), and
/// what was moved since.
struct Mover<'a> {
    app: &'a AppHandle,
    s: &'a Session,
    owned: &'a [OwnedItem],
    /// The characters with their class, the one played longest ago first.
    characters: Vec<(String, i64)>,
    /// The loadout's own items: never moved aside, nor equipped in place of
    /// another.
    keep: Vec<String>,
    /// Items of the other saved loadouts: the last to be moved aside.
    saved: HashSet<String>,
    /// Moved or equipped since (no longer where `owned` has them).
    gone: Vec<String>,
    /// (character, slot) of what was brought to a character since.
    brought: Vec<(String, u64)>,
}

impl Mover<'_> {
    /// Not part of the loadout, and still where it was.
    fn free(&self, x: &OwnedItem) -> bool {
        !self.keep.contains(&x.instance_id) && !self.gone.contains(&x.instance_id)
    }

    /// Unequipped items `character` holds in a slot, as far as known.
    fn held(&self, character: &str, bucket: u64) -> usize {
        let there = |x: &&OwnedItem| {
            x.location == "inventory"
                && x.bucket == bucket
                && x.character_id.as_deref() == Some(character)
        };
        self.owned
            .iter()
            .filter(there)
            .filter(|x| !self.gone.contains(&x.instance_id))
            .count()
            + self
                .brought
                .iter()
                .filter(|(c, b)| c == character && *b == bucket)
                .count()
    }

    /// `o` (held by `from`) into the vault. The vault full: first one of
    /// its items goes to a character with room for it (the one played
    /// longest ago first), as DIM does; not into the slot `bucket`, which
    /// is the one room is wanted in.
    async fn to_vault(&mut self, o: &OwnedItem, from: &str, bucket: u64) -> Result<(), String> {
        match transfer_status(self.app, self.s, o, from, true).await {
            Ok(()) => {
                self.gone.push(o.instance_id.clone());
                return Ok(());
            }
            Err((status, _)) if status == NO_ROOM => {}
            Err(e) => return Err(action_error(e)),
        }
        let owned = self.owned;
        let mut tries = 0;
        for x in owned.iter().filter(|x| x.location == "vault") {
            if !self.free(x) {
                continue;
            }
            let Some((slot, ..)) = kind_of(self.app, x.item_hash).await else {
                continue;
            };
            if slot == bucket || !(WEAPON_BUCKETS.contains(&slot) || ARMOR_BUCKETS.contains(&slot))
            {
                continue;
            }
            let Some(to) = self
                .characters
                .iter()
                .map(|(c, _)| c.clone())
                .find(|c| self.held(c, slot) < SLOT_ROOM)
            else {
                continue;
            };
            progress(
                self.app,
                &format!(
                    "{} {} …",
                    tr("Mache Platz im Tresor:", "Making room in the vault:"),
                    name_of(self.app, x.item_hash).await
                ),
            );
            self.gone.push(x.instance_id.clone());
            if transfer_status(self.app, self.s, x, &to, false)
                .await
                .is_ok()
            {
                self.brought.push((to, slot));
                transfer(self.app, self.s, o, from, true).await?;
                self.gone.push(o.instance_id.clone());
                return Ok(());
            }
            tries += 1;
            if tries == 4 {
                break;
            }
        }
        Err(tr("Tresor voll", "vault full").into())
    }

    /// `o` (in the vault) to `character`. Its slot there (`bucket`) full:
    /// first one of the items in it that isn't equipped nor part of the
    /// loadout goes to the vault, as DIM does: one of no saved loadout
    /// before one of them, one the character can't wear before the others,
    /// the lower tier first.
    async fn to_character(
        &mut self,
        o: &OwnedItem,
        bucket: u64,
        character: &str,
    ) -> Result<(), String> {
        match transfer_status(self.app, self.s, o, character, false).await {
            Ok(()) => {
                self.gone.push(o.instance_id.clone());
                self.brought.push((character.to_string(), bucket));
                return Ok(());
            }
            Err((status, _)) if status == NO_ROOM => {}
            Err(e) => return Err(action_error(e)),
        }
        let no_room = tr("kein Platz im Inventar", "no room in the inventory");
        let class = self
            .characters
            .iter()
            .find(|(c, _)| c == character)
            .map_or(ANY_CLASS, |(_, class)| *class);
        let owned = self.owned;
        let mut aside = Vec::new();
        for x in owned.iter().filter(|x| {
            x.location == "inventory"
                && x.bucket == bucket
                && bucket != 0
                && x.character_id.as_deref() == Some(character)
        }) {
            if !self.free(x) {
                continue;
            }
            let wearable = kind_of(self.app, x.item_hash)
                .await
                .is_none_or(|(_, c, ..)| c == ANY_CLASS || c == class);
            aside.push((
                (self.saved.contains(&x.instance_id), wearable, x.gear_tier),
                x,
            ));
        }
        aside.sort_by_key(|(key, _)| *key);
        let Some((_, room)) = aside.first() else {
            return Err(no_room.into());
        };
        progress(
            self.app,
            &format!(
                "{} {} …",
                tr("Mache Platz:", "Making room:"),
                name_of(self.app, room.item_hash).await
            ),
        );
        self.to_vault(room, character, bucket)
            .await
            .map_err(|e| format!("{no_room} ({e})"))?;
        transfer(self.app, self.s, o, character, false).await?;
        self.gone.push(o.instance_id.clone());
        self.brought.push((character.to_string(), bucket));
        Ok(())
    }

    /// Take `o` off `other`, who wears it, by equipping something else of
    /// its slot there, as DIM does: one of that character's own items, else
    /// from the vault, else from another character; no exotic (it could be
    /// the second one worn) unless `o` is one itself; the same type of item
    /// before others, the higher tier first.
    async fn unequip(
        &mut self,
        o: &OwnedItem,
        other: &str,
        bucket: u64,
        exotic: bool,
    ) -> Result<(), String> {
        let class = self
            .characters
            .iter()
            .find(|(c, _)| c == other)
            .map_or(ANY_CLASS, |(_, class)| *class);
        let type_name = kind_of(self.app, o.item_hash)
            .await
            .map(|k| k.3)
            .unwrap_or_default();
        let owned = self.owned;
        let mut failed = None;
        let mut tries = 0;
        // 0: what the character holds, 1: the vault, 2: the other characters.
        for stage in 0..3u8 {
            let stage_of = |x: &OwnedItem| match (x.location, x.character_id.as_deref()) {
                ("vault", _) => 1,
                (_, Some(c)) if c == other => 0,
                _ => 2,
            };
            let mut candidates = Vec::new();
            for x in owned
                .iter()
                .filter(|x| x.location != "equipped" && stage_of(x) == stage)
            {
                // (On a character, the slot it is in says what it is.)
                if !self.free(x) || (x.location == "inventory" && x.bucket != bucket) {
                    continue;
                }
                let Some((slot, for_class, is_exotic, name)) = kind_of(self.app, x.item_hash).await
                else {
                    continue;
                };
                if slot != bucket
                    || (for_class != ANY_CLASS && for_class != class)
                    || (is_exotic && !exotic)
                {
                    continue;
                }
                candidates.push((
                    (is_exotic, name != type_name, std::cmp::Reverse(x.gear_tier)),
                    x,
                ));
            }
            candidates.sort_by_key(|(key, _)| *key);
            for (_, x) in candidates {
                tries += 1;
                if tries > 3 {
                    return Err(failed.unwrap_or_default());
                }
                self.gone.push(x.instance_id.clone());
                if let Some(holder) = x.character_id.as_deref().filter(|_| stage == 2) {
                    if let Err(e) = self.to_vault(x, holder, bucket).await {
                        failed = Some(e);
                        continue;
                    }
                }
                if stage > 0 {
                    if let Err(e) = self.to_character(x, bucket, other).await {
                        failed = Some(e);
                        continue;
                    }
                }
                let body = json!({ "itemId": x.instance_id, "characterId": other, "membershipType": self.s.membership_type });
                match post_action(self.app, self.s, "Items/EquipItem/", body).await {
                    Ok(_) => return Ok(()),
                    Err(e) => failed = Some(action_error(e)),
                }
            }
        }
        Err(failed.unwrap_or_else(|| {
            tr(
                "dort nichts anderes zum Ausrüsten",
                "nothing else to equip there",
            )
            .into()
        }))
    }
}

/// The plugs the socket `index` of an item takes (its plug set), without
/// its empty one.
async fn socket_plugs(app: &AppHandle, def: &Value, index: usize) -> Vec<u32> {
    let entry = &def["sockets"]["socketEntries"][index];
    let empty = entry["singleInitialItemHash"].as_u64().unwrap_or(0) as u32;
    let mut plugs = Vec::new();
    for set in [
        &entry["reusablePlugSetHash"],
        &entry["randomizedPlugSetHash"],
    ] {
        let Some(set) = set.as_u64().filter(|&h| h != 0) else {
            continue;
        };
        let Some(d) = definition(app, "DestinyPlugSetDefinition", set).await else {
            continue;
        };
        plugs.extend(
            d["reusablePlugItems"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["currentlyCanRoll"].as_bool() != Some(false))
                .filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32))
                .filter(|&p| p != 0 && p != empty),
        );
    }
    plugs
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

/// One socket set on the way to a subclass setup (or an item's other
/// overrides): socket index and plug. With a list (stand-ins), the plug is
/// one itself: only put in to get the plug that was there out of its
/// socket; any of them will do.
type Step = (usize, u32, Option<Vec<u32>>);

/// The steps that put each plug of `group` (one kind: aspects, fragments,
/// …) into exactly the socket the loadout names for it: the game shows them
/// in socket order, and so does the loadout. A plug can't be in two sockets
/// at once, and such a socket can't be emptied either. So a plug that still
/// sits in another socket gets out of there first: by that socket's own
/// plug going in, or (they wait for each other, e.g. two swapped) by a
/// stand-in from `spare`, the plugs these sockets take.
/// (`current`: the item's plugs now, by socket index.)
fn arrange(current: &[u32], group: &[(usize, u32)], spare: &[u32]) -> Vec<Step> {
    let len = group
        .iter()
        .map(|(index, _)| index + 1)
        .max()
        .unwrap_or(0)
        .max(current.len());
    let mut now: Vec<u32> = (0..len)
        .map(|i| current.get(i).copied().unwrap_or(0))
        .collect();
    let mut pending: Vec<(usize, u32)> = group
        .iter()
        .copied()
        .filter(|&(index, plug)| now[index] != plug)
        .collect();
    let elsewhere = |now: &[u32], index: usize, plug: u32| {
        now.iter()
            .enumerate()
            .position(|(k, &c)| k != index && c == plug)
    };
    let mut used: Vec<u32> = Vec::new();
    let mut steps: Vec<Step> = Vec::new();
    while !pending.is_empty() {
        if let Some(pos) = pending
            .iter()
            .position(|&(index, plug)| elsewhere(&now, index, plug).is_none())
        {
            let (index, plug) = pending.remove(pos);
            now[index] = plug;
            steps.push((index, plug, None));
            continue;
        }
        // Each one left sits in another socket: the first one's gets a
        // stand-in (a plug that is in no socket and wanted in none).
        let (index, plug) = pending[0];
        let Some(holder) = elsewhere(&now, index, plug) else {
            break;
        };
        let stand_ins: Vec<u32> = spare
            .iter()
            .copied()
            .filter(|s| {
                *s != 0
                    && !now.contains(s)
                    && !used.contains(s)
                    && group.iter().all(|(_, wanted)| wanted != s)
            })
            .take(4)
            .collect();
        let Some(&first) = stand_ins.first() else {
            // None there: as they are (what is refused is told).
            steps.extend(pending.drain(..).map(|(index, plug)| (index, plug, None)));
            break;
        };
        used.extend(&stand_ins);
        now[holder] = first;
        steps.push((holder, first, Some(stand_ins[1..].to_vec())));
    }
    steps
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

/// The plugs in the sockets of the owned item `id`, by socket index (0:
/// none), as fetched.
fn plugs_of<'a>(owned: &'a [OwnedItem], id: &str) -> &'a [u32] {
    owned
        .iter()
        .find(|o| o.instance_id == id)
        .map_or(&[], |o| o.socket_plugs.as_slice())
}

/// The plug in socket `index` of an item with these plugs.
fn plug_in(plugs: &[u32], index: usize) -> Option<u32> {
    plugs.get(index).copied().filter(|&p| p != 0)
}

/// Mods given to the sockets of one kind on a piece (`assigned`, a socket
/// each; `current`: what each holds now, `empty`: its empty plug), put so
/// that as little as possible changes: a mod that is in one of them already
/// stays in that socket, the others go into the empty sockets first, then
/// over mods the loadout doesn't have.
fn keep_in_place(current: &[u32], empty: &[u32], assigned: &[Option<u32>]) -> Vec<Option<u32>> {
    let mut plugs: Vec<u32> = assigned.iter().flatten().copied().collect();
    let mut placed: Vec<Option<u32>> = vec![None; assigned.len()];
    for (k, now) in current.iter().enumerate().take(placed.len()) {
        if let Some(pos) = plugs.iter().position(|p| p == now) {
            placed[k] = Some(plugs.remove(pos));
        }
    }
    let mut rest: Vec<usize> = (0..placed.len()).filter(|&k| placed[k].is_none()).collect();
    let holds_mod = |k: usize| {
        current
            .get(k)
            .is_some_and(|&c| c != 0 && Some(&c) != empty.get(k))
    };
    rest.sort_by_key(|&k| holds_mod(k));
    for (k, plug) in rest.into_iter().zip(plugs) {
        placed[k] = Some(plug);
    }
    placed
}

/// A socket to change, and what it holds now.
type Change = (Target, Option<u32>);

/// The order to plug `changes` in: what isn't an armor mod first, as listed
/// (a subclass's aspects before its fragments, artifact perks before the
/// mods); then the armor mods, those that free the most energy first
/// (`cost`: a plug's energy cost), as DIM does: so each one goes straight in
/// over what its socket holds, with no emptying of the sockets before.
fn plug_order(changes: Vec<Change>, cost: &HashMap<u32, u32>) -> Vec<Change> {
    let cost_of = |plug: Option<u32>| plug.and_then(|p| cost.get(&p)).copied().unwrap_or(0) as i64;
    let (mut mods, mut ordered): (Vec<Change>, Vec<Change>) =
        changes.into_iter().partition(|(t, _)| t.3.is_some());
    mods.sort_by_key(|(t, now)| cost_of(Some(t.2)) - cost_of(*now));
    ordered.extend(mods);
    ordered
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
    // A piece the loadout lists its own mods for (modsByBucket: all of that
    // piece's mods, none too) has them replaced: what it holds now doesn't
    // count against its energy (it did, so a fitting loadout read "not
    // enough"). Not one DIM lists only looks for (shader, ornament).
    let armor_mod = |m: &u32| {
        defs.get(m)
            .is_some_and(|(_, c)| c.starts_with("enhancements") || c.contains("tuning"))
    };
    let replaced: Vec<bool> = armor
        .iter()
        .map(|a| {
            plan.mods_by_bucket.iter().any(|(bucket, mods)| {
                *bucket == a.bucket && (mods.is_empty() || mods.iter().any(armor_mod))
            })
        })
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
    // Which of a piece's alike sockets a mod went to doesn't matter: put so
    // that what is in already stays (a loadout that is on changes nothing).
    // Not tuning: one socket a piece, with its own choice of plugs.
    let mut kinds: Vec<(usize, String)> = Vec::new();
    for s in sockets.iter().filter(|s| !s.category.contains("tuning")) {
        if !kinds
            .iter()
            .any(|(piece, category)| *piece == s.piece && *category == s.category)
        {
            kinds.push((s.piece, s.category.clone()));
        }
    }
    for (piece, category) in kinds {
        let group: Vec<usize> = (0..sockets.len())
            .filter(|&i| sockets[i].piece == piece && sockets[i].category == category)
            .collect();
        let current: Vec<u32> = group
            .iter()
            .map(|&i| {
                armor[piece]
                    .current
                    .get(sockets[i].index)
                    .copied()
                    .unwrap_or(0)
            })
            .collect();
        let empty: Vec<u32> = group.iter().map(|&i| sockets[i].empty).collect();
        let assigned: Vec<Option<u32>> = group.iter().map(|&i| sockets[i].assigned).collect();
        for (&i, plug) in group.iter().zip(keep_in_place(&current, &empty, &assigned)) {
            sockets[i].assigned = plug;
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
/// longer owned, mods that don't fit. (An item another character wears is
/// taken off there when the loadout is put on; only a subclass can't be.)
pub(crate) async fn validate(
    app: &AppHandle,
    plan: &Plan,
    character: &str,
    class_type: i64,
    owned: &[OwnedItem],
) -> Vec<String> {
    let mut problems = Vec::new();
    if plan.class_type != ANY_CLASS && plan.class_type != class_type {
        problems.push(format!("{} {}", tr("Loadout für", "Loadout for"), class_name(plan.class_type)));
    }
    let mut armor = Vec::new();
    for it in &plan.equipped {
        let info = item(app, it.hash as u64).await;
        let name = info.as_ref().map(|i| i.name.clone()).unwrap_or_else(|| format!("#{}", it.hash));
        match find_owned(owned, it, character) {
            None => problems.push(format!(
                "{name}: {}",
                tr("nicht mehr vorhanden", "not owned anymore")
            )),
            Some(o)
                if o.location == "equipped"
                    && o.character_id.as_deref() != Some(character)
                    && !info.as_ref().is_some_and(|i| movable(i.bucket)) =>
            {
                problems.push(format!(
                    "{name}: {}",
                    tr(
                        "auf einem anderen Charakter ausgerüstet",
                        "equipped on another character"
                    )
                ))
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
    let has_artifact_item = artifact
        .as_ref()
        .is_some_and(|d| plan.equipped.iter().any(|it| it.hash == d.hash));
    let artifact_item = artifact
        .as_ref()
        .filter(|_| !has_artifact_item)
        .map(|d| PlanItem {
            id: None,
            hash: d.hash,
            overrides: Vec::new(),
        });
    // The characters, the one played longest ago first.
    let mut characters: Vec<(String, String, i64)> = profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, c)| {
            (
                c["dateLastPlayed"].as_str().unwrap_or_default().to_string(),
                id.clone(),
                c["classType"].as_i64().unwrap_or(-1),
            )
        })
        .collect();
    characters.sort();
    // What the other saved loadouts hold (left on the character if possible).
    let saved: HashSet<String> = crate::dimsync::cached_raw(app, &s)
        .await
        .unwrap_or_default()
        .iter()
        .flat_map(|l| {
            ["equipped", "unequipped"]
                .into_iter()
                .flat_map(|key| l[key].as_array().into_iter().flatten())
        })
        .filter_map(|entry| entry["id"].as_str().map(String::from))
        .collect();
    let mut mover = Mover {
        app,
        s: &s,
        owned: &owned,
        characters: characters
            .into_iter()
            .map(|(_, id, class)| (id, class))
            .collect(),
        keep: plan
            .equipped
            .iter()
            .filter_map(|it| find_owned(&owned, it, &character))
            .map(|o| o.instance_id.clone())
            .collect(),
        saved,
        gone: Vec::new(),
        brought: Vec::new(),
    };

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
            let bucket = info.as_ref().map(|i| i.bucket).unwrap_or(0);
            if let Some(other) = &o.character_id {
                // Worn by another character: something else goes on there.
                if o.location == "equipped" {
                    let elsewhere = tr(
                        "auf einem anderen Charakter ausgerüstet",
                        "equipped on another character",
                    );
                    if !movable(bucket) {
                        warnings.push(format!("{name}: {elsewhere}"));
                        continue;
                    }
                    progress(
                        app,
                        &format!(
                            "{} {name} …",
                            tr(
                                "Lege auf dem anderen Charakter ab:",
                                "Taking off the other character:"
                            )
                        ),
                    );
                    let exotic = info.as_ref().is_some_and(|i| i.exotic);
                    if let Err(e) = mover.unequip(o, other, bucket, exotic).await {
                        warnings.push(format!("{name}: {elsewhere} ({e})"));
                        continue;
                    }
                }
                if let Err(e) = mover.to_vault(o, other, bucket).await {
                    warnings.push(format!("{name}: {e}"));
                    continue;
                }
            }
            if let Err(e) = mover.to_character(o, bucket, &character).await {
                warnings.push(format!("{name}: {e}"));
                continue;
            }
        }
        // (What the character wears already needs no equipping.)
        if !(o.location == "equipped" && o.character_id.as_deref() == Some(character.as_str())) {
            to_equip.push((
                o.instance_id.clone(),
                info.as_ref().is_some_and(|i| i.exotic),
            ));
        }
        placed.push((o.instance_id.clone(), o.item_hash, it));
        if let Some(info) = info.filter(|i| ARMOR_BUCKETS.contains(&i.bucket)) {
            armor.push(ArmorPiece::from_owned(o, info.bucket));
        }
    }

    // 2. Equip; exotics last, so the old exotic is already replaced.
    to_equip.sort_by_key(|(_, exotic)| *exotic);
    if !to_equip.is_empty() {
        progress(
            app,
            &format!("{} ({}) …", tr("Rüste aus", "Equipping"), to_equip.len()),
        );
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
    progress(
        app,
        tr(
            "Subklasse und Mods werden gesetzt …",
            "Setting subclass and mods …",
        ),
    );
    // What is in each socket now: as fetched when this started (moving and
    // equipping change no plugs), not the whole profile once more.
    let mut targets: Vec<Target> = Vec::new();
    // The overrides' steps (in this order, a socket more than once at
    // times), and the stand-ins of those that are one.
    let mut steps: Vec<Change> = Vec::new();
    let mut stand_ins: HashMap<(String, usize, u32), Vec<u32>> = HashMap::new();
    let mut artifact_set = false;
    for (id, hash, it) in &placed {
        let plugs_now = plugs_of(&owned, id);
        // The artifact: its perks into the sockets that take them.
        if let Some(d) = artifact.as_ref().filter(|d| d.hash == *hash) {
            let current: Vec<u32> = (0..d.sockets.iter().map(|s| s.0 + 1).max().unwrap_or(0))
                .map(|i| plug_in(plugs_now, i).unwrap_or(0))
                .collect();
            let wanted: Vec<u32> = plan
                .artifact
                .iter()
                .copied()
                .filter(|&p| d.tier_of(p).is_some())
                .collect();
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
        let subclass = def
            .as_ref()
            .and_then(|d| d["inventory"]["bucketTypeHash"].as_u64())
            == Some(crate::fireteam::SUBCLASS);
        // A subclass's empty socket (e.g. a fragment slot) can't be "set";
        // it is emptied by the other plugs moving anyway. (Only there: a
        // weapon's first perk is its socket's default too, and is set.)
        let mut overrides: Vec<(usize, u32)> = it
            .overrides
            .iter()
            .copied()
            .filter(|&(index, plug)| !(subclass && default_plug(index) == Some(plug)))
            .collect();
        overrides.sort_by_key(|(index, _)| *index);
        // Grouped by plug category, in socket order (aspects before fragments).
        let mut groups: Vec<(String, Vec<(usize, u32)>)> = Vec::new();
        for (index, plug) in overrides {
            let category = item(app, plug as u64).await.map(|d| d.plug_category).unwrap_or_default();
            let category = if subclass { category } else { format!("{category}#{index}") };
            match groups.iter_mut().find(|(c, _)| *c == category) {
                Some((_, group)) => group.push((index, plug)),
                None => groups.push((category, vec![(index, plug)])),
            }
        }
        for (_, group) in groups {
            // (Only a subclass has several sockets of a kind.)
            let spare = match (&def, group.first()) {
                (Some(def), Some(&(index, _))) if subclass => socket_plugs(app, def, index).await,
                _ => Vec::new(),
            };
            for (index, plug, others) in arrange(plugs_now, &group, &spare) {
                if let Some(others) = others {
                    stand_ins.insert((id.clone(), index, plug), others);
                }
                steps.push(((id.clone(), index, plug, None), plug_in(plugs_now, index)));
            }
        }
    }
    // The armor mods; a socket its item says the plug of itself (a piece's
    // tuning, among its overrides) is set by that alone.
    let own_socket = |id: &str, index: usize| {
        placed
            .iter()
            .any(|(p, _, it)| p == id && it.overrides.iter().any(|(i, _)| *i == index))
    };
    let mods = place_mods(app, plan, &armor, &mut warnings).await;
    targets.extend(
        mods.into_iter()
            .filter(|(id, index, _, _)| !own_socket(id, *index)),
    );

    // Only the sockets that hold something else now, each once.
    let mut changes: Vec<Change> = Vec::new();
    for t in targets {
        let now = plug_in(plugs_of(&owned, &t.0), t.1);
        // (A mod socket this copy doesn't have has nothing to take out.)
        if now == Some(t.2)
            || (now.is_none() && Some(t.2) == t.3)
            || changes.iter().any(|(c, _)| c.0 == t.0 && c.1 == t.1)
        {
            continue;
        }
        changes.push((t, now));
    }
    let mut cost: HashMap<u32, u32> = HashMap::new();
    for (t, now) in changes.iter().filter(|(t, _)| t.3.is_some()) {
        for plug in [Some(t.2), *now].into_iter().flatten() {
            if !cost.contains_key(&plug) {
                let energy = item(app, plug as u64)
                    .await
                    .map(|d| d.energy_cost)
                    .unwrap_or(0);
                cost.insert(plug, energy);
            }
        }
    }
    // Each plug straight over what its socket holds, the armor mods in an
    // order that never needs more energy than the piece has (plug_order).
    let changes = plug_order(steps.into_iter().chain(changes).collect(), &cost);
    crate::weapons::log_to_file(&format!(
        "[loadout] apply: {} to equip, {} sockets to change ({} armor mods)",
        to_equip.len(),
        changes.len(),
        changes.iter().filter(|(t, _)| t.3.is_some()).count()
    ));
    let mut in_game_only = Vec::new();
    let total = changes.iter().filter(|(t, _)| Some(t.2) != t.3).count();
    let mut done = 0;
    // Artifact perks refused: tried again once the rest is in (the game may
    // want them in an order).
    let is_artifact_perk = |plug: u32| artifact.as_ref().is_some_and(|d| d.tier_of(plug).is_some());
    let mut retry: Vec<&Target> = Vec::new();
    // Mod sockets emptied before their turn (see below).
    let mut emptied: Vec<(&str, usize)> = Vec::new();
    for (n, (t, _)) in changes.iter().enumerate() {
        let (id, index, plug, empty) = t;
        if Some(*plug) == *empty {
            // A mod taken out.
            if !emptied.contains(&(id.as_str(), *index)) {
                let _ = insert_plug(app, &s, &character, id, *index, *plug).await;
            }
            continue;
        }
        done += 1;
        progress(
            app,
            &format!(
                "{} {} ({done}/{total}) …",
                tr("Setze", "Setting"),
                name_of(app, *plug).await
            ),
        );
        let mut result = insert_plug(app, &s, &character, id, *index, *plug).await;
        // A stand-in (it only gets another plug out of its socket): the
        // next one if it is refused; what fails shows at the plug that
        // wanted out.
        if let Some(others) = stand_ins.get(&(id.clone(), *index, *plug)) {
            for &other in others {
                if result.is_ok() {
                    break;
                }
                result = insert_plug(app, &s, &character, id, *index, other).await;
            }
            continue;
        }
        // An armor mod refused: the piece's energy may still be held by mods
        // that go later (the game's costs aren't always the listed ones).
        // Those sockets emptied now, then once more.
        if empty.is_some() && matches!(result, Err(PlugError::Other(_))) {
            let mut freed = false;
            for (later, now) in &changes[n + 1..] {
                let Some(later_empty) = later.3 else { continue };
                if later.0 != *id
                    || now.is_none_or(|c| c == later_empty)
                    || emptied.contains(&(later.0.as_str(), later.1))
                {
                    continue;
                }
                let _ = insert_plug(app, &s, &character, &later.0, later.1, later_empty).await;
                emptied.push((later.0.as_str(), later.1));
                freed = true;
            }
            if freed {
                result = insert_plug(app, &s, &character, id, *index, *plug).await;
            }
        }
        match result {
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
    let mut equipped: Vec<PlanItem> = Vec::new();
    for i in loadout["equipped"].as_array().into_iter().flatten() {
        let Some(hash) = num(&i["hash"]) else {
            continue;
        };
        let id: Option<String> = i["id"].as_str().filter(|id| *id != "0").map(Into::into);
        // Each item once (slots saved by older versions list the artifact twice).
        if equipped.iter().any(|e| e.hash == hash && e.id == id) {
            continue;
        }
        equipped.push(PlanItem {
            id,
            hash,
            overrides: i["socketOverrides"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(index, plug)| Some((index.parse().ok()?, num(plug)?)))
                .collect(),
        });
    }
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
    fn puts_plugs_into_the_sockets_named() {
        // Aspects A, B in sockets 5, 6; the loadout wants B in 5 and C in 6:
        // C goes in over B first, then B is free for socket 5.
        let sockets = [0, 0, 0, 0, 0, 1, 2];
        assert_eq!(
            arrange(&sockets, &[(5, 2), (6, 3)], &[]),
            [(6, 3, None), (5, 2, None)]
        );
        // The same two the other way round: one socket gets a stand-in, so
        // its plug can go into the other, then its own.
        assert_eq!(
            arrange(&sockets, &[(5, 2), (6, 1)], &[1, 2, 7, 8]),
            [(6, 7, Some(vec![8])), (5, 2, None), (6, 1, None)]
        );
        // As wanted already: nothing to do.
        assert!(arrange(&sockets, &[(5, 1), (6, 2)], &[7]).is_empty());
    }

    #[test]
    fn moves_fragments_into_the_loadouts_order() {
        // Fragments 1 2 3 4 5 in sockets 0..5, wanted 1 3 4 5 2.
        let sockets = [1, 2, 3, 4, 5];
        let steps = arrange(
            &sockets,
            &[(0, 1), (1, 3), (2, 4), (3, 5), (4, 2)],
            &[1, 2, 3, 4, 5, 9],
        );
        let mut now = sockets.to_vec();
        for (index, plug, _) in &steps {
            // Never a plug that still sits in another socket.
            assert!(!now
                .iter()
                .enumerate()
                .any(|(k, c)| k != *index && c == plug));
            now[*index] = *plug;
        }
        assert_eq!(now, [1, 3, 4, 5, 2]);
        assert_eq!(steps.len(), 5);
    }

    #[test]
    fn leaves_mods_that_are_in_already() {
        // Three alike sockets holding A, B and nothing (9: the empty plug);
        // the loadout has B and C for them, assigned in its own order.
        let placed = keep_in_place(&[1, 2, 9], &[9, 9, 9], &[Some(2), Some(3), None]);
        // B stays where it is, C takes the empty socket; A is no longer assigned.
        assert_eq!(placed, [None, Some(2), Some(3)]);
        // All in already, in another order: as they sit.
        assert_eq!(
            keep_in_place(&[1, 2, 9], &[9, 9, 9], &[Some(2), Some(1), None]),
            [Some(1), Some(2), None]
        );
        // Twice the same mod, one of them in: the other goes next to it.
        assert_eq!(
            keep_in_place(&[9, 4], &[9, 9], &[Some(4), Some(4)]),
            [Some(4), Some(4)]
        );
        // No empty socket left: over the mod the loadout doesn't have.
        assert_eq!(
            keep_in_place(&[1, 2], &[9, 9], &[Some(3), Some(2)]),
            [Some(3), Some(2)]
        );
    }

    #[test]
    fn plugs_what_frees_energy_first() {
        let cost: HashMap<u32, u32> = [(10, 1), (30, 3), (50, 5)].into_iter().collect();
        let target =
            |index: usize, plug: u32, empty: Option<u32>| ("a".to_string(), index, plug, empty);
        let changes = vec![
            // +4 (1 -> 5), a fragment, -3 (a mod out), -2 (3 -> 1).
            (target(0, 50, Some(9)), Some(10)),
            (target(7, 77, None), Some(70)),
            (target(1, 9, Some(9)), Some(30)),
            (target(2, 10, Some(9)), Some(30)),
        ];
        let order: Vec<usize> = plug_order(changes, &cost)
            .into_iter()
            .map(|(t, _)| t.1)
            .collect();
        assert_eq!(order, [7, 1, 2, 0]);
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
        // An item listed twice counts once.
        let twice = plan_from_dim(
            &serde_json::json!({ "equipped": [{ "id": "7", "hash": 1 }, { "hash": 1, "id": "7" }, { "id": "8", "hash": 1 }] }),
        );
        assert_eq!(twice.equipped.len(), 2);
        // No parameters: nothing to plug, keep the slot's identifiers.
        let bare = plan_from_dim(&serde_json::json!({ "classType": 3, "equipped": [] }));
        assert!(bare.mods.is_empty() && !bare.clear_mods && bare.identifiers.is_none() && bare.artifact.is_empty());
    }
}
