//! Feats (Edge of Fate's activity skulls, "Feat: Token Limit"): what a run
//! had on, from its PGCR's selectedSkullHashes, named by Bungie's skull
//! collections (downloaded once per manifest version, kept on disk).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::bungie::{api, BungieState};
use crate::i18n::locale;

/// Skulls that are no feat: an empty slot and a locked one.
const NOT_FEATS: [u32; 2] = [790421403, 1588671604];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feat {
    /// Without its "Feat: " ("Token Limit").
    pub name: String,
    pub icon: Option<String>,
    pub description: String,
    /// What it does to a run: "boon" (helps: a surge, Brawler …),
    /// "challenge" (harder: banes, threats, Galvanized, Scourge, No HUD …),
    /// "feat" (a raid's or dungeon's), else "neutral" (the activity's rules,
    /// base settings like Time Bonus or HUD Base).
    pub kind: String,
    /// A feat's reward grades (Cutthroat Combat 4, Encounter Challenges 3,
    /// Battalions 2, the limits 1): Bungie's multiplier for it.
    #[serde(default)]
    pub grade: u8,
    /// The triangles (▲) the portal shows for it: what it adds to the
    /// reward multiplier, 0.015 each; a challenge raises it (Threat 2,
    /// Difficult 4, Deadly 6), a boon lowers it (−1). 0 for a feat.
    #[serde(default)]
    pub triangles: i8,
    /// Its category as the game's customize menu has it ("Challenge
    /// Modifiers", "Gameplay Stakes" …, in the app's language), and where
    /// that comes in a list of them.
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub category_order: u8,
}

/// The skull categories (by hash, the same in every language), in the order
/// a run's modifiers are listed; a modifier in several (No HUD a challenge
/// in one activity, a gameplay stake in another) goes with the first: as
/// the portal's menu has it.
const CATEGORY_ORDER: [&[u64]; 7] = [
    &[597736995, 2782594556],            // Feats
    &[562753438],                        // Gameplay Stakes
    &[1492238292],                       // Buildcraft Stakes
    &[2685869925, 133988346],            // Boon (and Event) Modifiers
    &[2627457152],                       // Combatant Modifiers
    &[4202143300, 1809282739, 2953361283], // Challenge Modifiers
    &[1470780789, 1149589466],           // Rule Modifiers
];
/// How the categories are listed (as the game's menu goes): feats,
/// challenges, combatants, gameplay and buildcraft stakes, boons, rules.
const LIST_ORDER: [u8; 7] = [0, 3, 4, 5, 2, 1, 6];
/// Where the rule modifiers come in the list (fixed by the difficulty, not
/// picked).
pub const RULES_ORDER: u8 = 6;

