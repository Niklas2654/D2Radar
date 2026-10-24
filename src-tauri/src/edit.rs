//! Editing a DIM loadout's items in Radar: the perks and mods a weapon or
//! armor piece gets when the loadout is put on.
//!
//! Weapon perks and an armor piece's tuning are saved as the item's socket
//! overrides; armor mods per armor slot (`modsByBucket`), as DIM does.

use futures::future::join_all;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::apply::{find_owned, PlanItem};
use crate::dimsync::{cached_character, cached_raw, describe, save_loadout, DimLoadoutOut};
use crate::fireteam::{definition, item, ItemInfo, ARMOR_BUCKETS, WEAPON_BUCKETS};
use crate::i18n::tr;
use crate::inventory::{own_profile, owned_items, session, OwnedItem, Session};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSocket {
    index: usize,
    /// What goes in there ("Barrel", "Magazine", "Helmet Armor Mod" …).
    label: String,
    current: Option<ItemInfo>,
    options: Vec<ItemInfo>,
    /// Can be left empty (armor mods).
    removable: bool,
}

/// Plug categories that are not edited here.
fn skipped(category: &str) -> bool {
    ["masterworks", "crafting", "trackers", "shader", "skins", "memento", "mementos", "v300.weapon.damage_type"]
        .iter()
        .any(|c| category.contains(c))
}

async fn raw_loadout(app: &AppHandle, s: &Session, id: &str) -> Result<Value, String> {
    cached_raw(app, s)
        .await?
        .into_iter()
        .find(|l| l["id"].as_str() == Some(id))
        .ok_or_else(|| tr("Loadout nicht gefunden", "Loadout not found").to_string())
}

fn entry_index(l: &Value, hash: u64) -> Option<usize> {
    l["equipped"].as_array()?.iter().position(|e| e["hash"].as_u64() == Some(hash))
}

fn overrides_of(entry: &Value) -> Vec<(usize, u32)> {
    entry["socketOverrides"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(i, p)| Some((i.parse().ok()?, p.as_u64()? as u32)))
        .collect()
}

fn owned_for<'a>(owned: &'a [OwnedItem], entry: &Value, character: &str) -> Option<&'a OwnedItem> {
    let it = PlanItem {
        id: entry["id"].as_str().filter(|id| *id != "0").map(Into::into),
        hash: entry["hash"].as_u64()? as u32,
        overrides: Vec::new(),
    };
    find_owned(owned, &it, character)
}

/// The plugs that can go into socket `index`: the item's own choices (a
/// weapon's roll), else the unlocked plugs of the socket's plug sets.
async fn choices(app: &AppHandle, def: &Value, index: usize, owned: Option<&OwnedItem>, plug_sets: &Value, character: &str) -> Vec<u32> {
    if let Some((_, plugs)) = owned.and_then(|o| o.socket_options.iter().find(|(i, _)| *i == index)) {
        if plugs.len() > 1 {
            return plugs.clone();
        }
    }
    let entry = &def["sockets"]["socketEntries"][index];
    let mut out: Vec<u32> = Vec::new();
    for set in [&entry["reusablePlugSetHash"], &entry["randomizedPlugSetHash"]] {
        let Some(set) = set.as_u64().filter(|&h| h != 0) else { continue };
        let key = set.to_string();
        let unlocked: Vec<u32> = plug_sets["profilePlugSets"]["data"]["plugs"][&key]
            .as_array()
            .into_iter()
            .flatten()
            .chain(plug_sets["characterPlugSets"]["data"][character]["plugs"][&key].as_array().into_iter().flatten())
            .filter(|p| p["canInsert"].as_bool() != Some(false) && p["enabled"].as_bool() != Some(false))
            .filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32))
            .collect();
        if unlocked.is_empty() {
            if let Some(d) = definition(app, "DestinyPlugSetDefinition", set).await {
                out.extend(
                    d["reusablePlugItems"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|p| p["currentlyCanRoll"].as_bool() != Some(false))
                        .filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32)),
                );
            }
        } else {
            out.extend(unlocked);
        }
    }
    out.extend(
        entry["reusablePlugItems"].as_array().into_iter().flatten().filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32)),
    );
    let mut seen = std::collections::HashSet::new();
    out.retain(|p| *p != 0 && seen.insert(*p));
    out
}

