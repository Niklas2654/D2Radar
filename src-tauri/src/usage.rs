//! What the player base uses: the most used weapons in raids, dungeons and
//! overall. Bungie has no such statistic (nor a list of all players), so
//! Radar samples real post-game reports (PGCRs): it starts at the connected
//! player's recent activities and moves from report to report: the players
//! in them, their recent completions of the same kind, and so on. Only
//! completions count: every player who completed a run counts once for it;
//! a weapon's usage rate is the share of those player-runs with kills with
//! it.
//!
//! The statistic is over each category's newest `TARGET_COMPLETIONS`
//! completions; Radar keeps collecting (players not asked yet) until it has
//! them, then renews them with newer runs. Reports never change, so
//! they are kept on disk (older ones are dropped).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use futures::stream::{self, StreamExt};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::bungie::{api, api_url, BungieState};
use crate::fireteam::{item, ItemInfo};
use crate::i18n::tr;

const PGCR_BASE: &str = "https://stats.bungie.net/Platform";
/// The connected player's own recent activities, the start of the sample.
const SEED_ACTIVITIES: usize = 15;
/// The statistic is over each category's newest this many completions.
const TARGET_COMPLETIONS: usize = 1000;
/// Players whose history is asked per round…
const PLAYERS_PER_ROUND: usize = 50;
/// …with this many of each one's recent completions of the same kind (the
/// next players come from those reports).
const PER_PLAYER: usize = 10;
/// Rounds per run while collecting up to the target, and once it is reached
/// (then only renewing with newer runs).
const ROUNDS_COLLECTING: usize = 8;
const ROUNDS_FULL: usize = 2;
/// Players asked are asked again after this long (new runs by then).
const ASK_AGAIN_DAYS: i64 = 7;
/// A player who completed a run counts if they killed anything with a
/// weapon (AFK players don't); bosses leave few kills, so no more than that.
const MIN_KILLS: u64 = 1;
/// Kinetic, energy and power weapon slots.
const WEAPON_BUCKETS: [u64; 3] = [1498876634, 2465295065, 953998645];
/// Traits shown per weapon.
const TOP_TRAITS: usize = 4;
/// Weapons and types shown per category.
const TOP: usize = 10;
const TOP_TYPES: usize = 6;
const CONCURRENCY: usize = 6;
/// The statistic is renewed (and the sample grown) this often.
const TTL: Duration = Duration::from_secs(30 * 60);

