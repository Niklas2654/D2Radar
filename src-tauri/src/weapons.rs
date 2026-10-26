//! Weapons: an index of every weapon and its possible rolls (built once per
//! manifest version from Bungie's item, plug set and stat definitions),
//! search, and automatic detection of the weapon on the inspect screen by
//! reading its name off the screen (see screen.rs).
//!
//! Many weapons exist in several versions (reissues with different perk
//! pools). The manifest no longer links them to seasons, but each version
//! has its own season watermark. Detection compares the season watermark on
//! the inspected icon with each version's, then prefers versions the player
//! owns (Bungie login) and the version whose perks appear on screen. The
//! player's own copies give the actual roll.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::bungie::{api, BungieState};
use crate::inventory::OwnedItem;
use crate::i18n::{locale, tr};
use crate::screen::{self, Region};

const WEAPON_ITEM_TYPE: i32 = 3;
/// DestinySocketCategoryDefinition: the random perk columns and the frame.
const PERKS_CATEGORY: u32 = 4241085061;
const INTRINSIC_CATEGORY: u32 = 3956125808;
/// plugCategoryIdentifier of origin traits.
const ORIGIN_PLUGS: &str = "origins";
/// Tier of enhanced perks (same name as the base perk).
const ENHANCED_TIER: u8 = 3;

/// How often the inspect screen is checked while Destiny 2 is in front
/// (only the name's box is read, so this is cheap) …
const DETECT_INTERVAL: Duration = Duration::from_millis(450);
/// … and how often once nothing was there a while (playing, no menu open):
/// each picture makes Windows copy the game's frame back from the
/// graphics card, so in a fight there are only a few.
const IDLE_INTERVAL: Duration = Duration::from_millis(2000);
const IDLE_AFTER: Duration = Duration::from_secs(10);
/// When a check last saw something (an item, a guardian, a heading).
static LAST_SEEN: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// Checks without a weapon name before the overlay hides it again (a name
/// only covered on an unchanged screen does not count, see `same_scene`).
const MISSES_TO_HIDE: u32 = 1;
/// The inspect screen writes the name big; a hover tooltip much smaller
/// (measured at 1080p: 56 px inspecting, 26 px hovering, 34 px for other
/// headings). Minimum height of the name's line, as a share of the screen.
const INSPECT_NAME_HEIGHT: f64 = 0.04;
/// Fuzzy similarity needed between the read text and a weapon name.
const MATCH_SCORE: f64 = 0.9;
/// A line matching its closest name by less than this over the next one is
/// ambiguous (a cut-off name) and not used.
const AMBIGUOUS_GAP: f64 = 0.02;
/// … and between a line on screen and a perk name.
const PERK_SCORE: f64 = 0.93;
/// Where the weapon name usually sits on the inspect screen (16:9);
/// the user can calibrate it in the settings.
const DEFAULT_REGION: Region = Region { x: 0.04, y: 0.05, w: 0.42, h: 0.12 };