/// An armor piece's mod sockets with what the loadout puts in each: the
/// mods shown on the piece, matched to the sockets by plug category.
/// Tuning sockets are flagged (true).
async fn armor_sockets(app: &AppHandle, info: &ItemInfo, shown: &[ItemInfo]) -> Vec<(usize, ItemInfo, bool, Option<ItemInfo>)> {
    let empties = join_all(info.mod_sockets.iter().map(|&(_, empty)| item(app, empty))).await;
    let mut used = vec![false; shown.len()];
    let mut out = Vec::new();
    for (&(index, _), empty) in info.mod_sockets.iter().zip(empties) {
        let Some(empty) = empty else { continue };
        let category = empty.plug_category.clone();
        if category.is_empty() || skipped(&category) {
            continue;
        }
        let tuning = category.contains("tuning");
        let current = shown
            .iter()
            .enumerate()
            .find(|(i, m)| !used[*i] && m.plug_category == category)
            .map(|(i, m)| (i, m.clone()));
        let current = current.map(|(i, m)| {
            used[i] = true;
            m
        });
        out.push((index, empty, tuning, current));
    }
    out
}

/// The described loadout and its armor piece `hash` as shown (with mods).
async fn shown_piece(described: &DimLoadoutOut, hash: u64) -> Option<ItemInfo> {
    described.items().iter().find(|i| i.hash() == hash).cloned()
}

struct Context {
    s: Session,
    l: Value,
    character: String,
    class_type: i64,
    owned: Vec<OwnedItem>,
}

async fn context(app: &AppHandle, character_id: Option<String>, loadout_id: &str) -> Result<Context, String> {
    let s = session(app).await?;
    let key = character_id.unwrap_or_default();
    let (l, character, owned) = futures::join!(raw_loadout(app, &s, loadout_id), cached_character(app, &s, &key), owned_items(app));
    let (character, class_type) = character?;
    Ok(Context { l: l?, s, character, class_type, owned: owned.unwrap_or_default() })
}

/// The editable sockets of item `hash` in a DIM loadout.
#[tauri::command]
pub async fn loadout_item_sockets(
    app: AppHandle,
    character_id: Option<String>,
    loadout_id: String,
    hash: u64,
) -> Result<Vec<EditSocket>, String> {
    let c = context(&app, character_id, &loadout_id).await?;
    let i = entry_index(&c.l, hash).ok_or(tr("Item nicht im Loadout", "Item not in the loadout"))?;
    let entry = &c.l["equipped"][i];
    let info = item(&app, hash).await.ok_or("?")?;
    let def = definition(&app, "DestinyInventoryItemDefinition", hash).await.ok_or("?")?;
    let owned = owned_for(&c.owned, entry, &c.character);
    let plug_sets = own_profile(&app, &c.s, "105").await.unwrap_or(Value::Null);
    let overrides = overrides_of(entry);
    let plug_now = |index: usize| -> Option<u32> {
        overrides
            .iter()
            .find(|(i, _)| *i == index)
            .map(|(_, p)| *p)
            .or_else(|| owned.and_then(|o| o.socket_plugs.get(index).copied()))
            .filter(|&p| p != 0)
    };

    // (index, label, current, options, removable)
    let mut wanted: Vec<(usize, String, Option<ItemInfo>, Vec<u32>, bool)> = Vec::new();
    if WEAPON_BUCKETS.contains(&info.bucket) {
        let sockets: Vec<usize> = info.perk_sockets().iter().copied().chain(info.mod_sockets.iter().map(|(i, _)| *i)).collect();
        for index in sockets {
            let current = match plug_now(index) {
                Some(p) => item(&app, p as u64).await,
                None => None,
            };
            if current.as_ref().is_some_and(|p| skipped(&p.plug_category)) {
                continue;
            }
            let options = choices(&app, &def, index, owned, &plug_sets, &c.character).await;
            if options.len() < 2 {
                continue;
            }
            let label = current.as_ref().map(|p| p.type_name().to_string()).unwrap_or_default();
            wanted.push((index, label, current, options, false));
        }
    } else if ARMOR_BUCKETS.contains(&info.bucket) {
        let described = describe(&app, &c.l, &c.character, c.class_type, &c.owned).await;
        let shown = shown_piece(&described, hash).await.map(|p| p.mods().to_vec()).unwrap_or_default();
        for (index, empty, tuning, current) in armor_sockets(&app, &info, &shown).await {
            let current = if tuning {
                match plug_now(index) {
                    Some(p) => item(&app, p as u64).await.filter(|p| p.plug_category.contains("tuning")),
                    None => None,
                }
            } else {
                current
            };
            let options = choices(&app, &def, index, owned, &plug_sets, &c.character).await;
            let label = empty.type_name().to_string();
            wanted.push((index, label, current, options, !tuning));
        }
    } else {
        return Err(tr("Nur Waffen und Rüstung lassen sich bearbeiten", "Only weapons and armor can be edited").into());
    }

    let out = join_all(wanted.into_iter().map(|(index, label, current, options, removable)| {
        let app = app.clone();
        async move {
            let infos = join_all(options.iter().map(|p| item(&app, *p as u64))).await;
            let mut options: Vec<ItemInfo> = infos
                .into_iter()
                .flatten()
                .filter(|p| p.icon_present() && !skipped(&p.plug_category) && !p.plug_category.ends_with("empty"))
                .collect();
            // A socket's empty placeholder ("Empty Mod Socket") is the "none" choice.
            // Its name in each app language: "Empty", "Leer", "Vide", "Vacío", …
            const EMPTY: [&str; 8] = ["empty", "leer", "vide", "vacío", "vuoto", "vazio", "pusty", "пуст"];
            options.retain(|p| {
                let name = p.name.to_lowercase();
                !EMPTY.iter().any(|w| name.contains(w))
            });
            let label = if label.is_empty() { current.as_ref().map(|c| c.type_name().to_string()).unwrap_or_default() } else { label };
            EditSocket { index, label, current, options, removable }
        }
    }))
    .await;
    Ok(out.into_iter().filter(|s| !s.options.is_empty()).collect())
}

