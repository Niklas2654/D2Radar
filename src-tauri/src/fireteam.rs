//! Fireteam tab: resolves party members and builds a player profile
//! (characters, equipped build, raid/dungeon clears, PvP totals) from the
//! public Bungie API, plus the manifest data needed to label it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::future::join_all;
use futures::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::bungie::{api, class_name, BungieState};
use crate::i18n::{locale, tr};

/// Player profiles are cached this long, so switching between members is instant.
const DETAIL_TTL: Duration = Duration::from_secs(120);
/// The first Pantheon's versions share one image (Nezarec's a placeholder):
/// each shows its boss's raid instead (RaidHub's versions).
fn first_pantheon_art(hash: u64) -> Option<&'static str> {
    match crate::raidtags::activity_version(hash)? {
        (101, 128) => Some("europa-raid-deep-stone-crypt.jpg"),
        (101, 129) => Some("raid_kings_fall.jpg"),
        (101, 130) => Some("raid_nemesis.jpg"),
        (101, 131) => Some("raid_root_of_nightmares.jpg"),
        _ => None,
    }
}

/// When each exotic mission came out (English names, as the activity's
/// name starts; 17:00 UTC): the list is sorted by it.
const EXOTIC_RELEASES: [(&str, &str); 12] = [
    ("The Whisper", "2018-07-17T17:00:00Z"),
    ("Zero Hour", "2019-03-12T17:00:00Z"),
    ("Harbinger", "2020-07-14T17:00:00Z"),
    ("Presage", "2021-02-23T17:00:00Z"),
    ("Vox Obscura", "2022-03-08T17:00:00Z"),
    ("Operation: Seraph's Shield", "2022-12-20T17:00:00Z"),
    ("//node.ovrd.AVALON//", "2023-03-21T17:00:00Z"),
    ("Starcrossed", "2023-12-12T17:00:00Z"),
    ("Encore", "2024-04-02T17:00:00Z"),
    ("Kell's Fall", "2024-11-19T17:00:00Z"),
    ("Derealize", "2025-03-04T17:00:00Z"),
    ("Heliostat", "2025-07-15T17:00:00Z"),
];

/// An exotic mission's release, by an activity's English name (its
/// conquests "Master Conquest: Derealize" too).
fn exotic_release(english: &str) -> Option<&'static str> {
    EXOTIC_RELEASES
        .iter()
        .filter(|(n, _)| english.starts_with(n) || english.contains(&format!(": {n}")))
        .max_by_key(|(n, _)| n.len())
        .map(|(_, r)| *r)
}

/// Bungie's key art of The Desert Perpetual (This Week in Destiny,
/// 07/17/2025), scaled down: the normal version's artwork.
const DESERT_PERPETUAL_ART: &str = "https://images.contentstack.io/v3/assets/blte410e3b15535c144/blta98a4e4f5266123e/6878f0ddbbc2d8c4afb288d2/Apollo_Desert_Perpetual_Raid_3840x2160_EMBARGO_JULY_19.jpg?width=1280";
/// Item / perk definitions kept in memory at most.
const MAX_DEFINITIONS: usize = 4000;

// Equipment bucket hashes (DestinyInventoryBucketDefinition).
pub(crate) const SUBCLASS: u64 = 3284755031;
pub(crate) const WEAPON_BUCKETS: [u64; 3] = [1498876634, 2465295065, 953998645];
pub(crate) const ARMOR_BUCKETS: [u64; 5] = [3448274439, 3551918588, 14239492, 20886954, 1585787867];
/// Socket categories shown on equipped items: weapon perks, weapon mods, armor mods.
const WEAPON_PERKS: u64 = 4241085061;
const WEAPON_MODS: u64 = 2685412949;
const ARMOR_MODS: u64 = 590099826;
/// Power is shown as the character's light level instead.
const POWER_STAT: &str = "1935470627";
/// DestinyActivityModeType values for raids and dungeons.
const MODE_RAID: i64 = 4;
const MODE_DUNGEON: i64 = 82;
/// Activity types (DestinyActivityTypeDefinition): raid, dungeon, exotic
/// mission (the portal's versions; the first ones are story missions).
const RAID_TYPE: u64 = 2043403989;
const DUNGEON_TYPE: u64 = 608898761;
const EXOTIC_MISSION_TYPE: u64 = 1227821118;
const STORY_TYPES: [u64; 2] = [1686739444, 2962101345];
/// Typed as exotic missions, but none: Oblation (a seasonal activity).
const NOT_EXOTICS: [&str; 1] = ["Oblation"];
/// Exotic missions typed only as story ones (no portal version): Harbinger.
const STORY_EXOTICS: [u64; 1] = [1738383283];
const TIER_EXOTIC: i64 = 6;

/* ---------- Shared caches ---------- */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    hash: u64,
    pub(crate) name: String,
    icon: Option<String>,
    type_name: String,
    /// What it does (perks, exotic armor perks); empty when not needed.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) description: String,
    /// Exact numbers from the Destiny Data Compendium (exotic class item
    /// spirits), when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    exact: Option<String>,
    pub(crate) exotic: bool,
    /// 1 kinetic, 2 arc, 3 solar, 4 void, 6 stasis, 7 strand (0 = none).
    #[serde(skip_serializing_if = "is_zero")]
    damage_type: i64,
    /// Armor set the item belongs to (set bonuses).
    #[serde(skip)]
    set_hash: Option<u64>,
    /// Inventory bucket (slot) the item goes into.
    pub(crate) bucket: u64,
    /// Perks / mods plugged into an equipped item.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    perks: Vec<ItemInfo>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    mods: Vec<ItemInfo>,
    /// As a plug: its category (e.g. "frames", "enhancements.v2_head").
    #[serde(skip)]
    pub(crate) plug_category: String,
    /// As an armor mod: the energy it costs.
    #[serde(skip)]
    pub(crate) energy_cost: u32,
    /// Socket indexes holding perks, and holding mods with their empty plug.
    #[serde(skip)]
    perk_sockets: Vec<usize>,
    #[serde(skip)]
    pub(crate) mod_sockets: Vec<(usize, u64)>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ActivityKind {
    name: String,
    raid: bool,
    /// The master version ("Gläserne Kammer: Meister").
    #[serde(default)]
    master: bool,
    /// An exotic mission (raid false too).
    #[serde(default)]
    exotic: bool,
}

/// A name's suffix that marks the master version, in the game's languages.
fn is_master_suffix(suffix: &str) -> bool {
    let s = suffix.trim().to_lowercase();
    ["master", "meister", "großmeister", "maître", "maestro", "mestre", "mistrz", "мастер", "マスター", "마스터", "大师", "大師"]
        .iter()
        .any(|m| s == *m)
}

#[derive(Clone, Serialize, Deserialize)]
struct StatInfo {
    name: String,
    icon: Option<String>,
}

/// Compact slices of manifest tables, keyed by hash.
#[derive(Clone, Default, Serialize, Deserialize)]
struct ManifestCache {
    version: String,
    #[serde(default)]
    locale: String,
    activities: HashMap<u64, ActivityKind>,
    stats: HashMap<u64, StatInfo>,
}

static MANIFEST: Mutex<Option<ManifestCache>> = Mutex::new(None);
/// Item definitions keyed by (locale, item hash); None = unnamed item.
type ItemCache = HashMap<(&'static str, u64), Option<ItemInfo>>;
static ITEMS: Mutex<Option<ItemCache>> = Mutex::new(None);
static MEMBERS: Mutex<Option<HashMap<String, Membership>>> = Mutex::new(None);
/// Other definitions keyed by "locale:entity:hash"; None = not found.
static DEFINITIONS: Mutex<Option<HashMap<String, Option<Value>>>> = Mutex::new(None);
/// Keyed by "locale:membershipId".
static DETAILS: Mutex<Option<HashMap<String, (Instant, PlayerDetail)>>> = Mutex::new(None);

#[derive(Clone)]
pub struct Membership {
    pub membership_type: i64,
    pub display_name: String,
}

fn http(app: &AppHandle) -> (reqwest::Client, Result<String, String>) {
    let state = app.state::<BungieState>();
    (state.http.clone(), state.api_key())
}

/* ---------- Membership lookup ---------- */

/// Resolve a Destiny membership id to its platform and Bungie name (cached).
pub async fn resolve_member(app: &AppHandle, membership_id: &str) -> Option<Membership> {
    if let Some(m) = MEMBERS.lock().unwrap().get_or_insert_default().get(membership_id) {
        return Some(m.clone());
    }
    let (http, key) = http(app);
    let response = api(
        &http,
        &key.ok()?,
        Method::GET,
        &format!("/User/GetMembershipsById/{membership_id}/-1/"),
        None,
    )
    .await
    .ok()?;
    let memberships = response["destinyMemberships"].as_array()?;
    // With Cross Save, the override platform is the one holding the profile.
    let card = memberships
        .iter()
        .find(|m| {
            let cross = m["crossSaveOverride"].as_i64().unwrap_or(0);
            cross != 0 && m["membershipType"].as_i64() == Some(cross)
        })
        .or_else(|| memberships.iter().find(|m| m["membershipId"].as_str() == Some(membership_id)))
        .or_else(|| memberships.first())?;
    let name = card["bungieGlobalDisplayName"].as_str().filter(|n| !n.is_empty());
    let display_name = match (name, card["bungieGlobalDisplayNameCode"].as_u64()) {
        (Some(n), Some(code)) => format!("{n}#{code:04}"),
        _ => card["displayName"].as_str().unwrap_or(tr("Unbekannt", "Unknown")).to_string(),
    };
    let membership = Membership {
        membership_type: card["membershipType"].as_i64().unwrap_or(-1),
        display_name,
    };
    MEMBERS
        .lock()
        .unwrap()
        .get_or_insert_default()
        .insert(membership_id.to_string(), membership.clone());
    Some(membership)
}

/* ---------- Manifest ---------- */

fn manifest_cache_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(format!("manifest-slices-v10-{}.json", locale()))
}