/// A skull's kind, by Bungie's connotation (the same in every language):
/// 1 a boon, 2 and 3 a challenge; a feat raises combatant power.
fn kind_of(skull: &serde_json::Value) -> &'static str {
    match skull["activityModifierConnotation"].as_i64() {
        Some(1) => "boon",
        Some(2 | 3) => "challenge",
        _ if skull["modifierPowerContribution"].as_i64().is_some_and(|p| p > 0) => "feat",
        _ => "neutral",
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Cache {
    version: String,
    locale: String,
    feats: HashMap<u32, Feat>,
}

static FEATS: Mutex<Option<Cache>> = Mutex::new(None);

fn cache_path(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join("feats-v5.json")
}

/// Whether a skull of a run's report is a feat (not an empty or locked slot).
pub fn is_feat(skull: u32) -> bool {
    !NOT_FEATS.contains(&skull)
}

/// Every feat by its skull hash (empty when Bungie can't be reached).
pub async fn definitions(app: &AppHandle) -> HashMap<u32, Feat> {
    let lc = locale();
    if let Some(c) = FEATS.lock().unwrap().as_ref().filter(|c| c.locale == lc) {
        return c.feats.clone();
    }
    let state = app.state::<BungieState>();
    let (http, Ok(key)) = (state.http.clone(), state.api_key()) else { return HashMap::new() };
    let Ok(info) = api(&http, &key, Method::GET, "/Destiny2/Manifest/", None).await else { return HashMap::new() };
    let version = info["version"].as_str().unwrap_or_default().to_string();
    let path = cache_path(app);
    if let Some(cached) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<Cache>(&s).ok())
        .filter(|c| c.version == version && c.locale == lc)
    {
        let feats = cached.feats.clone();
        *FEATS.lock().unwrap() = Some(cached);
        return feats;
    }
    let Some(url) = info["jsonWorldComponentContentPaths"][lc]["DestinyActivitySelectableSkullCollectionDefinition"].as_str()
    else {
        return HashMap::new();
    };
    let Ok(res) = http.get(format!("https://www.bungie.net{url}")).send().await else { return HashMap::new() };
    let Ok(collections) = res.json::<serde_json::Value>().await else { return HashMap::new() };
    // The categories (each collection is in one, through its subcategories).
    let table = |name: &str| {
        let url = info["jsonWorldComponentContentPaths"][lc][name].as_str().map(|u| format!("https://www.bungie.net{u}"));
        let http = http.clone();
        async move {
            let res = http.get(url?).send().await.ok()?;
            res.json::<serde_json::Value>().await.ok()
        }
    };
    let (subcategories, categories) = futures::join!(
        table("DestinyActivitySkullSubcategoryDefinition"),
        table("DestinyActivitySkullCategoryDefinition"),
    );
    let (subcategories, categories) = (subcategories.unwrap_or_default(), categories.unwrap_or_default());
    let category_of = |collection: &serde_json::Value| -> Option<(u8, String)> {
        let sub = collection["skullSubcategoryHashes"].as_array()?.iter().find_map(|h| h.as_u64())?;
        let parent = subcategories[sub.to_string()]["parentSkullCategoryHash"].as_u64()?;
        let rank = CATEGORY_ORDER.iter().position(|hashes| hashes.contains(&parent))? as u8;
        let name = categories[parent.to_string()]["displayProperties"]["name"].as_str().unwrap_or_default().to_string();
        Some((rank, name))
    };
    let mut feats: HashMap<u32, Feat> = HashMap::new();
    let mut ranks: HashMap<u32, u8> = HashMap::new();
    // Each modifier's triangles (a few differ between collections: a single
    // bane is 2 in the portal, more in older activities; the least counts).
    let mut triangles: HashMap<u32, i8> = HashMap::new();
    for collection in collections.as_object().into_iter().flat_map(|o| o.values()) {
        let category = category_of(collection);
        for s in collection["selectableActivitySkulls"].as_array().into_iter().flatten() {
            let skull = &s["activitySkull"];
            let Some(hash) = skull["skullIdentifierHash"].as_u64().map(|h| h as u32) else { continue };
            if s["isEmptySkull"].as_bool() == Some(true) || !is_feat(hash) {
                continue;
            }
            let multiplier = skull["modifierMultiplierContribution"].as_f64().unwrap_or(0.0);
            // Not a feat's grade, nor an odd one far off the portal's scale.
            if kind_of(skull) != "feat" && (0.0149..=0.2).contains(&multiplier.abs()) {
                let t = (multiplier / 0.015).round() as i8;
                triangles.entry(hash).and_modify(|least| if t.abs() < least.abs() { *least = t }).or_insert(t);
            }
            // Seen already: only its category, if this one comes first.
            if let Some(feat) = feats.get_mut(&hash) {
                if let Some((rank, name)) = &category {
                    if ranks.get(&hash).is_none_or(|r| rank < r) {
                        ranks.insert(hash, *rank);
                        feat.category = name.clone();
                        feat.category_order = LIST_ORDER[*rank as usize];
                    }
                }
                continue;
            }
            let display = &skull["displayProperties"];
            let full = display["name"].as_str().unwrap_or_default();
            if full.is_empty() {
                continue;
            }
            // "Feat: Token Limit" (in every language "<word>: <name>").
            let name = full.split_once(": ").map(|(_, n)| n).unwrap_or(full).to_string();
            feats.insert(
                hash,
                Feat {
                    name,
                    icon: display["icon"].as_str().map(|p| format!("https://www.bungie.net{p}")),
                    description: display["description"].as_str().unwrap_or_default().to_string(),
                    kind: kind_of(skull).to_string(),
                    grade: if kind_of(skull) == "feat" {
                        skull["modifierMultiplierContribution"].as_f64().unwrap_or(0.0).round().clamp(0.0, 9.0) as u8
                    } else {
                        0
                    },
                    category: category.as_ref().map(|(_, n)| n.clone()).unwrap_or_default(),
                    category_order: category.as_ref().map_or(9, |(r, _)| LIST_ORDER[*r as usize]),
                    triangles: 0,
                },
            );
            if let Some((rank, _)) = &category {
                ranks.insert(hash, *rank);
            }
        }
    }
    for (hash, t) in triangles {
        if let Some(feat) = feats.get_mut(&hash) {
            feat.triangles = t;
        }
    }
    let cache = Cache { version, locale: lc.to_string(), feats: feats.clone() };
    if let Ok(json) = serde_json::to_string(&cache) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&path, json);
    }
    *FEATS.lock().unwrap() = Some(cache);
    feats
}