/* ---------- Raw manifest shapes (only the needed fields) ---------- */

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawDisplay {
    name: String,
    icon: Option<String>,
    description: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawItem {
    hash: u32,
    display_properties: RawDisplay,
    item_type: i32,
    item_type_display_name: String,
    class_type: i64,
    index: u32,
    icon_watermark: Option<String>,
    redacted: bool,
    inventory: RawInventory,
    sockets: Option<RawSockets>,
    stats: Option<RawStats>,
    equipping_block: Option<RawEquipping>,
    plug: Option<RawPlug>,
    flavor_text: String,
    perks: Vec<RawItemPerk>,
    /// Its collections entry (where it drops: `RawCollectible`).
    collectible_hash: u32,
}

/// A collections entry: where its item comes from ("Source: Vault of
/// Glass raid"), read in English (see `WeaponIndex::sources`).
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawCollectible {
    source_string: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawItemPerk {
    perk_hash: u32,
    /// 0 = shown in the tooltip.
    perk_visibility: u8,
}

/// A sandbox perk: what a catalyst actually does.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSandboxPerk {
    display_properties: RawDisplay,
    is_displayable: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawInventory {
    tier_type: u8,
    bucket_type_hash: u64,
    /// A pattern to craft it exists.
    recipe_item_hash: u32,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSockets {
    socket_entries: Vec<RawSocketEntry>,
    socket_categories: Vec<RawSocketCategory>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSocketEntry {
    single_initial_item_hash: u32,
    randomized_plug_set_hash: Option<u32>,
    reusable_plug_set_hash: Option<u32>,
    reusable_plug_items: Vec<RawPlugItem>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawSocketCategory {
    socket_category_hash: u32,
    socket_indexes: Vec<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPlugItem {
    plug_item_hash: u32,
    #[serde(default = "yes")]
    currently_can_roll: bool,
}

fn yes() -> bool {
    true
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawStats {
    stat_group_hash: Option<u32>,
    stats: HashMap<String, RawStatValue>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct RawStatValue {
    value: i32,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawEquipping {
    ammo_type: u8,
    /// The armor set it belongs to (set bonuses), 0: none.
    equipable_item_set_hash: u32,
}

/// An armor set: its name ("Atheon's Memory").
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawItemSet {
    display_properties: RawDisplay,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawPlug {
    plug_category_identifier: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawPlugSet {
    reusable_plug_items: Vec<RawPlugItem>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawStatGroup {
    scaled_stats: Vec<RawScaledStat>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawScaledStat {
    stat_hash: u32,
    display_as_numeric: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawStatDef {
    display_properties: RawDisplay,
}

/* ---------- Index ---------- */

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Column {
    label: String,
    perks: Vec<u32>,
    /// Random roll column (vs. a fixed perk).
    random: bool,
    /// Perk -> its enhanced version, where this weapon can have it.
    #[serde(default)]
    enhanced: Vec<(u32, u32)>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Weapon {
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    tier: u8,
    ammo: u8,
    /// Manifest order; reissues of a weapon have a higher index.
    index: u32,
    /// Season symbol drawn on the icon; tells versions apart.
    watermark: Option<String>,
    frame: Option<u32>,
    origins: Vec<u32>,
    columns: Vec<Column>,
    /// (stat hash, value, shown as a number instead of a bar)
    stats: Vec<(u32, i32, bool)>,
    /// The weapon's lore line (exotics have one that says what they are).
    #[serde(default)]
    flavor: String,
    /// An exotic's catalyst: what it adds once completed.
    #[serde(default)]
    catalyst: Option<Perk>,
    /// Can be crafted (a pattern exists).
    #[serde(default)]
    craftable: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Perk {
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    description: String,
    /// Its enhanced version (crafted / enhanced weapons), when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    enhanced: Option<Box<Perk>>,
}

#[derive(Serialize, Deserialize)]
struct WeaponIndex {
    version: String,
    locale: String,
    weapons: Vec<Weapon>,
    perks: HashMap<u32, Perk>,
    stat_names: HashMap<u32, String>,
    /// Plugs dropped as duplicates of a listed perk with the same name
    /// (e.g. enhanced variants) -> that perk, to map real rolls.
    #[serde(default)]
    aliases: HashMap<u32, u32>,
    /// Perk -> its enhanced version (same name, higher tier).
    #[serde(default)]
    enhanced: HashMap<u32, u32>,
    /// Every equippable item (weapons, armor, subclasses), for picking
    /// Armor and weapon mods (hash -> name), for hovered tooltips: any mod
    /// can be on the piece inspected.
    #[serde(default)]
    mods: HashMap<u32, String>,
    /// gear by slot and class (loadout presets).
    #[serde(default)]
    gear: HashMap<u32, GearInfo>,
    /// Weapons' and armor's source (English, lower case: "source: vault of
    /// glass raid"), for searching by it (`source:vaultofglass`).
    #[serde(default)]
    sources: HashMap<u32, String>,
    /// Armor piece -> its set's name (normalized), for searching by it.
    #[serde(default)]
    sets: HashMap<u32, String>,
    /// Artifacts and artifact perks: name (normalized) -> hash and icon.
    #[serde(default)]
    artifacts: HashMap<String, (u32, Option<String>)>,
}

/// Slot, class and look of an equippable item.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GearInfo {
    pub name: String,
    pub icon: Option<String>,
    pub type_name: String,
    /// Inventory bucket (slot) it goes into.
    pub bucket: u64,
    /// 0 Titan, 1 Hunter, 2 Warlock, 3 any.
    pub class_type: i64,
    pub exotic: bool,
    pub watermark: Option<String>,
}

/// The gear table (see `WeaponIndex::gear`).
#[derive(Clone)]
pub(crate) struct Gear(Arc<WeaponDb>);

impl Gear {
    pub(crate) fn get(&self, hash: u32) -> Option<&GearInfo> {
        self.0.index.gear.get(&hash)
    }
}

/// The gear table of the current manifest (built with the weapon index).
pub(crate) async fn gear(app: &AppHandle) -> Result<Gear, String> {
    Ok(Gear(db(app).await?))
}

/// The index plus name lookups.
struct WeaponDb {
    index: WeaponIndex,
    /// One entry per name: the newest version (for search).
    by_name: Vec<(String, usize)>,
    /// Every version per name, newest first.
    versions: HashMap<String, Vec<usize>>,
    /// Armor name (normalized) -> every item with it (reissues).
    armor: Vec<(String, Vec<u32>)>,
}

static DB: Mutex<Option<Arc<WeaponDb>>> = Mutex::new(None);
/// Serializes index builds (they download and parse ~200 MB).
static BUILD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Upper-case letters and digits only, single spaces: OCR and names compare well.
fn normalize(s: &str) -> String {
    s.to_uppercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_index(
    version: String,
    items: HashMap<String, RawItem>,
    plug_sets: HashMap<String, RawPlugSet>,
    groups: HashMap<String, RawStatGroup>,
    stat_defs: HashMap<String, RawStatDef>,
    sandbox_perks: HashMap<String, RawSandboxPerk>,
    collectibles: HashMap<String, RawCollectible>,
    item_sets: HashMap<String, RawItemSet>,
) -> WeaponIndex {
    let item = |hash: u32| items.get(&hash.to_string());
    let mut perks: HashMap<u32, Perk> = HashMap::new();
    let mut aliases: HashMap<u32, u32> = HashMap::new();
    let mut enhanced: HashMap<u32, u32> = HashMap::new();
    let mut weapons = Vec::new();

    // A plug worth showing: named, with an icon and a type (this drops empty
    // sockets and trackers).
    let usable = |hash: u32| {
        item(hash).filter(|p| {
            !p.display_properties.name.is_empty()
                && p.display_properties.icon.is_some()
                && !p.item_type_display_name.is_empty()
        })
    };
    let remember = |hash: u32, perks: &mut HashMap<u32, Perk>| {
        if let Some(p) = usable(hash) {
            perks.entry(hash).or_insert_with(|| Perk {
                hash,
                name: p.display_properties.name.clone(),
                icon: p.display_properties.icon.clone(),
                type_name: p.item_type_display_name.clone(),
                description: p.display_properties.description.clone(),
                enhanced: None,
            });
        }
    };

    for w in items.values() {
        if w.item_type != WEAPON_ITEM_TYPE || w.redacted || w.display_properties.name.is_empty() {
            continue;
        }
        let Some(sockets) = &w.sockets else { continue };
        let indexes = |category: u32| {
            sockets
                .socket_categories
                .iter()
                .find(|c| c.socket_category_hash == category)
                .map(|c| c.socket_indexes.clone())
                .unwrap_or_default()
        };

        let frame = indexes(INTRINSIC_CATEGORY)
            .first()
            .and_then(|&i| sockets.socket_entries.get(i))
            .map(|e| e.single_initial_item_hash)
            .filter(|&h| usable(h).is_some());

        let mut columns = Vec::new();
        let mut origins = Vec::new();
        for i in indexes(PERKS_CATEGORY) {
            let Some(entry) = sockets.socket_entries.get(i) else { continue };
            let random = entry.randomized_plug_set_hash.is_some();
            let mut plugs: Vec<(u32, bool)> = match entry.randomized_plug_set_hash.or(entry.reusable_plug_set_hash) {
                Some(set) => plug_sets
                    .get(&set.to_string())
                    .map(|s| s.reusable_plug_items.iter().map(|p| (p.plug_item_hash, p.currently_can_roll)).collect())
                    .unwrap_or_default(),
                None => entry.reusable_plug_items.iter().map(|p| (p.plug_item_hash, p.currently_can_roll)).collect(),
            };
            // The initial plug first (curated / origin trait), then the pool.
            if entry.single_initial_item_hash != 0 {
                plugs.insert(0, (entry.single_initial_item_hash, true));
            }
            // Rollable perks first; enhanced variants share names, keep one.
            let is_enhanced = |h: u32| item(h).is_some_and(|p| p.inventory.tier_type == ENHANCED_TIER);
            plugs.sort_by_key(|&(h, can_roll)| (!can_roll, is_enhanced(h)));
            let mut seen: Vec<(String, u32)> = Vec::new();
            let mut column_enhanced: Vec<(u32, u32)> = Vec::new();
            let mut column: Vec<u32> = Vec::new();
            for (hash, _) in plugs {
                if let Some(p) = usable(hash) {
                    match seen.iter().find(|(name, _)| *name == p.display_properties.name) {
                        Some(&(_, kept)) if kept != hash => {
                            aliases.insert(hash, kept);
                            if is_enhanced(hash) && !is_enhanced(kept) {
                                enhanced.entry(kept).or_insert(hash);
                                if !column_enhanced.iter().any(|(b, _)| *b == kept) {
                                    column_enhanced.push((kept, hash));
                                }
                            }
                        }
                        Some(_) => {}
                        None => {
                            seen.push((p.display_properties.name.clone(), hash));
                            column.push(hash);
                        }
                    }
                }
            }
            if column.is_empty() {
                continue;
            }
            let is_origin = item(column[0])
                .and_then(|p| p.plug.as_ref())
                .is_some_and(|p| p.plug_category_identifier == ORIGIN_PLUGS);
            if is_origin {
                origins.extend(column);
            } else {
                let label = item(column[0]).map(|p| p.item_type_display_name.clone()).unwrap_or_default();
                // Fixed columns only need their first (actual) perk.
                if !random {
                    column.truncate(1);
                }
                column_enhanced.retain(|(base, _)| column.contains(base));
                columns.push(Column { label, perks: column, random, enhanced: column_enhanced });
            }
        }
        if columns.is_empty() && frame.is_none() {
            continue;
        }

        let stats = w
            .stats
            .as_ref()
            .and_then(|s| {
                let group = groups.get(&s.stat_group_hash?.to_string())?;
                Some(
                    group
                        .scaled_stats
                        .iter()
                        .filter_map(|g| {
                            let v = s.stats.get(&g.stat_hash.to_string())?.value;
                            Some((g.stat_hash, v, g.display_as_numeric))
                        })
                        .collect(),
                )
            })
            .unwrap_or_default();

        for hash in frame.iter().chain(&origins).chain(columns.iter().flat_map(|c| &c.perks)) {
            remember(*hash, &mut perks);
        }

        // An exotic's catalyst: the plug that goes into its empty catalyst
        // socket. What it does is in its (visible) sandbox perks.
        let catalyst = sockets.socket_entries.iter().find_map(|e| {
            let category = |h: u32| item(h).and_then(|p| p.plug.as_ref()).map(|p| p.plug_category_identifier.as_str()).unwrap_or("");
            let is_empty = |h: u32| category(h).contains("exotic.masterwork") && category(h).contains("empty");
            let pool: Vec<u32> = std::iter::once(e.single_initial_item_hash)
                .chain(e.reusable_plug_items.iter().map(|p| p.plug_item_hash))
                .chain(e.reusable_plug_set_hash.into_iter().chain(e.randomized_plug_set_hash).flat_map(|set| {
                    plug_sets
                        .get(&set.to_string())
                        .map(|s| s.reusable_plug_items.iter().map(|p| p.plug_item_hash).collect::<Vec<_>>())
                        .unwrap_or_default()
                }))
                .filter(|&h| h != 0)
                .collect();
            // The catalyst socket: holds the empty catalyst plug or a catalyst.
            if !pool.iter().any(|&h| is_empty(h) || category(h) == "catalysts") {
                return None;
            }
            let pool = pool.into_iter().filter(|&h| !is_empty(h));
            let plugs: Vec<(u32, &RawItem)> = pool
                .filter(|&h| h != e.single_initial_item_hash)
                .filter_map(|h| item(h).map(|p| (h, p)))
                .filter(|(_, p)| !p.display_properties.name.is_empty())
                .collect();
            // What it does: the visible sandbox perks of one of the plugs
            // (the catalyst item, or its effect plug), else the effect plug's text.
            let effects = |p: &RawItem| -> Vec<String> {
                p.perks
                    .iter()
                    // 2 = hidden; the effect itself is often shown only as 1.
                    .filter(|x| x.perk_visibility != 2)
                    .filter_map(|x| sandbox_perks.get(&x.perk_hash.to_string()))
                    .filter(|x| x.is_displayable && !x.display_properties.description.is_empty())
                    .map(|x| x.display_properties.description.clone())
                    .collect()
            };
            let is_effect = |p: &RawItem| p.plug.as_ref().is_some_and(|x| x.plug_category_identifier == "catalysts");
            let description = plugs
                .iter()
                .map(|(_, p)| effects(p))
                .find(|e| !e.is_empty())
                .map(|e| e.join("
"))
                .or_else(|| plugs.iter().find(|(_, p)| is_effect(p)).map(|(_, p)| p.display_properties.description.clone()))
                .or_else(|| plugs.first().map(|(_, p)| p.display_properties.description.clone()))?;
            // Named after the catalyst item ("X Catalyst") when there is one.
            let (hash, named) = plugs.iter().find(|(_, p)| !is_effect(p)).or(plugs.first())?;
            Some(Perk {
                hash: *hash,
                name: named.display_properties.name.clone(),
                icon: named.display_properties.icon.clone(),
                type_name: String::new(),
                description,
                enhanced: None,
            })
        });
        weapons.push(Weapon {
            hash: w.hash,
            name: w.display_properties.name.clone(),
            icon: w.display_properties.icon.clone(),
            type_name: w.item_type_display_name.clone(),
            tier: w.inventory.tier_type,
            ammo: w.equipping_block.as_ref().map_or(0, |e| e.ammo_type),
            index: w.index,
            watermark: w.icon_watermark.clone(),
            frame,
            origins,
            columns,
            stats,
            flavor: w.flavor_text.clone(),
            catalyst,
            craftable: w.inventory.recipe_item_hash != 0,
        });
    }
    weapons.sort_by(|a, b| a.name.cmp(&b.name));

    let stat_names = stat_defs
        .into_iter()
        .filter_map(|(hash, def)| {
            let name = def.display_properties.name;
            (!name.is_empty()).then(|| Some((hash.parse().ok()?, name)))?
        })
        .collect();
    // Armor 2, weapons 3, subclasses 16.
    let gear = items
        .values()
        .filter(|i| matches!(i.item_type, 2 | 3 | 16) && !i.redacted && !i.display_properties.name.is_empty())
        .map(|i| {
            (
                i.hash,
                GearInfo {
                    name: i.display_properties.name.clone(),
                    icon: i.display_properties.icon.clone(),
                    type_name: i.item_type_display_name.clone(),
                    bucket: i.inventory.bucket_type_hash,
                    class_type: i.class_type,
                    exotic: i.inventory.tier_type == 6,
                    watermark: i.icon_watermark.clone(),
                },
            )
        })
        .collect();
    // The enhanced versions are shown too.
    for &h in enhanced.values() {
        remember(h, &mut perks);
    }
    // Mods (item type 19) that go into armor or weapon mod sockets.
    let mods = items
        .values()
        .filter(|i| i.item_type == 19 && !i.redacted && !i.display_properties.name.is_empty())
        .filter(|i| {
            i.plug.as_ref().is_some_and(|p| {
                let c = &p.plug_category_identifier;
                (c.starts_with("enhancements.") && !c.contains("artifice") && !c.contains("ornament"))
                    || c.contains("weapon.mod_")
            })
        })
        .map(|i| (i.hash, i.display_properties.name.clone()))
        .collect();
    // Where weapons and armor come from.
    let sources = items
        .values()
        .filter(|i| matches!(i.item_type, 2 | 3) && i.collectible_hash != 0)
        .filter_map(|i| {
            let source = &collectibles.get(&i.collectible_hash.to_string())?.source_string;
            (!source.is_empty()).then(|| (i.hash, source.to_lowercase()))
        })
        .collect();
    // Each set piece's set name.
    let sets = items
        .values()
        .filter(|i| i.item_type == 2)
        .filter_map(|i| {
            let set = i.equipping_block.as_ref()?.equipable_item_set_hash;
            let name = &item_sets.get(&set.to_string())?.display_properties.name;
            (set != 0 && !name.is_empty()).then(|| (i.hash, normalize(name)))
        })
        .collect();
    // Artifacts and their perks ("Artifact", "Artifact Perk"; "Artefakt", …).
    let artifacts = items
        .values()
        .filter(|i| {
            let kind = i.item_type_display_name.to_lowercase();
            ["artifact", "artefa", "artéfa"].iter().any(|k| kind.contains(k))
        })
        .filter(|i| !i.display_properties.name.is_empty())
        .map(|i| (normalize(&i.display_properties.name), (i.hash, i.display_properties.icon.clone())))
        .collect();
    WeaponIndex { version, locale: locale().to_string(), weapons, perks, stat_names, aliases, enhanced, mods, gear, sources, sets, artifacts }
}

fn index_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(format!("weapons-v11-{}.json", locale()))
}

fn into_db(index: WeaponIndex) -> Arc<WeaponDb> {
    // Per name the newest version, preferring ones with random rolls.
    let mut best: HashMap<String, usize> = HashMap::new();
    for (i, w) in index.weapons.iter().enumerate() {
        let key = normalize(&w.name);
        let rank = |w: &Weapon| (w.columns.iter().any(|c| c.random), w.index);
        match best.get(&key) {
            Some(&j) if rank(&index.weapons[j]) >= rank(w) => {}
            _ => {
                best.insert(key, i);
            }
        }
    }
    let mut versions: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, w) in index.weapons.iter().enumerate() {
        versions.entry(normalize(&w.name)).or_default().push(i);
    }
    for list in versions.values_mut() {
        list.sort_by_key(|&i| std::cmp::Reverse(index.weapons[i].index));
    }
    // Armor names (helmet … class item), one hash each: inspected armor.
    let mut armor: HashMap<String, Vec<u32>> = HashMap::new();
    for (hash, g) in &index.gear {
        if crate::fireteam::ARMOR_BUCKETS.contains(&g.bucket) {
            armor.entry(normalize(&g.name)).or_default().push(*hash);
        }
    }
    Arc::new(WeaponDb { by_name: best.into_iter().collect(), versions, index, armor: armor.into_iter().collect() })
}

async fn download<T: for<'de> Deserialize<'de> + Send + 'static>(
    http: &reqwest::Client,
    paths: &serde_json::Value,
    table: &str,
) -> Result<HashMap<String, T>, String> {
    let path = paths[table].as_str().ok_or(tr("Manifest-Pfad fehlt", "Manifest path missing"))?;
    let bytes = http
        .get(format!("https://www.bungie.net{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    // Parsing the item table takes a moment; keep it off the async threads.
    tauri::async_runtime::spawn_blocking(move || serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// The weapon index for the current language: memory, disk, or built from
/// the manifest (first time per manifest version, a few seconds).
async fn db(app: &AppHandle) -> Result<Arc<WeaponDb>, String> {
    let current = |db: &Arc<WeaponDb>| db.index.locale == locale();
    if let Some(db) = DB.lock().unwrap().clone().filter(current) {
        return Ok(db);
    }
    let _building = BUILD.lock().await;
    if let Some(db) = DB.lock().unwrap().clone().filter(current) {
        return Ok(db);
    }

    let state = app.state::<BungieState>();
    let key = state.api_key()?;
    let info = api(&state.http, &key, Method::GET, "/Destiny2/Manifest/", None).await?;
    let version = info["version"].as_str().unwrap_or_default().to_string();
    let path = index_path(app);

    let cached = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || {
            std::fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str::<WeaponIndex>(&s).ok())
        }
    })
    .await
    .ok()
    .flatten()
    .filter(|i| i.version == version && i.locale == locale());

    let index = match cached {
        Some(index) => index,
        None => {
            let paths = &info["jsonWorldComponentContentPaths"][locale()];
            // Sources in English, whatever the app's language: searched by
            // the activities' English names.
            let english = &info["jsonWorldComponentContentPaths"]["en"];
            let http = state.http.clone();
            let (items, plug_sets, groups, stat_defs, sandbox_perks, collectibles, item_sets) = futures::try_join!(
                download::<RawItem>(&http, paths, "DestinyInventoryItemDefinition"),
                download::<RawPlugSet>(&http, paths, "DestinyPlugSetDefinition"),
                download::<RawStatGroup>(&http, paths, "DestinyStatGroupDefinition"),
                download::<RawStatDef>(&http, paths, "DestinyStatDefinition"),
                download::<RawSandboxPerk>(&http, paths, "DestinySandboxPerkDefinition"),
                download::<RawCollectible>(&http, english, "DestinyCollectibleDefinition"),
                download::<RawItemSet>(&http, paths, "DestinyEquipableItemSetDefinition"),
            )?;
            let index = build_index(version, items, plug_sets, groups, stat_defs, sandbox_perks, collectibles, item_sets);
            if let Ok(json) = serde_json::to_string(&index) {
                if let Some(dir) = path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(&path, json);
            }
            index
        }
    };
    let db = into_db(index);
    *DB.lock().unwrap() = Some(db.clone());
    Ok(db)
}

/* ---------- Output shapes ---------- */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponSummary {
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    tier: u8,
    watermark: Option<String>,
    /// All versions of this weapon (reissues per season), newest first.
    versions: Vec<VersionOut>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnOut {
    label: String,
    random: bool,
    perks: Vec<Perk>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatOut {
    name: String,
    value: i32,
    numeric: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponDetail {
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    tier: u8,
    /// 1 primary, 2 special, 3 heavy.
    ammo: u8,
    watermark: Option<String>,
    frame: Option<Perk>,
    origins: Vec<Perk>,
    columns: Vec<ColumnOut>,
    stats: Vec<StatOut>,
    /// All versions of this weapon, newest first (including this one).
    versions: Vec<VersionOut>,
    /// Perks read on screen, i.e. the inspected roll (empty when unknown).
    rolled: Vec<u32>,
    /// How the version was chosen: "owned", "watermark", "perks" or "newest".
    matched_by: &'static str,
    /// The player's own copies of this version and their perks.
    copies: Vec<CopyOut>,
    /// The versions differ by season, but neither the icon region nor the
    /// Bungie login is set up, so the season couldn't be determined.
    season_needs_setup: bool,
    flavor: String,
    catalyst: Option<Perk>,
    craftable: bool,
    /// Some of its perks have enhanced versions.
    enhanceable: bool,
}

impl WeaponDetail {

}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOut {
    /// Item instance id (for moving it).
    id: String,
    /// "equipped", "inventory" or "vault".
    location: &'static str,
    /// Every perk the copy can switch to, as listed in this weapon's columns.
    perks: Vec<u32>,
    /// The perks currently selected on the copy.
    selected: Vec<u32>,
    /// Of its perks, the ones it has in their enhanced version (as listed).
    enhanced: Vec<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionOut {
    hash: u32,
    watermark: Option<String>,
}

fn versions_of(db: &WeaponDb, w: &Weapon) -> Vec<VersionOut> {
    db.versions
        .get(&normalize(&w.name))
        .map(|list| {
            list.iter()
                .map(|&i| VersionOut { hash: db.index.weapons[i].hash, watermark: db.index.weapons[i].watermark.clone() })
                .collect()
        })
        .unwrap_or_default()
}

fn summary(db: &WeaponDb, w: &Weapon) -> WeaponSummary {
    WeaponSummary {
        hash: w.hash,
        name: w.name.clone(),
        icon: w.icon.clone(),
        type_name: w.type_name.clone(),
        tier: w.tier,
        watermark: w.watermark.clone(),
        versions: versions_of(db, w),
    }
}

fn detail(db: &WeaponDb, w: &Weapon) -> WeaponDetail {
    // A perk with its enhanced version attached.
    let perk = |h: &u32| db.index.perks.get(h).cloned();
    // A column's perk with its enhanced version, if this weapon can have it.
    let column_perk = |c: &Column, h: &u32| {
        let mut p = perk(h)?;
        p.enhanced = c
            .enhanced
            .iter()
            .find(|(base, _)| base == h)
            .and_then(|(_, e)| perk(e))
            .map(Box::new);
        Some(p)
    };
    let enhanceable = w.columns.iter().any(|c| !c.enhanced.is_empty());
    let versions = versions_of(db, w);
    WeaponDetail {
        hash: w.hash,
        name: w.name.clone(),
        icon: w.icon.clone(),
        type_name: w.type_name.clone(),
        tier: w.tier,
        ammo: w.ammo,
        watermark: w.watermark.clone(),
        versions,
        rolled: Vec::new(),
        matched_by: "newest",
        copies: Vec::new(),
        season_needs_setup: false,
        flavor: w.flavor.clone(),
        catalyst: w.catalyst.clone(),
        craftable: w.craftable,
        enhanceable,
        frame: w.frame.as_ref().and_then(perk),
        origins: w.origins.iter().filter_map(perk).collect(),
        columns: w
            .columns
            .iter()
            .map(|c| ColumnOut {
                label: c.label.clone(),
                random: c.random,
                perks: c.perks.iter().filter_map(|h| column_perk(c, h)).collect(),
            })
            .collect(),
        stats: w
            .stats
            .iter()
            .filter_map(|&(hash, value, numeric)| {
                Some(StatOut { name: db.index.stat_names.get(&hash)?.clone(), value, numeric })
            })
            .collect(),
    }
}

/// Best weapon for some OCR'd text (whole lines and adjacent line pairs);
/// the newest version of that name.
#[cfg(test)]
fn match_text(db: &WeaponDb, lines: &[String]) -> Option<usize> {
    let lines: Vec<screen::TextLine> = lines
        .iter()
        .map(|text| screen::TextLine { text: text.clone(), x: 0.0, y: 0.0, w: 0.0, h: 0.0 })
        .collect();
    match_lines(db, &lines).map(|(i, _)| i)
}

/// Like `match_text`, also returning the box of the line(s) that matched.
fn match_lines(db: &WeaponDb, lines: &[screen::TextLine]) -> Option<(usize, screen::TextLine)> {
    best_line(&db.by_name, lines).map(|(i, line)| (*i, line))
}

/// The name in `names` closest to a line on screen (at least MATCH_SCORE).
fn best_line<'a, T>(names: &'a [(String, T)], lines: &[screen::TextLine]) -> Option<(&'a T, screen::TextLine)> {
    best_scored(names, lines).map(|(value, line, _)| (value, line))
}

/// `best_line` with its score (to compare weapon and armor matches).
fn best_scored<'a, T>(names: &'a [(String, T)], lines: &[screen::TextLine]) -> Option<(&'a T, screen::TextLine, f64)> {
    let mut texts: Vec<screen::TextLine> = lines.to_vec();
    // Long names can wrap onto two lines; the pair's box spans both.
    texts.extend(lines.windows(2).map(|p| {
        let (a, b) = (&p[0], &p[1]);
        let (x, y) = (a.x.min(b.x), a.y.min(b.y));
        screen::TextLine {
            text: format!("{} {}", a.text, b.text),
            x,
            y,
            w: (a.x + a.w).max(b.x + b.w) - x,
            // The icon is sized by one line of the name, not both.
            h: a.h,
        }
    }));
    let mut best: Option<(f64, &T, screen::TextLine)> = None;
    for line in texts {
        let text = normalize(&line.text);
        if text.chars().count() < 3 {
            continue;
        }
        // Short names are also compared without spaces ("DFA" / "D F A"
        // of "D.F.A.": the dots read or not).
        let compact = (text.len() <= 10).then(|| text.replace(' ', ""));
        // The closest name for this line, and how close the next one is.
        let mut top: Option<(f64, &T)> = None;
        let mut runner_up = 0.0;
        for (name, value) in names {
            let mut score = strsim::jaro_winkler(&text, name);
            if let Some(compact) = &compact {
                if name.len() <= 12 && name.replace(' ', "") == *compact {
                    score = 1.0;
                }
            }
            match top {
                Some((s, _)) if score <= s => runner_up = f64::max(runner_up, score),
                _ => {
                    runner_up = top.map_or(runner_up, |(s, _)| f64::max(runner_up, s));
                    top = Some((score, value));
                }
            }
        }
        let Some((score, value)) = top else { continue };
        // A line fitting two names alike is part of a name (the rest
        // covered, e.g. by the cursor: "EXODUS DOWN" of "… VEST" and
        // "… MASK"): no telling which, so it doesn't count.
        // An exact read is never in doubt ("… MARK" next to "… MASK").
        let exact = score >= 0.999;
        if score < MATCH_SCORE || (!exact && runner_up >= score - AMBIGUOUS_GAP) {
            continue;
        }
        if best.as_ref().is_none_or(|(s, _, _)| score > *s) {
            best = Some((score, value, line.clone()));
        }
    }
    best.map(|(score, value, line)| (value, line, score))
}

/// Name key of `index`'s weapon.
fn name_key(db: &WeaponDb, index: usize) -> String {
    normalize(&db.index.weapons[index].name)
}

/// Whether a perk name shows up in the text read off the screen.
fn on_screen(texts: &[String], perk: &str) -> bool {
    let name = normalize(perk);
    let long = name.chars().count() >= 6;
    texts.iter().any(|t| {
        *t == name || (long && t.contains(&name)) || strsim::jaro_winkler(t, &name) >= PERK_SCORE
    })
}

/// The player's copies of `w`, with their plugs mapped to `w`'s listed perks.
fn copies_of(db: &WeaponDb, w: &Weapon, owned: &[OwnedItem]) -> Vec<CopyOut> {
    let listed: Vec<u32> = w.columns.iter().flat_map(|c| c.perks.iter()).chain(&w.origins).copied().collect();
    let listed_only = |plugs: &[u32]| -> Vec<u32> {
        let mut out: Vec<u32> = plugs
            .iter()
            .map(|p| db.index.aliases.get(p).copied().unwrap_or(*p))
            .filter(|p| listed.contains(p))
            .collect();
        out.dedup();
        out
    };
    owned
        .iter()
        .filter(|o| o.item_hash == w.hash)
        .map(|o| CopyOut {
            id: o.instance_id.clone(),
            location: o.location,
            perks: listed_only(&o.options),
            selected: listed_only(&o.plugs),
            enhanced: o
                .options
                .iter()
                .chain(&o.plugs)
                .filter_map(|p| w.columns.iter().flat_map(|c| &c.enhanced).find(|(_, e)| e == p).map(|(base, _)| *base))
                .fold(Vec::new(), |mut acc, b| {
                    if !acc.contains(&b) {
                        acc.push(b);
                    }
                    acc
                }),
        })
        .collect()
}

/// Pick the version of `key`: narrowed to the season `watermark` seen on
/// screen (if known), then to versions the player owns, then the one whose
/// perks appear in `lines` (the whole screen), else the newest. The roll is
/// taken from the player's copies, or from the perks read on screen.
fn identify(
    db: &WeaponDb,
    key: &str,
    lines: &[String],
    watermark: Option<&str>,
    owned: &[OwnedItem],
) -> Option<WeaponDetail> {
    let all = db.versions.get(key)?;
    let same_season: Vec<usize> = all
        .iter()
        .copied()
        .filter(|&i| watermark.is_some_and(|w| db.index.weapons[i].watermark.as_deref() == Some(w)))
        .collect();
    let by_watermark = !same_season.is_empty() && same_season.len() < all.len();
    let mut versions = if same_season.is_empty() { all.clone() } else { same_season };
    let owned_versions: Vec<usize> = versions
        .iter()
        .copied()
        .filter(|&i| owned.iter().any(|o| o.item_hash == db.index.weapons[i].hash))
        .collect();
    let by_owned = !owned_versions.is_empty() && owned_versions.len() < versions.len();
    if !owned_versions.is_empty() {
        versions = owned_versions;
    }
    let texts: Vec<String> = lines.iter().map(|l| normalize(l)).filter(|t| t.chars().count() >= 3).collect();
    let mut best: Option<(usize, Vec<u32>)> = None;
    for &i in &versions {
        let w = &db.index.weapons[i];
        let rolled: Vec<u32> = w
            .columns
            .iter()
            .flat_map(|c| &c.perks)
            .chain(&w.origins)
            .copied()
            .filter(|h| db.index.perks.get(h).is_some_and(|p| on_screen(&texts, &p.name)))
            .collect();
        // Newest first, so only a strictly better match replaces it.
        if best.as_ref().is_none_or(|(_, b)| rolled.len() > b.len()) {
            best = Some((i, rolled));
        }
    }
    let (i, read) = best?;
    let w = &db.index.weapons[i];
    let mut d = detail(db, w);
    d.copies = copies_of(db, w, owned);
    d.matched_by = if by_watermark {
        "watermark"
    } else if by_owned {
        "owned"
    } else if !read.is_empty() {
        "perks"
    } else {
        "newest"
    };
    // The player's copies are exact; text on screen is the fallback.
    d.rolled = if d.copies.is_empty() {
        read
    } else {
        let mut all: Vec<u32> = d.copies.iter().flat_map(|c| c.perks.iter().copied()).collect();
        all.sort_unstable();
        all.dedup();
        all
    };
    Some(d)
}

/// Bungie images (icons, watermarks), cached in memory.
static IMAGES: Mutex<Option<HashMap<String, Arc<image::RgbaImage>>>> = Mutex::new(None);
const MAX_IMAGES: usize = 300;

async fn bungie_image(http: &reqwest::Client, path: &str) -> Option<Arc<image::RgbaImage>> {
    if let Some(img) = IMAGES.lock().unwrap().get_or_insert_default().get(path) {
        return Some(img.clone());
    }
    let bytes = http.get(format!("https://www.bungie.net{path}")).send().await.ok()?.bytes().await.ok()?;
    let img = Arc::new(image::load_from_memory(&bytes).ok()?.to_rgba8());
    let mut images = IMAGES.lock().unwrap();
    let images = images.get_or_insert_default();
    // Decoded images are big (~36 KB each): start over past a few hundred
    // rather than keep every weapon ever inspected.
    if images.len() >= MAX_IMAGES {
        images.clear();
    }
    images.insert(path.to_string(), img.clone());
    Some(img)
}

/// How far the icon somewhere in `area` (part of the screen around the
/// icon, which is about `size` pixels big) is from each season's look of
/// `key` (lower = closer). None if the versions don't differ by watermark
/// or the images aren't available.
async fn watermark_scores(
    app: &AppHandle,
    db: &WeaponDb,
    versions: &[usize],
    area: &image::RgbaImage,
    size: f64,
) -> Option<Vec<(String, f64)>> {
    // Distinct (icon, watermark) looks among the versions.
    let mut looks: Vec<(String, String)> = Vec::new();
    for &i in versions {
        let w = &db.index.weapons[i];
        if let (Some(icon), Some(mark)) = (&w.icon, &w.watermark) {
            if !looks.iter().any(|(ic, m)| m == mark && ic == icon) {
                looks.push((icon.clone(), mark.clone()));
            }
        }
    }
    if looks.len() < 2 {
        return None;
    }
    let http = app.state::<BungieState>().http.clone();
    let mut images = Vec::new();
    for (icon, mark) in &looks {
        images.push((bungie_image(&http, icon).await?, bungie_image(&http, mark).await?));
    }
    let area = area.clone();
    let distances = tauri::async_runtime::spawn_blocking(move || {
        let mask = watermark_mask(&images.iter().map(|(_, m)| (**m).clone()).collect::<Vec<_>>());
        images
            .iter()
            .map(|(icon, mark)| {
                let template = composite(icon, mark);
                icon_distance(&locate_icon(&area, &template, size), &template, &mask)
            })
            .collect::<Vec<f64>>()
    })
    .await
    .ok()?;
    // A look as "icon|watermark".
    Some(looks.into_iter().map(|(icon, mark)| format!("{icon}|{mark}")).zip(distances).collect())
}

/* ---------- Season watermark matching ---------- */

/// On the inspect screen the weapon icon is a square left of the name; the
/// screen scales with the resolution, so its size is a share of the screen
/// height (96 px at 1080p). The read name's height is no good measure: the
/// lock icon after the name sometimes counts as text (59–72 px for the same
/// name), which made the icon box and so the season wrong.
const ICON_PER_SCREEN_HEIGHT: f64 = 96.0 / 1080.0;
/// The gap (in icon sizes) to the name, top-aligned with it.
const ICON_GAP: f64 = 0.26;

/// The icon's box on screen, next to the weapon name's line box.
fn icon_box_from_name(name: &screen::TextLine, screen_height: f64) -> (f64, f64, f64) {
    let size = screen_height * ICON_PER_SCREEN_HEIGHT;
    let x = name.x - size * (1.0 + ICON_GAP);
    let y = name.y - size * 0.03;
    (x, y, size)
}

/// Margin (in icon sizes) cropped around the derived icon box, so the icon
/// is fully inside even when the estimate is a bit off.
const ICON_PAD: f64 = 0.25;
/// An icon decides against the better-read name only this much closer.
const ICON_CLEARLY_CLOSER: f64 = 0.9;
/// A weapon and an armor name both fitting a line compete (the icon
/// decides) only when their scores are this close.
const RIVAL_GAP: f64 = 0.05;

/// Crop a square box (x, y, size in pixels) plus `pad` icon sizes on each
/// side out of a screenshot.
fn crop_box(shot: &image::RgbaImage, (x, y, size): (f64, f64, f64), pad: f64) -> Option<image::RgbaImage> {
    let (w, h) = (shot.width() as f64, shot.height() as f64);
    let (x0, y0) = ((x - pad * size).max(0.0), (y - pad * size).max(0.0));
    let (x1, y1) = ((x + size * (1.0 + pad)).min(w), (y + size * (1.0 + pad)).min(h));
    (x1 - x0 >= 8.0 && y1 - y0 >= 8.0)
        .then(|| image::imageops::crop_imm(shot, x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32).to_image())
}

/// The square in `area` that looks most like `template` (an icon as the
/// game draws it), scaled to ICON_SIZE. The icon is expected to be about
/// `size` pixels big.
fn locate_icon(area: &image::RgbaImage, template: &image::RgbaImage, size: f64) -> image::RgbaImage {
    use image::imageops::{crop_imm, resize, FilterType};
    const STEP: u32 = 3;
    let mut best: Option<(u64, image::RgbaImage)> = None;
    for scale in [0.88, 0.94, 1.0, 1.06, 1.12] {
        // Resize so the icon would be ICON_SIZE big.
        let k = ICON_SIZE as f64 / (size * scale);
        let (w, h) = ((area.width() as f64 * k).round() as u32, (area.height() as f64 * k).round() as u32);
        if w < ICON_SIZE || h < ICON_SIZE {
            continue;
        }
        let scaled = resize(area, w, h, FilterType::Triangle);
        for oy in (0..=h - ICON_SIZE).step_by(2) {
            for ox in (0..=w - ICON_SIZE).step_by(2) {
                let mut sum = 0u64;
                for y in (0..ICON_SIZE).step_by(STEP as usize) {
                    for x in (0..ICON_SIZE).step_by(STEP as usize) {
                        let a = scaled.get_pixel(ox + x, oy + y);
                        let b = template.get_pixel(x, y);
                        sum += (0..3).map(|c| (a[c] as i32 - b[c] as i32).unsigned_abs() as u64).sum::<u64>();
                    }
                }
                if best.as_ref().is_none_or(|(s, _)| sum < *s) {
                    best = Some((sum, crop_imm(&scaled, ox, oy, ICON_SIZE, ICON_SIZE).to_image()));
                }
            }
        }
    }
    // Area smaller than the icon: use it as it is.
    best.map(|(_, icon)| icon).unwrap_or_else(|| area.clone())
}

/// Size of Bungie's icons and watermarks.
const ICON_SIZE: u32 = 96;
/// Watermark pixels with at least this alpha are compared.
const WATERMARK_ALPHA: u8 = 40;

/// The icon as the game draws it: icon with the season watermark on top.
fn composite(icon: &image::RgbaImage, watermark: &image::RgbaImage) -> image::RgbaImage {
    use image::imageops::{overlay, resize, FilterType};
    let mut out = resize(icon, ICON_SIZE, ICON_SIZE, FilterType::Triangle);
    overlay(&mut out, &resize(watermark, ICON_SIZE, ICON_SIZE, FilterType::Triangle), 0, 0);
    out
}

/// Pixels where the watermarks differ: only there do the versions differ.
/// (Every watermark has the same grey strip down the left; counting it
/// drowned the small season symbol, and D.F.A.'s "Curse of Osiris" symbol
/// lost to another.) If they're alike everywhere: where any draws.
fn watermark_mask(watermarks: &[image::RgbaImage]) -> Vec<bool> {
    use image::imageops::{resize, FilterType};
    let resized: Vec<_> = watermarks
        .iter()
        .map(|w| resize(w, ICON_SIZE, ICON_SIZE, FilterType::Triangle))
        .collect();
    // A pixel's look: brightness times opacity.
    let look = |w: &image::RgbaImage, i: u32| {
        let p = w.get_pixel(i % ICON_SIZE, i / ICON_SIZE);
        (p[0] as f64 + p[1] as f64 + p[2] as f64) / 3.0 * p[3] as f64 / 255.0
    };
    let differ: Vec<bool> = (0..ICON_SIZE * ICON_SIZE)
        .map(|i| {
            let looks: Vec<f64> = resized.iter().map(|w| look(w, i)).collect();
            let (lo, hi) = looks.iter().fold((f64::MAX, f64::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
            hi - lo >= 40.0
        })
        .collect();
    if differ.iter().filter(|&&d| d).count() >= 20 {
        return differ;
    }
    (0..ICON_SIZE * ICON_SIZE)
        .map(|i| resized.iter().any(|w| w.get_pixel(i % ICON_SIZE, i / ICON_SIZE)[3] >= WATERMARK_ALPHA))
        .collect()
}

/// Mean colour difference between the captured icon and a template, over
/// the masked pixels. Tries small shifts and scales, since the captured box
/// is only roughly around the icon. Lower is better.
fn icon_distance(captured: &image::RgbaImage, template: &image::RgbaImage, mask: &[bool]) -> f64 {
    use image::imageops::{resize, FilterType};
    let masked = mask.iter().filter(|&&m| m).count().max(1);
    let mut best = f64::MAX;
    for scale in [0.9, 0.95, 1.0, 1.05, 1.1] {
        let size = (ICON_SIZE as f64 * scale).round() as u32;
        let cap = resize(captured, size, size, FilterType::Triangle);
        let offset = (size as i32 - ICON_SIZE as i32) / 2;
        for dy in -3..=3 {
            for dx in -3..=3 {
                let (mut sum, mut n) = (0u64, 0usize);
                for (i, _) in mask.iter().enumerate().filter(|(_, &m)| m) {
                    let (x, y) = ((i as u32 % ICON_SIZE) as i32, (i as u32 / ICON_SIZE) as i32);
                    let (cx, cy) = (x + offset + dx, y + offset + dy);
                    if cx < 0 || cy < 0 || cx >= size as i32 || cy >= size as i32 {
                        continue;
                    }
                    let a = cap.get_pixel(cx as u32, cy as u32);
                    let b = template.get_pixel(x as u32, y as u32);
                    sum += (0..3).map(|c| (a[c] as i32 - b[c] as i32).unsigned_abs() as u64).sum::<u64>();
                    n += 1;
                }
                if n * 2 >= masked {
                    best = best.min(sum as f64 / (n * 3) as f64);
                }
            }
        }
    }
    best
}

/* ---------- Search & detail commands ---------- */

#[tauri::command]
pub async fn weapons_search(app: AppHandle, query: String) -> Result<Vec<WeaponSummary>, String> {
    let db = db(&app).await?;
    let q = normalize(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits: Vec<(f64, usize)> = db
        .by_name
        .iter()
        .filter_map(|(name, i)| {
            let score = if name.starts_with(&q) {
                2.0
            } else if name.contains(&q) {
                1.5
            } else {
                strsim::jaro_winkler(&q, name)
            };
            (score >= 0.85).then_some((score, *i))
        })
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| db.index.weapons[a.1].name.cmp(&db.index.weapons[b.1].name)));
    Ok(hits.into_iter().take(20).map(|(_, i)| summary(&db, &db.index.weapons[i])).collect())
}

#[tauri::command]
pub async fn weapon_detail(app: AppHandle, hash: u32) -> Result<WeaponDetail, String> {
    let db = db(&app).await?;
    let weapon = db
        .index
        .weapons
        .iter()
        .find(|w| w.hash == hash)
        .ok_or(tr("Waffe nicht gefunden", "Weapon not found"))?;
    let owned = crate::inventory::owned_items(&app).await.unwrap_or_default();
    let mut d = detail(&db, weapon);
    d.copies = copies_of(&db, weapon, &owned);
    let mut rolled: Vec<u32> = d.copies.iter().flat_map(|c| c.perks.iter().copied()).collect();
    rolled.sort_unstable();
    rolled.dedup();
    d.rolled = rolled;
    Ok(d)
}

/// Pull a copy of a weapon out of the vault to the current character.
#[tauri::command]
pub async fn weapon_pull(app: AppHandle, instance_id: String, item_hash: u32) -> Result<String, String> {
    crate::inventory::pull_from_vault(&app, &instance_id, item_hash).await
}

/* ---------- Detection ---------- */

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectConfig {
    auto: bool,
    /// Where the weapon name is.
    region: Region,
    /// Where the weapon icon is (season watermark); optional.
    #[serde(default)]
    icon: Option<Region>,
}

impl Default for DetectConfig {
    fn default() -> Self {
        Self { auto: true, region: DEFAULT_REGION, icon: None }
    }
}

struct Detection {
    config: Option<DetectConfig>,
    /// Name (key) of the weapon currently shown in the overlay.
    shown: Option<String>,
    /// Closed with the hotkey: not shown again until it leaves the screen.
    dismissed: Option<String>,
    misses: u32,
}

static DETECTION: Mutex<Detection> =
    Mutex::new(Detection { config: None, shown: None, dismissed: None, misses: 0 });

/// The weapon or armor piece recognized last, kept after it left the
/// screen: the inspect page (inspect.rs) shows it.
static LAST_GEAR: Mutex<Option<Found>> = Mutex::new(None);
/// A guardian's character screen seen last (yours or a player's you
/// inspect): the name read above "Season N", and when.
static LAST_GUARDIAN: Mutex<Option<(String, std::time::Instant)>> = Mutex::new(None);
/// What was recognized last, "gear" or "guardian": the inspect page opens on it.
static LAST_KIND: Mutex<&'static str> = Mutex::new("");
/// Where the character screen has the name: the top left, with the
/// "Season N" line under it.
const GUARDIAN_REGION: Region = Region { x: 0.07, y: 0.012, w: 0.36, h: 0.105 };
/// The emblem left of the name (its square icon), to tell players of the
/// same name apart (see `fireteam::guardian_candidates`).
const EMBLEM_REGION: Region = Region { x: 0.072, y: 0.018, w: 0.045, h: 0.096 };
/// The emblem of the character screen seen last.
static LAST_EMBLEM: Mutex<Option<image::RgbaImage>> = Mutex::new(None);

/// The emblem of the character screen seen last (None: none seen).
pub(crate) fn last_emblem() -> Option<image::RgbaImage> {
    LAST_EMBLEM.lock().unwrap().clone()
}

/// Where a player's inspect screen shows their full Bungie name
/// ("Guardian#1234"), big, in the middle.
const CODE_REGION: Region = Region { x: 0.28, y: 0.72, w: 0.3, h: 0.11 };
/// The full name read there for the guardian on screen: (name, code).
static GUARDIAN_CODE: Mutex<Option<(String, u32)>> = Mutex::new(None);

/// The guardian `name`'s number, when their screen showed it ("#4106").
/// Radar's own reading of the guardian on screen, when it differs from the
/// engine's: (the name shown, the other reading).
static GUARDIAN_ALT: Mutex<Option<(String, Vec<(String, f32)>)>> = Mutex::new(None);

/// The top left when the last check found no character screen there.
static GUARDIAN_IDLE: Mutex<Option<Vec<u8>>> = Mutex::new(None);
/// Checks of it in a row not read.
static GUARDIAN_SKIPS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// The other readings of the name of guardian `name`, and how sure Radar's
/// reading was of each.
pub(crate) fn guardian_alt(name: &str) -> Vec<(String, f32)> {
    GUARDIAN_ALT.lock().unwrap().as_ref().filter(|(n, _)| n == name).map(|(_, alt)| alt.clone()).unwrap_or_default()
}

pub(crate) fn guardian_code(name: &str) -> Option<(String, u32)> {
    GUARDIAN_CODE
        .lock()
        .unwrap()
        .as_ref()
        .filter(|(n, _)| n.to_lowercase() == name.to_lowercase() || name_in(n, name))
        .map(|(n, c)| (n.clone(), *c))
}

/// "Name#1234" in what was read: the name and its number.
fn full_name(lines: &[screen::TextLine]) -> Option<(String, u32)> {
    // The name and its number read as one line, or as two side by side
    // ("Postmaster jr.", "#0773").
    let joined = lines.windows(2).filter(|p| p[1].text.trim_start().starts_with('#')).map(|p| format!("{}{}", p[0].text, p[1].text.trim()));
    lines.iter().map(|l| l.text.clone()).chain(joined).find_map(|text| {
        let (name, rest) = text.split_once('#')?;
        let digits: String = rest.chars().filter(|c| c.is_ascii_digit()).take(4).collect();
        let name = name_part(name)?;
        if digits.len() != 4 {
            return None;
        }
        Some((name, digits.parse().ok()?))
    })
}

/// A name of symbols only ("[...]").
fn symbols_only(name: &str) -> bool {
    !name.trim().is_empty() && !name.chars().any(|c| c.is_alphanumeric())
}

/// A name as read, with the symbols at its edges (a name of symbols only,
/// "[...]", too).
fn name_part(read: &str) -> Option<String> {
    let name = read.split_whitespace().collect::<Vec<_>>().join(" ");
    // Only specks around it left off (a dot of the banner, a quote): any
    // other symbol at its edges is part of names ("=|DBB|=KS901",
    // "Postmaster jr.", "[Salz] Salty Shaker", "Pandaris_").
    let kept = name.trim_matches(|c: char| c.is_whitespace() || "•·,:;'\"`".contains(c));
    (kept.chars().filter(|c| !c.is_whitespace()).count() >= 2).then(|| kept.to_string())
}

/// The same guardian again is noticed anew after this long.
const GUARDIAN_AGAIN: Duration = Duration::from_secs(60);

/// The name on a character screen: the big line right above the one
/// starting "Season <number>" ("Saison" in German and French, "Temporada",
/// "Stagione", "Sezon", "Сезон" in the game's other languages).
/// A character screen's "Season N" line (under the guardian's name).
fn season_line(lines: &[screen::TextLine]) -> Option<&screen::TextLine> {
    lines.iter().find(|l| {
        let n = normalize(&l.text);
        let mut words = n.split(' ');
        let read = matches!(words.next(), Some("SEASON" | "SAISON" | "TEMPORADA" | "STAGIONE" | "SEZON" | "СЕЗОН")) && words.next().is_some_and(|w| w.starts_with(|c: char| c.is_ascii_digit()));
        // Read garbled over the banner ("SeasonP8 • 11 550", "Seas C) n
        // 28"): its start and a number, short.
        let compact: String = l.text.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
        let garbled = ["seas", "sais", "temp", "stag", "sezo", "сезо"].iter().any(|p| compact.starts_with(p))
            && compact.chars().any(|c| c.is_ascii_digit())
            && compact.chars().count() <= 24;
        read || garbled
    })
}

/// The name above the "Season" line read with Radar's own reading (see
/// `nameocr`): for names the Windows engine can't read, in other scripts
/// or of look-alike characters ("★尺E卂卩E尺★").
fn own_read_name(shot: &image::RgbaImage, season: &screen::TextLine) -> Vec<(String, f32)> {
    // Sized by the screen (the "Season" line's height is read anywhere
    // from its letters to its icons): the name's height, from its line up.
    let h = shot.height() as f64 * NAME_HEIGHT;
    let x0 = (season.x - h * 0.4).max(0.0);
    let y0 = (season.y - h * 1.3).max(0.0);
    let y1 = (season.y - h * 0.05).min(shot.height() as f64);
    let x1 = shot.width() as f64;
    if y1 - y0 < 8.0 || x1 - x0 < 8.0 {
        return Vec::new();
    }
    let crop = image::imageops::crop_imm(shot, x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32).to_image();
    // The same name as at the last check (the banner as it was): its
    // readings again, the models not run (a tenth of a second each check).
    let banner = guardian_scene(&crop);
    if let Some((_, readings)) = OWN_READ.lock().unwrap().as_ref().filter(|(before, _)| scene_alike(before, &banner) && before.len() == banner.len()) {
        return readings.clone();
    }
    // For a look at it later: the part read last (own-read.png by the log).
    if let Some(path) = LOG_FILE.lock().unwrap().clone() {
        let _ = crop.save(path.with_file_name("own-read.png"));
    }
    // Each model's reading (other scripts, Cyrillic), the surest first.
    let mut out: Vec<(String, f32)> = Vec::new();
    for (text, sure) in crate::nameocr::read_line_all(&crop) {
        // Bits of the banner's art read after it ("（（").
        let trimmed = text.trim_end_matches(|c: char| c.is_whitespace() || "()（）[]【】|!.,:;'\"`~-".contains(c)).trim();
        let text = if trimmed.chars().count() >= 2 { trimmed.to_string() } else { text.trim().to_string() };
        log_once(format!("[guardian] own reading '{text}' ({sure:.2})"));
        if sure >= OWN_READ_SURE && text.chars().filter(|c| !c.is_whitespace()).count() >= 2 && !out.iter().any(|(t, _)| *t == text) {
            out.push((text, sure));
        }
    }
    *OWN_READ.lock().unwrap() = Some((banner, out.clone()));
    out
}

/// The name area Radar's own reading read last, and what it read there.
static OWN_READ: Mutex<Option<(Vec<u8>, Vec<(String, f32)>)>> = Mutex::new(None);

/// A guardian's name's height, in the banner's (`GUARDIAN_REGION`).
const NAME_HEIGHT: f64 = 0.34;
/// How sure Radar's own reading must be of a name: to be searched, and to
/// be the name shown.
const OWN_READ_SURE: f32 = 0.5;
const OWN_NAME_SURE: f32 = 0.8;

fn guardian_name(lines: &[screen::TextLine]) -> Option<String> {
    let season = season_line(lines)?;
    lines
        .iter()
        // Above it, bigger, starting near it (the emblem's edge can be read
        // as a letter in front: "A VincentNoir76").
        .filter(|l| l.y + l.h <= season.y + season.h * 0.4 && l.h >= season.h * 1.15 && (l.x - season.x).abs() < season.h * 8.0)
        .max_by(|a, b| a.y.total_cmp(&b.y))
        .map(|first| {
            // Pieces of it on the same row (the engine split it: "A9Co",
            // "Alm@nA3d3r"), left to right; close ones joined.
            let mut row: Vec<&screen::TextLine> = lines
                .iter()
                .filter(|l| l.x >= season.x - season.h * 2.0 && l.h >= season.h * 1.15 && l.y < first.y + first.h * 0.6 && l.y + l.h > first.y + first.h * 0.4)
                .collect();
            row.sort_by(|a, b| a.x.total_cmp(&b.x));
            let mut text = String::new();
            let mut end: Option<f64> = None;
            for l in row {
                if let Some(end) = end {
                    if l.x - end > first.h * 0.45 {
                        text.push(' ');
                    }
                }
                text.push_str(&l.text);
                end = Some(l.x + l.w);
            }
            let words: Vec<&str> = text.split_whitespace().collect();
            // A lone character in front of the name: the emblem, not it.
            let start = words.iter().position(|w| w.chars().filter(|c| c.is_alphanumeric()).count() > 1).unwrap_or(0);
            name_part(&words[start..].join(" "))
        })
        .flatten()
}

/// The guardian whose character screen is on screen now (the notice
/// stays while it is), and how many checks in a row missed it.
static GUARDIAN_ON_SCREEN: Mutex<(Option<String>, u32)> = Mutex::new((None, 0));
/// Checks without the name before the guardian counts as gone.
const GUARDIAN_MISSES: u32 = 2;

/// The guardian on screen changed: the overlay's notice shows them (their
/// full "Name#1234" once known) or goes.
fn guardian_on_screen(app: &AppHandle, name: Option<String>) {
    let changed = {
        let mut on = GUARDIAN_ON_SCREEN.lock().unwrap();
        on.1 = 0;
        let changed = on.0 != name;
        on.0 = name.clone();
        changed
    };
    if !changed {
        return;
    }
    if GUARDIAN_CODE.lock().unwrap().as_ref().is_some_and(|(n, _)| name.as_deref().is_none_or(|now| !name_in(n, now))) {
        *GUARDIAN_CODE.lock().unwrap() = None;
    }
    let _ = app.emit("guardian-present", name.clone());
    // Who it is (you, your fireteam, the full name on screen, or by
    // emblem): the notice with the "#1234" then.
    if let Some(name) = name {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // The full name in the middle of the screen is read a moment
            // after the name: give it that moment.
            tokio::time::sleep(Duration::from_millis(700)).await;
            let Ok(list) = crate::fireteam::resolve_guardian(&app, &name).await else { return };
            let Some(sure) = crate::fireteam::sure_guardian(&list) else { return };
            if GUARDIAN_ON_SCREEN.lock().unwrap().0.as_deref() == Some(name.as_str()) {
                let _ = app.emit("guardian-present", Some(sure.name().to_string()));
            }
        });
    }
}

/// A character screen on screen: its guardian noticed while it is there
/// (gone after a few checks without it); the inspect page shows them as
/// Fireteam's player view.
async fn guardian_check(app: &AppHandle) {
    type Read = (Vec<screen::TextLine>, image::RgbaImage, Vec<u8>, Option<(String, u32)>, Option<String>, Vec<(String, f32)>);
    let read = tauri::async_runtime::spawn_blocking(|| -> Result<Read, String> {
        let shot = screen::capture_primary_area(Some(GUARDIAN_REGION))?;
        // No character screen last time (no "Season" line), none shown, the
        // top left as it was: none now either; not read (every few checks
        // read anyway).
        let scene_now = guardian_scene(&shot);
        let idle = GUARDIAN_ON_SCREEN.lock().unwrap().0.is_none()
            && GUARDIAN_IDLE.lock().unwrap().as_ref().is_some_and(|before| scene_alike(before, &scene_now));
        if idle && GUARDIAN_SKIPS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < MAX_SKIPPED_READS {
            return Ok((Vec::new(), image::RgbaImage::new(1, 1), scene_now, None, None, Vec::new()));
        }
        GUARDIAN_SKIPS.store(0, std::sync::atomic::Ordering::Relaxed);
        // The name is white over a busy banner (faces, icons): only the
        // near-white, uncoloured pixels kept, black on white, read far
        // better; the plain picture as a second try.
        let mut lines = screen::ocr_text_lines(&white_text(&shot))?;
        let mut plain = None;
        if guardian_name(&lines).is_none() {
            let read = screen::ocr_text_lines(&shot)?;
            if guardian_name(&read).is_some() || lines.is_empty() {
                lines = read.clone();
            }
            plain = Some(read);
        }
        // A name the engine can't read (other scripts, look-alikes:
        // "★尺E卂卩E尺★"), the "Season" line under it: Radar's own reading.
        // A new guardian: Radar's own reading too, searched beside the
        // engine's (each reads some names better: "^9Co^1m@n^3d3r" is
        // "A9CoA1m@nA3d3r" to the engine, "9Co^1m@n^3d3r" to Radar's).
        let new_guardian = match (GUARDIAN_ON_SCREEN.lock().unwrap().0.as_deref(), guardian_name(&lines)) {
            (Some(on), Some(read)) => !name_in(on, &read) && !name_in(&read, on),
            _ => true,
        };
        let own_all = if guardian_name(&lines).is_none() || new_guardian {
            season_line(&lines).or_else(|| plain.as_deref().and_then(season_line)).map(|season| own_read_name(&shot, season)).unwrap_or_default()
        } else {
            Vec::new()
        };
        // As the name shown only when Radar's reading is sure of it ("cYaYlowbl"
        // for "=|DBB|=KS901" was 0.70); less sure, only searched beside.
        let own = own_all.first().filter(|(_, sure)| *sure >= OWN_NAME_SURE).map(|(text, _)| text.clone());
        let has_name = guardian_name(&lines).is_some() || own.is_some();
        // No character screen: the next check may skip reading (see above).
        let no_screen = season_line(&lines).is_none() && plain.as_deref().and_then(season_line).is_none();
        *GUARDIAN_IDLE.lock().unwrap() = no_screen.then(|| scene_now.clone());
        // Only worth a picture when there is a name.
        let emblem = if has_name {
            screen::capture_primary_area(Some(EMBLEM_REGION))?
        } else {
            image::RgbaImage::new(1, 1)
        };
        // Another player's screen shows their full name in the middle:
        // read once per guardian (it settles who it is at once).
        // (Tried on every check while a guardian is there and it isn't
        // known yet: it shows a moment after the name.)
        let guardian_there = has_name || GUARDIAN_ON_SCREEN.lock().unwrap().0.is_some();
        let code = if guardian_there && GUARDIAN_CODE.lock().unwrap().is_none() {
            let middle = screen::capture_primary_area(Some(CODE_REGION))?;
            let read = screen::ocr_text_lines(&middle)?;
            let code = full_name(&read);
            if code.is_none() {
                let texts: Vec<String> = read.iter().map(|l| format!("'{}'", l.text)).collect();
                log_once(format!("[guardian] no full name in the middle: {}", texts.join(", ")));
            }
            code
        } else {
            None
        };
        Ok((lines, emblem, guardian_scene(&shot), code, own, own_all))
    })
    .await;
    let Ok(Ok((lines, emblem, scene, code, own, own_all))) = read else { return };
    if let Some(code) = &code {
        log_once(format!("[guardian] full name '{}#{:04}'", code.0, code.1));
        *GUARDIAN_CODE.lock().unwrap() = Some(code.clone());
    }
    // The guardian shown already: their name in what was read is enough
    // (the "Season" line is often read garbled over the banner's icons:
    // "seåö!Ö28").
    let shown_name = GUARDIAN_ON_SCREEN.lock().unwrap().0.clone();
    let read_name = guardian_name(&lines).or(own.clone()).or_else(|| {
        let shown = shown_name?;
        lines.iter().any(|l| name_in(&l.text, &shown)).then_some(shown)
    });
    let Some(read_name) = read_name else {
        // No name read this time. The top left still as when it was read: a
        // misread (the guardian stays). Changed: gone after a few misses.
        // (Only shortly after the last read: a dark top left looks alike
        // in plenty of other screens.)
        let recent = LAST_GUARDIAN.lock().unwrap().as_ref().is_some_and(|(_, at)| at.elapsed() < GUARDIAN_GRACE);
        let same = recent && GUARDIAN_SCENE.lock().unwrap().as_ref().is_some_and(|seen| scene_alike(seen, &scene));
        let gone = {
            let mut on = GUARDIAN_ON_SCREEN.lock().unwrap();
            if same {
                on.1 = 0;
            } else {
                on.1 += 1;
            }
            if on.0.is_some() {
                let read: Vec<String> = lines.iter().map(|l| format!("'{}' {:.0}px", l.text, l.h)).collect();
                log_once(format!("[guardian] miss {} (same screen: {same}): {}", on.1, read.join(", ")));
            }
            on.0.is_some() && on.1 >= GUARDIAN_MISSES
        };
        if gone {
            *GUARDIAN_SCENE.lock().unwrap() = None;
            guardian_on_screen(app, None);
        }
        return;
    };
    // The full name in the middle, read with it: bigger and on a plain
    // ground, it wins over a name at the top that differs (a name of
    // symbols, "[...]", read there as "ca").
    let read_name = match &code {
        Some((middle, _)) if !name_in(middle, &read_name) && !name_in(&read_name, middle) => middle.clone(),
        _ => read_name,
    };
    // Still the same screen as at the last read.
    let same_screen = GUARDIAN_SCENE.lock().unwrap().as_ref().is_some_and(|seen| scene_alike(seen, &scene));
    *GUARDIAN_SCENE.lock().unwrap() = Some(scene);
    // Read a little differently than before ("GuardianO748"): the same one.
    let name = match GUARDIAN_ON_SCREEN.lock().unwrap().0.clone() {
        Some(on) if strsim::jaro_winkler(&on.to_lowercase(), &read_name.to_lowercase()) >= 0.88 => on,
        // A name of symbols the middle line named ("[...]"), the screen
        // unchanged and only a scrap read at the top ("ca"): still them.
        // (Any other name read: another guardian, at once.)
        Some(on) if same_screen && symbols_only(&on) && guardian_code(&on).is_some() && read_name.chars().filter(|c| c.is_alphanumeric()).count() <= 3 => on,
        _ => read_name,
    };
    *LAST_EMBLEM.lock().unwrap() = Some(emblem);
    // The other readings of a new guardian, for the search.
    let others: Vec<(String, f32)> = own_all.into_iter().filter(|(own, _)| *own != name).collect();
    if !others.is_empty() {
        *GUARDIAN_ALT.lock().unwrap() = Some((name.clone(), others));
    }
    guardian_on_screen(app, Some(name.clone()));
    let fresh = {
        let mut last = LAST_GUARDIAN.lock().unwrap();
        let fresh = last.as_ref().is_none_or(|(n, at)| *n != name || at.elapsed() > GUARDIAN_AGAIN);
        *last = Some((name.clone(), std::time::Instant::now()));
        fresh
    };
    *LAST_KIND.lock().unwrap() = "guardian";
    if fresh {
        log_once(format!("[guardian] '{name}'"));
    }
}

/// How long after the name was last read a check without it still counts
/// as a misread (when the screen looks alike).
const GUARDIAN_GRACE: Duration = Duration::from_millis(2500);

/// White text alone: near-white, uncoloured pixels black, the rest white.
fn white_text(shot: &image::RgbaImage) -> image::RgbaImage {
    image::RgbaImage::from_fn(shot.width(), shot.height(), |x, y| {
        let p = shot.get_pixel(x, y);
        let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);
        let (max, min) = (r.max(g).max(b), r.min(g).min(b));
        if max >= 150 && max - min <= 50 {
            image::Rgba([0, 0, 0, 255])
        } else {
            image::Rgba([255, 255, 255, 255])
        }
    })
}

/// Whether `text` (read off the screen) has `name` in it: five of its
/// letters in a row are enough ("ÆW7VineentNoir7" has "VincentNoir76").
fn name_in(text: &str, name: &str) -> bool {
    // Look-alikes as one (l, I and 1; O and 0): read either way.
    let plain = |s: &str| {
        s.to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .map(|c| match c {
                'l' | 'i' => '1',
                'o' => '0',
                c => c,
            })
            .collect::<Vec<char>>()
    };
    if plain(name).is_empty() {
        // Symbols only ("[...]"): as they are.
        return !name.trim().is_empty() && text.contains(name.trim());
    }
    let (text, name) = (plain(text), plain(name));
    if name.len() < 5 {
        return text.windows(name.len().max(1)).any(|w| w == name.as_slice());
    }
    let text: String = text.into_iter().collect();
    name.windows(5).any(|w| text.contains(&w.iter().collect::<String>()))
}

/// The top left of the screen when the guardian's name was read last.
static GUARDIAN_SCENE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// A tiny grey picture of the name's area, to tell "same screen, name
/// misread" from "screen left".
fn guardian_scene(shot: &image::RgbaImage) -> Vec<u8> {
    image::imageops::thumbnail(shot, 48, 12)
        .pixels()
        .map(|p| ((p[0] as u32 * 3 + p[1] as u32 * 6 + p[2] as u32) / 10) as u8)
        .collect()
}

fn scene_alike(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    let changed = a.iter().zip(b).filter(|(x, y)| x.abs_diff(**y) > SCENE_CELL_DIFF).count();
    (changed as f64 / a.len() as f64) < SCENE_CHANGED
}

/// The inspect page is open over the game: no screen reading meanwhile.
pub(crate) static PAUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static LAST_SHOT: Mutex<Option<image::RgbaImage>> = Mutex::new(None);

/// The last item identified (key, when, what): reused when the same name is
/// read again shortly after it went away, instead of identifying it anew.
type Found = (Option<WeaponDetail>, Option<crate::armor::ArmorDetail>);
static LAST_FOUND: Mutex<Option<(String, std::time::Instant, Found)>> = Mutex::new(None);
const REUSE_FOUND: Duration = Duration::from_secs(30);

/// A tiny grayscale picture of the whole screen: the latest check's, and
/// the one from the last check that read a name. A check without a name
/// whose screen still looks like the latter means something covers the
/// name (a hover tooltip), not that the inspect screen closed.
static SCENE_NOW: Mutex<Option<Vec<u8>>> = Mutex::new(None);
static SCENE_SIGHTED: Mutex<Option<Vec<u8>>> = Mutex::new(None);
const SCENE_SIZE: (u32, u32) = (64, 36);
/// A cell counts as changed past this brightness difference (0–255) …
const SCENE_CELL_DIFF: u8 = 24;
/// … and the screen as a different one past this share of changed cells
/// (a tooltip covers well under it; leaving the inspect screen far more).
const SCENE_CHANGED: f64 = 0.2;
/// The longest the shown item is kept while its name stays covered.
const COVERED_MAX: Duration = Duration::from_millis(1400);
/// Since when the shown item's name is covered (None: it was read).
static COVERED_SINCE: Mutex<Option<std::time::Instant>> = Mutex::new(None);

/// The left half only: on the armor inspect screen the right half is the
/// character, animated, which changed "the screen" while nothing else did.
fn scene(shot: &image::RgbaImage) -> Vec<u8> {
    let small = image::imageops::thumbnail(shot, SCENE_SIZE.0, SCENE_SIZE.1);
    small
        .enumerate_pixels()
        .filter(|(x, _, _)| *x < SCENE_SIZE.0 / 2)
        .map(|(_, _, p)| ((p[0] as u32 * 3 + p[1] as u32 * 6 + p[2] as u32) / 10) as u8)
        .collect()
}

/// The big lines of the latest check (normalized), and the name of what is
/// shown: a line reading only part of that name ("DARKHOLLOW" of
/// "DARKHOLLOW MASK", the rest misread) keeps it rather than counting as
/// a miss.
static BIG_LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Checks in a row not read (the screen unchanged, nothing on it); at most
/// this many, then one is read all the same.
static SKIPPED_READS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
const MAX_SKIPPED_READS: u32 = 4;
static SHOWN_NAME: Mutex<Option<String>> = Mutex::new(None);
/// Where the shown item's name ends (screen pixels, its bottom): perks and
/// mods are well below it (see `check_hover`).
static SHOWN_NAME_BOTTOM: Mutex<Option<f64>> = Mutex::new(None);

/// Whether a line just read is the start of the shown item's name.
fn part_of_shown() -> bool {
    let Some(shown) = SHOWN_NAME.lock().unwrap().clone() else { return false };
    BIG_LINES.lock().unwrap().iter().any(|line| {
        let n = line.chars().count();
        if n < 5 {
            return false;
        }
        let start: String = shown.chars().take(n).collect();
        strsim::jaro_winkler(line, &start) >= 0.93
    })
}

/// Whether the screen is still the one where the shown name was read
/// (only covered in places).
fn same_scene() -> bool {
    let (now, sighted) = (SCENE_NOW.lock().unwrap().clone(), SCENE_SIGHTED.lock().unwrap().clone());
    let (Some(now), Some(sighted)) = (now, sighted) else { return false };
    if now.len() != sighted.len() || now.is_empty() {
        return false;
    }
    let changed = now.iter().zip(&sighted).filter(|(a, b)| a.abs_diff(**b) > SCENE_CELL_DIFF).count();
    let share = changed as f64 / now.len() as f64;
    log_once(format!("[detect] name gone, screen changed {:.0}%", share * 100.0));
    share < SCENE_CHANGED
}

fn config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("weapon-detect.json")
}

fn config(app: &AppHandle) -> DetectConfig {
    let mut d = DETECTION.lock().unwrap();
    *d.config.get_or_insert_with(|| {
        std::fs::read_to_string(config_path(app))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    })
}

fn save_config(app: &AppHandle, config: DetectConfig) -> Result<(), String> {
    let path = config_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    DETECTION.lock().unwrap().config = Some(config);
    Ok(())
}

fn show(app: &AppHandle, key: Option<String>, weapon: Option<WeaponDetail>) {
    show_found(app, key, (weapon, None));
}

/// The overlay shows the inspected weapon or armor (or nothing).
fn show_found(app: &AppHandle, key: Option<String>, (weapon, armor): (Option<WeaponDetail>, Option<crate::armor::ArmorDetail>)) {
    if key.is_none() {
        *COVERED_SINCE.lock().unwrap() = None;
        *SHOWN_NAME.lock().unwrap() = None;
        set_hovered(app, None);
        set_armor_hovered(app, None);
    }
    DETECTION.lock().unwrap().shown = key;
    if weapon.is_some() || armor.is_some() {
        *LAST_GEAR.lock().unwrap() = Some((weapon.clone(), armor.clone()));
        *LAST_KIND.lock().unwrap() = "gear";
    }
    let _ = app.emit("weapon-detected", weapon);
    let _ = app.emit("armor-detected", armor);
}

/// What the inspect page shows first: the gear recognized last.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastGear {
    weapon: Option<WeaponDetail>,
    armor: Option<crate::armor::ArmorDetail>,
    /// The guardian of the character screen seen last (their name).
    guardian: Option<String>,
    /// The artifact seen last (its name).
    artifact: Option<String>,
    /// Which came last: "gear", "guardian", "artifact" or "" (nothing yet).
    latest: &'static str,
}

#[tauri::command]
pub fn inspect_last() -> LastGear {
    let (weapon, armor) = LAST_GEAR.lock().unwrap().clone().unwrap_or((None, None));
    let guardian = LAST_GUARDIAN.lock().unwrap().as_ref().map(|(n, _)| n.clone());
    let artifact = LAST_ARTIFACT.lock().unwrap().clone();
    LastGear { weapon, armor, guardian, artifact, latest: *LAST_KIND.lock().unwrap() }
}

/// An armor piece found by name: its first version (shown in the list),
/// and every version of the name (to look it up).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorHit {
    item: crate::fireteam::ItemInfo,
    hashes: Vec<u32>,
}

/// Armor by name, as weapons are searched: only exotics and set pieces
/// (the rest has nothing to show).
#[tauri::command]
pub async fn armor_search(app: AppHandle, query: String) -> Result<Vec<ArmorHit>, String> {
    let db = db(&app).await?;
    let q = normalize(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits: Vec<(f64, &(String, Vec<u32>))> = db
        .armor
        .iter()
        .filter_map(|entry| {
            let name = &entry.0;
            let score = if name.starts_with(&q) {
                2.0
            } else if name.contains(&q) {
                1.5
            } else {
                strsim::jaro_winkler(&q, name)
            };
            (score >= 0.85).then_some((score, entry))
        })
        .collect();
    hits.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1 .0.cmp(&b.1 .0)));
    let mut out = Vec::new();
    for (_, (_, hashes)) in hits.into_iter().take(40) {
        // Any version an exotic or a set piece (a name's versions come in
        // no fixed order; some are bare reissues): that one is listed.
        for &h in hashes {
            if let Some(info) = crate::fireteam::item(&app, h as u64).await {
                if info.exotic || info.set_hash().is_some() {
                    out.push(ArmorHit { item: info, hashes: hashes.clone() });
                    break;
                }
            }
        }
        if out.len() >= 20 {
            break;
        }
    }
    Ok(out)
}

/// An armor piece found by search: its perks and set, as when inspected.
#[tauri::command]
pub async fn armor_detail(app: AppHandle, hashes: Vec<u32>) -> Result<Option<crate::armor::ArmorDetail>, String> {
    Ok(crate::armor::identify_or_plain(&app, &hashes).await)
}

/// A weapon name read in the configured region of the screen, together
/// with the screenshot (for version detection).
struct Sighting {
    db: Arc<WeaponDb>,
    key: String,
    shot: image::RgbaImage,
    /// Where the name was read, in screenshot pixels.
    name: screen::TextLine,
    /// An armor piece instead of a weapon (the items with its name).
    armor: Option<Vec<u32>>,
    /// The name it matched (normalized), see `part_of_shown`.
    matched: String,
}

/// The weapon name in `region` of `shot`, with its box in `shot`'s pixels.
/// Print a line unless it is the same as the last one (checks run often).
fn log_once(line: String) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let mut last = LAST.lock().unwrap();
    if *last != line {
        println!("{line}");
        log_to_file(&line);
        *last = line;
    }
}

/// detect.log in the app's cache folder: what the screen reading saw (to
/// tell why an item wasn't recognized). Started over past 1 MB.
static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

pub(crate) fn log_to_file(line: &str) {
    use std::io::Write;
    let Some(path) = LOG_FILE.lock().unwrap().clone() else { return };
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > 1_000_000) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {line}", chrono::Local::now().format("%H:%M:%S"));
    }
}

/// The name region when nothing big was read in it, saved (at most every
/// 5 s) as unread-name.png next to detect.log: what the reading missed.
fn save_unread(crop: &image::RgbaImage) {
    static LAST: Mutex<Option<std::time::Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(5)) {
            return;
        }
        *last = Some(std::time::Instant::now());
    }
    let Some(path) = LOG_FILE.lock().unwrap().clone() else { return };
    let _ = crop.save(path.with_file_name("unread-name.png"));
}

/// What a name on the inspect screen is.
enum Named {
    Weapon(usize),
    /// Every armor item with the name.
    Armor(Vec<u32>),
}

/// The weapon or armor name in `region` of `shot` (one text reading for
/// both), with its box in `shot`'s pixels. Only names written as big as on
/// the inspect screen count (not a hover tooltip showing the same item).
/// With the winner, the other kind's match when both a weapon and an armor
/// name fit (the icon then decides, see `icon_decides`).
type Read = (Named, screen::TextLine, Vec<Named>);

fn read_any(db: &WeaponDb, shot: &image::RgbaImage, region: Region) -> Result<Option<Read>, String> {
    let min_height = shot.height() as f64 * INSPECT_NAME_HEIGHT;
    let crop = screen::crop(shot, region);
    let mut lines = screen::ocr_text_lines(&crop)?;
    let mut big: Vec<screen::TextLine> = lines.iter().filter(|l| l.h >= min_height).cloned().collect();
    // No big line: maybe a short name the engine misses when enlarged
    // ("D.F.A."); read once more as it is.
    if big.is_empty() {
        let plain = screen::ocr_text_lines_at(&crop, 1.0)?;
        let plain_big: Vec<screen::TextLine> = plain.iter().filter(|l| l.h >= min_height).cloned().collect();
        if !plain_big.is_empty() {
            lines = plain;
            big = plain_big;
        } else {
            save_unread(&crop);
        }
    }
    // A big line that is no name: maybe a long one running past the drawn
    // region ("PROMISED REIGN GRIPS" read as "PROMISED", the cut-off word
    // dropped). Read again out to the screen's right edge. Only then: read
    // that wide every time, a short name next to the weapon's 3D model
    // ("ROSE") often wasn't found at all.
    let unknown = !big.is_empty() && best_scored(&db.by_name, &big).is_none() && best_scored(&db.armor, &big).is_none();
    if unknown && region.x + region.w < 0.99 {
        let wide = Region { w: 1.0 - region.x, ..region };
        lines = screen::ocr_text_lines(&screen::crop(shot, wide))?;
        big = lines.iter().filter(|l| l.h >= min_height).cloned().collect();
    }
    let (ox, oy) = screen::crop_origin(shot, region);
    *BIG_LINES.lock().unwrap() = big.iter().map(|l| normalize(&l.text)).collect();
    // Both kinds, the closer name wins ("FELWINTER'S HELM" is near enough
    // to the weapon "Felwinter's Lie", but nearer to the helmet).
    let weapon = best_scored(&db.by_name, &big);
    let armor = best_scored(&db.armor, &big);
    let armor_wins = match (&weapon, &armor) {
        (Some((_, _, w)), Some((_, _, a))) => a > w,
        (None, Some(_)) => true,
        _ => false,
    };
    // The other kind only competes when its name fits about as well
    // ("DREAMBANE ROE" is the Robes, not the fusion rifle "Dream Breaker").
    let (w_score, a_score) = (weapon.as_ref().map_or(0.0, |w| w.2), armor.as_ref().map_or(0.0, |a| a.2));
    let close = (w_score - a_score).abs() < RIVAL_GAP;
    let weapon_rival = weapon.as_ref().filter(|_| close).map(|(i, _, _)| Named::Weapon(**i));
    let armor_rival = armor.as_ref().filter(|_| close).map(|(h, _, _)| Named::Armor((*h).clone()));
    let found = if armor_wins {
        armor.map(|(hashes, line, score)| {
            log_once(format!("[armor] name '{}' {:.0} px ({score:.2})", line.text, line.h));
            (Named::Armor(hashes.clone()), line, weapon_rival.into_iter().collect())
        })
    } else {
        weapon.map(|(i, line, score)| {
            log_once(format!("[weapon] name '{}' {:.0} px (screen {} px, {score:.2})", line.text, line.h, shot.height()));
            (Named::Weapon(*i), line, armor_rival.into_iter().collect())
        })
    };
    // A name only partly read that starts several names ("PROMISED REIGN"
    // of the Grips, the Helm, …): all of them, for the icon to decide.
    let found = found.or_else(|| {
        big.iter().find_map(|line| {
            let text = normalize(&line.text);
            if text.chars().count() < 6 {
                return None;
            }
            let starts = |name: &str| name.starts_with(&text) && name.len() > text.len();
            let mut cands: Vec<Named> = db.by_name.iter().filter(|(n, _)| starts(n)).map(|(_, i)| Named::Weapon(*i)).collect();
            cands.extend(db.armor.iter().filter(|(n, _)| starts(n)).map(|(_, h)| Named::Armor(h.clone())));
            if !(2..=12).contains(&cands.len()) {
                return None;
            }
            log_once(format!("[detect] '{}' starts {} names: the icon decides", line.text, cands.len()));
            let first = cands.remove(0);
            Some((first, line.clone(), cands))
        })
    });
    if found.is_none() && !big.is_empty() {
        let texts: Vec<String> = big.iter().map(|l| format!("'{}' {:.0}px", l.text, l.h)).collect();
        log_once(format!("[detect] no name in big lines: {}", texts.join(", ")));
    }
    if big.is_empty() {
        // To see a name the reading missed (e.g. "D.F.A."): the lines it
        // did find, if any look like headings.
        let texts: Vec<String> = lines.iter().filter(|l| l.h >= 24.0 * shot.height() as f64 / 1080.0).map(|l| format!("'{}' {:.0}px", l.text, l.h)).collect();
        if !texts.is_empty() {
            log_once(format!("[detect] no big line; read: {}", texts.join(", ")));
        }
    }
    if found.is_none() {
        // Tuning aid: a weapon name in small print (a tooltip) is skipped.
        if let Some((_, line)) = match_lines(db, &lines) {
            log_once(format!("[weapon] skipped small name '{}' ({:.0} px < {min_height:.0})", line.text, line.h));
        }
    }
    // No item: maybe an artifact's screen (its name as big).
    *ARTIFACT_SEEN.lock().unwrap() = if found.is_none() { best_scored(&ARTIFACT_NAMES, &big).map(|(name, _, _)| name.clone()) } else { None };
    Ok(found.map(|(named, mut line, rival)| {
        line.x += ox as f64;
        line.y += oy as f64;
        (named, line, rival)
    }))
}

/* ---------- The artifact screen ---------- */

/// Every artifact's name (normalized), with its name as the sheet has it.
static ARTIFACT_NAMES: std::sync::LazyLock<Vec<(String, String)>> = std::sync::LazyLock::new(|| {
    crate::compendium::artifacts().iter().map(|a| (normalize(&a.name), a.name.clone())).collect()
});

/// The artifact whose name the last check read (none: none read).
static ARTIFACT_SEEN: Mutex<Option<String>> = Mutex::new(None);
/// The artifact on screen, and checks since its name was last read.
static ARTIFACT_ON_SCREEN: Mutex<(Option<String>, u32)> = Mutex::new((None, 0));
/// The artifact seen last (the inspect page shows it).
static LAST_ARTIFACT: Mutex<Option<String>> = Mutex::new(None);
/// Checks without its name before the artifact counts as gone.
const ARTIFACT_MISSES: u32 = 2;

/// After a check: the artifact screen came, stayed or went (the overlay's
/// notice shows its name while it is there).
fn artifact_check(app: &AppHandle, seen: Option<String>) {
    let now = {
        let mut on = ARTIFACT_ON_SCREEN.lock().unwrap();
        match seen {
            Some(name) => {
                on.1 = 0;
                if on.0.as_ref() == Some(&name) {
                    return;
                }
                log_once(format!("[artifact] {name}"));
                *LAST_ARTIFACT.lock().unwrap() = Some(name.clone());
                *LAST_KIND.lock().unwrap() = "artifact";
                on.0 = Some(name);
            }
            None if on.0.is_some() => {
                on.1 += 1;
                if on.1 < ARTIFACT_MISSES {
                    return;
                }
                on.0 = None;
            }
            None => return,
        }
        on.0.clone()
    };
    let _ = app.emit("artifact-present", now);
}

/// An artifact's perks as the inspect page shows them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactView {
    name: String,
    season: String,
    /// What it works best with (elements, then weapons).
    elements: Vec<String>,
    weapons: Vec<String>,
    icon: Option<String>,
    /// Per tier (one, two, three diamonds): its perks.
    tiers: Vec<Vec<ArtifactPerkView>>,
    /// Every artifact's name (to look at another).
    all: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactPerkView {
    name: String,
    /// What it does, with the numbers (Destiny Data Compendium, English).
    text: String,
    icon: Option<String>,
}

/// An artifact's perks with exact numbers (by its name; none: the one seen
/// last, else the first listed).
#[tauri::command]
pub async fn artifact_detail(app: AppHandle, name: Option<String>) -> Result<Option<ArtifactView>, String> {
    let all = crate::compendium::artifacts();
    let wanted = name.or_else(|| LAST_ARTIFACT.lock().unwrap().clone());
    let Some(artifact) = wanted.and_then(|w| all.iter().find(|a| a.name == w)).or(all.first()) else { return Ok(None) };
    // Icons from the manifest, by name (English names: other languages
    // name them differently, then none).
    let db = db(&app).await.ok();
    let icon = |name: &str| db.as_ref().and_then(|db| db.index.artifacts.get(&normalize(name))).and_then(|(_, icon)| icon.clone());
    let split = |s: &str| s.split('|').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect::<Vec<_>>();
    let (elements, weapons) = match artifact.focus.split_once('⯁') {
        Some((e, w)) => (split(e), split(w)),
        None => (Vec::new(), Vec::new()),
    };
    Ok(Some(ArtifactView {
        name: artifact.name.clone(),
        season: artifact.season.clone(),
        elements,
        weapons,
        icon: icon(&artifact.name),
        tiers: artifact
            .tiers
            .iter()
            .map(|tier| tier.iter().map(|p| ArtifactPerkView { name: p.name.clone(), text: p.text.clone(), icon: icon(&p.name) }).collect())
            .collect(),
        all: all.iter().map(|a| a.name.clone()).collect(),
    }))
}

/// The weapon name in `region` of `shot` (see `read_any`).
fn read_name(db: &WeaponDb, shot: &image::RgbaImage, region: Region) -> Result<Option<(usize, screen::TextLine)>, String> {
    Ok(read_any(db, shot, region)?.and_then(|(named, line, _)| match named {
        Named::Weapon(i) => Some((i, line)),
        Named::Armor(_) => None,
    }))
}

/// Detection cost, summed and written to detect.log every 30 checks (to
/// tell what a check costs on the player's PC): capture, scene, text.
static TIMING: Mutex<(u32, [Duration; 3])> = Mutex::new((0, [Duration::ZERO; 3]));

fn note_timing(capture: Duration, scene: Duration, text: Duration, (w, h): (u32, u32)) {
    let mut t = TIMING.lock().unwrap();
    t.0 += 1;
    t.1[0] += capture;
    t.1[1] += scene;
    t.1[2] += text;
    if t.0 >= 30 {
        let avg = |d: Duration| d.as_secs_f64() * 1000.0 / t.0 as f64;
        log_to_file(&format!(
            "[timing] {w}x{h} avg per check: capture {:.1} ms, scene {:.1} ms, text {:.1} ms",
            avg(t.1[0]),
            avg(t.1[1]),
            avg(t.1[2])
        ));
        *t = (0, [Duration::ZERO; 3]);
    }
}

/// What a check takes from the screen: the name's region out to the right
/// edge (long names) and down a good way (so `same_scene` still sees a
/// tooltip covering the name as a small change), and the icon's box.
fn watch_area(name: Region, icon: Option<Region>) -> Region {
    let (mut x0, mut y0) = (name.x, name.y);
    let (mut x1, mut y1) = (1.0f64, (name.y + name.h.max(0.45)).min(1.0));
    if let Some(i) = icon {
        x0 = x0.min(i.x);
        y0 = y0.min(i.y);
        x1 = x1.max(i.x + i.w);
        y1 = y1.max(i.y + i.h);
    }
    let (x0, y0) = (x0.clamp(0.0, 1.0), y0.clamp(0.0, 1.0));
    Region { x: x0, y: y0, w: (x1.min(1.0) - x0).max(0.01), h: (y1.min(1.0) - y0).max(0.01) }
}

async fn read_screen(app: &AppHandle) -> Result<Option<Sighting>, String> {
    let db = db(app).await?;
    let region = config(app).region;
    let icon = config(app).icon;
    screen::set_read_region(region);
    let found = {
        let db = db.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let t0 = std::time::Instant::now();
            let shot = screen::capture_primary_area(Some(watch_area(region, icon)))?;
            let t1 = std::time::Instant::now();
            let now = scene(&shot);
            // Nothing big to read last time and the screen as it was: nothing
            // now either; the reading saved (every few checks read anyway).
            let unchanged = BIG_LINES.lock().unwrap().is_empty()
                && SCENE_NOW.lock().unwrap().as_ref().is_some_and(|before| scene_alike(before, &now));
            *SCENE_NOW.lock().unwrap() = Some(now);
            if unchanged && SKIPPED_READS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < MAX_SKIPPED_READS {
                return Ok(None);
            }
            SKIPPED_READS.store(0, std::sync::atomic::Ordering::Relaxed);
            let t2 = std::time::Instant::now();
            let found = read_any(&db, &shot, region)?;
            note_timing(t1 - t0, t2 - t1, t2.elapsed(), (shot.width(), shot.height()));
            Ok(found.map(|(named, name, rival)| (shot, named, name, rival)))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let Some((shot, named, name, rival)) = found else { return Ok(None) };
    let mut named = named;
    // Several fit the name (a weapon and an armor piece: "FELWINTER'S HELM"
    // / "Felwinter's Lie"; or a name read only in part): the one whose icon
    // is on screen.
    if !rival.is_empty() {
        let mut all = vec![named];
        all.extend(rival);
        let pick = icon_picks(app, &db, &shot, &name, &all).await;
        named = all.swap_remove(pick);
    }
    let (weapon, armor) = match named {
        Named::Weapon(i) => (Some(i), None),
        Named::Armor(hashes) => (None, Some(hashes)),
    };
    let key = match weapon {
        Some(i) => name_key(&db, i),
        // By the matched name's items, not the OCR text (which can
        // differ by a letter between checks: a "new" piece each time).
        None => named_key(&db, &Named::Armor(armor.clone().unwrap_or_default())),
    };
    let matched = match (weapon, &armor) {
        (Some(i), _) => normalize(&db.index.weapons[i].name),
        (None, Some(hashes)) => db.armor.iter().find(|(_, h)| h == hashes).map(|(n, _)| n.clone()).unwrap_or_default(),
        (None, None) => String::new(),
    };
    Ok(Some(Sighting { key, db, shot, name, armor, matched }))
}

/// The key a name is shown under (see `Detection::shown`).
fn named_key(db: &WeaponDb, named: &Named) -> String {
    match named {
        Named::Weapon(i) => name_key(db, *i),
        Named::Armor(hashes) => format!("ARMOR {:?}", hashes.iter().min()),
    }
}

/// Decisions of `icon_picks` (the candidates' keys -> which one).
static ICON_DECISIONS: Mutex<Option<HashMap<String, usize>>> = Mutex::new(None);

/// Which of `candidates` (by name: weapons, armor) is the item on screen:
/// the one whose icon is closest to the icon box (drawn in the settings,
/// or next to the name). Remembered per set of candidates, so it runs once,
/// not every check. The first when the icons can't be had.
async fn icon_picks(
    app: &AppHandle,
    db: &WeaponDb,
    shot: &image::RgbaImage,
    name: &screen::TextLine,
    candidates: &[Named],
) -> usize {
    let key = candidates.iter().map(|c| named_key(db, c)).collect::<Vec<_>>().join("|");
    if let Some(&pick) = ICON_DECISIONS.lock().unwrap().get_or_insert_default().get(&key) {
        return pick;
    }
    let look = |named: &Named| -> Option<(String, Option<String>)> {
        match named {
            Named::Weapon(i) => {
                let w = &db.index.weapons[*i];
                Some((w.icon.clone()?, w.watermark.clone()))
            }
            Named::Armor(hashes) => {
                let g = hashes.iter().find_map(|h| db.index.gear.get(h))?;
                Some((g.icon.clone()?, g.watermark.clone()))
            }
        }
    };
    let http = app.state::<BungieState>().http.clone();
    let mut templates = Vec::new();
    for c in candidates {
        let Some((icon, mark)) = look(c) else { return 0 };
        let Some(icon) = bungie_image(&http, &icon).await else { return 0 };
        let mark = match &mark {
            Some(mark) => bungie_image(&http, mark).await.map(|m| (*m).clone()),
            None => None,
        };
        templates.push(composite(&icon, &mark.unwrap_or_else(|| image::RgbaImage::new(1, 1))));
    }
    let area = match config(app).icon {
        Some(region) => {
            let area = screen::crop(shot, region);
            let size = area.width().min(area.height()) as f64;
            Some((area, size))
        }
        None => {
            let icon = icon_box_from_name(name, shot.height() as f64);
            crop_box(shot, icon, ICON_PAD).map(|area| (area, icon.2))
        }
    };
    let Some((area, size)) = area else { return 0 };
    let distances = tauri::async_runtime::spawn_blocking(move || {
        // The whole icon counts (not only where watermarks differ).
        let mask = vec![true; (ICON_SIZE * ICON_SIZE) as usize];
        templates
            .iter()
            .map(|t| icon_distance(&locate_icon(&area, t, size), t, &mask))
            .collect::<Vec<f64>>()
    })
    .await
    .unwrap_or_default();
    let best = distances.iter().enumerate().min_by(|a, b| a.1.total_cmp(b.1));
    // Another than the best-read name only with an icon clearly closer
    // (52.0 against 52.2 is a coin toss: the name decides then).
    let pick = match (best, distances.first()) {
        (Some((i, &d)), Some(&first)) if i != 0 && d < first * ICON_CLEARLY_CLOSER => i,
        _ => 0,
    };
    log_once(format!(
        "[detect] icon picks {} of {key}: {}",
        pick,
        distances.iter().map(|d| format!("{d:.1}")).collect::<Vec<_>>().join(" | ")
    ));
    let mut decisions = ICON_DECISIONS.lock().unwrap();
    let decisions = decisions.get_or_insert_default();
    if decisions.len() >= 500 {
        decisions.clear();
    }
    decisions.insert(key, pick);
    pick
}

/// What a sighting is: the weapon's detail, or the armor's.
async fn identify_any(app: &AppHandle, sighting: Sighting) -> (Option<WeaponDetail>, Option<crate::armor::ArmorDetail>) {
    match sighting.armor {
        Some(hashes) => {
            let armor = crate::armor::identify(app, &hashes).await;
            log_once(match &armor {
                Some(a) => format!("[armor] {:?}: {}", hashes, a.summary()),
                None => format!("[armor] {:?}: not exotic or set armor", hashes),
            });
            (None, armor)
        }
        None => (identify_sighting(app, sighting).await, None),
    }
}

/// Pictures of the icon read for the season, and how far apart.
const SEASON_SHOTS: usize = 3;
const SEASON_SHOT_GAP: Duration = Duration::from_millis(120);

/// How much closer the best season must be than the next one (summed
/// over the pictures) to count; otherwise the player's copy decides.
const SEASON_MARGIN: f64 = 1.06;

/// The season watermark from a few pictures of the icon (the first, taken
/// with the sighting, may still be fading in): each season's distance is
/// summed over all pictures. A season counts only when clearly closest;
/// otherwise none (better than a wrong one: then the copy you own decides).
async fn season_by_vote(
    app: &AppHandle,
    db: &WeaponDb,
    versions: &[usize],
    first: Option<(image::RgbaImage, f64)>,
    icon_of: &(dyn Fn(&image::RgbaImage) -> Option<(image::RgbaImage, f64)> + Sync),
) -> Option<String> {
    let mut totals: Vec<(String, f64)> = Vec::new();
    let mut icon = first;
    for shot in 0..SEASON_SHOTS {
        if shot > 0 {
            tokio::time::sleep(SEASON_SHOT_GAP).await;
            let fresh = tauri::async_runtime::spawn_blocking(screen::capture_primary).await.ok()?.ok()?;
            icon = icon_of(&fresh);
        }
        let Some((area, size)) = &icon else { continue };
        let Some(scores) = watermark_scores(app, db, versions, area, *size).await else { continue };
        for (mark, distance) in scores {
            match totals.iter_mut().find(|(m, _)| *m == mark) {
                Some((_, total)) => *total += distance,
                None => totals.push((mark, distance)),
            }
        }
    }
    totals.sort_by(|a, b| a.1.total_cmp(&b.1));
    let (best, second) = (totals.first()?, totals.get(1)?);
    let sure = second.1 > best.1 * SEASON_MARGIN;
    let short = |look: &str| {
        let (icon, mark) = look.split_once('|').unwrap_or(("", look));
        let id = |p: &str| p.rsplit('/').next().unwrap_or(p).chars().take(6).collect::<String>();
        format!("{}+{}", id(icon), id(mark))
    };
    log_once(format!(
        "[weapon] season {}: {}",
        if sure { "sure" } else { "unsure" },
        totals.iter().map(|(m, d)| format!("{} {d:.1}", short(m))).collect::<Vec<_>>().join(" | ")
    ));
    sure.then(|| best.0.clone())
}

/// Detail for a sighting: reads the whole screen once to find the version
/// and the rolled perks.
async fn identify_sighting(app: &AppHandle, sighting: Sighting) -> Option<WeaponDetail> {
    let Sighting { db, key, shot, name, .. } = sighting;
    // The checks only take part of the screen (see `watch_area`); for the
    // perks and the season the whole of it, once per item.
    let shot = tauri::async_runtime::spawn_blocking(screen::capture_primary)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(shot);
    let icon_region = config(app).icon;
    // A drawn icon box wins; otherwise the icon is found next to the name.
    let icon_of = move |shot: &image::RgbaImage| match icon_region {
        Some(region) => {
            let area = screen::crop(shot, region);
            let size = area.width().min(area.height()) as f64;
            Some((area, size))
        }
        None => {
            let icon = icon_box_from_name(&name, shot.height() as f64);
            crop_box(shot, icon, ICON_PAD).map(|area| (area, icon.2))
        }
    };
    let icon = icon_of(&shot);
    // Season watermark, the player's copies and the perks on screen: at the
    // same time, not one after the other.
    // The name read may be cut off (an overlay widget covering its end is
    // blacked out for reading): "CORRECTIVE MEASURE" could be "… (TIMELOST)".
    // Then the icon decides between all weapons whose name starts the same.
    let siblings: Vec<String> = db
        .versions
        .keys()
        .filter(|k| **k == key || k.starts_with(&format!("{key} ")) || key.starts_with(&format!("{k} ")))
        .cloned()
        .collect();
    let candidates: Vec<usize> = siblings.iter().flat_map(|k| db.versions.get(k).cloned().unwrap_or_default()).collect();
    if siblings.len() > 1 {
        println!("[weapon] name may be cut off: {siblings:?}");
    }
    let (look, owned, lines) = futures::join!(
        async {
            let t = std::time::Instant::now();
            let w = season_by_vote(app, &db, &candidates, icon, &icon_of).await;
            println!("[weapon]   watermark {} ms", t.elapsed().as_millis());
            w
        },
        async {
            let t = std::time::Instant::now();
            let o = crate::inventory::owned_items_quick(app).await;
            println!("[weapon]   inventory {} ms", t.elapsed().as_millis());
            o
        },
        async {
            let t = std::time::Instant::now();
            let l = tauri::async_runtime::spawn_blocking(move || screen::ocr_lines(&shot).unwrap_or_default())
                .await
                .unwrap_or_default();
            println!("[weapon]   screen text {} ms", t.elapsed().as_millis());
            l
        },
    );
    // Which weapon (of several with the same start) and season the icon
    // showed; unsure between weapons: the one the player owns, if just one.
    let version_of_look = |look: &str| {
        let (icon, mark) = look.split_once('|')?;
        candidates.iter().copied().find(|&i| {
            let w = &db.index.weapons[i];
            w.icon.as_deref() == Some(icon) && w.watermark.as_deref() == Some(mark)
        })
    };
    let picked = look.as_deref().and_then(version_of_look);
    let key = match picked {
        Some(i) => name_key(&db, i),
        None if siblings.len() > 1 => {
            let owned_keys: Vec<&String> = siblings
                .iter()
                .filter(|k| {
                    db.versions.get(*k).into_iter().flatten().any(|&i| {
                        owned.as_deref().unwrap_or_default().iter().any(|o| o.item_hash == db.index.weapons[i].hash)
                    })
                })
                .collect();
            if owned_keys.len() == 1 { owned_keys[0].clone() } else { key }
        }
        None => key,
    };
    let watermark = picked.and_then(|i| db.index.weapons[i].watermark.clone());
    let mut d = identify(&db, &key, &lines, watermark.as_deref(), owned.as_deref().unwrap_or_default())?;
    let seasons = {
        let mut marks: Vec<&Option<String>> = d.versions.iter().map(|v| &v.watermark).collect();
        marks.dedup();
        marks.len()
    };
    d.season_needs_setup = seasons > 1 && watermark.is_none() && owned.is_none();
    Some(d)
}

/// One automatic check: show a newly inspected weapon, hide it once gone.
async fn detect_tick(app: &AppHandle) {
    let started = std::time::Instant::now();
    let Ok(found) = read_screen(app).await else { return };
    let artifact = ARTIFACT_SEEN.lock().unwrap().take();
    artifact_check(app, artifact);
    static TICKS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let tick = TICKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // No item on screen (and none shown): every other check, a look for a
    // character screen's guardian.
    // (Every check while one is on screen: leaving it shows at once.)
    let guardian_shown = GUARDIAN_ON_SCREEN.lock().unwrap().0.is_some();
    if found.is_none() && DETECTION.lock().unwrap().shown.is_none() && (guardian_shown || tick.is_multiple_of(2)) {
        guardian_check(app).await;
    }
    if tick.is_multiple_of(50) {
        println!("[weapon] screen check {} ms", started.elapsed().as_millis());
    }
    let (shown, dismissed) = {
        let d = DETECTION.lock().unwrap();
        (d.shown.clone(), d.dismissed.clone())
    };
    match found {
        Some(sighting) => {
            DETECTION.lock().unwrap().misses = 0;
            *SCENE_SIGHTED.lock().unwrap() = SCENE_NOW.lock().unwrap().clone();
            *COVERED_SINCE.lock().unwrap() = None;
            *SHOWN_NAME.lock().unwrap() = Some(sighting.matched.clone());
            *SHOWN_NAME_BOTTOM.lock().unwrap() = Some(sighting.name.y + sighting.name.h);
            let key = sighting.key.clone();
            if shown.as_ref() != Some(&key) && dismissed.as_ref() != Some(&key) {
                // Seen again right after it went away (a covered name, a
                // fade): the result from before, at once.
                let recent = LAST_FOUND
                    .lock()
                    .unwrap()
                    .as_ref()
                    .filter(|(k, at, _)| *k == key && at.elapsed() < REUSE_FOUND)
                    .map(|(_, _, found)| found.clone());
                let found = match recent {
                    Some(found) => found,
                    None => {
                        let started = std::time::Instant::now();
                        let found = identify_any(app, sighting).await;
                        println!("[weapon] identified in {} ms", started.elapsed().as_millis());
                        found
                    }
                };
                *LAST_FOUND.lock().unwrap() = Some((key.clone(), std::time::Instant::now(), found.clone()));
                show_found(app, Some(key), found);
            }
        }
        // Shown, and part of its name read (the rest misread or covered):
        // still the same item.
        None if shown.is_some() && part_of_shown() => {
            DETECTION.lock().unwrap().misses = 0;
            *COVERED_SINCE.lock().unwrap() = None;
            log_once("[detect] part of the shown name read: kept".into());
        }
        // Shown, and the name only covered (hovering a perk or mod): keep it.
        None if shown.is_some()
            && same_scene()
            && COVERED_SINCE.lock().unwrap().get_or_insert_with(std::time::Instant::now).elapsed() < COVERED_MAX =>
        {
            log_once("[weapon] name covered, screen unchanged: kept".into());
        }
        None => {
            let misses = {
                let mut d = DETECTION.lock().unwrap();
                d.misses += 1;
                if d.misses >= MISSES_TO_HIDE {
                    d.dismissed = None;
                }
                d.misses
            };
            if misses >= MISSES_TO_HIDE && shown.is_some() {
                show(app, None, None);
            }
        }
    }
}

/* ---------- Hovered perk (in game) ---------- */

/// The perk whose tooltip the game shows at the pointer, among the shown
/// weapon's perks (sent as "perk-hover" when it changes).
static HOVERED: Mutex<Option<u32>> = Mutex::new(None);

fn set_hovered(app: &AppHandle, perk: Option<u32>) {
    let mut hovered = HOVERED.lock().unwrap();
    if *hovered != perk {
        *hovered = perk;
        let _ = app.emit("perk-hover", perk);
    }
}

/// The hovered armor mod / perk (hash), sent as "armor-hover" with the
/// item when it changes.
static ARMOR_HOVERED: Mutex<Option<u64>> = Mutex::new(None);

fn set_armor_hovered(app: &AppHandle, plug: Option<crate::fireteam::ItemInfo>) {
    let hash = plug.as_ref().map(|p| p.hash());
    let mut hovered = ARMOR_HOVERED.lock().unwrap();
    if *hovered != hash {
        *hovered = hash;
        let _ = app.emit("armor-hover", plug);
    }
}

/// Background loop: checks the inspect screen while Destiny 2 is in front.
pub fn start_detection(app: &AppHandle) {
    crate::nameocr::warm_up();
    *LOG_FILE.lock().unwrap() = app.path().app_cache_dir().ok().map(|d| d.join("detect.log"));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let idle = LAST_SEEN.lock().unwrap().is_none_or(|at| at.elapsed() >= IDLE_AFTER);
            tokio::time::sleep(if idle { IDLE_INTERVAL } else { DETECT_INTERVAL }).await;
            // Off, or the inspect page covers the game.
            if !config(&app).auto || PAUSED.load(std::sync::atomic::Ordering::SeqCst) {
                continue;
            }
            // Only while the game is in front. Out of it (alt-tab, a
            // screenshot tool) the shown item stays, like the other widgets.
            if screen::destiny_in_foreground() {
                detect_tick(&app).await;
                // Something on screen (shown, or a heading read): quick
                // checks for a while, so moving on from it shows at once.
                let seen = DETECTION.lock().unwrap().shown.is_some()
                    || GUARDIAN_ON_SCREEN.lock().unwrap().0.is_some()
                    || !BIG_LINES.lock().unwrap().is_empty();
                if seen {
                    *LAST_SEEN.lock().unwrap() = Some(std::time::Instant::now());
                }
            }
        }
    });
}

#[tauri::command]
pub fn weapon_detect_config(app: AppHandle) -> DetectConfig {
    config(&app)
}

#[tauri::command]
pub fn weapon_set_auto(app: AppHandle, auto: bool) -> Result<(), String> {
    let mut c = config(&app);
    c.auto = auto;
    if !auto {
        show(&app, None, None);
    }
    save_config(&app, c)
}

/// Set the name region, or with `icon` the weapon icon region.
#[tauri::command]
pub fn weapon_set_region(app: AppHandle, region: Region, icon: Option<bool>) -> Result<(), String> {
    let mut c = config(&app);
    if icon.unwrap_or(false) {
        c.icon = Some(region);
    } else {
        c.region = region;
    }
    save_config(&app, c)
}

/// Screenshot for calibration after a delay (time to open the inspect screen).
#[tauri::command]
pub async fn weapon_capture(delay_seconds: u64) -> Result<String, String> {
    tokio::time::sleep(Duration::from_secs(delay_seconds.min(15))).await;
    let shot = tauri::async_runtime::spawn_blocking(screen::capture_primary)
        .await
        .map_err(|e| e.to_string())??;
    let preview = screen::preview_url(&shot)?;
    *LAST_SHOT.lock().unwrap() = Some(shot);
    Ok(preview)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    lines: Vec<String>,
    weapon: Option<WeaponDetail>,
}

/// Run the detection on the calibration screenshot with the saved regions:
/// what the name region reads, and which weapon (and version) that gives.
#[tauri::command]
pub async fn weapon_test(app: AppHandle) -> Result<TestResult, String> {
    let shot = LAST_SHOT
        .lock()
        .unwrap()
        .clone()
        .ok_or(tr("Erst einen Screenshot machen", "Take a screenshot first"))?;
    let region = config(&app).region;
    let db = db(&app).await?;
    let (lines, found) = {
        let (db, shot) = (db.clone(), shot.clone());
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
            let lines = screen::ocr_lines(&screen::crop(&shot, region))?;
            Ok((lines, read_name(&db, &shot, region)?))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let weapon = match found {
        Some((i, name)) => identify_sighting(&app, Sighting { key: name_key(&db, i), db: db.clone(), shot, name, armor: None, matched: String::new() }).await,
        None => None,
    };
    Ok(TestResult { lines, weapon })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A character screen's name, read from a screenshot in
    #[test]
    fn symbol_names_kept() {
        assert_eq!(name_part("[...]").as_deref(), Some("[...]"));
        assert_eq!(name_part("• Calus ").as_deref(), Some("Calus"));
        assert_eq!(name_part("Pandaris_").as_deref(), Some("Pandaris_"));
        assert_eq!(name_part("[Salz] Salty Shaker").as_deref(), Some("[Salz] Salty Shaker"));
        assert_eq!(name_part("=|DBB|=KS901").as_deref(), Some("=|DBB|=KS901"));
        assert_eq!(name_part("Postmaster jr.").as_deref(), Some("Postmaster jr."));
        assert!(name_in("[...]#8882", "[...]"));
        assert!(!name_in("ca", "[...]"));
    }

    /// $RADAR_GUARDIAN_SHOT (plain and with the white-text mask).
    #[test]
    #[ignore]
    fn guardian_name_from_shot() {
        let path = std::env::var("RADAR_GUARDIAN_SHOT").expect("RADAR_GUARDIAN_SHOT");
        let full = image::open(path).unwrap().to_rgba8();
        let (w, h) = (full.width() as f64, full.height() as f64);
        let r = GUARDIAN_REGION;
        let shot = image::imageops::crop_imm(&full, (r.x * w) as u32, (r.y * h) as u32, (r.w * w) as u32, (r.h * h) as u32).to_image();
        let c = CODE_REGION;
        let middle = image::imageops::crop_imm(&full, (c.x * w) as u32, (c.y * h) as u32, (c.w * w) as u32, (c.h * h) as u32).to_image();
        let read = screen::ocr_text_lines(&middle).unwrap();
        println!("code: {:?} from {:?}", full_name(&read), read.iter().map(|l| l.text.clone()).collect::<Vec<_>>());
        for (label, img) in [("plain", shot.clone()), ("mask", white_text(&shot))] {
            let lines = screen::ocr_text_lines(&img).unwrap();
            let read: Vec<String> = lines.iter().map(|l| format!("'{}' {:.0}px", l.text, l.h)).collect();
            println!("{label}: name {:?} from {}", guardian_name(&lines), read.join(", "));
            if let Some(season) = season_line(&lines) {
                // (all readings)
                println!("{label}: season at {:.0},{:.0} h {:.0}; own reading {:?}", season.x, season.y, season.h, own_read_name(&shot, season));
            }
        }
    }

    /// The weapon db built from manifest files in $RADAR_MANIFEST_DIR.
    fn manifest_db() -> Arc<WeaponDb> {
        let dir = std::env::var("RADAR_MANIFEST_DIR").expect("RADAR_MANIFEST_DIR");
        fn load<T: for<'de> Deserialize<'de>>(dir: &str, table: &str) -> HashMap<String, T> {
            serde_json::from_slice(&std::fs::read(format!("{dir}/{table}.json")).unwrap()).unwrap()
        }
        into_db(build_index(
            "test".into(),
            load(&dir, "DestinyInventoryItemDefinition"),
            load(&dir, "DestinyPlugSetDefinition"),
            load(&dir, "DestinyStatGroupDefinition"),
            load(&dir, "DestinyStatDefinition"),
            load(&dir, "DestinySandboxPerkDefinition"),
            load(&dir, "DestinyCollectibleDefinition"),
            load(&dir, "DestinyEquipableItemSetDefinition"),
        ))
    }

    /// Builds the index from manifest files in $RADAR_MANIFEST_DIR:
    /// `cargo test --lib weapon_index -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn weapon_index_from_manifest() {
        let db = manifest_db();
        println!("weapons: {}, unique names: {}, perks: {}", db.index.weapons.len(), db.by_name.len(), db.index.perks.len());
        // The gear table: AION helmet (Titan? any class armor has its class), a subclass.
        let helmet = &db.index.gear[&3013134961];
        println!("gear: {} items; {} bucket {} class {}", db.index.gear.len(), helmet.name, helmet.bucket, helmet.class_type);
        assert_eq!(helmet.bucket, 3448274439, "helmet bucket");
        assert!(db.index.gear.values().any(|g| g.bucket == 3284755031), "subclasses included");
        for name in ["Perfektionierter Ausbruch", "Dürresammler", "Auserwählte des Reisenden"] {
            if let Some(w) = db.index.weapons.iter().rev().find(|w| w.name == name) {
                println!("{name}: catalyst={:?} flavor={:?}", w.catalyst.as_ref().map(|c| (&c.name, &c.description)), w.flavor);
            }
        }
        let with = db.index.weapons.iter().filter(|w| w.tier == 6 && w.catalyst.is_some()).count();
        let exotics = db.index.weapons.iter().filter(|w| w.tier == 6).count();
        println!("exotics with catalyst: {with} / {exotics}");
        let craftable = db.index.weapons.iter().filter(|w| w.craftable).count();
        println!("craftable: {craftable}, perks with enhanced version: {}", db.index.enhanced.len());
        let enhanceable = db.index.weapons.iter().filter(|w| w.columns.iter().any(|c| !c.enhanced.is_empty())).count();
        let both = db.index.weapons.iter().filter(|w| w.craftable && w.columns.iter().any(|c| !c.enhanced.is_empty())).count();
        println!("weapons with enhanced perks: {enhanceable} (of them craftable: {both}), weapons total: {}", db.index.weapons.len());
        if let Some(e) = db.index.enhanced.get(&2578928832) {
            println!("Rückspulgeschosse enhanced -> {e} {:?}", db.index.perks.get(e).map(|p| (&p.type_name, &p.name)));
        }
        let i = match_text(&db, &["SCHICKSALSBRINGER".into()]).expect("matched");
        let d = detail(&db, &db.index.weapons[i]);
        println!("{} ({}) frame={:?} origins={:?}", d.name, d.hash, d.frame.as_ref().map(|p| &p.name), d.origins.iter().map(|p| &p.name).collect::<Vec<_>>());
        for c in &d.columns {
            println!("  {} [{}]: {}", c.label, if c.random { "random" } else { "fixed" }, c.perks.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", "));
        }
        println!("  stats: {}", d.stats.iter().map(|s| format!("{} {}", s.name, s.value)).collect::<Vec<_>>().join(", "));
        assert_eq!(d.hash, 4184168210, "newest version");

        // Version detection from perk names read on the inspect screen.
        let pick = |name: &str, screen: &[&str]| {
            let lines: Vec<String> = screen.iter().map(|l| l.to_string()).collect();
            let d = identify(&db, &normalize(name), &lines, None, &[]).expect("identified");
            let rolled: Vec<String> = d.rolled.iter().map(|h| db.index.perks[h].name.clone()).collect();
            println!("{name} {screen:?} -> {} matched_by={} rolled={rolled:?} ({} versions)", d.hash, d.matched_by, d.versions.len());
            d.hash
        };
        // Original Fatebringer has Dreschen / Mörderischer Wind, the reissue doesn't.
        assert_eq!(pick("Schicksalsbringer", &["SCHICKSALSBRINGER", "Dreschen", "Explosivladung", "Gezogener Lauf"]), 2171478765);
        assert_eq!(pick("Schicksalsbringer", &["SCHICKSALSBRINGER", "Feuerkraft", "Präzisions-Instrument"]), 4184168210);
        // Nothing readable: newest version.
        assert_eq!(pick("Schicksalsbringer", &["SCHICKSALSBRINGER"]), 4184168210);
        assert_eq!(pick("Gnadenlos", &["GNADENLOS", "Für Schlagkraft gebaut", "Riss"]), 2831259643);
        assert_eq!(pick("Gnadenlos", &["GNADENLOS", "Gesetzloser", "Wuuusch!"]), 435821041);

        // Season watermark narrows the versions (Lotus-Eater: 3 versions, 2 seasons).
        let lotus = db.index.weapons.iter().find(|w| w.hash == 3922217119).expect("Lotus-Eater");
        let key = normalize(&lotus.name);
        let older = "/common/destiny2_content/icons/0ac354c1c326441716ddb15d2c158c59.png";
        let newer = "/common/destiny2_content/icons/e78fd9419f99464816ac8f628bc3c4af.png";
        let d = identify(&db, &key, &[], Some(older), &[]).unwrap();
        println!("{} older watermark -> {} matched_by={}", lotus.name, d.hash, d.matched_by);
        assert_eq!((d.hash, d.matched_by), (3922217119, "watermark"));
        let d = identify(&db, &key, &[], Some(newer), &[]).unwrap();
        println!("{} newer watermark -> {} matched_by={}", lotus.name, d.hash, d.matched_by);
        assert_eq!((d.hash, d.matched_by), (837298567, "watermark"));

        // Owning one version decides it, and the copy's plugs are the roll.
        let reissue = db.index.weapons.iter().find(|w| w.hash == 4184168210).unwrap();
        let perk_hash = |name: &str| {
            reissue.columns.iter().flat_map(|c| &c.perks).copied().find(|h| db.index.perks[h].name == name).unwrap()
        };
        let owned = vec![OwnedItem {
            item_hash: 4184168210,
            instance_id: "1".into(),
            character_id: None,
            socket_plugs: Vec::new(),
            energy_capacity: None,
            socket_options: Vec::new(),
            location: "vault",
            plugs: vec![perk_hash("Korkenzieher-Drall"), perk_hash("Taktisches Magazin"), perk_hash("Feuerkraft"), 1234],
            options: vec![perk_hash("Korkenzieher-Drall"), perk_hash("Taktisches Magazin"), perk_hash("Feuerkraft"), 1234],
        }];
        let d = identify(&db, &normalize("Schicksalsbringer"), &[], None, &owned).unwrap();
        let rolled: Vec<&str> = d.rolled.iter().map(|h| db.index.perks[h].name.as_str()).collect();
        println!("owned reissue -> {} matched_by={} rolled={rolled:?} copies={}", d.hash, d.matched_by, d.copies.len());
        assert_eq!((d.hash, d.matched_by, d.copies.len(), d.rolled.len()), (4184168210, "owned", 1, 3));
    }

    /// The icon box derived from the name on real inspect screenshots:
    /// `cargo test --lib icon_from_name -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn icon_from_name_on_screenshots() {
        let dir = std::env::var("RADAR_MANIFEST_DIR").expect("RADAR_MANIFEST_DIR");
        let db = manifest_db();
        let whole = Region { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
        // (file, name region, icon box as seen in the screenshot: x, y, size)
        for (file, region, expected) in [
            ("inspect-qua.webp", DEFAULT_REGION, (113.0, 86.0, 96.0)),
            // Already cropped to the top-left of the screen.
            ("inspect-lotus.webp", whole, (21.0, 1.0, 96.0)),
        ] {
            let shot = image::open(format!("{dir}/{file}")).unwrap().to_rgba8();
            // The manifest may be in another language than the screenshot;
            // then the tallest line stands in for the matched name.
            let line = match read_name(&db, &shot, region).unwrap() {
                Some((_, line)) => line,
                None => screen::ocr_text_lines(&screen::crop(&shot, region))
                    .unwrap()
                    .into_iter()
                    .max_by(|a, b| a.h.total_cmp(&b.h))
                    .expect("text read"),
            };
            // Both screenshots are cut from a 1080p screen.
            let (x, y, size) = icon_box_from_name(&line, 1080.0);
            println!(
                "{file}: {:?} at ({:.0},{:.0}) h={:.0} -> icon ({x:.0},{y:.0}) size {size:.0} | expected {expected:?}",
                line.text, line.x, line.y, line.h
            );
            let (ex, ey, es) = expected;
            assert!((x - ex).abs() < 0.12 * es && (y - ey).abs() < 0.12 * es && (size - es).abs() < 0.12 * es);

            if file == "inspect-lotus.webp" {
                // The older season's watermark must win on the derived box.
                let open = |f: &str| image::open(format!("{dir}/{f}")).unwrap().to_rgba8();
                let (icon, marks) = (open("lotus-icon.jpg"), [open("wm-e78f.png"), open("wm-0ac3.png")]);
                let mask = watermark_mask(&marks);
                let area = crop_box(&shot, (x, y, size), ICON_PAD).unwrap();
                let d: Vec<f64> = marks
                    .iter()
                    .map(|m| {
                        let template = composite(&icon, m);
                        icon_distance(&locate_icon(&area, &template, size), &template, &mask)
                    })
                    .collect();
                println!("  newer season {:.1} | older season {:.1}", d[0], d[1]);
                assert!(d[1] < d[0], "older season expected");
            }
        }
    }

    /// Season watermark matching on a real inspect screenshot (Lotus-Eater):
    /// `cargo test --lib watermark -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn watermark_on_inspect_screenshot() {
        let dir = std::env::var("RADAR_MANIFEST_DIR").expect("RADAR_MANIFEST_DIR");
        let open = |f: &str| image::open(format!("{dir}/{f}")).unwrap().to_rgba8();
        let shot = open("inspect-lotus.webp");
        // The icon in the top-left of the screenshot, box drawn roughly.
        let icon = open("lotus-icon.jpg");
        let marks = [open("wm-e78f.png"), open("wm-0ac3.png")];
        let mask = watermark_mask(&marks);
        // Boxes as a user might draw them: exact, shifted, too big, too small.
        for (x, y, w, h) in [(20, 0, 99, 99), (14, 0, 110, 104), (24, 3, 92, 92), (17, 0, 104, 99), (26, 0, 96, 100)] {
            let captured = image::imageops::crop_imm(&shot, x, y, w, h).to_image();
            let d: Vec<f64> = marks.iter().map(|m| icon_distance(&captured, &composite(&icon, m), &mask)).collect();
            println!("box {x},{y} {w}x{h}: newer season {:.1} | older season {:.1} -> {}", d[0], d[1], if d[1] < d[0] { "older" } else { "newer" });
        }
    }

    #[test]
    fn normalizes_for_matching() {
        assert_eq!(normalize("Schicksalsbringer"), "SCHICKSALSBRINGER");
        assert_eq!(normalize("  Bürde von  Izanagi! "), "BÜRDE VON IZANAGI");
        assert_eq!(normalize("MIDA-Multi-Tool"), "MIDA MULTI TOOL");
    }
}


/* ---------- One search for weapons and armor, by name and by source ---------- */

/// The sources searchable with `source:` (raids, dungeons, destinations,
/// activities): the name shown, and what an item's source mentions.
const SOURCES: &[(&str, &[&str])] = &[
    // Raids
    ("The Desert Perpetual", &["desert perpetual"]),
    ("Salvation's Edge", &["salvation's edge"]),
    ("Crota's End", &["crota's end"]),
    ("Root of Nightmares", &["root of nightmares"]),
    ("King's Fall", &["king's fall"]),
    ("Vow of the Disciple", &["vow of the disciple"]),
    ("Vault of Glass", &["vault of glass"]),
    ("Deep Stone Crypt", &["deep stone crypt"]),
    ("Garden of Salvation", &["garden of salvation"]),
    ("Last Wish", &["last wish"]),
    ("Crown of Sorrow", &["crown of sorrow"]),
    ("Scourge of the Past", &["scourge of the past"]),
    ("Leviathan", &["leviathan"]),
    // Dungeons
    ("Equilibrium", &["equilibrium"]),
    ("Sundered Doctrine", &["sundered doctrine"]),
    ("Vesper's Host", &["vesper's host"]),
    ("Warlord's Ruin", &["warlord's ruin"]),
    ("Ghosts of the Deep", &["ghosts of the deep"]),
    ("Spire of the Watcher", &["spire of the watcher"]),
    ("Duality", &["duality"]),
    ("Grasp of Avarice", &["grasp of avarice"]),
    ("Prophecy", &["prophecy"]),
    ("Pit of Heresy", &["pit of heresy"]),
    ("The Shattered Throne", &["shattered throne"]),
    // Destinations
    ("Kepler", &["kepler"]),
    ("Pale Heart", &["pale heart"]),
    ("Neomuna", &["neomuna"]),
    ("Throne World", &["throne world"]),
    ("Europa", &["europa"]),
    ("Moon", &["moon"]),
    ("Dreaming City", &["dreaming city"]),
    ("Tangled Shore", &["tangled shore"]),
    ("Nessus", &["nessus"]),
    ("EDZ", &["european dead zone", "edz"]),
    ("Cosmodrome", &["cosmodrome"]),
    ("Mars", &["mars"]),
    ("Mercury", &["mercury"]),
    ("Io", &[" io"]),
    ("Titan", &["titan,", "on titan", " titan."]),
    // Activities
    ("Trials of Osiris", &["trials of osiris"]),
    ("Iron Banner", &["iron banner"]),
    ("Nightfall", &["nightfall"]),
    ("Crucible", &["crucible"]),
    ("Gambit", &["gambit"]),
    ("Vanguard", &["vanguard"]),
    ("Dares of Eternity", &["dares of eternity"]),
    ("Onslaught", &["onslaught"]),
    ("Pantheon", &["pantheon"]),
    ("Exotic Missions", &["exotic mission"]),
    ("Xûr", &["xûr", "xur"]),
    ("Banshee-44", &["banshee"]),
    ("Seasonal", &["season pass", "seasonal"]),
];

/// A source as typed after `source:` (letters and digits, lower case).
fn source_key(name: &str) -> String {
    // (Plain letters: "xur" for Xûr.)
    name.to_lowercase().replace('û', "u").chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

fn from_source(db: &WeaponDb, hash: u32, needles: &[&str]) -> bool {
    db.index.sources.get(&hash).is_some_and(|s| needles.iter().any(|n| s.contains(n)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    name: String,
    /// What to type after `source:`.
    key: String,
    /// Weapons and armor pieces (by name) from it.
    count: usize,
}

/// Every source with something from it, for completing `source:`.
#[tauri::command]
pub async fn gear_sources(app: AppHandle) -> Result<Vec<SourceEntry>, String> {
    let db = db(&app).await?;
    Ok(SOURCES
        .iter()
        .map(|(name, needles)| {
            let weapons = db.by_name.iter().filter(|(key, _)| {
                db.versions.get(key).into_iter().flatten().any(|&i| from_source(&db, db.index.weapons[i].hash, needles))
            });
            let armor = db.armor.iter().filter(|(_, hashes)| hashes.iter().any(|&h| from_source(&db, h, needles)));
            SourceEntry { name: name.to_string(), key: source_key(name), count: weapons.count() + armor.count() }
        })
        .filter(|s| s.count > 0)
        .collect())
}

/// An armor piece found (by name and, if asked, source): light, from the
/// gear table (no lookups).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorFound {
    name: String,
    icon: Option<String>,
    type_name: String,
    /// The class it is for ("" for any).
    class_name: String,
    exotic: bool,
    /// Its slot: 0 helmet, 1 arms, 2 chest, 3 legs, 4 class item.
    slot: u8,
    /// Every version of the name.
    hashes: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GearHit {
    Weapon { weapon: WeaponSummary },
    Armor { armor: ArmorFound },
}

/// Weapons and armor by name, and by where they come from: `source:` with
/// a source's key (or the start of one: "source:vault"), alone or with a
/// name ("source:lastwish hood"). Weapons first.
#[tauri::command]
pub async fn gear_search(app: AppHandle, query: String) -> Result<Vec<GearHit>, String> {
    let db = db(&app).await?;
    // "source:" and the source after it, however written ("source: vault
    // of glass", "source:VaultOfGlass"): as many words as still start a
    // source's name; the other words are a name to look for.
    let mut words: Vec<String> = Vec::new();
    let mut wanted: Option<Vec<&'static [&'static str]>> = None;
    let lower = query.to_lowercase();
    let (before, after) = match lower.find("source:") {
        Some(at) => (&lower[..at], Some(&lower[at + "source:".len()..])),
        None => (lower.as_str(), None),
    };
    words.extend(before.split_whitespace().map(String::from));
    if let Some(after) = after {
        let rest: Vec<&str> = after.split_whitespace().collect();
        let mut key = String::new();
        let mut taken = 0;
        for word in &rest {
            let next = format!("{key}{}", source_key(word));
            if SOURCES.iter().any(|(n, _)| source_key(n).starts_with(&next)) {
                key = next;
                taken += 1;
            } else {
                break;
            }
        }
        words.extend(rest[taken..].iter().map(|w| w.to_string()));
        let exact: Vec<_> = SOURCES.iter().filter(|(n, _)| source_key(n) == key).map(|(_, n)| *n).collect();
        let starting: Vec<_> = SOURCES.iter().filter(|(n, _)| source_key(n).starts_with(&key)).map(|(_, n)| *n).collect();
        // Nothing after "source:" yet: no filter.
        if !key.is_empty() {
            wanted = Some(if exact.is_empty() { starting } else { exact });
        }
    }
    let text = normalize(&words.join(" "));
    if text.is_empty() && wanted.is_none() {
        return Ok(Vec::new());
    }
    let sourced = |hashes: &mut dyn Iterator<Item = u32>| match &wanted {
        None => true,
        Some(sources) => {
            let all: Vec<u32> = hashes.collect();
            sources.iter().any(|needles| all.iter().any(|&h| from_source(&db, h, needles)))
        }
    };
    let score = |name: &str| -> Option<f64> {
        if text.is_empty() {
            return Some(1.0);
        }
        if name.starts_with(&text) {
            Some(2.0)
        } else if name.contains(&text) {
            Some(1.5)
        } else {
            let s = strsim::jaro_winkler(&text, name);
            (s >= 0.85).then_some(s)
        }
    };
    let limit = if wanted.is_some() { 200 } else { 20 };
    let mut weapons: Vec<(f64, usize)> = db
        .by_name
        .iter()
        .filter_map(|(name, i)| {
            let s = score(name)?;
            let versions = db.versions.get(name).cloned().unwrap_or_default();
            sourced(&mut versions.iter().map(|&v| db.index.weapons[v].hash)).then_some((s, *i))
        })
        .collect();
    weapons.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| db.index.weapons[a.1].name.cmp(&db.index.weapons[b.1].name)));
    let mut armor: Vec<(f64, &(String, Vec<u32>))> = db
        .armor
        .iter()
        .filter_map(|entry| {
            // Its own name, or its set's ("Atheon's Memory": every piece).
            let by_set = || {
                entry.1.iter().filter_map(|h| db.index.sets.get(h)).filter_map(|set| score(set)).fold(None, |best: Option<f64>, s| Some(best.map_or(s, |b| b.max(s))))
            };
            let s = score(&entry.0).or_else(by_set)?;
            sourced(&mut entry.1.iter().copied()).then_some((s, entry))
        })
        .collect();
    armor.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1 .0.cmp(&b.1 .0)));
    let mut out: Vec<GearHit> =
        weapons.into_iter().take(limit).map(|(_, i)| GearHit::Weapon { weapon: summary(&db, &db.index.weapons[i]) }).collect();
    for (_, (_, hashes)) in armor.into_iter().take(limit) {
        // The newest version shows (highest hash order is no help: the
        // gear table's first with an icon).
        let Some(g) = hashes.iter().filter_map(|h| db.index.gear.get(h)).find(|g| g.icon.is_some()) else { continue };
        out.push(GearHit::Armor {
            armor: ArmorFound {
                name: g.name.clone(),
                icon: g.icon.clone(),
                type_name: g.type_name.clone(),
                class_name: if g.class_type == 3 { String::new() } else { crate::bungie::class_name(g.class_type).to_string() },
                exotic: g.exotic,
                slot: crate::fireteam::ARMOR_BUCKETS.iter().position(|&b| b == g.bucket).unwrap_or(5) as u8,
                hashes: hashes.clone(),
            },
        });
    }
    Ok(out)
}