/// Activity kinds (raid/dungeon) and stat names, downloaded once per
/// manifest version and kept on disk.
async fn manifest(app: &AppHandle) -> Result<ManifestCache, String> {
    if let Some(m) = MANIFEST.lock().unwrap().clone().filter(|m| m.locale == locale()) {
        return Ok(m);
    }
    let lc = locale();
    let (http, key) = http(app);
    let key = key?;
    let info = api(&http, &key, Method::GET, "/Destiny2/Manifest/", None).await?;
    let version = info["version"].as_str().unwrap_or_default().to_string();
    check_definitions(app, &version);

    let path = manifest_cache_path(app);
    if let Some(cached) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<ManifestCache>(&s).ok())
        .filter(|c| c.version == version && c.locale == lc)
    {
        *MANIFEST.lock().unwrap() = Some(cached.clone());
        return Ok(cached);
    }

    let paths = &info["jsonWorldComponentContentPaths"][lc];
    let download = |table: &str| {
        let url = paths[table].as_str().map(|p| format!("https://www.bungie.net{p}"));
        let http = http.clone();
        async move {
            let url = url.ok_or(tr("Manifest-Pfad fehlt", "Manifest path missing"))?;
            http.get(url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json::<HashMap<String, Value>>()
                .await
                .map_err(|e| e.to_string())
        }
    };
    let (activities, stats) =
        futures::try_join!(download("DestinyActivityDefinition"), download("DestinyStatDefinition"))?;

    let exotics = exotic_missions(&activities);
    let activities = activities
        .into_iter()
        .filter_map(|(hash, def)| {
            if let Some((name, master)) = exotics.get(&hash) {
                let kind = ActivityKind { name: name.clone(), raid: false, master: *master, exotic: true };
                return Some((hash.parse().ok()?, kind));
            }
            // By activity type: Bungie's mode field is missing on many raids
            // (VoG Master, Garden, Desert Perpetual…) or says dungeon (Crota's
            // End). The mode only where there's no type.
            let mode = def["directActivityModeType"].as_i64();
            let raid = match def["activityTypeHash"].as_u64() {
                Some(RAID_TYPE) => true,
                Some(DUNGEON_TYPE) => false,
                _ => match mode {
                    Some(MODE_RAID) => true,
                    Some(MODE_DUNGEON) => false,
                    _ => return None,
                },
            };
            let name = def["displayProperties"]["name"].as_str().filter(|n| !n.is_empty())?;
            // "Gläserne Kammer: Meister" and "Gläserne Kammer" count as one raid
            // (the master flag kept apart, for lowmans).
            let mut parts = name.splitn(2, ':');
            let mut base = parts.next().unwrap_or(name).trim().to_string();
            let master = parts.next().is_some_and(is_master_suffix);
            // The Pantheon's versions are a list item each: the first one's
            // ("The Pantheon: Atraks Sovereign"), the new one's ("Pantheon:
            // Calus Resplendent: Customize" -> "Pantheon: Calus Resplendent")
            // and its featured playlists ("Featured Encore: Morgeth").
            let raidhub = hash.parse().ok().and_then(crate::raidtags::activity_version);
            if raidhub.is_some_and(|(a, _)| a == 101 || a == 102) {
                let parts: Vec<&str> = name.split(':').map(str::trim).collect();
                if parts.len() >= 2 {
                    base = format!("{}: {}", parts[0], parts[1]);
                }
            }
            Some((hash.parse().ok()?, ActivityKind { name: base, raid, master, exotic: false }))
        })
        .collect();
    let stats = stats
        .into_iter()
        .filter_map(|(hash, def)| {
            let name = def["displayProperties"]["name"].as_str().filter(|n| !n.is_empty())?;
            let icon = def["displayProperties"]["icon"].as_str().map(Into::into);
            Some((hash.parse().ok()?, StatInfo { name: name.into(), icon }))
        })
        .collect();

    let cache = ManifestCache { version, locale: lc.to_string(), activities, stats };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&cache) {
        let _ = std::fs::write(&path, json);
    }
    *MANIFEST.lock().unwrap() = Some(cache.clone());
    Ok(cache)
}

/// Raid activity hash -> raid name (versions grouped), from the manifest.
/// Dungeon activities: hash -> (dungeon name, master version).
pub(crate) async fn dungeon_names(app: &AppHandle) -> Result<HashMap<u64, (String, bool)>, String> {
    Ok(manifest(app)
        .await?
        .activities
        .into_iter()
        .filter(|(_, kind)| !kind.raid && !kind.exotic)
        .map(|(hash, kind)| (hash, (kind.name, kind.master)))
        .collect())
}

/// Exotic mission activities: hash -> (mission name, master version).
pub(crate) async fn exotic_names(app: &AppHandle) -> Result<HashMap<u64, (String, bool)>, String> {
    Ok(manifest(app)
        .await?
        .activities
        .into_iter()
        .filter(|(_, kind)| kind.exotic)
        .map(|(hash, kind)| (hash, (kind.name, kind.master)))
        .collect())
}

/// Every exotic mission's activities (hash as the manifest has it -> the
/// mission's name, master version), in the manifest's language. The
/// portal's versions are typed so ("Presage: Customize"; its conquests
/// "Master Conquest: Derealize: Customize" count as the mission), the
/// first ones are story missions of the same name ("Presage: Standard",
/// "Operation: Seraph's Shield (Expert)").
fn exotic_missions(activities: &HashMap<String, Value>) -> HashMap<String, (String, bool)> {
    let name_of = |def: &Value| def["displayProperties"]["name"].as_str().unwrap_or_default().trim().to_string();
    // The missions: the portal's names without their last part.
    let mut bases: Vec<String> = activities
        .values()
        .filter(|d| d["activityTypeHash"].as_u64() == Some(EXOTIC_MISSION_TYPE))
        .filter_map(|d| name_of(d).rsplit_once(": ").map(|(base, _)| base.trim().to_string()))
        .chain(STORY_EXOTICS.iter().filter_map(|h| activities.get(&h.to_string()).map(name_of)))
        // (Its parts too: "Oblation: Bloodline".)
        .filter(|n| !n.is_empty() && !NOT_EXOTICS.iter().any(|x| n == x || n.starts_with(&format!("{x}:"))))
        .collect();
    bases.sort();
    bases.dedup();
    // A conquest of one, or a part of one ("Oblation: Bloodline"): that one.
    let all = bases.clone();
    bases.retain(|b| !all.iter().any(|o| o != b && (b.ends_with(&format!(": {o}")) || b.starts_with(&format!("{o}: ")))));
    let mission = |name: &str| {
        bases
            .iter()
            .filter(|b| {
                name == b.as_str()
                    || name.starts_with(&format!("{b}:"))
                    || name.starts_with(&format!("{b} ("))
                    || name.ends_with(&format!(": {b}"))
                    || name.contains(&format!(": {b}:"))
            })
            .max_by_key(|b| b.len())
            .cloned()
    };
    activities
        .iter()
        .filter(|(_, d)| {
            let kind = d["activityTypeHash"].as_u64().unwrap_or(0);
            kind == EXOTIC_MISSION_TYPE || STORY_TYPES.contains(&kind)
        })
        .filter_map(|(hash, d)| {
            let name = name_of(d);
            let base = mission(&name)?;
            let master = name.rsplit_once(": ").is_some_and(|(_, last)| is_master_suffix(last));
            Some((hash.clone(), (base, master)))
        })
        .collect()
}

/// Raid activities: hash -> (raid name, master version).
pub(crate) async fn raid_names(app: &AppHandle) -> Result<HashMap<u64, (String, bool)>, String> {
    Ok(manifest(app)
        .await?
        .activities
        .into_iter()
        .filter(|(_, kind)| kind.raid)
        .map(|(hash, kind)| (hash, (kind.name, kind.master)))
        .collect())
}

/// Item definition via the entity endpoint (cached; None for unnamed items).
pub(crate) async fn item(app: &AppHandle, hash: u64) -> Option<ItemInfo> {
    let lc = locale();
    if let Some(cached) = ITEMS.lock().unwrap().get_or_insert_default().get(&(lc, hash)) {
        return cached.clone();
    }
    let def = definition_in(app, "DestinyInventoryItemDefinition", hash, lc).await?;
    // Mods often have no text of their own: what they do is their perk's
    // ("Heavy Ammo Scout" and others showed only their name).
    let own = def["displayProperties"]["description"].as_str().unwrap_or_default().to_string();
    let description = if own.is_empty() {
        match def["perks"].as_array().and_then(|p| p.first()).and_then(|p| p["perkHash"].as_u64()) {
            Some(perk) => definition(app, "DestinySandboxPerkDefinition", perk)
                .await
                .and_then(|d| d["displayProperties"]["description"].as_str().map(String::from))
                .unwrap_or_default(),
            None => own,
        }
    } else {
        own
    };
    // The exact numbers (Destiny Data Compendium), by its English name.
    let english = if lc == "en" { None } else { definition_in(app, "DestinyInventoryItemDefinition", hash, "en").await };
    let exact = english
        .as_ref()
        .unwrap_or(&def)["displayProperties"]["name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .and_then(crate::compendium::exact);
    let info = def["displayProperties"]["name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .map(|name| ItemInfo {
            hash,
            name: name.into(),
            icon: def["displayProperties"]["icon"].as_str().map(Into::into),
            type_name: def["itemTypeDisplayName"].as_str().unwrap_or_default().into(),
            description,
            exact,
            exotic: def["inventory"]["tierType"].as_i64() == Some(TIER_EXOTIC),
            // Weapons have a default damage type, subclasses their HUD one.
            damage_type: def["defaultDamageType"]
                .as_i64()
                .filter(|&d| d != 0)
                .or(def["talentGrid"]["hudDamageType"].as_i64())
                .unwrap_or(0),
            set_hash: def["equippingBlock"]["equipableItemSetHash"].as_u64().filter(|&h| h != 0),
            bucket: def["inventory"]["bucketTypeHash"].as_u64().unwrap_or(0),
            perks: Vec::new(),
            mods: Vec::new(),
            plug_category: def["plug"]["plugCategoryIdentifier"].as_str().unwrap_or_default().into(),
            energy_cost: def["plug"]["energyCost"]["energyCost"].as_u64().unwrap_or(0) as u32,
            perk_sockets: socket_indexes(&def, &[WEAPON_PERKS]),
            mod_sockets: socket_indexes(&def, &[WEAPON_MODS, ARMOR_MODS])
                .into_iter()
                .map(|i| (i, def["sockets"]["socketEntries"][i]["singleInitialItemHash"].as_u64().unwrap_or(0)))
                .collect(),
        });
    ITEMS.lock().unwrap().get_or_insert_default().insert((lc, hash), info.clone());
    info
}

/// Socket indexes of an item definition in the given socket categories.
fn socket_indexes(def: &Value, categories: &[u64]) -> Vec<usize> {
    def["sockets"]["socketCategories"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["socketCategoryHash"].as_u64().is_some_and(|h| categories.contains(&h)))
        .flat_map(|c| c["socketIndexes"].as_array().cloned().unwrap_or_default())
        .filter_map(|i| i.as_u64().map(|i| i as usize))
        .collect()
}

/// An equipped item with the perks and mods plugged into it (`sockets` is
/// the profile's item sockets component).
async fn equipped_item(app: &AppHandle, equipped: &Value, sockets: &Value) -> Option<ItemInfo> {
    let plugs: Vec<u64> = equipped["itemInstanceId"]
        .as_str()
        .and_then(|id| sockets[id]["sockets"].as_array())
        .into_iter()
        .flatten()
        .map(|s| s["plugHash"].as_u64().unwrap_or(0))
        .collect();
    item_with_plugs(app, equipped["itemHash"].as_u64()?, &plugs).await
}

/// An item with the perks and mods in its sockets (`plugs`: the plug hash
/// per socket index, 0 = none).
pub(crate) async fn item_with_plugs(app: &AppHandle, hash: u64, plugs: &[u64]) -> Option<ItemInfo> {
    let mut info = item(app, hash).await?;
    let plug_at = |i: usize| plugs.get(i).copied().filter(|&h| h != 0);
    let perk_hashes: Vec<u64> = info.perk_sockets.iter().filter_map(|&i| plug_at(i)).collect();
    // Sockets still holding their empty default plug are left out.
    let mod_hashes: Vec<u64> = info
        .mod_sockets
        .iter()
        .filter_map(|&(i, empty)| plug_at(i).filter(|&h| h != empty))
        .collect();
    let (perks, mods) = futures::join!(
        join_all(perk_hashes.into_iter().map(|h| item(app, h))),
        join_all(mod_hashes.into_iter().map(|h| item(app, h))),
    );
    info.perks = perks.into_iter().flatten().filter(|p| !p.plug_category.contains("trackers")).collect();
    // Exotic armor: its exotic perks as plugged (an exotic class item's two
    // "spirits" too), with what they do.
    if info.exotic && ARMOR_BUCKETS.contains(&info.bucket) {
        let plugged = join_all(plugs.iter().copied().filter(|&h| h != 0).map(|h| item(app, h))).await;
        let perks: Vec<ItemInfo> =
            plugged.into_iter().flatten().filter(|p| p.plug_category == "intrinsics" && !p.name.is_empty()).collect();
        // Exact numbers by the English name (exotic class item spirits).
        info.perks = join_all(perks.into_iter().map(|mut p| async move {
            if let Some(name) = definition_in(app, "DestinyInventoryItemDefinition", p.hash, "en")
                .await
                .and_then(|d| d["displayProperties"]["name"].as_str().map(String::from))
            {
                p.exact = crate::compendium::exact(&name);
            }
            p
        }))
        .await;
    }
    info.mods = mods
        .into_iter()
        .flatten()
        .filter(|p| {
            let c = &p.plug_category;
            // Real mods only: no masterwork, ornaments, shaders, trackers …
            !["masterworks", "empty", "skins", "shader", "ornament", "trackers", "memento"].iter().any(|x| c.contains(x))
                && !c.starts_with("crafting")
                && p.icon_present()
        })
        .collect();
    Some(info)
}