/// (activity mode, key): raids, dungeons, all PvE.
const CATEGORIES: [(u32, &str); 3] = [(4, "raid"), (82, "dungeon"), (7, "all")];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponUse {
    item: ItemInfo,
    /// Share of player-runs that got kills with it (0..1).
    rate: f64,
    kills: u64,
    /// The traits on it most often, from players who have it equipped.
    traits: Vec<TraitUse>,
    /// How many equipped copies the traits are from.
    rolls: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraitUse {
    item: ItemInfo,
    /// Share of the equipped copies with this trait (0..1).
    share: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeUse {
    type_name: String,
    /// Share of all weapon kills (0..1).
    share: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCategory {
    key: String,
    activities: usize,
    /// How many completions the statistic is meant to cover.
    target: usize,
    /// Different players, and player-runs (players who completed a run,
    /// counted per run).
    players: usize,
    player_runs: usize,
    weapons: Vec<WeaponUse>,
    types: Vec<TypeUse>,
    /// When the numbers were last brought up to date (unix ms).
    updated_at: Option<i64>,
}

/// One report: when, which kind, every player with their kills per weapon.
#[derive(Clone, Serialize, Deserialize)]
struct Report {
    mode: u32,
    period: DateTime<Utc>,
    /// (membership type, membership id, completed, [(weapon hash, kills)])
    players: Vec<(i64, String, bool, Vec<(u64, u64)>)>,
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    /// instance id -> report
    reports: HashMap<String, Report>,
    /// Per mode: players whose history was asked, and when.
    asked: HashMap<u32, HashMap<String, DateTime<Utc>>>,
    /// Per player: when, and their equipped weapons with the plugs in them
    /// (the rolls the traits come from).
    #[serde(default)]
    rolls: HashMap<String, (DateTime<Utc>, Vec<(u64, Vec<u64>)>)>,
    /// When the last collecting run finished.
    #[serde(default)]
    collected_at: Option<DateTime<Utc>>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
/// The last result, when it was made and whether every category was full.
static RESULT: Mutex<Option<(Instant, bool, Vec<UsageCategory>)>> = Mutex::new(None);

/// Forget the summary (its names are in the old language); the reports
/// stay, the next call names them anew.
pub(crate) fn forget_summary() {
    *RESULT.lock().unwrap() = None;
}

fn cache_path(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join("weapon-usage-v4.json")
}

fn load(app: &AppHandle) {
    let mut cache = CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(
            std::fs::read_to_string(cache_path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        );
    }
}

/// The newest reports of a mode, newest first, at most the target.
fn newest(cache: &Cache, mode: u32) -> Vec<(&String, &Report)> {
    let mut reports: Vec<(&String, &Report)> = cache.reports.iter().filter(|(_, r)| r.mode == mode).collect();
    reports.sort_by(|a, b| b.1.period.cmp(&a.1.period));
    reports.truncate(TARGET_COMPLETIONS);
    reports
}

/// Keep only the reports that count (each mode's newest), then write the cache.
fn save(app: &AppHandle) {
    let json = {
        let mut cache = CACHE.lock().unwrap();
        let Some(cache) = cache.as_mut() else { return };
        let keep: HashSet<String> =
            CATEGORIES.iter().flat_map(|(mode, _)| newest(cache, *mode).into_iter().map(|(id, _)| id.clone())).collect();
        cache.reports.retain(|id, _| keep.contains(id));
        let since = Utc::now() - chrono::Duration::days(ASK_AGAIN_DAYS);
        for asked in cache.asked.values_mut() {
            asked.retain(|_, at| *at >= since);
        }
        // Rolls of a month: weapons get re-rolled, metas change.
        let rolls_since = Utc::now() - chrono::Duration::days(30);
        cache.rolls.retain(|_, (at, _)| *at >= rolls_since);
        serde_json::to_string(cache)
    };
    if let Ok(json) = json {
        let path = cache_path(app);
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, json);
    }
}

/// A player's newest completions of a mode (instance ids), all characters.
async fn recent(http: &reqwest::Client, key: &str, mt: i64, mid: &str, mode: u32, count: usize) -> Vec<String> {
    // Profile, equipment and its sockets: the same request, the rolls along.
    let path = format!("/Destiny2/{mt}/Profile/{mid}/?components=100,205,305");
    let Ok(profile) = api(http, key, Method::GET, &path, None).await else {
        return Vec::new();
    };
    let sockets = &profile["itemComponents"]["sockets"]["data"];
    let rolls: Vec<(u64, Vec<u64>)> = profile["characterEquipment"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .flat_map(|(_, c)| c["items"].as_array().cloned().unwrap_or_default())
        .filter(|i| WEAPON_BUCKETS.contains(&i["bucketHash"].as_u64().unwrap_or(0)))
        .filter_map(|i| {
            let plugs = sockets[i["itemInstanceId"].as_str()?]["sockets"]
                .as_array()?
                .iter()
                .filter_map(|s| s["plugHash"].as_u64())
                .collect();
            Some((i["itemHash"].as_u64()?, plugs))
        })
        .collect();
    if !rolls.is_empty() {
        if let Some(cache) = CACHE.lock().unwrap().as_mut() {
            cache.rolls.insert(mid.to_string(), (Utc::now(), rolls));
        }
    }
    // Only the rolls wanted (see fill_rolls).
    if count == 0 {
        return Vec::new();
    }
    let characters: Vec<String> = profile["profile"]["data"]["characterIds"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c.as_str().map(Into::into))
        .collect();
    let mut all: Vec<(String, String)> = Vec::new();
    for cid in characters {
        let path = format!("/Destiny2/{mt}/Account/{mid}/Character/{cid}/Stats/Activities/?count={count}&mode={mode}");
        let Ok(history) = api(http, key, Method::GET, &path, None).await else { continue };
        for a in history["activities"].as_array().into_iter().flatten() {
            if a["values"]["completed"]["basic"]["value"].as_f64() != Some(1.0) {
                continue;
            }
            let (Some(period), Some(id)) = (a["period"].as_str(), a["activityDetails"]["instanceId"].as_str()) else { continue };
            all.push((period.to_string(), id.to_string()));
        }
    }
    all.sort_by(|a, b| b.0.cmp(&a.0));
    all.into_iter().take(count).map(|(_, id)| id).collect()
}

/// Every player's kills per weapon in one report (None = failed).
async fn fetch_report(http: &reqwest::Client, key: &str, instance: &str, mode: u32) -> Option<Report> {
    let url = format!("{PGCR_BASE}/Destiny2/Stats/PostGameCarnageReport/{instance}/");
    let report = api_url(http, key, Method::GET, &url, None).await.ok()?;
    let period = report["period"].as_str()?.parse::<DateTime<Utc>>().ok()?;
    let mut players: Vec<(i64, String, bool, Vec<(u64, u64)>)> = Vec::new();
    for entry in report["entries"].as_array().into_iter().flatten() {
        let info = &entry["player"]["destinyUserInfo"];
        let (Some(mt), Some(mid)) = (info["membershipType"].as_i64(), info["membershipId"].as_str()) else { continue };
        let completed = entry["values"]["completed"]["basic"]["value"].as_f64() == Some(1.0);
        let mut kills: HashMap<u64, u64> = HashMap::new();
        for w in entry["extended"]["weapons"].as_array().into_iter().flatten() {
            let (Some(hash), Some(k)) = (w["referenceId"].as_u64(), w["values"]["uniqueWeaponKills"]["basic"]["value"].as_f64())
            else {
                continue;
            };
            *kills.entry(hash).or_default() += k as u64;
        }
        // A player can appear once per character; merge them.
        match players.iter_mut().find(|(_, m, _, _)| m == mid) {
            Some((_, _, done, list)) => {
                *done |= completed;
                for (hash, k) in kills {
                    match list.iter_mut().find(|(h, _)| *h == hash) {
                        Some((_, total)) => *total += k,
                        None => list.push((hash, k)),
                    }
                }
            }
            None => players.push((mt, mid.to_string(), completed, kills.into_iter().collect())),
        }
    }
    Some(Report { mode, period, players })
}

/// Fetch the reports not cached yet; how many were new.
async fn fetch_missing(http: &reqwest::Client, key: &str, ids: Vec<String>, mode: u32) -> usize {
    let missing: Vec<String> = {
        let cache = CACHE.lock().unwrap();
        let cache = cache.as_ref().expect("loaded");
        ids.into_iter().filter(|id| !cache.reports.contains_key(id)).collect()
    };
    let got: Vec<(String, Option<Report>)> = stream::iter(missing)
        .map(|id| {
            let (http, key) = (http.clone(), key.to_string());
            async move {
                let report = fetch_report(&http, &key, &id, mode).await;
                (id, report)
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;
    let mut cache = CACHE.lock().unwrap();
    let cache = cache.as_mut().expect("loaded");
    let mut fetched = 0;
    for (id, report) in got {
        if let Some(report) = report {
            cache.reports.insert(id, report);
            fetched += 1;
        }
    }
    fetched
}

/// Grow the sample of one kind of activity: the connected player's runs,
/// then players from the reports so far who weren't asked yet.
async fn grow(http: &reqwest::Client, key: &str, mt: i64, mid: &str, mode: u32) -> usize {
    let count = || CACHE.lock().unwrap().as_ref().map_or(0, |c| c.reports.values().filter(|r| r.mode == mode).count());
    let rounds = if count() < TARGET_COMPLETIONS { ROUNDS_COLLECTING } else { ROUNDS_FULL };
    let mut fetched = fetch_missing(http, key, recent(http, key, mt, mid, mode, SEED_ACTIVITIES).await, mode).await;
    for round in 0..rounds {
        // Enough collected: one round for fresh runs is enough.
        if round >= ROUNDS_FULL && count() >= TARGET_COMPLETIONS {
            break;
        }
        let next: Vec<(i64, String)> = {
            let mut cache = CACHE.lock().unwrap();
            let cache = cache.as_mut().expect("loaded");
            let asked = cache.asked.entry(mode).or_default();
            asked.insert(mid.to_string(), Utc::now());
            let mut seen = HashSet::new();
            // Newest reports first: their players play now.
            let mut reports: Vec<&Report> = cache.reports.values().filter(|r| r.mode == mode).collect();
            reports.sort_by(|a, b| b.period.cmp(&a.period));
            let next: Vec<(i64, String)> = reports
                .iter()
                .flat_map(|r| r.players.iter())
                .filter(|(t, m, _, _)| *t > 0 && !asked.contains_key(m) && seen.insert(m.clone()))
                .map(|(t, m, _, _)| (*t, m.clone()))
                .take(PLAYERS_PER_ROUND)
                .collect();
            for (_, m) in &next {
                asked.insert(m.clone(), Utc::now());
            }
            next
        };
        if next.is_empty() {
            break;
        }
        let ids: Vec<String> = stream::iter(next)
            .map(|(t, m)| {
                let (http, key) = (http.clone(), key.to_string());
                async move { recent(&http, &key, t, &m, mode, PER_PLAYER).await }
            })
            .buffer_unordered(CONCURRENCY)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .flatten()
            .collect();
        fetched += fetch_missing(http, key, ids, mode).await;
    }
    fetched
}

/// Most used weapons of the player base per category (raids, dungeons,
/// all PvE), over each one's newest `TARGET_COMPLETIONS` completions
/// (fewer while still collecting).
#[tauri::command]
pub async fn weapon_usage(app: AppHandle) -> Result<Vec<UsageCategory>, String> {
    let cached = || {
        RESULT
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(at, _, _)| at.elapsed() < TTL)
            .map(|(_, _, r)| r.clone())
    };
    if let Some(result) = cached() {
        return Ok(result);
    }
    let state = app.state::<BungieState>();
    state.player().ok_or(tr("Kein Spieler verbunden", "No player connected"))?;
    // Collecting (hundreds of requests) runs in the background; the answer
    // is what is there now: the last result, else what is on disk.
    spawn_collecting(&app);
    if let Some((_, _, result)) = RESULT.lock().unwrap().as_ref() {
        return Ok(result.clone());
    }
    // One summary at a time: callers meanwhile wait for it (then reuse it).
    static SUMMARIZING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = SUMMARIZING.lock().await;
    if let Some((_, _, result)) = RESULT.lock().unwrap().as_ref() {
        return Ok(result.clone());
    }
    load(&app);
    let result = summarize(&app).await;
    // Kept as stale: the collecting run replaces it.
    let stale = Instant::now().checked_sub(TTL).unwrap_or_else(Instant::now);
    *RESULT.lock().unwrap() = Some((stale, false, result.clone()));
    Ok(result)
}

/// Grow the sample and summarize it anew, in the background (one at a time).
fn spawn_collecting(app: &AppHandle) {
    static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        collect(&app).await;
        RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

async fn collect(app: &AppHandle) {
    let state = app.state::<BungieState>();
    let Some((mt, mid)) = state.player() else { return };
    let Ok(key) = state.api_key() else { return };
    let http = state.http.clone();
    load(app);
    for (mode, _) in CATEGORIES {
        grow(&http, &key, mt, &mid, mode).await;
        // Saved as it goes: closing Radar mid-way keeps what was collected.
        save(app);
    }
    fill_rolls(&http, &key).await;
    if let Some(cache) = CACHE.lock().unwrap().as_mut() {
        cache.collected_at = Some(Utc::now());
    }
    save(app);
    let result = summarize(app).await;
    let full = result.iter().all(|c| c.activities >= TARGET_COMPLETIONS);
    *RESULT.lock().unwrap() = Some((Instant::now(), full, result));
    // Open pages pick it up at once.
    let _ = app.emit("weapon-usage-updated", ());
}

/// The statistic over what is collected so far.
async fn summarize(app: &AppHandle) -> Vec<UsageCategory> {
    let app = app.clone();
    let gear = crate::weapons::gear(&app).await.ok();
    let mut categories = Vec::new();
    for (mode, name) in CATEGORIES {
        // The player-runs that count, with their kills per weapon.
        let (mut counted, mut players, mut activities) = (Vec::new(), HashSet::new(), 0);
        let mut updated_at: Option<DateTime<Utc>>;
        {
            let cache = CACHE.lock().unwrap();
            let cache = cache.as_ref().expect("loaded");
            updated_at = cache.collected_at;
            for (_, report) in newest(cache, mode) {
                activities += 1;
                // Before the first finished run: the newest completion.
                if cache.collected_at.is_none() && updated_at.is_none_or(|u| report.period > u) {
                    updated_at = Some(report.period);
                }
                // Those who completed it (and actually played: kills).
                for (_, m, completed, kills) in &report.players {
                    if *completed && kills.iter().map(|(_, k)| k).sum::<u64>() >= MIN_KILLS {
                        players.insert(m.clone());
                        counted.push(kills.clone());
                    }
                }
            }
        }
        let player_runs = counted.len();
        // Names and types from Radar's own item table (instant); Bungie is
        // only asked for the few weapons shown. Versions of a weapon
        // (reissues) count as one: by name.
        let mut by_name: HashMap<String, (u64, u64, u64)> = HashMap::new();
        let mut types: HashMap<String, u64> = HashMap::new();
        let mut all_kills = 0u64;
        if let Some(gear) = &gear {
            for kills in &counted {
                let mut seen = HashSet::new();
                for (hash, k) in kills.iter().filter(|(_, k)| *k > 0) {
                    let Some(info) = gear.get(*hash as u32) else { continue };
                    all_kills += k;
                    *types.entry(info.type_name.clone()).or_default() += k;
                    let e = by_name.entry(info.name.clone()).or_insert((0, 0, *hash));
                    e.1 += k;
                    if seen.insert(info.name.clone()) {
                        e.0 += 1;
                    }
                }
            }
        }
        let mut ranked: Vec<(u64, u64, u64)> = by_name.into_values().collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
        let mut weapons: Vec<WeaponUse> = Vec::new();
        // The shown weapons and their traits, looked up side by side.
        let shown = futures::future::join_all(ranked.into_iter().take(TOP).map(|(used, kills, hash)| {
            let (app, gear) = (app.clone(), gear.clone());
            async move {
                let info = item(&app, hash).await?;
                let (traits, rolls) = top_traits(&app, gear.as_ref(), &info.name).await;
                Some(WeaponUse { item: info, rate: used as f64 / player_runs.max(1) as f64, kills, traits, rolls })
            }
        }))
        .await;
        weapons.extend(shown.into_iter().flatten());
        let mut types: Vec<TypeUse> = types
            .into_iter()
            .map(|(type_name, kills)| TypeUse { type_name, share: kills as f64 / all_kills.max(1) as f64 })
            .collect();
        types.sort_by(|a, b| b.share.total_cmp(&a.share));
        types.truncate(TOP_TYPES);
        println!("[usage] {name}: {activities} activities, {} players, {player_runs} player-runs", players.len());
        categories.push(UsageCategory {
            key: name.into(),
            activities,
            target: TARGET_COMPLETIONS,
            players: players.len(),
            player_runs,
            weapons,
            types,
            updated_at: updated_at.map(|u| u.timestamp_millis()),
        });
    }
    categories
}

/// The traits most often on equipped copies of a weapon (any version, by
/// name), and how many copies that is.
async fn top_traits(app: &AppHandle, gear: Option<&crate::weapons::Gear>, name: &str) -> (Vec<TraitUse>, usize) {
    let Some(gear) = gear else { return (Vec::new(), 0) };
    let all: Vec<(u64, Vec<u64>)> = {
        let cache = CACHE.lock().unwrap();
        let Some(cache) = cache.as_ref() else { return (Vec::new(), 0) };
        cache.rolls.values().flat_map(|(_, rolls)| rolls.iter().cloned()).collect()
    };
    // The versions of the weapon among the rolled hashes (by name).
    let copies: Vec<&Vec<u64>> =
        all.iter().filter(|(h, _)| gear.get(*h as u32).is_some_and(|g| g.name == name)).map(|(_, p)| p).collect();
    // Only traits ("frames": the two trait columns), not barrels, mags …;
    // an enhanced trait counts as the trait (by name).
    let plugs: Vec<u64> = copies.iter().flat_map(|p| p.iter()).copied().collect::<HashSet<_>>().into_iter().collect();
    let infos = futures::future::join_all(plugs.iter().map(|p| item(app, *p))).await;
    let traits_of: HashMap<u64, Option<ItemInfo>> = plugs
        .into_iter()
        .zip(infos)
        .map(|(plug, info)| (plug, info.filter(|i| i.plug_category == "frames" && i.icon_present())))
        .collect();
    let mut counts: HashMap<String, (usize, ItemInfo)> = HashMap::new();
    for plugs in &copies {
        let mut seen = HashSet::new();
        for info in plugs.iter().filter_map(|p| traits_of.get(p).cloned().flatten()) {
            if seen.insert(info.name.clone()) {
                counts.entry(info.name.clone()).or_insert((0, info)).0 += 1;
            }
        }
    }
    let mut traits: Vec<TraitUse> = counts
        .into_values()
        .map(|(n, item)| TraitUse { item, share: n as f64 / copies.len().max(1) as f64 })
        .collect();
    traits.sort_by(|a, b| b.share.total_cmp(&a.share));
    traits.truncate(TOP_TRAITS);
    (traits, copies.len())
}

/// Players in the counted reports whose equipped weapons aren't known yet
/// (asked before rolls were collected): their equipment, a batch per run.
async fn fill_rolls(http: &reqwest::Client, key: &str) {
    const PER_RUN: usize = 200;
    let missing: Vec<(i64, String)> = {
        let cache = CACHE.lock().unwrap();
        let Some(cache) = cache.as_ref() else { return };
        let mut seen = HashSet::new();
        CATEGORIES
            .iter()
            .flat_map(|(mode, _)| newest(cache, *mode))
            .flat_map(|(_, r)| r.players.iter())
            .filter(|(t, m, done, _)| *t > 0 && *done && !cache.rolls.contains_key(m) && seen.insert(m.clone()))
            .map(|(t, m, _, _)| (*t, m.clone()))
            .take(PER_RUN)
            .collect()
    };
    stream::iter(missing)
        .map(|(t, m)| {
            let (http, key) = (http.clone(), key.to_string());
            // No activities (count 0): just the profile with the rolls.
            async move { recent(&http, &key, t, &m, 0, 0).await }
        })
        .buffer_unordered(CONCURRENCY)
        .collect::<Vec<_>>()
        .await;
}