/// Put `plug` into socket `index` of item `hash` in a DIM loadout (0 =
/// leave an armor mod socket empty). Returns the loadout as shown now.
#[tauri::command]
pub async fn loadout_set_plug(
    app: AppHandle,
    character_id: Option<String>,
    loadout_id: String,
    hash: u64,
    index: usize,
    plug: u32,
) -> Result<DimLoadoutOut, String> {
    let c = context(&app, character_id, &loadout_id).await?;
    let mut l = c.l.clone();
    let i = entry_index(&l, hash).ok_or(tr("Item nicht im Loadout", "Item not in the loadout"))?;
    let info = item(&app, hash).await.ok_or("?")?;

    let mut as_override = WEAPON_BUCKETS.contains(&info.bucket);
    let mut old_mod: Option<u64> = None;
    let mut shown_by_bucket: Vec<(u64, Vec<ItemInfo>)> = Vec::new();
    if ARMOR_BUCKETS.contains(&info.bucket) {
        let described = describe(&app, &l, &c.character, c.class_type, &c.owned).await;
        let shown = shown_piece(&described, hash).await.map(|p| p.mods().to_vec()).unwrap_or_default();
        let socket = armor_sockets(&app, &info, &shown).await.into_iter().find(|(s, ..)| *s == index);
        let Some((_, _, tuning, current)) = socket else {
            return Err(tr("Diesen Sockel gibt es nicht", "No such socket").into());
        };
        as_override = tuning;
        old_mod = current.map(|m| m.hash());
        // Every armor piece's mods as shown, to pin them to their slot.
        shown_by_bucket = described
            .items()
            .iter()
            .filter(|it| ARMOR_BUCKETS.contains(&it.bucket))
            .map(|it| (it.bucket, it.mods().iter().filter(|m| !m.plug_category.contains("tuning")).cloned().collect()))
            .collect();
    } else if !as_override {
        return Err(tr("Nur Waffen und Rüstung lassen sich bearbeiten", "Only weapons and armor can be edited").into());
    }

    if as_override {
        let entry = &mut l["equipped"][i];
        if !entry["socketOverrides"].is_object() {
            entry["socketOverrides"] = json!({});
        }
        let overrides = entry["socketOverrides"].as_object_mut().expect("object");
        if plug == 0 {
            overrides.remove(&index.to_string());
        } else {
            overrides.insert(index.to_string(), json!(plug));
        }
    } else {
        let mut by_bucket: Map<String, Value> = Map::new();
        for (bucket, mods) in shown_by_bucket {
            let mut hashes: Vec<u64> = mods.iter().map(|m| m.hash()).collect();
            if bucket == info.bucket {
                match old_mod.and_then(|old| hashes.iter().position(|h| *h == old)) {
                    Some(pos) if plug == 0 => {
                        hashes.remove(pos);
                    }
                    Some(pos) => hashes[pos] = plug as u64,
                    None if plug != 0 => hashes.push(plug as u64),
                    None => {}
                }
            }
            by_bucket.insert(bucket.to_string(), json!(hashes));
        }
        if !l["parameters"].is_object() {
            l["parameters"] = json!({});
        }
        l["parameters"]["modsByBucket"] = Value::Object(by_bucket);
        l["parameters"]["mods"] = json!([]);
    }
    l["lastUpdatedAt"] = json!(chrono::Utc::now().timestamp_millis());
    save_loadout(&app, &c.s, l.clone()).await?;
    crate::dimsync::remember_raw(&l);
    Ok(describe(&app, &l, &c.character, c.class_type, &c.owned).await)
}