impl ItemInfo {
    pub(crate) fn hash(&self) -> u64 {
        self.hash
    }

    /// The armor set it belongs to.
    pub(crate) fn set_hash(&self) -> Option<u64> {
        self.set_hash
    }

    pub(crate) fn type_name(&self) -> &str {
        &self.type_name
    }

    /// The mods shown on it (see `with_mods`).
    /// With exact numbers (from the Compendium) when there are none yet.
    pub(crate) fn with_exact(mut self, exact: Option<String>) -> Self {
        if self.exact.is_none() {
            self.exact = exact;
        }
        self
    }

    pub(crate) fn icon(&self) -> Option<&str> {
        self.icon.as_deref()
    }

    pub(crate) fn mods(&self) -> &[ItemInfo] {
        &self.mods
    }

    pub(crate) fn perk_sockets(&self) -> &[usize] {
        &self.perk_sockets
    }

    /// Its perks (as plugged).
    pub(crate) fn perks(&self) -> &[ItemInfo] {
        &self.perks
    }

    /// The same item showing these perks.
    pub(crate) fn with_perks(mut self, perks: Vec<ItemInfo>) -> Self {
        self.perks = perks;
        self
    }

    /// The same item showing these mods (e.g. a loadout's mods on its armor).
    pub(crate) fn with_mods(mut self, mods: Vec<ItemInfo>) -> Self {
        self.mods = mods;
        self
    }

    /// Has an icon (empty sockets and placeholders often don't).
    pub(crate) fn icon_present(&self) -> bool {
        self.icon.is_some()
    }
}

fn is_zero(n: &i64) -> bool {
    *n == 0
}

/// Any manifest definition via the entity endpoint (cached).
pub(crate) async fn definition(app: &AppHandle, entity: &str, hash: u64) -> Option<Value> {
    definition_in(app, entity, hash, locale()).await
}

/// A definition in a given language (English names for lookups in English
/// community data).
pub(crate) async fn definition_in(app: &AppHandle, entity: &str, hash: u64, lang: &str) -> Option<Value> {
    let cache_key = format!("{lang}:{entity}:{hash}");
    load_definitions(app);
    if let Some(cached) = DEFINITIONS.lock().unwrap().get_or_insert_default().get(&cache_key) {
        return cached.clone();
    }
    // Kept in the game data (shipped with the app, or looked up before): at
    // once; of an older manifest, looked up anew in the background.
    let current = DEFINITIONS_VERSION.lock().unwrap().clone();
    if let Some((version, data)) = crate::db::definition(app, lang, entity, hash) {
        // (An empty one, kept from before: looked up anew.)
        if let Some(def) = serde_json::from_str::<Value>(&data).ok().filter(|d| !d.is_null()) {
            remember(&cache_key, Some(def.clone()));
            if current.as_ref().is_some_and(|c| *c != version) {
                let (app, entity, lang) = (app.clone(), entity.to_string(), lang.to_string());
                tauri::async_runtime::spawn(async move {
                    if let Some(new) = fetch_definition(&app, &entity, hash, &lang).await {
                        remember(&format!("{lang}:{entity}:{hash}"), Some(new.clone()));
                        keep_later(&app, &lang, &entity, hash, &new);
                    }
                });
            }
            return Some(def);
        }
    }
    let def = fetch_definition(app, entity, hash, lang).await;
    remember(&cache_key, def.clone());
    if let Some(d) = &def {
        keep_later(app, lang, entity, hash, d);
    }
    def
}

/// A definition from Bungie (the manifest entity endpoint).
async fn fetch_definition(app: &AppHandle, entity: &str, hash: u64, lang: &str) -> Option<Value> {
    let (http, key) = http(app);
    let path = format!("/Destiny2/Manifest/{entity}/{hash}/?lc={lang}");
    api(&http, &key.ok()?, Method::GET, &path, None).await.ok()
}

/// In memory (every item, perk and mod looked at stays otherwise: start
/// over past a few thousand; they're in the game data anyway).
fn remember(cache_key: &str, def: Option<Value>) {
    let mut definitions = DEFINITIONS.lock().unwrap();
    let definitions = definitions.get_or_insert_default();
    if definitions.len() >= MAX_DEFINITIONS {
        definitions.clear();
    }
    definitions.insert(cache_key.to_string(), def);
}

/* ---------- Definitions kept (the game data, see db.rs) ---------- */

/// The current manifest's version (set when it's known).
static DEFINITIONS_VERSION: Mutex<Option<String>> = Mutex::new(None);
static DEFINITIONS_LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static DEFINITIONS_SAVING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// New definitions to write: (lang, entity, hash, JSON).
static TO_KEEP: Mutex<Vec<(String, String, u64, String)>> = Mutex::new(Vec::new());

/// The file definitions were kept in before the database.
fn definitions_path(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join("definitions-v1.json")
}

/// The old file's definitions, taken over into the game data once.
fn load_definitions(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    if DEFINITIONS_LOADED.swap(true, Ordering::SeqCst) {
        return;
    }
    #[derive(Deserialize)]
    struct DefinitionsFile {
        version: String,
        definitions: HashMap<String, Value>,
    }
    let path = definitions_path(app);
    let Some(file) = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<DefinitionsFile>(&s).ok()) else {
        return;
    };
    let rows: Vec<(String, String, u64, String, String)> = file
        .definitions
        .iter()
        .filter_map(|(key, def)| {
            let mut parts = key.splitn(3, ':');
            let (lang, entity, hash) = (parts.next()?, parts.next()?, parts.next()?.parse().ok()?);
            Some((lang.to_string(), entity.to_string(), hash, file.version.clone(), def.to_string()))
        })
        .collect();
    crate::db::set_definitions(app, &rows);
    let _ = std::fs::remove_file(path);
}

/// Written a few seconds after the last new definition (not on each).
fn keep_later(app: &AppHandle, lang: &str, entity: &str, hash: u64, def: &Value) {
    use std::sync::atomic::Ordering;
    TO_KEEP.lock().unwrap().push((lang.to_string(), entity.to_string(), hash, def.to_string()));
    if DEFINITIONS_SAVING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        DEFINITIONS_SAVING.store(false, Ordering::SeqCst);
        // (The manifest's version not known yet: asked for first.)
        if DEFINITIONS_VERSION.lock().unwrap().is_none() {
            let _ = manifest(&app).await;
        }
        let Some(version) = DEFINITIONS_VERSION.lock().unwrap().clone() else { return };
        let rows: Vec<_> = std::mem::take(&mut *TO_KEEP.lock().unwrap())
            .into_iter()
            .map(|(lang, entity, hash, data)| (lang, entity, hash, version.clone(), data))
            .collect();
        tauri::async_runtime::spawn_blocking(move || crate::db::set_definitions(&app, &rows));
    });
}

/// The current manifest: definitions kept of an older one are looked up
/// anew when used (served meanwhile); items looked up are dropped.
fn check_definitions(app: &AppHandle, version: &str) {
    load_definitions(app);
    let mut kept = DEFINITIONS_VERSION.lock().unwrap();
    if kept.as_deref().is_some_and(|v| v != version) {
        DEFINITIONS.lock().unwrap().take();
        ITEMS.lock().unwrap().take();
    }
    *kept = Some(version.to_string());
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetPerk {
    /// Pieces of the set needed for this bonus.
    required: u32,
    name: String,
    description: String,
    icon: Option<String>,
    active: bool,
    /// The exact numbers (Destiny Data Compendium), when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    exact: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArmorSet {
    name: String,
    /// Equipped pieces of the set.
    pieces: u32,
    perks: Vec<SetPerk>,
}

/// The armor sets among the equipped armor, with their bonuses (most
/// pieces first).
pub(crate) async fn armor_sets(app: &AppHandle, armor: &[ItemInfo]) -> Vec<ArmorSet> {
    let mut counts: Vec<(u64, u32)> = Vec::new();
    for set in armor.iter().filter_map(|a| a.set_hash) {
        match counts.iter_mut().find(|(h, _)| *h == set) {
            Some((_, n)) => *n += 1,
            None => counts.push((set, 1)),
        }
    }
    let sets = join_all(counts.into_iter().map(|(hash, pieces)| armor_set(app, hash, pieces))).await;
    let mut sets: Vec<ArmorSet> = sets.into_iter().flatten().collect();
    sets.sort_by_key(|s| std::cmp::Reverse(s.pieces));
    sets
}

/// An armor set with its bonuses, `pieces` of it worn (which bonuses are
/// active).
pub(crate) async fn armor_set(app: &AppHandle, hash: u64, pieces: u32) -> Option<ArmorSet> {
    {
        let (def, english_set) = futures::join!(
            definition(app, "DestinyEquipableItemSetDefinition", hash),
            definition_in(app, "DestinyEquipableItemSetDefinition", hash, "en"),
        );
        let def = def?;
        let name = def["displayProperties"]["name"].as_str().filter(|n| !n.is_empty())?.to_string();
        let english_set = english_set.and_then(|d| d["displayProperties"]["name"].as_str().map(String::from));
        let english_set = &english_set;
        let perks = join_all(def["setPerks"].as_array().cloned().unwrap_or_default().into_iter().map(|p| async move {
            let required = p["requiredSetCount"].as_u64()? as u32;
            let hash = p["sandboxPerkHash"].as_u64()?;
            let (perk, english) = futures::join!(
                definition(app, "DestinySandboxPerkDefinition", hash),
                definition_in(app, "DestinySandboxPerkDefinition", hash, "en"),
            );
            let perk = perk?;
            let shown = &perk["displayProperties"];
            // By set and pieces first (the sheet names some bonuses
            // differently), else by the bonus's name.
            let by_set = match english_set {
                Some(set) => crate::compendium::set_bonus(set, required),
                None => None,
            };
            let exact = match (by_set, english.as_ref().and_then(|e| e["displayProperties"]["name"].as_str())) {
                (Some(text), _) => Some(text),
                (None, Some(name)) => crate::compendium::exact(name),
                (None, None) => None,
            };
            Some(SetPerk {
                required,
                name: shown["name"].as_str().unwrap_or_default().into(),
                description: shown["description"].as_str().unwrap_or_default().into(),
                icon: shown["icon"].as_str().map(Into::into),
                active: pieces >= required,
                exact,
            })
        }))
        .await;
        let mut perks: Vec<SetPerk> = perks.into_iter().flatten().collect();
        perks.sort_by_key(|p| p.required);
        Some(ArmorSet { name, pieces, perks })
    }
}

/* ---------- Player profile ---------- */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterInfo {
    id: String,
    class_name: String,
    light: i64,
    emblem_path: Option<String>,
    emblem_background_path: Option<String>,
    /// The emblem as on the character screen's header: a wide banner
    /// (~1958×146) and the emblem's icon cut out (PNG) to put on its left.
    emblem_banner: Option<String>,
    emblem_overlay: Option<String>,
    #[serde(skip)]
    emblem_hash: u64,
    last_played: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatValue {
    hash: u64,
    name: String,
    icon: Option<String>,
    value: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Clears {
    name: String,
    clears: u32,
    /// Fastest completion Bungie recorded for any version of the activity.
    fastest_ms: Option<u64>,
    /// When it came out (RFC 3339; the list is sorted by it, newest first).
    released: Option<String>,
    /// Its artwork (Bungie's PGCR image, full URL).
    image: Option<String>,
    /// The same artwork as an older one's ("Epic" of a raid): shown in a
    /// look of its own.
    image_variant: bool,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Totals {
    raid_clears: Option<u32>,
    dungeon_clears: Option<u32>,
    pvp_kd: Option<f64>,
    pvp_kda: Option<f64>,
    pvp_kills: Option<u32>,
    pvp_deaths: Option<u32>,
    pvp_matches: Option<u32>,
    pvp_wins: Option<u32>,
    pvp_best_game_kills: Option<u32>,
    pvp_longest_spree: Option<u32>,
    trials_kd: Option<f64>,
    trials_kills: Option<u32>,
    trials_matches: Option<u32>,
    trials_wins: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Subclass {
    item: ItemInfo,
    plugs: Vec<ItemInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDetail {
    membership_id: String,
    membership_type: i64,
    display_name: String,
    characters: Vec<CharacterInfo>,
    subclass: Option<Subclass>,
    weapons: Vec<ItemInfo>,
    armor: Vec<ItemInfo>,
    armor_sets: Vec<ArmorSet>,
    stats: Vec<StatValue>,
    totals: Totals,
    raids: Vec<Clears>,
    dungeons: Vec<Clears>,
    exotics: Vec<Clears>,
    /// Every character's equipped build (characters' order).
    builds: Vec<CharacterBuild>,
    /// The Pantheon (both), apart from the raids.
    pantheon: Vec<Clears>,
    /// Sections that could not be loaded (e.g. private profile).
    warnings: Vec<String>,
    fetched_at: i64,
}

fn basic(v: &Value) -> Option<f64> {
    v["basic"]["value"].as_f64()
}

fn mode_totals(stats: &Value, totals: &mut Totals) {
    let all = |mode: &str, name: &str| basic(&stats[mode]["allTime"][name]);
    totals.raid_clears = all("raid", "activitiesCleared").map(|v| v as u32);
    totals.dungeon_clears = all("dungeon", "activitiesCleared").map(|v| v as u32);
    let count = |mode: &str, name: &str| all(mode, name).map(|v| v as u32);
    totals.pvp_kd = all("allPvP", "killsDeathsRatio");
    totals.pvp_kda = all("allPvP", "killsDeathsAssists");
    totals.pvp_kills = count("allPvP", "kills");
    totals.pvp_deaths = count("allPvP", "deaths");
    totals.pvp_best_game_kills = count("allPvP", "bestSingleGameKills");
    totals.pvp_longest_spree = count("allPvP", "longestKillSpree");
    totals.trials_kills = count("trials_of_osiris", "kills");
    totals.pvp_matches = all("allPvP", "activitiesEntered").map(|v| v as u32);
    totals.pvp_wins = all("allPvP", "activitiesWon").map(|v| v as u32);
    totals.trials_kd = all("trials_of_osiris", "killsDeathsRatio");
    totals.trials_matches = all("trials_of_osiris", "activitiesEntered").map(|v| v as u32);
    totals.trials_wins = all("trials_of_osiris", "activitiesWon").map(|v| v as u32);
}

async fn build_detail(app: &AppHandle, membership_id: &str) -> Result<PlayerDetail, String> {
    let member = resolve_member(app, membership_id)
        .await
        .ok_or(tr("Spieler nicht gefunden", "Player not found"))?;
    let mt = member.membership_type;
    let (http, key) = http(app);
    let key = key?;
    let mut warnings = Vec::new();

    // 200 Characters, 205 CharacterEquipment, 305 ItemSockets
    let profile_path = format!("/Destiny2/{mt}/Profile/{membership_id}/?components=200,205,305");
    let stats_path = format!("/Destiny2/{mt}/Account/{membership_id}/Character/0/Stats/?modes=4,82,5,84&groups=1");
    // The account's stats list deleted characters too: their clears count.
    let account_path = format!("/Destiny2/{mt}/Account/{membership_id}/Stats/?groups=1");
    let (profile, history, manifest, account) = futures::join!(
        api(&http, &key, Method::GET, &profile_path, None),
        api(&http, &key, Method::GET, &stats_path, None),
        manifest(app),
        api(&http, &key, Method::GET, &account_path, None),
    );
    let profile = profile?;

    let mut characters: Vec<CharacterInfo> = profile["characters"]["data"]
        .as_object()
        .map(|chars| {
            chars
                .iter()
                .map(|(id, c)| CharacterInfo {
                    id: id.clone(),
                    class_name: class_name(c["classType"].as_i64().unwrap_or(-1)).into(),
                    light: c["light"].as_i64().unwrap_or(0),
                    emblem_path: c["emblemPath"].as_str().map(Into::into),
                    emblem_background_path: c["emblemBackgroundPath"].as_str().map(Into::into),
                    emblem_banner: None,
                    emblem_overlay: None,
                    emblem_hash: c["emblemHash"].as_u64().unwrap_or(0),
                    last_played: c["dateLastPlayed"].as_str().map(Into::into),
                })
                .collect()
        })
        .unwrap_or_default();
    characters.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    // The shown character's emblem as on the character screen.
    if let Some(c) = characters.first_mut().filter(|c| c.emblem_hash != 0) {
        if let Some(d) = definition(app, "DestinyInventoryItemDefinition", c.emblem_hash).await {
            let path = |key: &str| d[key].as_str().filter(|s| !s.is_empty()).map(String::from);
            c.emblem_banner = path("secondarySpecial");
            c.emblem_overlay = path("secondaryOverlay");
        }
    }

    // Every character's build at once (items are cached); the most recently
    // played one's also as the detail's own.
    let builds: Vec<CharacterBuild> =
        join_all(characters.iter().map(|c| character_build(app, &profile, &c.id, &manifest))).await;
    let first = builds.first().cloned().unwrap_or_default();
    let (subclass, weapons, armor, sets, stats) = (first.subclass, first.weapons, first.armor, first.armor_sets, first.stats);
    if weapons.is_empty() && armor.is_empty() && !characters.is_empty() {
        warnings.push(tr("Ausrüstung nicht sichtbar", "Gear not visible").into());
    }

    let mut totals = Totals::default();
    match &history {
        Ok(h) => mode_totals(h, &mut totals),
        Err(_) => warnings.push(tr("Statistiken nicht verfügbar", "Stats unavailable").into()),
    }

    // Clears per raid / dungeon / exotic mission, summed over all
    // characters (keyed by kind: 0 dungeon, 1 raid, 2 exotic mission, 3 the
    // Pantheon: RaidHub's 101 and 102, a tab of its own).
    let mut raids = Vec::new();
    let mut dungeons = Vec::new();
    let mut exotics = Vec::new();
    let mut pantheon = Vec::new();
    let kind_of = |hash: u64, k: &ActivityKind| -> u8 {
        if k.raid && crate::raidtags::activity_version(hash).is_some_and(|(a, _)| a == 101 || a == 102) {
            3
        } else if k.raid {
            1
        } else if k.exotic {
            2
        } else {
            0
        }
    };
    match &manifest {
        Ok(m) => {
            // Every character's, deleted ones too (else only the current).
            let mut ids: Vec<String> = account
                .as_ref()
                .ok()
                .and_then(|a| a["characters"].as_array())
                .into_iter()
                .flatten()
                .filter_map(|c| c["characterId"].as_str().map(String::from))
                .collect();
            if ids.is_empty() {
                ids = characters.iter().map(|c| c.id.clone()).collect();
            }
            let aggregates = join_all(ids.iter().map(|id| {
                let path = format!("/Destiny2/{mt}/Account/{membership_id}/Character/{id}/Stats/AggregateActivityStats/");
                let (http, key) = (http.clone(), key.clone());
                async move { api(&http, &key, Method::GET, &path, None).await }
            }))
            .await;
            let mut sums: HashMap<(u8, String), (u32, Option<u64>)> = HashMap::new();
            for aggregate in aggregates.iter().flatten() {
                for a in aggregate["activities"].as_array().into_iter().flatten() {
                    let Some((hash, kind)) = a["activityHash"].as_u64().and_then(|h| Some((h, m.activities.get(&h)?))) else {
                        continue;
                    };
                    let clears = basic(&a["values"]["activityCompletions"]).unwrap_or(0.0) as u32;
                    if clears == 0 {
                        continue;
                    }
                    let fastest = basic(&a["values"]["fastestCompletionMsForActivity"])
                        .map(|v| v as u64)
                        .filter(|&ms| ms > 0);
                    let entry = sums.entry((kind_of(hash, kind), kind.name.clone())).or_default();
                    entry.0 += clears;
                    entry.1 = match (entry.1, fastest) {
                        (Some(a), Some(b)) => Some(a.min(b)),
                        (a, b) => a.or(b),
                    };
                }
            }
            if aggregates.iter().any(Result::is_err) {
                warnings.push(tr("Aktivitäten teilweise nicht verfügbar", "Some activities unavailable").into());
            }
            // Every raid and dungeon, with no clears too. Raids as RaidHub
            // lists them, but not its 102 (Pantheon with Bungie's featured
            // playlists, "Featured Encore"): those only with clears.
            for (&hash, kind) in &m.activities {
                let listed = crate::raidtags::activity_version(hash).is_some_and(|(activity, _)| activity != 102)
                    || crate::raidtags::is_pantheon_version(hash);
                if !kind.name.is_empty() && (!kind.raid || listed) {
                    sums.entry((kind_of(hash, kind), kind.name.clone())).or_default();
                }
            }
            // Each one's release and artwork: a raid's release by its
            // RaidHub activity, a dungeon's by its English name; the artwork
            // from the first of its activities that has one.
            let mut hashes: HashMap<(u8, String), Vec<u64>> = HashMap::new();
            for (&hash, kind) in &m.activities {
                hashes.entry((kind_of(hash, kind), kind.name.clone())).or_default().push(hash);
            }
            let looks = join_all(sums.keys().map(|(kind, name)| {
                let mut hashes = hashes.get(&(*kind, name.clone())).cloned().unwrap_or_default();
                hashes.sort_unstable();
                let (raid, exotic, app) = (*kind == 1 || *kind == 3, *kind == 2, &app);
                async move {
                    let defs = join_all(
                        hashes.iter().take(4).map(|&h| definition_in(app, "DestinyActivityDefinition", h, "en")),
                    )
                    .await;
                    let image = defs
                        .iter()
                        .flatten()
                        .find_map(|d| {
                            d["pgcrImage"]
                                .as_str()
                                .filter(|p| !p.is_empty() && !p.contains("missing") && !p.contains("placeholder"))
                        })
                        .map(|p| format!("https://www.bungie.net{p}"));
                    // The Desert Perpetual and its Epic share one image in
                    // the manifest: the normal one shows Bungie's key art of
                    // the raid (from its launch article) instead.
                    // …and the Epic one its final encounter, shipped with
                    // the app (public/raids).
                    let is = |activity: u16| {
                        raid && hashes.iter().any(|&h| crate::raidtags::activity_version(h).is_some_and(|(a, _)| a == activity))
                    };
                    let image = if is(15) {
                        Some(DESERT_PERPETUAL_ART.to_string())
                    } else if is(16) {
                        Some("/raids/desert-perpetual-epic.webp".to_string())
                    } else if let Some(art) = raid.then(|| hashes.iter().find_map(|&h| first_pantheon_art(h))).flatten() {
                        Some(format!("https://www.bungie.net/img/destiny_content/pgcr/{art}"))
                    } else {
                        image
                    };
                    let released = if raid {
                        hashes.iter().find_map(|&h| crate::raidtags::release(h))
                    } else if exotic {
                        defs.iter()
                            .flatten()
                            .find_map(|d| exotic_release(d["displayProperties"]["name"].as_str()?))
                    } else {
                        defs.iter().flatten().find_map(|d| {
                            let english = d["displayProperties"]["name"].as_str()?.split(':').next()?.trim().to_string();
                            crate::clears::dungeon_release(&english)
                        })
                    };
                    (released, image)
                }
            }))
            .await;
            for (((kind, name), (clears, fastest_ms)), (released, image)) in sums.into_iter().zip(looks) {
                let entry = Clears {
                    name,
                    clears,
                    fastest_ms,
                    released: released.map(String::from),
                    image,
                    image_variant: false,
                };
                match kind {
                    1 => raids.push(entry),
                    2 => exotics.push(entry),
                    3 => pantheon.push(entry),
                    _ => dungeons.push(entry),
                }
            }
            // An artwork an older one has already: the newer one's look
            // differs.
            for list in [&mut raids, &mut dungeons, &mut exotics, &mut pantheon] {
                list.sort_by(|a, b| a.released.cmp(&b.released));
                let mut seen = std::collections::HashSet::new();
                for c in list.iter_mut() {
                    if let Some(image) = &c.image {
                        c.image_variant = !seen.insert(image.clone());
                    }
                }
            }
            // Newest first (none known: at the end, by clears).
            let order = |a: &Clears, b: &Clears| b.released.cmp(&a.released).then(b.clears.cmp(&a.clears));
            raids.sort_by(order);
            dungeons.sort_by(order);
            exotics.sort_by(order);
            pantheon.sort_by(order);
        }
        Err(e) => warnings.push(format!("{}: {e}", tr("Manifest nicht geladen", "Manifest not loaded"))),
    }

    Ok(PlayerDetail {
        membership_id: membership_id.to_string(),
        membership_type: mt,
        display_name: member.display_name,
        characters,
        subclass,
        weapons,
        armor,
        armor_sets: sets,
        stats,
        totals,
        raids,
        dungeons,
        exotics,
        builds,
        pantheon,
        warnings,
        fetched_at: chrono::Utc::now().timestamp_millis(),
    })
}

/// One character's equipped build: subclass and its plugs, weapons, armor
/// (and its sets), stats.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterBuild {
    character_id: String,
    subclass: Option<Subclass>,
    weapons: Vec<ItemInfo>,
    armor: Vec<ItemInfo>,
    armor_sets: Vec<ArmorSet>,
    stats: Vec<StatValue>,
}

async fn character_build(
    app: &AppHandle,
    profile: &Value,
    character_id: &str,
    manifest: &Result<ManifestCache, String>,
) -> CharacterBuild {
    let mut subclass = None;
    let mut stats = Vec::new();
    let equipped = profile["characterEquipment"]["data"][character_id]["items"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let in_bucket = |buckets: &[u64]| {
        let mut found: Vec<&Value> = equipped
            .iter()
            .filter(|i| i["bucketHash"].as_u64().is_some_and(|b| buckets.contains(&b)))
            .collect();
        found.sort_by_key(|i| buckets.iter().position(|b| Some(*b) == i["bucketHash"].as_u64()));
        found
    };
    let lookup = |hashes: Vec<u64>| join_all(hashes.into_iter().map(|h| item(app, h)));

    let sockets = &profile["itemComponents"]["sockets"]["data"];
    let (equipped_weapons, equipped_armor) = futures::join!(
        join_all(in_bucket(&WEAPON_BUCKETS).into_iter().map(|i| equipped_item(app, i, sockets))),
        join_all(in_bucket(&ARMOR_BUCKETS).into_iter().map(|i| equipped_item(app, i, sockets))),
    );
    let weapons: Vec<ItemInfo> = equipped_weapons.into_iter().flatten().collect();
    let armor: Vec<ItemInfo> = equipped_armor.into_iter().flatten().collect();
    let armor_sets = armor_sets(app, &armor).await;

    if let Some(sub) = in_bucket(&[SUBCLASS]).first() {
        let sockets = sub["itemInstanceId"]
            .as_str()
            .map(|id| &profile["itemComponents"]["sockets"]["data"][id]["sockets"])
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let plug_hashes = sockets.iter().filter_map(|s| s["plugHash"].as_u64()).collect();
        let (sub_item, plugs) = futures::join!(
            item(app, sub["itemHash"].as_u64().unwrap_or(0)),
            lookup(plug_hashes),
        );
        if let Some(sub_item) = sub_item {
            subclass = Some(Subclass {
                item: sub_item,
                plugs: plugs.into_iter().flatten().filter(|p| !p.type_name.is_empty()).collect(),
            });
        }
    }

    if let (Ok(m), Some(values)) =
        (manifest, profile["characters"]["data"][character_id]["stats"].as_object())
    {
        stats = values
            .iter()
            .filter(|(hash, _)| hash.as_str() != POWER_STAT)
            .filter_map(|(hash, v)| {
                let hash: u64 = hash.parse().ok()?;
                let info = m.stats.get(&hash)?;
                Some(StatValue {
                    hash,
                    name: info.name.clone(),
                    icon: info.icon.clone(),
                    value: v.as_i64().unwrap_or(0),
                })
            })
            .collect();
    }

    CharacterBuild { character_id: character_id.to_string(), subclass, weapons, armor, armor_sets, stats }
}

/// Profile for the Fireteam tab. Cached for DETAIL_TTL unless `force`.
#[tauri::command]
pub async fn fireteam_player(
    app: AppHandle,
    membership_id: String,
    force: Option<bool>,
) -> Result<PlayerDetail, String> {
    let cache_key = format!("{}:{membership_id}", locale());
    if !force.unwrap_or(false) {
        let cached = DETAILS
            .lock()
            .unwrap()
            .get_or_insert_default()
            .get(&cache_key)
            .filter(|(at, _)| at.elapsed() < DETAIL_TTL)
            .map(|(_, d)| d.clone());
        if let Some(detail) = cached {
            return Ok(detail);
        }
    }
    let detail = build_detail(&app, &membership_id).await?;
    let mut details = DETAILS.lock().unwrap();
    let details = details.get_or_insert_default();
    // Expired ones go (they'd only be fetched again anyway).
    details.retain(|_, (at, _)| at.elapsed() < DETAIL_TTL);
    details.insert(cache_key, (Instant::now(), detail.clone()));
    Ok(detail)
}

/// Look up any player by Bungie name ("Name#1234") and return their
/// membership id, for opening their profile in the Fireteam tab.
#[tauri::command]
pub async fn fireteam_search(app: AppHandle, name: String) -> Result<String, String> {
    let (display_name, code) = name
        .trim()
        .rsplit_once('#')
        .and_then(|(n, c)| Some((n.trim(), c.trim().parse::<u32>().ok()?)))
        .filter(|(n, _)| !n.is_empty())
        .ok_or(tr("Bitte im Format Name#1234 eingeben", "Please use the format Name#1234"))?;
    find_by_name(&app, display_name, code).await.map(|(id, _)| id)
}

/// The playing account (membership id and type) of the exact Bungie name.
async fn find_by_name(app: &AppHandle, display_name: &str, code: u32) -> Result<(String, i64), String> {
    let (http, key) = http(app);
    let results = api(
        &http,
        &key?,
        Method::POST,
        "/Destiny2/SearchDestinyPlayerByBungieName/All/",
        Some(serde_json::json!({ "displayName": display_name, "displayNameCode": code })),
    )
    .await?;
    let not_found = tr("Spieler nicht gefunden", "Player not found");
    let cards = results.as_array().filter(|a| !a.is_empty()).ok_or(not_found)?;
    let cross = cards[0]["crossSaveOverride"].as_i64().unwrap_or(0);
    let card = cards
        .iter()
        .find(|c| cross != 0 && c["membershipType"].as_i64() == Some(cross))
        .unwrap_or(&cards[0]);
    let id = card["membershipId"].as_str().ok_or(not_found)?;
    Ok((id.into(), card["membershipType"].as_i64().unwrap_or(0)))
}

/// What a suggested player shows: emblem and whether they're online.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCard {
    emblem: Option<String>,
    online: bool,
    /// When they played last (ISO time), for sorting suggestions.
    last_played: Option<String>,
    /// No Destiny 2 profile (the name search finds those too): not shown.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    no_destiny: bool,
}

/// Forget the players' details and cards: their item and activity names are
/// in the old language (the language changed).
pub(crate) fn forget_names() {
    *DETAILS.lock().unwrap() = None;
    *CARDS.lock().unwrap() = None;
}

/// Cards of players (by membership id), reused for a minute.
static CARDS: Mutex<Option<HashMap<String, (Instant, PlayerCard)>>> = Mutex::new(None);
const CARD_TTL: Duration = Duration::from_secs(60);

/// A player's emblem (most recently played character) and online status:
/// online while a character is in an activity (Bungie shows that unless
/// the player hides it).
#[tauri::command]
pub async fn fireteam_player_card(app: AppHandle, membership_type: i64, membership_id: String) -> Result<PlayerCard, String> {
    player_card(&app, membership_type, membership_id).await
}

async fn player_card(app: &AppHandle, membership_type: i64, membership_id: String) -> Result<PlayerCard, String> {
    if let Some((at, card)) = CARDS.lock().unwrap().get_or_insert_default().get(&membership_id) {
        if at.elapsed() < CARD_TTL {
            return Ok(card.clone());
        }
    }
    let (http, key) = http(app);
    let profile = match api(
        &http,
        &key?,
        Method::GET,
        &format!("/Destiny2/{membership_type}/Profile/{membership_id}/?components=200,204"),
        None,
    )
    .await
    {
        Ok(profile) => profile,
        Err(e) if crate::bungie::no_destiny_account(&e) => {
            return Ok(PlayerCard { emblem: None, online: false, last_played: None, no_destiny: true });
        }
        Err(e) => return Err(e),
    };
    let last = profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .max_by_key(|(_, c)| c["dateLastPlayed"].as_str().unwrap_or("").to_string());
    let emblem = last.and_then(|(_, c)| c["emblemPath"].as_str().map(String::from));
    let last_played = last.and_then(|(_, c)| c["dateLastPlayed"].as_str().map(String::from));
    let online = profile["characterActivities"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .any(|(_, a)| a["currentActivityHash"].as_u64().is_some_and(|h| h != 0));
    let card = PlayerCard { emblem, online, last_played, no_destiny: false };
    let mut cards = CARDS.lock().unwrap();
    let cards = cards.get_or_insert_default();
    cards.retain(|_, (at, _)| at.elapsed() < CARD_TTL);
    cards.insert(membership_id, (Instant::now(), card.clone()));
    Ok(card)
}

/// A player suggested while typing a name.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSuggestion {
    /// "Name#1234"
    name: String,
    membership_id: String,
    membership_type: i64,
    /// When they played last (ISO time).
    last_played: Option<String>,
}

/// Players whose Bungie name starts with `prefix` (Bungie's global name
/// search), those that play Destiny 2 only, at most `MAX_SUGGESTIONS`:
/// whoever played last first (Bungie lists them by number, so a common
/// name's first page is mostly long-gone players).
#[tauri::command]
pub async fn fireteam_suggest(app: AppHandle, prefix: String) -> Result<Vec<PlayerSuggestion>, String> {
    const MAX_SUGGESTIONS: usize = 20;
    // All the pages hold (6 × ~25), each player's profile asked a few at a time.
    const MAX_CANDIDATES: usize = 160;
    const PROFILES_AT_ONCE: usize = 64;
    // Bungie's name search goes page by page (about 25 a page) in no useful
    // order and stops after 5 or 6 pages, however common the name: all it
    // gives is read, at once. Who isn't in it is only found by the full
    // name with its number (looked up exactly, below).
    const MAX_PAGES: u32 = 8;
    // The search is by name; the code after "#" narrows the results here.
    let (name, code) = match prefix.trim().split_once('#') {
        Some((n, c)) => (n.trim().to_string(), c.trim().to_string()),
        None => (prefix.trim().to_string(), String::new()),
    };
    if name.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let mut out: Vec<PlayerSuggestion> = Vec::new();
    // Looked up exactly (found whatever the pages hold): the complete name,
    // or with 3 digits typed the 10 numbers it can still be.
    if code.chars().all(|c| c.is_ascii_digit()) && (code.len() == 3 || code.len() == 4) {
        let numbers: Vec<String> =
            if code.len() == 4 { vec![code.clone()] } else { (0..10).map(|d| format!("{code}{d}")).collect() };
        let found = join_all(numbers.iter().map(|n| find_by_name(&app, &name, n.parse().unwrap_or(0)))).await;
        for (number, result) in numbers.iter().zip(found) {
            if let Ok((id, membership_type)) = result {
                out.push(PlayerSuggestion { name: format!("{name}#{number}"), membership_id: id, membership_type, last_played: None });
            }
        }
    }
    let (http, key) = http(&app);
    let key = key?;
    let pages = join_all((0..MAX_PAGES).map(|page| {
        let (http, key, name) = (http.clone(), key.clone(), name.clone());
        async move {
            api(
                &http,
                &key,
                Method::POST,
                &format!("/User/Search/GlobalName/{page}/"),
                Some(serde_json::json!({ "displayNamePrefix": name })),
            )
            .await
        }
    }))
    .await;
    // The full name typed: those first, whenever they played.
    let exact = out.len();
    'pages: for found in pages {
        // A page past the end (or one Bungie didn't answer): skipped.
        let Ok(found) = found else { continue };
        for user in found["searchResults"].as_array().into_iter().flatten() {
            let Some(global) = user["bungieGlobalDisplayName"].as_str() else { continue };
            let number = format!("{:04}", user["bungieGlobalDisplayNameCode"].as_u64().unwrap_or(0));
            if !number.starts_with(&code) {
                continue;
            }
            // The account that plays (cross save), else the first one.
            let cards = user["destinyMemberships"].as_array().cloned().unwrap_or_default();
            let Some(first) = cards.first() else { continue };
            let cross = first["crossSaveOverride"].as_i64().unwrap_or(0);
            let card = cards.iter().find(|c| cross != 0 && c["membershipType"].as_i64() == Some(cross)).unwrap_or(first);
            let Some(id) = card["membershipId"].as_str() else { continue };
            if out.iter().any(|s| s.membership_id == id) {
                continue;
            }
            out.push(PlayerSuggestion {
                name: format!("{global}#{number}"),
                membership_id: id.into(),
                membership_type: card["membershipType"].as_i64().unwrap_or(0),
                last_played: None,
            });
            if out.len() == MAX_CANDIDATES {
                break 'pages;
            }
        }
    }
    // When each played last (their profiles; the cards the list shows come
    // from the same, cached): the latest first, no Destiny 2 profile left out.
    let jobs: Vec<_> = out
        .iter()
        .map(|s| {
            let app = app.clone();
            let (t, id) = (s.membership_type, s.membership_id.clone());
            Box::pin(async move { player_card(&app, t, id).await.ok() })
                as std::pin::Pin<Box<dyn std::future::Future<Output = Option<PlayerCard>> + Send>>
        })
        .collect();
    let cards: Vec<Option<PlayerCard>> = futures::stream::iter(jobs).buffered(PROFILES_AT_ONCE).collect().await;
    let mut out: Vec<(usize, PlayerSuggestion)> = out
        .into_iter()
        .zip(cards)
        .enumerate()
        .filter(|(_, (_, card))| !card.as_ref().is_some_and(|c| c.no_destiny))
        .map(|(i, (mut s, card))| {
            s.last_played = card.and_then(|c| c.last_played);
            (i, s)
        })
        .collect();
    out.sort_by(|(i, a), (j, b)| (*i >= exact).cmp(&(*j >= exact)).then(b.last_played.cmp(&a.last_played)));
    Ok(out.into_iter().map(|(_, s)| s).take(MAX_SUGGESTIONS).collect())
}

/* ---------- A guardian of a character screen, by name and emblem ---------- */

/// A player named as on a character screen, and how alike their emblem is
/// to the one there (1 the same, None: not compared).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GuardianCandidate {
    /// "Name#1234"
    name: String,
    membership_id: String,
    membership_type: i64,
    score: Option<f64>,
    /// Why it scored so: "activity" (in yours now), "recent" (played with
    /// you lately), "emblem" (alike); None: not weighed.
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

/// A picture as a comparable signature: 24×24 grey, over black (an
/// overlay icon's transparent parts dark, as on screen), normalized to
/// zero mean and unit length (brightness and contrast don't count).
fn emblem_signature(img: &image::RgbaImage) -> Vec<f32> {
    let small = image::imageops::resize(img, 24, 24, image::imageops::FilterType::Triangle);
    let grey: Vec<f32> = small
        .pixels()
        .map(|p| {
            let a = p[3] as f32 / 255.0;
            (p[0] as f32 * 0.3 + p[1] as f32 * 0.59 + p[2] as f32 * 0.11) * a
        })
        .collect();
    let mean = grey.iter().sum::<f32>() / grey.len() as f32;
    let centered: Vec<f32> = grey.iter().map(|g| g - mean).collect();
    let len = centered.iter().map(|g| g * g).sum::<f32>().sqrt().max(1e-3);
    centered.into_iter().map(|g| g / len).collect()
}

/// Downloaded emblem pictures, by path (each is fetched once a run).
static EMBLEM_IMAGES: Mutex<Option<HashMap<String, Option<Vec<f32>>>>> = Mutex::new(None);

async fn emblem_image(http: &reqwest::Client, path: &str) -> Option<Vec<f32>> {
    if let Some(cached) = EMBLEM_IMAGES.lock().unwrap().get_or_insert_default().get(path) {
        return cached.clone();
    }
    let bytes = http.get(format!("https://www.bungie.net{path}")).send().await.ok()?.bytes().await.ok();
    let sig = bytes.and_then(|b| image::load_from_memory(&b).ok()).map(|i| emblem_signature(&i.to_rgba8()));
    EMBLEM_IMAGES.lock().unwrap().get_or_insert_default().insert(path.to_string(), sig.clone());
    sig
}

impl GuardianCandidate {
    /// "Name#1234"
    pub(crate) fn name(&self) -> &str {
        &self.name
    }
}

/// How sure Radar's own reading of a name must be to pick its spelling
/// among others that are players too.
const SURE_READING: f32 = 0.95;

/// An emblem this alike, and this much more alike than the next player's,
/// is the one on screen (as the inspect page decides too).
const SURE: f64 = 0.75;
const AHEAD: f64 = 0.1;

/// The one of `list` (as `resolve_guardian` sorts it) that surely is the
/// guardian on screen, if any.
pub(crate) fn sure_guardian(list: &[GuardianCandidate]) -> Option<&GuardianCandidate> {
    let first = list.first()?;
    if list.len() == 1 {
        return Some(first);
    }
    let score = first.score?;
    let next = list.get(1).and_then(|c| c.score);
    (score >= SURE && next.is_none_or(|n| score - n >= AHEAD)).then_some(first)
}

/// Who a character screen's name is, looked up once per name for a while
/// (the notice asks, the inspect page asks again).
static RESOLVED: Mutex<Option<HashMap<String, (Instant, Vec<GuardianCandidate>)>>> = Mutex::new(None);
const RESOLVED_TTL: Duration = Duration::from_secs(600);

/// The players a character screen's name can be: you or one of your
/// fireteam (sure), else everyone of that name, the most alike emblem first.
/// A name's letters and digits, lower case: names compared so match
/// however a "_" (or "-", ".", a space) was read: as itself, a space, or
/// not at all.
fn plain_name(name: &str) -> String {
    name.chars()
        .map(latin_look_alike)
        .collect::<String>()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        // Read alike, one for the other: l, I and 1; O and 0.
        .map(|c| match c {
            'l' | 'i' => '1',
            'o' => '0',
            c => c,
        })
        .collect()
}

/// The Latin letter a character of another script stands for in "fancy"
/// names ("★尺E卂卩E尺★" is REAPER), with what Radar's own reading reads
/// for those it doesn't know (卂 as 凡, 卩 as 口); full-width letters and
/// digits as plain ones. Others as they are.
fn latin_look_alike(c: char) -> char {
    if let Some((latin, _)) = LOOK_ALIKES.iter().find(|(_, glyphs)| glyphs.contains(c)) {
        return *latin;
    }
    match c {
        // Full-width forms (Ａ, ａ, ０, ［).
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        c => c,
    }
}

/// Characters of other scripts "fancy" names use for Latin letters.
const LOOK_ALIKES: [(char, &str); 26] = [
    ('a', "卂凡丹ﾑムΛ"),
    ('b', "乃"),
    ('c', "匚ㄈ"),
    ('d', "ᗪ刀"),
    ('e', "乇モヨΣ"),
    ('f', "千ｷキ"),
    ('g', "Ꮆ"),
    ('h', "卄廾ん"),
    ('i', "丨工ｴ"),
    ('j', "ﾌフ"),
    ('k', "Ҝ"),
    ('l', "ㄥレﾚ"),
    ('m', "爪ﾶ"),
    ('n', "几れ"),
    ('o', "ㄖ口回ロ○◯"),
    ('p', "卩ㄗ尸"),
    ('q', "Ɋ"),
    ('r', "尺"),
    ('s', "丂"),
    ('t', "ㄒイ"),
    ('u', "ㄩ凵ひ"),
    ('v', "ᐯ"),
    ('w', "山ฟ"),
    ('x', "乂メﾒ"),
    ('y', "ㄚ丫"),
    ('z', "乙"),
];

/// Whether a name read (`read`, see `plain_name`) is `name`: the same
/// letters and digits; for a name in another script (read by Radar's own
/// reading, a character off at times: "★尺EAE尺★") alike enough.
fn same_name(read: &str, name: &str) -> bool {
    let (a, b) = (plain_name(read), plain_name(name));
    if a.is_empty() && b.is_empty() {
        // Symbols only ("[...]"): the same ones (full-width as plain).
        let symbols = |s: &str| s.trim().chars().map(latin_look_alike).filter(|c| !c.is_whitespace()).collect::<String>();
        return !symbols(read).is_empty() && symbols(read) == symbols(name);
    }
    if a == b {
        return !a.is_empty();
    }
    let other_script = read.chars().any(|c| !c.is_ascii());
    other_script && a.chars().count() >= 4 && strsim::jaro_winkler(&a, &b) >= 0.88
}

/// The spellings of a guardian's name and of the other reading of it (see
/// `weapons::guardian_alt`), in turn: likeliest of each first.
fn spellings_of(name: &str) -> Vec<String> {
    let mut lists = vec![spellings(name)];
    lists.extend(crate::weapons::guardian_alt(name).iter().map(|(alt, _)| spellings(alt)));
    let mut out: Vec<String> = Vec::new();
    for i in 0..lists.iter().map(Vec::len).max().unwrap_or(0) {
        for list in &lists {
            if let Some(v) = list.get(i).filter(|v| !out.contains(v)) {
                out.push(v.clone());
            }
        }
    }
    out
}

/// The start of a name read from the screen that is surely right: up to
/// the first character often misread (l / I / 1, O / 0) or a "_" (often
/// lost). "Lamine Yama1684" -> "Lamine Yama".
fn sure_start(name: &str) -> String {
    let name = name.trim();
    let start: String = name.chars().take_while(|c| (c.is_alphanumeric() || *c == ' ') && !"lI1|0O".contains(*c)).collect();
    let start = start.trim_end().to_string();
    if start.chars().count() >= 2 {
        start
    } else {
        name.chars().take_while(|c| c.is_alphanumeric()).collect()
    }
}

/// The ways a name read off the screen may be spelled, likeliest first
/// (Bungie's search finds exact names only): characters read alike swapped
/// (l, I and 1; O and 0; "_" for a space or dash); in a "fancy" name
/// (other scripts), a letter for a look-alike Radar's reading doesn't know
/// (it reads 卂 as A, 卩 as P: "★尺EAPE尺★" is "★尺E卂卩E尺★").
fn spellings(name: &str) -> Vec<String> {
    // Read tidied up first (a stray "'" dropped, the space after a comma
    // back: "Moth,Watcher of 'Light" is "Moth, Watcher of Light"), then as read.
    let tidy = tidied(name);
    // A single character split off by a space ("Chris Y" for "Chrisツ"):
    // joined on too.
    let joined = tidy.split(' ').any(|w| w.chars().count() == 1).then(|| tidy.replace(' ', ""));
    if tidy == name.trim() && joined.is_none() {
        return spellings_as_read(name);
    }
    let lists: Vec<Vec<String>> = [Some(tidy.clone()), joined, Some(name.to_string())].into_iter().flatten().map(|n| spellings_as_read(&n)).collect();
    let mut out: Vec<String> = Vec::new();
    for i in 0..lists.iter().map(Vec::len).max().unwrap_or(0) {
        for v in lists.iter().filter_map(|l| l.get(i)) {
            if !out.contains(v) {
                out.push(v.clone());
            }
        }
    }
    out
}

/// A name read with its specks of punctuation tidied: quotes dropped, one
/// space after a comma.
fn tidied(name: &str) -> String {
    let mut out = String::new();
    let mut chars = name.trim().chars().peekable();
    while let Some(c) = chars.next() {
        if "'`\"’‘".contains(c) {
            continue;
        }
        out.push(c);
        if c == ',' && chars.peek().is_some_and(|n| n.is_alphanumeric()) {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn spellings_as_read(name: &str) -> Vec<String> {
    const MAX: usize = 48;
    let name = name.trim();
    let fancy = name.chars().any(|c| !c.is_ascii());
    let options: Vec<Vec<char>> = name
        .chars()
        .map(|c| {
            let mut options = vec![c];
            let alike: &[char] = match c {
                '1' => &['l', 'I', 'i'],
                'l' => &['1', 'I', 'i'],
                'I' => &['l', '1'],
                'i' => &['1', 'l'],
                '0' => &['O'],
                'O' => &['0'],
                // A "^" (color codes in names: "^9Co^1m@n") read as an A.
                'A' => &['^'],
                // A "ツ" (a smiley in names: "Chrisツ") read as a Y.
                'Y' => &['ツ'],
                ' ' | '-' | '.' => &['_'],
                _ => &[],
            };
            options.extend(alike);
            if fancy {
                let latin = latin_look_alike(c).to_ascii_lowercase();
                for (_, glyphs) in LOOK_ALIKES.iter().filter(|(l, _)| *l == latin) {
                    options.extend(glyphs.chars().filter(|g| *g != c && !crate::nameocr::knows(*g)));
                }
            }
            options
        })
        .collect();
    // With none swapped, then one, two, …
    fn spell(options: &[Vec<char>], at: usize, swaps: usize, word: &mut String, out: &mut Vec<String>, max: usize) {
        if out.len() >= max {
            return;
        }
        if at == options.len() {
            if swaps == 0 {
                out.push(word.clone());
            }
            return;
        }
        for (i, c) in options[at].iter().enumerate() {
            if i > 0 && swaps == 0 {
                break;
            }
            word.push(*c);
            spell(options, at + 1, if i > 0 { swaps - 1 } else { swaps }, word, out, max);
            word.pop();
        }
    }
    let mut out = Vec::new();
    for swaps in 0..=options.len().min(4) {
        spell(&options, 0, swaps, &mut String::new(), &mut out, MAX);
    }
    // A "_" at either end, too thin to be read ("Pandaris_" as "Pandaris"),
    // or a "." at the end, left off as a speck ("Postmaster jr.").
    if !name.is_empty() {
        let caret = name.contains('^').then(|| format!("^{name}"));
        // Every space a "_" (names spaced with them: "Comic_sans_2001").
        let underscored = name.contains(' ').then(|| name.replace(' ', "_"));
        // A "]" without its "[": the first character was it ("tsalz] Salty
        // Shaker" is "[Salz] Salty Shaker"), or it was lost.
        let bracket: Vec<String> = [('[', ']'), ('(', ')')]
            .iter()
            .filter(|(open, close)| name.contains(*close) && !name.contains(*open))
            .flat_map(|(open, _)| {
                let rest: String = name.chars().skip(1).collect();
                [format!("{open}{rest}"), format!("{open}{name}")]
            })
            .collect();
        for (i, v) in
            bracket.into_iter().chain(underscored).chain([format!("{name}_"), format!("{name}."), format!("_{name}")]).chain(caret).enumerate()
        {
            // (Moved up when it is among the others already.)
            out.retain(|o| *o != v);
            out.insert((1 + i).min(out.len()), v);
        }
        out.truncate(MAX);
    }
    out
}

pub(crate) async fn resolve_guardian(app: &AppHandle, name: &str) -> Result<Vec<GuardianCandidate>, String> {
    let wanted = name.trim().to_lowercase();
    let plain = plain_name(name);
    let known = app.state::<BungieState>().known_players();
    if let Some((full, id, membership_type)) =
        known.into_iter().find(|(n, _, _)| !plain.is_empty() && plain_name(n.split('#').next().unwrap_or("")) == plain)
    {
        return Ok(vec![GuardianCandidate { name: full, membership_id: id, membership_type, score: Some(1.0), reason: None }]);
    }
    // Their full name was on screen ("Guardian#1234"): exactly them. The
    // number reads reliably, the name less so ("leaderI" for "leader1", a
    // "_" lost): if the exact lookup misses, the one of that number among
    // the names starting alike.
    if let Some((middle, code)) = crate::weapons::guardian_code(name) {
        // The middle's name first (bigger, on a plain ground: "JSTN NV" where
        // the top read "OSTN NV"), then the top's; a few at a time, the
        // likeliest first.
        let mut tries = spellings(&middle);
        tries.truncate(16);
        tries.extend(spellings_of(name).into_iter().filter(|v| !tries.contains(v)).take(16).collect::<Vec<_>>());
        for chunk in tries.chunks(8) {
            let found = join_all(chunk.iter().map(|v| find_by_name(app, v, code))).await;
            if let Some((variant, Ok((id, membership_type)))) = chunk.iter().zip(found).find(|(_, f)| f.is_ok()) {
                return Ok(vec![GuardianCandidate {
                    name: format!("{variant}#{code:04}"),
                    membership_id: id,
                    membership_type,
                    score: Some(1.0),
                    reason: None,
                }]);
            }
        }
        if let Some(found) = by_number(app, name, code).await {
            return Ok(vec![found]);
        }
    }
    if let Some((at, list)) = RESOLVED.lock().unwrap().get_or_insert_default().get(&wanted) {
        if at.elapsed() < RESOLVED_TTL {
            return Ok(list.clone());
        }
    }
    let list = guardian_search(app.clone(), name.to_string()).await?;
    RESOLVED.lock().unwrap().get_or_insert_default().insert(wanted, (Instant::now(), list.clone()));
    Ok(list)
}

#[tauri::command]
pub async fn guardian_candidates(app: AppHandle, name: String) -> Result<Vec<GuardianCandidate>, String> {
    resolve_guardian(&app, &name).await
}

/// Every player named exactly `name` (Bungie's name search, a few pages),
/// with how alike each one's emblems (any character's: its icon and its
/// overlay) are to the one on the character screen seen last; the most
/// alike first.
async fn guardian_search(app: AppHandle, name: String) -> Result<Vec<GuardianCandidate>, String> {
    const MAX_PAGES: u32 = 8;
    const MAX_PLAYERS: usize = 60;
    let (http, key) = http(&app);
    let key = key?;
    // Bungie's search finds exact names only: the first spelling it knows
    // (see `spellings`; one page each, a few at a time), then every player
    // of it.
    let search = |page: u32, name: String| {
        let (http, key) = (http.clone(), key.clone());
        async move {
            api(&http, &key, Method::POST, &format!("/User/Search/GlobalName/{page}/"), Some(serde_json::json!({ "displayNamePrefix": name })))
                .await
        }
    };
    // (Every spelling it knows: "Pandaris" and "Pandaris_" are both
    // players; the emblem decides below.)
    const MAX_SPELLINGS: usize = 24;
    let mut known = Vec::new();
    for chunk in spellings_of(&name).into_iter().take(MAX_SPELLINGS).collect::<Vec<_>>().chunks(8) {
        let found = join_all(chunk.iter().map(|v| search(0, v.clone()))).await;
        let any = |f: &Result<Value, String>| f.as_ref().ok().and_then(|f| f["searchResults"].as_array()).is_some_and(|a| !a.is_empty());
        known.extend(chunk.iter().zip(&found).filter(|(_, f)| any(f)).map(|(v, _)| v.clone()));
    }
    let mut players: Vec<GuardianCandidate> = Vec::new();
    for spelled in known {
        for page in 0..MAX_PAGES {
            let found = search(page, spelled.clone()).await?;
            for user in found["searchResults"].as_array().into_iter().flatten() {
                let Some(global) = user["bungieGlobalDisplayName"].as_str() else {
                    continue;
                };
                if !same_name(&spelled, global) {
                    continue;
                }
                let cards = user["destinyMemberships"].as_array().cloned().unwrap_or_default();
                let Some(first) = cards.first() else { continue };
                let cross = first["crossSaveOverride"].as_i64().unwrap_or(0);
                let card = cards
                    .iter()
                    .find(|c| cross != 0 && c["membershipType"].as_i64() == Some(cross))
                    .unwrap_or(first);
                let Some(id) = card["membershipId"].as_str() else {
                    continue;
                };
                if players.iter().any(|p| p.membership_id == id) {
                    continue;
                }
                players.push(GuardianCandidate {
                    name: format!("{global}#{:04}", user["bungieGlobalDisplayNameCode"].as_u64().unwrap_or(0)),
                    membership_id: id.into(),
                    membership_type: card["membershipType"].as_i64().unwrap_or(0),
                    score: None,
                    reason: None,
                });
            }
            if players.len() >= MAX_PLAYERS || found["hasMore"].as_bool() != Some(true) {
                break;
            }
        }
    }
    // Players of several spellings ("Comic sans 2001" and "Comic_sans_2001"):
    // the one Radar's own reading is sure of, exactly, if it is a player.
    if players.len() > 1 {
        let exact = |s: &str| s.trim().chars().map(latin_look_alike).collect::<String>().to_lowercase();
        let sure: Vec<String> =
            crate::weapons::guardian_alt(&name).into_iter().filter(|(_, sure)| *sure >= SURE_READING).map(|(r, _)| exact(&r)).collect();
        let of_sure: Vec<GuardianCandidate> =
            players.iter().filter(|p| sure.contains(&exact(p.name.rsplit_once('#').map_or(p.name.as_str(), |(n, _)| n)))).cloned().collect();
        if !of_sure.is_empty() && of_sure.len() < players.len() {
            players = of_sure;
        }
    }
    // One of that name (or none): nothing to weigh.
    if players.len() <= 1 {
        return Ok(players);
    }
    // Several: first the emblem on screen against theirs.
    let seen = crate::weapons::last_emblem()
        .filter(|e| e.width() > 4)
        .map(|e| emblem_signature(&e));
    if let Some(seen) = &seen {
        let scores = join_all(players.iter().map(|p| {
            let (http, key, app) = (http.clone(), key.clone(), app.clone());
            async move {
                let path = format!("/Destiny2/{}/Profile/{}/?components=200", p.membership_type, p.membership_id);
                let profile = api(&http, &key, Method::GET, &path, None).await.ok()?;
                let emblems: Vec<u64> = profile["characters"]["data"]
                    .as_object()?
                    .values()
                    .filter_map(|c| c["emblemHash"].as_u64())
                    .collect();
                let mut best: Option<f64> = None;
                for emblem in emblems {
                    let Some(def) = definition(&app, "DestinyInventoryItemDefinition", emblem).await else {
                        continue;
                    };
                    let paths = [def["displayProperties"]["icon"].as_str(), def["secondaryOverlay"].as_str()];
                    for path in paths.into_iter().flatten().filter(|p| !p.is_empty()) {
                        if let Some(sig) = emblem_image(&http, path).await {
                            let corr: f32 = sig.iter().zip(seen).map(|(a, b)| a * b).sum();
                            best = Some(best.map_or(corr as f64, |b: f64| b.max(corr as f64)));
                        }
                    }
                }
                best
            }
        }))
        .await;
        for (p, score) in players.iter_mut().zip(scores) {
            p.score = score;
            p.reason = score.map(|_| "emblem");
        }
        players.sort_by(|a, b| b.score.unwrap_or(-1.0).total_cmp(&a.score.unwrap_or(-1.0)));
        if sure_guardian(&players).is_some() {
            return Ok(players);
        }
    }
    // The emblem didn't settle it: one in your activity right now (whoever
    // you inspect is mostly there with you), then one you played with in
    // your last runs.
    let (my_activity, recent) = futures::join!(my_activity(&app), recent_fellows(&app));
    let together = join_all(players.iter().map(|p| {
        let (http, key, recent) = (http.clone(), key.clone(), &recent);
        async move {
            if let Some(mine) = my_activity {
                let path = format!("/Destiny2/{}/Profile/{}/?components=204", p.membership_type, p.membership_id);
                if let Ok(profile) = api(&http, &key, Method::GET, &path, None).await {
                    let there = profile["characterActivities"]["data"]
                        .as_object()
                        .into_iter()
                        .flat_map(|c| c.values())
                        .any(|c| c["currentActivityHash"].as_u64() == Some(mine));
                    if there {
                        return Some((2.0, "activity"));
                    }
                }
            }
            recent.contains(&p.membership_id).then_some((1.5, "recent"))
        }
    }))
    .await;
    for (p, found) in players.iter_mut().zip(together) {
        if let Some((score, reason)) = found {
            p.score = Some(score);
            p.reason = Some(reason);
        }
    }
    players.sort_by(|a, b| b.score.unwrap_or(-1.0).total_cmp(&a.score.unwrap_or(-1.0)));
    Ok(players)
}

/// The activity you are in right now (None: none, or orbit).
async fn my_activity(app: &AppHandle) -> Option<u64> {
    let state = app.state::<BungieState>();
    let (mt, id) = state.player()?;
    let (http, key) = http(app);
    let path = format!("/Destiny2/{mt}/Profile/{id}/?components=204");
    let profile = api(&http, &key.ok()?, Method::GET, &path, None).await.ok()?;
    profile["characterActivities"]["data"]
        .as_object()?
        .values()
        .max_by_key(|c| c["dateActivityStarted"].as_str().unwrap_or("").to_string())
        .and_then(|c| c["currentActivityHash"].as_u64())
        .filter(|&h| h != 0 && h != 82913930)
}

/// Who played with you in your last runs (their membership ids), for a
/// while once looked up.
async fn recent_fellows(app: &AppHandle) -> std::collections::HashSet<String> {
    static CACHE: Mutex<Option<(Instant, std::collections::HashSet<String>)>> = Mutex::new(None);
    if let Some((at, ids)) = CACHE.lock().unwrap().clone() {
        if at.elapsed() < Duration::from_secs(300) {
            return ids;
        }
    }
    let state = app.state::<BungieState>();
    let Some((mt, id)) = state.player() else { return Default::default() };
    let (http, key) = http(app);
    let Ok(key) = key else { return Default::default() };
    let mut ids = std::collections::HashSet::new();
    // The character played last: its last ten runs.
    let path = format!("/Destiny2/{mt}/Profile/{id}/?components=200");
    let Ok(profile) = api(&http, &key, Method::GET, &path, None).await else { return ids };
    let Some(character) = profile["characters"]["data"]
        .as_object()
        .and_then(|c| c.iter().max_by_key(|(_, c)| c["dateLastPlayed"].as_str().unwrap_or("").to_string()).map(|(k, _)| k.clone()))
    else {
        return ids;
    };
    let path = format!("/Destiny2/{mt}/Account/{id}/Character/{character}/Stats/Activities/?count=10");
    let Ok(list) = api(&http, &key, Method::GET, &path, None).await else { return ids };
    let instances: Vec<String> = list["activities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["activityDetails"]["instanceId"].as_str().map(String::from))
        .collect();
    let reports = join_all(instances.iter().map(|instance| {
        let (http, key) = (http.clone(), key.clone());
        async move { api(&http, &key, Method::GET, &format!("/Destiny2/Stats/PostGameCarnageReport/{instance}/"), None).await.ok() }
    }))
    .await;
    for report in reports.into_iter().flatten() {
        for entry in report["entries"].as_array().into_iter().flatten() {
            if let Some(member) = entry["player"]["destinyUserInfo"]["membershipId"].as_str() {
                if member != id {
                    ids.insert(member.to_string());
                }
            }
        }
    }
    *CACHE.lock().unwrap() = Some((Instant::now(), ids.clone()));
    ids
}

/// The player numbered `code` whose name starts as `name` (read off the
/// screen, maybe a letter off): Bungie's name search by the first letters,
/// the one with that number and a name alike.
async fn by_number(app: &AppHandle, name: &str, code: u32) -> Option<GuardianCandidate> {
    let plain = plain_name;
    let read = plain(name);
    // The surely right start (more of it: fewer pages to look through).
    let prefix = sure_start(name);
    if prefix.chars().count() < 2 {
        return None;
    }
    let (http, key) = http(app);
    let key = key.ok()?;
    for page in 0..10 {
        let found = api(
            &http,
            &key,
            Method::POST,
            &format!("/User/Search/GlobalName/{page}/"),
            Some(serde_json::json!({ "displayNamePrefix": prefix })),
        )
        .await
        .ok()?;
        for user in found["searchResults"].as_array().into_iter().flatten() {
            if user["bungieGlobalDisplayNameCode"].as_u64() != Some(code as u64) {
                continue;
            }
            let Some(global) = user["bungieGlobalDisplayName"].as_str() else { continue };
            if strsim::jaro_winkler(&plain(global), &read) < 0.8 {
                continue;
            }
            let cards = user["destinyMemberships"].as_array().cloned().unwrap_or_default();
            let first = cards.first()?;
            let cross = first["crossSaveOverride"].as_i64().unwrap_or(0);
            let card = cards.iter().find(|c| cross != 0 && c["membershipType"].as_i64() == Some(cross)).unwrap_or(first);
            return Some(GuardianCandidate {
                name: format!("{global}#{code:04}"),
                membership_id: card["membershipId"].as_str()?.into(),
                membership_type: card["membershipType"].as_i64().unwrap_or(0),
                score: Some(1.0),
                reason: None,
            });
        }
        if found["hasMore"].as_bool() != Some(true) {
            break;
        }
    }
    None
}

#[cfg(test)]
mod name_tests {
    use super::*;

    #[test]
    fn misread_names_match() {
        assert_eq!(plain_name("Lamine Yama1684"), plain_name("Lamine Yamal684"));
        assert_eq!(plain_name("Foo Bar"), plain_name("Foo_Bar"));
        assert_eq!(sure_start("Lamine Yama1684"), "Lamine Yama");
        assert_eq!(sure_start("Foo_Bar"), "Foo");
        assert!(spellings("Lamine Yama1684").contains(&"Lamine Yamal684".to_string()));
        assert!(spellings("★尺EAPE尺★").contains(&"★尺E卂卩E尺★".to_string()));
        assert_eq!(spellings("Pandaris")[1], "Pandaris_");
        assert!(spellings("Postmaster jr").contains(&"Postmaster jr.".to_string()));
        assert_eq!(spellings("Moth,Watcher of 'Light")[0], "Moth, Watcher of Light");
        assert_eq!(spellings("Comic sans 2001")[1], "Comic_sans_2001");
        assert!(spellings("Shadowi66XP").contains(&"Shadow166XP".to_string()));
        assert!(spellings("ChrisY").contains(&"Chrisツ".to_string()));
        assert!(spellings("Chris 'Y").contains(&"Chrisツ".to_string()));
        assert_eq!(spellings("tsalz] Salty Shaker")[1], "[salz] Salty Shaker");
        assert!(spellings("A9CoA1m@nA3d3r").contains(&"^9Co^1m@n^3d3r".to_string()));
        assert!(spellings("9Co^1m@n^3d3r").contains(&"^9Co^1m@n^3d3r".to_string()));
        assert_eq!(plain_name("★尺E卂卩E尺★"), plain_name("REAPER"));
        assert!(same_name("★尺EAPE尺★", "★尺E卂卩E尺★"));
        assert!(same_name("★尺EAE尺★", "★尺E卂卩E尺★"));
        assert!(!same_name("Calis", "Calus"));
        assert!(same_name("[...]", "[...]"));
        assert!(!same_name("[...]", "[..]"));
    }
}
