//! Full clears, best full-clear times and lowmans from Bungie alone; for
//! dungeons their solo flawless runs and day-one clears.
//!
//! The activity history doesn't say whether a raid was started from the
//! beginning; only the post-game carnage report (PGCR) of each run does. So
//! every completed raid's PGCR is fetched once and what it tells kept on
//! disk forever: reports never change, and fireteam members share most runs.
//!
//! Which PGCR field tells depends on the report's age, as RaidHub reads them
//! (its Services, process-pgcr.go): since Season of the Haunted (2022-05-24)
//! `activityWasStartedFromBeginning` works; in Witch Queen before that it is
//! wrongly false after a wipe, so only a true one, or a false one on a run
//! without deaths, counts; in Beyond Light (2020-11-10 to 2022-02-22) it is
//! always false and the phase index tells nothing either: unknown; before
//! Beyond Light the starting phase does (0; Leviathan 0 or 2, Scourge of the
//! Past 0 or 1). A run of unknown start counts as no full clear.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

use futures::stream::{self, StreamExt};
use reqwest::Method;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::bungie::{api, api_url, BungieState};
use crate::i18n::{locale, tr};

const PGCR_BASE: &str = "https://stats.bungie.net/Platform";
/// Parallel PGCR requests (stats.bungie.net), still inside Bungie's limits.
const CONCURRENCY: usize = 16;
const HISTORY_PAGE: usize = 250;
/// History pages asked for at once (per character).
const PAGE_WAVE: usize = 4;
/// A history page when only the runs since the last time are asked for.
const UPDATE_PAGE: usize = 25;
/// Results are reused this long; new runs only need their own reports.
const TTL: Duration = Duration::from_secs(600);
/// Save the report cache every this many new reports, so progress survives
/// closing the app in the middle of a long first load.
const SAVE_EVERY: usize = 100;
/// Ages of PGCRs (see the module docs).
const BEYOND_LIGHT: &str = "2020-11-10T17:00:00Z";
const WITCH_QUEEN: &str = "2022-02-22T17:00:00Z";
const HAUNTED: &str = "2022-05-24T17:00:00Z";
/// Leviathan's activities (started fresh at phase 0 or 2) and Scourge of
/// the Past's (0 or 1), as RaidHub lists them.
const LEVIATHAN: [u64; 24] = [
    2693136600, 2693136601, 2693136602, 2693136603, 2693136604, 2693136605, 89727599, 287649202, 1699948563,
    1875726950, 3916343513, 4039317196, 417231112, 508802457, 757116822, 771164842, 1685065161, 1800508819,
    2449714930, 3446541099, 4206123728, 3912437239, 3879860661, 3857338478,
];
const SCOURGE: [u64; 2] = [548750096, 2812525063];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaidFullClears {
    name: String,
    full_clears: u32,
    /// Fastest run that was started from the beginning.
    best_seconds: Option<u64>,
    /// Lowmans and flawless runs, as RaidHub picks and names them.
    tags: Vec<crate::raidtags::RaidTag>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullClearStats {
    full_clears: u32,
    raids: Vec<RaidFullClears>,
    /// Sum of the best full-clear time of every raid that has one.
    sum_of_best_seconds: Option<u64>,
    /// Each dungeon's and exotic mission's best full-clear time (no
    /// checkpoint run), by name.
    best_full_seconds: HashMap<String, u64>,
    raids_with_best: u32,
    /// Completions whose start can't be told (not counted as full clears).
    unknown_start: u32,
    /// Dungeons: solo flawless runs and day-one clears.
    dungeons: Vec<DungeonTags>,
    /// Exotic missions: the same (no race).
    exotics: Vec<DungeonTags>,
    /// While loading: the list items still waiting for reports.
    pending: Vec<String>,
}

/// What's known while reports are still loading.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Partial {
    membership_id: String,
    stats: FullClearStats,
}

/// How often at most a partial result is shown while loading.
const PARTIAL_EVERY: Duration = Duration::from_millis(400);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DungeonTags {
    name: String,
    tags: Vec<crate::raidtags::RaidTag>,
}

/// Each dungeon's solo flawless triumph ("solo, without dying and without
/// leaving the activity"): Bungie awarded it in the game, so it tells even
/// where the reports can't (Nov 2020 – Feb 2022 they don't say whether a
/// run started from the beginning).
const SOLO_FLAWLESS_TRIUMPHS: [(&str, u32); 11] = [
    ("The Shattered Throne", 3205009787),
    ("Pit of Heresy", 3950599483),
    ("Prophecy", 3191784400),
    ("Grasp of Avarice", 3718971745),
    ("Duality", 4126703847),
    ("Spire of the Watcher", 4032136335),
    ("Ghosts of the Deep", 2105117002),
    ("Warlord's Ruin", 238037026),
    ("Vesper's Host", 1553599507),
    ("Sundered Doctrine", 28261116),
    ("Equilibrium", 1204858125),
];

/// The dungeons (English names) whose solo flawless triumph the player has.
/// Empty if their triumphs are private.
async fn solo_flawless_triumphs(app: &AppHandle, mt: i64, mid: &str) -> std::collections::HashSet<&'static str> {
    let state = app.state::<BungieState>();
    let Ok(key) = state.api_key() else { return Default::default() };
    let Ok(profile) = api(&state.http, &key, Method::GET, &format!("/Destiny2/{mt}/Profile/{mid}/?components=900"), None).await
    else {
        return Default::default();
    };
    // A record is done when its "objective not completed" bit (4) is off.
    let done = |records: &serde_json::Value, hash: u32| {
        records[hash.to_string()]["state"].as_u64().is_some_and(|state| state & 4 == 0)
    };
    let profile_records = &profile["profileRecords"]["data"]["records"];
    let characters: Vec<&serde_json::Value> = profile["characterRecords"]["data"]
        .as_object()
        .map(|c| c.values().map(|v| &v["records"]).collect())
        .unwrap_or_default();
    SOLO_FLAWLESS_TRIUMPHS
        .iter()
        .filter(|(_, hash)| done(profile_records, *hash) || characters.iter().any(|records| done(records, *hash)))
        .map(|(name, _)| *name)
        .collect()
}

/// The race window a run of a dungeon (English name) was completed in, and
/// its rank. Contest by the run's own activity (its "Contest Mode"
/// modifier; normal opens beside it once the world first is done): in the
/// first 24 hours "Day One Contest" (4), later "Contest" (3). Otherwise in
/// the first 24 hours "Day One" (2), before the first weekly reset after
/// release (Tuesday 17:00 UTC, as RaidHub has it for raids) "Week One" (1).
fn race_window(dungeon: &str, completed: DateTime<Utc>, contest: bool) -> Option<(&'static str, u8)> {
    use chrono::{Datelike, TimeZone};
    let (_, release) = DUNGEON_RELEASES.iter().find(|(n, _)| *n == dungeon)?;
    let release: DateTime<Utc> = release.parse().ok()?;
    let day_one = completed < release + chrono::Duration::days(1);
    match (day_one, contest) {
        (true, true) => return Some(("Day One Contest", 4)),
        (false, true) => return Some(("Contest", 3)),
        (true, false) => return Some(("Day One", 2)),
        _ => {}
    }
    // Days to the next Tuesday (a release on a Tuesday: the one after).
    let days = (8 - release.weekday().num_days_from_monday()) % 7;
    let days = if days == 0 { 7 } else { days };
    let reset = (release.date_naive() + chrono::Days::new(days as u64)).and_hms_opt(17, 0, 0)?;
    (completed < Utc.from_utc_datetime(&reset)).then_some(("Week One", 1))
}

/// When a dungeon (English name) went live.
pub(crate) fn dungeon_release(dungeon: &str) -> Option<&'static str> {
    DUNGEON_RELEASES.iter().find(|(n, _)| *n == dungeon).map(|(_, r)| *r)
}

/// When each dungeon went live (English names; 17:00 UTC, as Bungie starts
/// them): its day one is the 24 hours after.
const DUNGEON_RELEASES: [(&str, &str); 11] = [
    ("The Shattered Throne", "2018-09-25T17:00:00Z"),
    ("Pit of Heresy", "2019-10-29T17:00:00Z"),
    ("Prophecy", "2020-06-09T17:00:00Z"),
    ("Grasp of Avarice", "2021-12-07T17:00:00Z"),
    ("Duality", "2022-05-27T17:00:00Z"),
    ("Spire of the Watcher", "2022-12-09T17:00:00Z"),
    ("Ghosts of the Deep", "2023-05-26T17:00:00Z"),
    ("Warlord's Ruin", "2023-12-01T17:00:00Z"),
    ("Vesper's Host", "2024-10-11T17:00:00Z"),
    ("Sundered Doctrine", "2025-02-07T17:00:00Z"),
    ("Equilibrium", "2025-12-13T17:00:00Z"),
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    membership_id: String,
    done: usize,
    total: usize,
}

/// What a run's PGCR tells: started from the beginning (None: can't be
/// told), players, deaths. Short names: the file holds thousands.
#[derive(Clone, Copy, Serialize, serde::Deserialize)]
struct Report {
    f: Option<bool>,
    p: u8,
    d: u32,
}

/// Character id -> its class ("titan", "hunter", "warlock"), of the players looked at (a deleted
/// character has none).
static CLASSES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

/// A player's characters' classes (their current ones).
async fn character_classes(app: &AppHandle, mt: i64, membership_id: &str) -> HashMap<String, String> {
    let state = app.state::<BungieState>();
    let Ok(key) = state.api_key() else { return HashMap::new() };
    let path = format!("/Destiny2/{mt}/Profile/{membership_id}/?components=200");
    api(&state.http, &key, Method::GET, &path, None)
        .await
        .ok()
        .and_then(|p| p["characters"]["data"].as_object().cloned())
        .into_iter()
        .flatten()
        .filter_map(|(id, c)| {
            let class = match c["classType"].as_i64() {
                Some(0) => "titan",
                Some(1) => "hunter",
                Some(2) => "warlock",
                _ => return None,
            };
            Some((id, class.to_string()))
        })
        .collect()
}

/// A lowman tag's run: (players, flawless, master), when its label says
/// nothing else ("Solo Flawless", "Duo Flawless Master"; not "Week One
/// Solo Flawless" or "Solo Atheon": those are their own run only).
fn lowman_kind(label: &str) -> Option<(u8, bool, bool)> {
    let label = label.split(" · ").next().unwrap_or(label);
    let words: Vec<&str> = label.split(' ').collect();
    if !words.iter().all(|w| ["Solo", "Duo", "Trio", "Flawless", "Master"].contains(w)) {
        return None;
    }
    let players = if words.contains(&"Solo") {
        1
    } else if words.contains(&"Duo") {
        2
    } else if words.contains(&"Trio") {
        3
    } else {
        return None;
    };
    Some((players, words.contains(&"Flawless"), words.contains(&"Master")))
}

/// instanceId -> its report (persisted).
static REPORTS: Mutex<Option<HashMap<String, Report>>> = Mutex::new(None);
/// instanceId -> the skulls (feats) it had on, for runs since feats exist
/// (FEATS_FROM; persisted apart: older reports in the cache get only these
/// asked for again).
static FEATS: Mutex<Option<HashMap<String, Extras>>> = Mutex::new(None);

/// What a run's report tells beyond the Report, for runs since feats
/// exist: its skulls (feats and modifiers) and difficulty tier (an index
/// into its activity's tier list: "Expert" in the portal).
#[derive(Clone, Default, Serialize, serde::Deserialize)]
struct Extras {
    s: Vec<u32>,
    #[serde(default)]
    t: Option<u8>,
}
/// A race tag's labels alone (no lowman merged into it).
const RACE_LABELS: [&str; 6] = ["Day One", "Week One", "Contest", "Day One Contest", "Contest Challenge", "Day One Contest Challenge"];
/// Feats came with The Edge of Fate.
const FEATS_FROM: &str = "2025-07-15T17:00:00Z";

fn feats_path(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join("pgcr-extras-v2.json")
}

/// Whether a run is from when feats exist (its report tells which).
fn has_feats(run: &Run) -> bool {
    run.period.is_some_and(|p| p >= FEATS_FROM.parse::<DateTime<Utc>>().expect("valid date"))
}
static RESULTS: Mutex<Option<HashMap<String, (Instant, FullClearStats)>>> = Mutex::new(None);

fn cache_path(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from("."));
    // Earlier caches read old reports' start wrongly (and had no players).
    for old in ["pgcr-fresh-v2.json", "pgcr-crew-v1.json"] {
        let _ = std::fs::remove_file(dir.join(old));
    }
    dir.join("pgcr-v3.json")
}

fn load_reports(app: &AppHandle) {
    let mut reports = REPORTS.lock().unwrap();
    if reports.is_none() {
        *reports = Some(
            std::fs::read_to_string(cache_path(app))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        );
    }
    let mut feats = FEATS.lock().unwrap();
    if feats.is_none() {
        *feats = Some(
            std::fs::read_to_string(feats_path(app))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        );
    }
}

fn save_reports(app: &AppHandle) {
    let json = serde_json::to_string(REPORTS.lock().unwrap().as_ref().unwrap_or(&HashMap::new()));
    if let Ok(json) = json {
        let path = cache_path(app);
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, json);
    }
    if let Ok(json) = serde_json::to_string(FEATS.lock().unwrap().as_ref().unwrap_or(&HashMap::new())) {
        let _ = std::fs::write(feats_path(app), json);
    }
}

/// A completed raid run from the activity history.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Run {
    instance_id: String,
    activity_hash: u64,
    seconds: u64,
    /// When it started.
    period: Option<DateTime<Utc>>,
    /// The character it was played on (set as the runs are read).
    #[serde(default, skip)]
    character_id: String,
}

/// Each character's completed runs ("account:mode" -> character -> runs,
/// newest first), kept on disk: an update only asks for the runs since.
type History = HashMap<String, HashMap<String, Vec<Run>>>;
static HISTORY: Mutex<Option<History>> = Mutex::new(None);

fn history_path(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join("history-v1.json")
}

/// The runs kept for a character (empty: none yet, the whole history is
/// asked for).
fn known_runs(app: &AppHandle, key: &str, cid: &str) -> Vec<Run> {
    let mut history = HISTORY.lock().unwrap();
    let history = history.get_or_insert_with(|| {
        std::fs::read_to_string(history_path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    });
    history.get(key).and_then(|c| c.get(cid)).cloned().unwrap_or_default()
}

fn save_history(app: &AppHandle, key: &str, characters: HashMap<String, Vec<Run>>) {
    let json = {
        let mut history = HISTORY.lock().unwrap();
        let history = history.get_or_insert_default();
        history.insert(key.to_string(), characters);
        serde_json::to_string(history)
    };
    if let Ok(json) = json {
        let path = history_path(app);
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, json);
    }
}

/// A history page's activities: the completed runs, and every instance on
/// it (completed or not).
fn page_runs(history: &serde_json::Value) -> (Vec<Run>, Vec<&str>) {
    let list = history["activities"].as_array().map(Vec::as_slice).unwrap_or_default();
    let mut runs = Vec::new();
    let mut ids = Vec::new();
    for a in list {
        let Some(instance_id) = a["activityDetails"]["instanceId"].as_str() else { continue };
        ids.push(instance_id);
        let value = |name: &str| a["values"][name]["basic"]["value"].as_f64().unwrap_or(0.0);
        if value("completed") < 1.0 {
            continue;
        }
        runs.push(Run {
            instance_id: instance_id.to_string(),
            activity_hash: a["activityDetails"]["referenceId"].as_u64().unwrap_or(0),
            seconds: value("activityDurationSeconds") as u64,
            period: a["period"].as_str().and_then(|p| p.parse().ok()),
            character_id: String::new(),
        });
    }
    (runs, ids)
}

/// Completed runs of an activity mode (4 raids, 82 dungeons). Only what is
/// new since the last time is asked for: the history comes newest first,
/// so its pages until one with a run already known.
async fn completed_runs(app: &AppHandle, mt: i64, mid: &str, mode: u32) -> Result<Vec<Run>, String> {
    let state = app.state::<BungieState>();
    let key = state.api_key()?;
    // Account stats list deleted characters too; their raids still count.
    let account = api(&state.http, &key, Method::GET, &format!("/Destiny2/{mt}/Account/{mid}/Stats/?groups=1"), None).await?;
    let character_ids: Vec<String> = account["characters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|c| c["characterId"].as_str().map(Into::into))
        .collect();
    let history_key = format!("{mid}:{mode}");

    // Every character at once.
    let per_character = character_ids.iter().map(|cid| {
        let (http, key) = (&state.http, &key);
        let known = known_runs(app, &history_key, cid);
        async move {
            let page_path = |count: usize, page: usize| {
                format!("/Destiny2/{mt}/Account/{mid}/Character/{cid}/Stats/Activities/?mode={mode}&count={count}&page={page}")
            };
            let mut runs = Vec::new();
            if known.is_empty() {
                // Nothing kept: the whole history, its pages a few at once
                // (a wave, the next one while the last came back full).
                for wave in 0.. {
                    let pages = (wave * PAGE_WAVE..(wave + 1) * PAGE_WAVE).map(|page| {
                        let path = page_path(HISTORY_PAGE, page);
                        async move { api(http, key, Method::GET, &path, None).await }
                    });
                    let mut more = true;
                    for history in futures::future::join_all(pages).await {
                        let history = history?;
                        let (page, ids) = page_runs(&history);
                        runs.extend(page);
                        more &= ids.len() == HISTORY_PAGE;
                    }
                    if !more {
                        break;
                    }
                }
            } else {
                // Newer runs: small pages until one reaches a known run.
                let ids: std::collections::HashSet<&str> = known.iter().map(|r| r.instance_id.as_str()).collect();
                for page in 0.. {
                    let history = api(http, key, Method::GET, &page_path(UPDATE_PAGE, page), None).await?;
                    let (page, on_page) = page_runs(&history);
                    runs.extend(page.into_iter().filter(|r| !ids.contains(r.instance_id.as_str())));
                    if on_page.len() < UPDATE_PAGE || on_page.iter().any(|id| ids.contains(id)) {
                        break;
                    }
                }
                runs.extend(known.iter().cloned());
            }
            for run in &mut runs {
                run.character_id = cid.clone();
            }
            Ok::<_, String>((cid.clone(), runs))
        }
    });
    let mut characters = HashMap::new();
    for character in futures::future::join_all(per_character).await {
        let (cid, runs) = character?;
        characters.insert(cid, runs);
    }
    let runs = characters.values().flatten().cloned().collect();
    save_history(app, &history_key, characters);
    Ok(runs)
}

/// A run's PGCR from Bungie.
pub(crate) async fn fetch_report(http: &reqwest::Client, key: &str, instance_id: &str) -> Option<serde_json::Value> {
    let url = format!("{PGCR_BASE}/Destiny2/Stats/PostGameCarnageReport/{instance_id}/");
    api_url(http, key, Method::GET, &url, None).await.ok()
}

/// Whether a PGCR's run was started from the beginning, as far as its age
/// lets it tell (see the module docs; None: can't be told).
pub(crate) fn started_fresh(report: &serde_json::Value) -> Option<bool> {
    let period = report["period"].as_str().and_then(|p| DateTime::parse_from_rfc3339(p).ok())?;
    let at = |date: &str| -> DateTime<Utc> { date.parse().expect("valid date") };
    let deaths: f64 = report["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| e["values"]["deaths"]["basic"]["value"].as_f64().unwrap_or(0.0))
        .sum();
    let flag = report["activityWasStartedFromBeginning"].as_bool();
    // The raid itself (Pantheon's playlists name it in referenceId).
    let details = &report["activityDetails"];
    let director = details["directorActivityHash"].as_u64().unwrap_or(0);
    let activity = details["referenceId"].as_u64().filter(|&r| r != 0 && r != director).unwrap_or(director);
    if period >= at(HAUNTED) {
        flag
    } else if period >= at(WITCH_QUEEN) {
        // Wrongly false after a wipe: a false one only counts without deaths.
        flag.filter(|&f| f || deaths == 0.0)
    } else if period >= at(BEYOND_LIGHT) {
        None
    } else {
        report["startingPhaseIndex"].as_i64().map(|phase| {
            if LEVIATHAN.contains(&activity) {
                phase == 0 || phase == 2
            } else if SCOURGE.contains(&activity) {
                phase <= 1
            } else {
                phase == 0
            }
        })
    }
}

/// What a run's PGCR tells (None = the request failed).
async fn report_of(http: &reqwest::Client, key: &str, instance_id: &str) -> Option<(Report, Extras)> {
    let report = fetch_report(http, key, instance_id).await?;
    // The feats it had on (listed once per slot and player: once each).
    let mut skulls: Vec<u32> = report["selectedSkullHashes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|h| h.as_u64().map(|h| h as u32))
        .filter(|&h| crate::feats::is_feat(h))
        .collect();
    skulls.sort_unstable();
    skulls.dedup();
    // Everyone who played in it (once, whatever their characters), and all
    // their deaths.
    let entries = report["entries"].as_array().cloned().unwrap_or_default();
    let mut players: Vec<&str> = entries
        .iter()
        .filter_map(|e| e["player"]["destinyUserInfo"]["membershipId"].as_str())
        .collect();
    players.sort_unstable();
    players.dedup();
    let deaths: f64 = entries.iter().map(|e| e["values"]["deaths"]["basic"]["value"].as_f64().unwrap_or(0.0)).sum();
    let tier = report["activityDifficultyTier"].as_u64().map(|t| t.min(255) as u8);
    Some((Report { f: started_fresh(&report), p: players.len().min(255) as u8, d: deaths as u32 }, Extras { s: skulls, t: tier }))
}

async fn compute(app: &AppHandle, membership_id: &str) -> Result<FullClearStats, String> {
    let member = crate::fireteam::resolve_member(app, membership_id)
        .await
        .ok_or(tr("Spieler nicht gefunden", "Player not found"))?;
    // Raids, dungeons, exotic missions (story and portal versions), names
    // and triumphs all at once.
    let mt = member.membership_type;
    let (runs, dungeon_runs, story_runs, strike_runs, raid_names, dungeon_names, exotic_names, triumphs, classes) = futures::join!(
        completed_runs(app, mt, membership_id, 4),
        completed_runs(app, mt, membership_id, 82),
        completed_runs(app, mt, membership_id, 2),
        completed_runs(app, mt, membership_id, 3),
        crate::fireteam::raid_names(app),
        crate::fireteam::dungeon_names(app),
        crate::fireteam::exotic_names(app),
        solo_flawless_triumphs(app, mt, membership_id),
        character_classes(app, mt, membership_id),
    );
    CLASSES.lock().unwrap().get_or_insert_default().extend(classes);
    let (runs, raid_names) = (runs?, raid_names?);
    let (dungeon_runs, dungeon_names) = (dungeon_runs?, dungeon_names?);
    // Only the exotic missions of the story and strike runs (their reports
    // are asked for).
    let exotic_names = exotic_names.unwrap_or_default();
    let mut exotic_runs: Vec<Run> = story_runs
        .unwrap_or_default()
        .into_iter()
        .chain(strike_runs.unwrap_or_default())
        .filter(|r| exotic_names.contains_key(&r.activity_hash))
        .collect();
    exotic_runs.sort_by(|a, b| a.instance_id.cmp(&b.instance_id));
    exotic_runs.dedup_by(|a, b| a.instance_id == b.instance_id);

    load_reports(app);
    // Runs with no report yet, and runs from when feats exist whose feats
    // aren't known yet (reports kept from before).
    let missing: Vec<String> = {
        let reports = REPORTS.lock().unwrap();
        let reports = reports.as_ref().expect("loaded");
        let feats = FEATS.lock().unwrap();
        let feats = feats.as_ref().expect("loaded");
        runs.iter()
            .chain(&dungeon_runs)
            .chain(&exotic_runs)
            .filter(|r| !reports.contains_key(&r.instance_id) || (has_feats(r) && !feats.contains_key(&r.instance_id)))
            .map(|r| r.instance_id.clone())
            .collect()
    };

    // The list item each run is (a raid, dungeon, exotic mission or
    // Pantheon version, by the name shown): downloads go by item, the
    // smallest first, and each finished one shows at once.
    let item_of: HashMap<&str, String> = runs
        .iter()
        .map(|r| (r, raid_names.get(&r.activity_hash)))
        .chain(dungeon_runs.iter().map(|r| (r, dungeon_names.get(&r.activity_hash))))
        .chain(exotic_runs.iter().map(|r| (r, exotic_names.get(&r.activity_hash))))
        .filter_map(|(r, n)| Some((r.instance_id.as_str(), n?.0.clone())))
        .collect();
    let mut left: HashMap<String, usize> = HashMap::new();
    for id in &missing {
        *left.entry(item_of.get(id.as_str()).cloned().unwrap_or_default()).or_default() += 1;
    }
    let mut missing = missing;
    missing.sort_by_key(|id| {
        let item = item_of.get(id.as_str()).cloned().unwrap_or_default();
        (left.get(&item).copied().unwrap_or(0), item)
    });
    let pending = |left: &HashMap<String, usize>| -> Vec<String> {
        left.iter().filter(|(n, c)| **c > 0 && !n.is_empty()).map(|(n, _)| n.clone()).collect()
    };
    let mut shown_at = Instant::now();

    let total = missing.len();
    let emit = |done: usize| {
        let _ = app.emit(
            "fullclears-progress",
            Progress { membership_id: membership_id.to_string(), done, total },
        );
    };
    if total > 0 {
        emit(0);
        // What the reports kept already tell, at once.
        let stats = tally(
            app,
            &runs,
            &dungeon_runs,
            &exotic_runs,
            &raid_names,
            &dungeon_names,
            &exotic_names,
            &triumphs,
            pending(&left),
        )
        .await;
        let _ = app.emit("fullclears-partial", Partial { membership_id: membership_id.to_string(), stats });
        let state = app.state::<BungieState>();
        let (http, key) = (state.http.clone(), state.api_key()?);
        let mut results = stream::iter(missing)
            .map(|id| {
                let (http, key) = (http.clone(), key.clone());
                async move {
                    let report = report_of(&http, &key, &id).await;
                    (id, report)
                }
            })
            .buffer_unordered(CONCURRENCY);
        let mut done = 0;
        while let Some((id, report)) = results.next().await {
            done += 1;
            let item = item_of.get(id.as_str()).cloned().unwrap_or_default();
            if let Some((report, extras)) = report {
                FEATS.lock().unwrap().get_or_insert_default().insert(id.clone(), extras);
                REPORTS.lock().unwrap().get_or_insert_default().insert(id, report);
            }
            // An item done: what's known so far, shown (a few times a
            // second at most).
            let count = left.entry(item).or_default();
            *count = count.saturating_sub(1);
            if *count == 0 && done < total && shown_at.elapsed() >= PARTIAL_EVERY {
                shown_at = Instant::now();
                let stats = tally(
                    app,
                    &runs,
                    &dungeon_runs,
                    &exotic_runs,
                    &raid_names,
                    &dungeon_names,
                    &exotic_names,
                    &triumphs,
                    pending(&left),
                )
                .await;
                let _ = app.emit("fullclears-partial", Partial { membership_id: membership_id.to_string(), stats });
            }
            if done % SAVE_EVERY == 0 {
                save_reports(app);
            }
            if done % 10 == 0 || done == total {
                emit(done);
            }
        }
        save_reports(app);
    }

    let mut stats = tally(
        app,
        &runs,
        &dungeon_runs,
        &exotic_runs,
        &raid_names,
        &dungeon_names,
        &exotic_names,
        &triumphs,
        Vec::new(),
    )
    .await;
    // Lowman tags whose run's character is gone (deleted: not in the
    // profile): its class from the run's own report.
    if classes_from_reports(app, &runs, &dungeon_runs, &exotic_runs).await {
        stats = tally(app, &runs, &dungeon_runs, &exotic_runs, &raid_names, &dungeon_names, &exotic_names, &triumphs, Vec::new()).await;
    }
    Ok(stats)
}

/// The classes of characters no longer in the profile (deleted) whose runs
/// are lowmans: from those runs' reports (they say each player's class).
/// Whether any was learned.
async fn classes_from_reports(app: &AppHandle, runs: &[Run], dungeon_runs: &[Run], exotic_runs: &[Run]) -> bool {
    // A lowman run of a character of unknown class: one per character.
    let missing: Vec<(String, String)> = {
        // (Reports first, then classes: as `tally` takes them.)
        let reports = REPORTS.lock().unwrap();
        let classes = CLASSES.lock().unwrap();
        let (Some(classes), Some(reports)) = (classes.as_ref(), reports.as_ref()) else { return false };
        let mut seen = std::collections::HashSet::new();
        runs.iter()
            .chain(dungeon_runs)
            .chain(exotic_runs)
            .filter(|r| !r.character_id.is_empty() && !classes.contains_key(&r.character_id))
            .filter(|r| reports.get(&r.instance_id).is_some_and(|rep| rep.p <= 3))
            .filter(|r| seen.insert(r.character_id.clone()))
            .map(|r| (r.character_id.clone(), r.instance_id.clone()))
            .collect()
    };
    if missing.is_empty() {
        return false;
    }
    let state = app.state::<BungieState>();
    let Ok(key) = state.api_key() else { return false };
    let http = state.http.clone();
    let found: Vec<Option<(String, String)>> = stream::iter(missing)
        .map(|(character, instance)| {
            let (http, key) = (http.clone(), key.clone());
            async move {
                let report = fetch_report(&http, &key, &instance).await?;
                let entry = report["entries"].as_array()?.iter().find(|e| e["characterId"].as_str() == Some(character.as_str()))?;
                let class = match entry["player"]["classHash"].as_u64()? {
                    3655393761 => "titan",
                    671679327 => "hunter",
                    2271682572 => "warlock",
                    _ => return None,
                };
                Some((character, class.to_string()))
            }
        })
        .buffer_unordered(8)
        .collect()
        .await;
    let found: Vec<(String, String)> = found.into_iter().flatten().collect();
    let any = !found.is_empty();
    CLASSES.lock().unwrap().get_or_insert_default().extend(found);
    any
}

/// What a player's runs and the reports kept so far make: full clears and
/// every tag. Also while reports are still loading (`pending`: the list
/// items still waiting for some).
#[allow(clippy::too_many_arguments)]
async fn tally(
    app: &AppHandle,
    runs: &[Run],
    dungeon_runs: &[Run],
    exotic_runs: &[Run],
    raid_names: &HashMap<u64, (String, bool)>,
    dungeon_names: &HashMap<u64, (String, bool)>,
    exotic_names: &HashMap<u64, (String, bool)>,
    triumphs: &std::collections::HashSet<&'static str>,
    pending: Vec<String>,
) -> FullClearStats {
    // Every modifier, for the tags' feats (looked up before any lock).
    let mods = crate::feats::definitions(app).await;
    // Dungeons first (their names are looked up, with no lock held).
    let dungeon_reports: HashMap<String, Report> = {
        let reports = REPORTS.lock().unwrap();
        let reports = reports.as_ref().expect("loaded");
        dungeon_runs.iter().filter_map(|r| reports.get(&r.instance_id).map(|rep| (r.instance_id.clone(), *rep))).collect()
    };
    let mut dungeons = dungeon_tags(app, dungeon_runs, dungeon_names, &dungeon_reports, triumphs).await;
    // Exotic missions: tagged as dungeons are (solo flawless, the hardest
    // solo difficulty).
    let exotic_reports: HashMap<String, Report> = {
        let reports = REPORTS.lock().unwrap();
        let reports = reports.as_ref().expect("loaded");
        exotic_runs.iter().filter_map(|r| reports.get(&r.instance_id).map(|rep| (r.instance_id.clone(), *rep))).collect()
    };
    let mut exotics = exotic_tags(app, exotic_runs, exotic_names, &exotic_reports).await;
    // Their fastest full clears: a dungeon's started fresh, a mission's
    // unless it says otherwise (as its tags count them).
    let mut best_full_seconds: HashMap<String, u64> = HashMap::new();
    let fastest = [(dungeon_runs, dungeon_names, &dungeon_reports, true), (exotic_runs, exotic_names, &exotic_reports, false)];
    for (list, names, reports, strict) in fastest {
        for run in list {
            let (Some((name, _)), Some(report)) = (names.get(&run.activity_hash), reports.get(&run.instance_id)) else {
                continue;
            };
            let full = if strict { report.f == Some(true) } else { report.f != Some(false) };
            if full && run.seconds > 0 && !name.is_empty() {
                let best = best_full_seconds.entry(name.clone()).or_insert(run.seconds);
                *best = (*best).min(run.seconds);
            }
        }
    }

    let reports = REPORTS.lock().unwrap();
    let reports = reports.as_ref().expect("loaded");
    #[derive(Default)]
    struct Tally {
        full_clears: u32,
        best_seconds: Option<u64>,
        tags: Vec<crate::raidtags::RaidTag>,
    }
    let mut per_raid: HashMap<String, Tally> = HashMap::new();
    let (mut full_clears, mut unknown_start) = (0, 0);
    // RaidHub's activity -> the raid's name here (for its tags).
    let mut names: HashMap<u16, String> = HashMap::new();
    let mut instances = Vec::new();
    for run in runs {
        let Some(report) = reports.get(&run.instance_id) else { continue };
        unknown_start += u32::from(report.f.is_none());
        let (name, _) = raid_names.get(&run.activity_hash).cloned().unwrap_or_default();
        // The Pantheon (101, 102) is a list item per version: tagged
        // apart (pantheon_tags).
        if let Some((activity, _)) = crate::raidtags::activity_version(run.activity_hash).filter(|(a, _)| *a != 101 && *a != 102) {
            if !name.is_empty() {
                names.entry(activity).or_insert_with(|| name.clone());
            }
        }
        if let Some(started) = run.period {
            instances.push(crate::raidtags::Instance {
                id: run.instance_id.clone(),
                hash: run.activity_hash,
                players: report.p,
                fresh: report.f,
                deathless: report.d == 0,
                started,
                completed: started + chrono::Duration::seconds(run.seconds as i64),
            });
        }
        if report.f != Some(true) {
            continue;
        }
        full_clears += 1;
        let entry = per_raid.entry(name).or_default();
        entry.full_clears += 1;
        if run.seconds > 0 {
            entry.best_seconds = Some(entry.best_seconds.map_or(run.seconds, |best| best.min(run.seconds)));
        }
    }
    for (activity, tags) in crate::raidtags::tags(&instances) {
        if let Some(name) = names.get(&activity) {
            per_raid.entry(name.clone()).or_default().tags.extend(tags);
        }
    }
    for (name, tags) in pantheon_tags(runs, raid_names, reports) {
        per_raid.entry(name).or_default().tags.extend(tags);
    }

    let mut raids: Vec<RaidFullClears> = per_raid
        .into_iter()
        .filter(|(name, t)| !name.is_empty() && (t.full_clears > 0 || !t.tags.is_empty()))
        .map(|(name, t)| RaidFullClears { name, full_clears: t.full_clears, best_seconds: t.best_seconds, tags: t.tags })
        .collect();
    raids.sort_by_key(|r| std::cmp::Reverse(r.full_clears));
    let bests: Vec<u64> = raids.iter().filter_map(|r| r.best_seconds).collect();

    // The list items where feats were played (each of their tags says its
    // run's count, none too).
    let mut with_feats: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Where feats exist: the run with the most of them (then the heavier
    // ones, fewer players, flawless, the earlier), unless a lowman tag is
    // that run already ("5 Feats").
    {
        let extras = FEATS.lock().unwrap();
        let extras = extras.as_ref();
        type Key = (usize, u32, std::cmp::Reverse<u8>, bool, std::cmp::Reverse<DateTime<Utc>>);
        let mut best: HashMap<String, (Key, String, u8, u32, DateTime<Utc>)> = HashMap::new();
        let all = runs.iter().map(|r| (r, raid_names.get(&r.activity_hash))).chain(dungeon_runs.iter().map(|r| (r, dungeon_names.get(&r.activity_hash))));
        for (run, name) in all {
            let (Some((name, _)), Some(report), Some(started), Some(extra)) =
                (name, reports.get(&run.instance_id), run.period, extras.and_then(|e| e.get(&run.instance_id)))
            else {
                continue;
            };
            let feats: Vec<&crate::feats::Feat> = extra.s.iter().filter_map(|h| mods.get(h)).filter(|m| m.kind == "feat").collect();
            // The Pantheon's start flag often says "not from the start": its
            // runs count regardless.
            let pantheon = crate::raidtags::activity_version(run.activity_hash).is_some_and(|(a, _)| a == 101 || a == 102);
            if feats.is_empty() || name.is_empty() || (report.f == Some(false) && !pantheon) {
                continue;
            }
            let grade: u32 = feats.iter().map(|m| u32::from(m.grade)).sum();
            let completed = started + chrono::Duration::seconds(run.seconds as i64);
            let key = (feats.len(), grade, std::cmp::Reverse(report.p), report.d == 0, std::cmp::Reverse(completed));
            if best.get(name).is_none_or(|b| key > b.0) {
                best.insert(name.clone(), (key, run.instance_id.clone(), report.p, report.d, completed));
            }
        }
        with_feats.extend(best.keys().cloned());
        let feat_count = |id: &str| -> usize {
            extras
                .and_then(|e| e.get(id))
                .map_or(0, |e| e.s.iter().filter_map(|h| mods.get(h)).filter(|m| m.kind == "feat").count())
        };
        for (name, (key, id, _, _, when)) in best {
            // Only with more feats than any lowman tag of it has (that one
            // says its own count already).
            let lowman_most = raids
                .iter()
                .filter(|r| r.name == name)
                .flat_map(|r| &r.tags)
                .chain(dungeons.iter().filter(|d| d.name == name).flat_map(|d| &d.tags))
                .filter(|t| !t.instance_id.is_empty() && !(t.race && RACE_LABELS.contains(&t.label.as_str())))
                .map(|t| feat_count(&t.instance_id))
                .max();
            if lowman_most.is_some_and(|most| key.0 <= most) {
                continue;
            }
            // Just its count ("5 Feats", set below with the icons).
            let label = "Feats".to_string();
            let tag = crate::raidtags::RaidTag {
                label,
                best: false,
                checkpoint: false,
                instance_id: id,
                date: when.to_rfc3339(),
                race: false,
                race_best: None,
                feats: Vec::new(),
                classes: Vec::new(),
                runs: Vec::new(),
            };
            if let Some(r) = raids.iter_mut().find(|r| r.name == name) {
                r.tags.push(tag);
            } else if let Some(d) = dungeons.iter_mut().find(|d| d.name == name) {
                d.tags.push(tag);
            } else if raid_names.values().any(|(n, _)| *n == name) {
                raids.push(RaidFullClears { name, full_clears: 0, best_seconds: None, tags: vec![tag] });
            } else {
                dungeons.push(DungeonTags { name, tags: vec![tag] });
            }
        }
    }
    // Every tag its run's feats (as small icons on it).
    let feats_of = |id: &str| -> Vec<crate::feats::Feat> {
        let feats = FEATS.lock().unwrap();
        feats
            .as_ref()
            .and_then(|f| f.get(id))
            .map(|e| e.s.iter().filter_map(|h| mods.get(h)).filter(|m| m.kind == "feat").cloned().collect())
            .unwrap_or_default()
    };
    let items = raids
        .iter_mut()
        .map(|r| (&r.name, &mut r.tags))
        .chain(dungeons.iter_mut().map(|d| (&d.name, &mut d.tags)));
    for (name, tags) in items {
        let counted = with_feats.contains(name);
        for tag in tags.iter_mut().filter(|t| !t.instance_id.is_empty()) {
            tag.feats = feats_of(&tag.instance_id);
            // Where feats were played: every tag its run's count (none
            // too), the most-feats one its count alone ("5 Feats").
            let n = tag.feats.len();
            // A race alone ("Day One", "Day One Contest") counts no feats.
            let race_only = tag.race && RACE_LABELS.contains(&tag.label.as_str());
            if tag.label == "Feats" {
                tag.label = format!("{n} {}", if n == 1 { "Feat" } else { "Feats" });
            } else if !race_only && (counted || n > 0) {
                tag.label = format!("{} · {n} {}", tag.label, if n == 1 { "Feat" } else { "Feats" });
            }
        }
    }

    // Lowman tags: the classes of the characters that made them: every run
    // like the tag's (as many players, flawless or not, master or not, from
    // the start) on that list item, and the tag's own.
    {
        let classes = CLASSES.lock().unwrap();
        let classes = classes.as_ref();
        // (The reports: the lock taken above, still held.)
        let by_id: HashMap<&str, &Run> = runs.iter().chain(dungeon_runs).chain(exotic_runs).map(|r| (r.instance_id.as_str(), r)).collect();
        // Each list item's runs, with whether they are its master version.
        let mut of_item: HashMap<&str, Vec<(&Run, bool)>> = HashMap::new();
        for (list, names) in [(runs, raid_names), (dungeon_runs, dungeon_names), (exotic_runs, exotic_names)] {
            for run in list {
                if let Some((name, master)) = names.get(&run.activity_hash) {
                    of_item.entry(name.as_str()).or_default().push((run, *master));
                }
            }
        }
        let items = raids
            .iter_mut()
            .map(|r| (r.name.clone(), &mut r.tags))
            .chain(dungeons.iter_mut().map(|d| (d.name.clone(), &mut d.tags)))
            .chain(exotics.iter_mut().map(|d| (d.name.clone(), &mut d.tags)));
        for (name, tags) in items {
            for tag in tags.iter_mut().filter(|t| !t.race && !t.instance_id.is_empty()) {
                let lowman = ["Solo", "Duo", "Trio"].iter().any(|w| tag.label.split(' ').any(|l| l == *w));
                if !lowman {
                    continue;
                }
                let mut made: Vec<&Run> = by_id.get(tag.instance_id.as_str()).copied().into_iter().collect();
                if let (Some((players, flawless, master)), false) = (lowman_kind(&tag.label), tag.checkpoint) {
                    for (run, is_master) in of_item.get(name.as_str()).into_iter().flatten() {
                        let Some(report) = reports.get(&run.instance_id) else { continue };
                        if report.p == players && (!flawless || report.d == 0) && report.f == Some(true) && *is_master == master {
                            made.push(run);
                        }
                    }
                }
                // Per class its newest run; those newest first.
                let completed = |r: &Run| r.period.map(|p| p + chrono::Duration::seconds(r.seconds as i64));
                made.sort_by_key(|r| std::cmp::Reverse(completed(r)));
                let mut per_class: Vec<crate::raidtags::TagRun> = Vec::new();
                for run in made {
                    let Some(class) = classes.and_then(|m| m.get(&run.character_id)) else { continue };
                    if per_class.iter().any(|r| r.class == *class) {
                        continue;
                    }
                    per_class.push(crate::raidtags::TagRun {
                        class: class.clone(),
                        instance_id: run.instance_id.clone(),
                        date: completed(run).map(|d| d.to_rfc3339()).unwrap_or_default(),
                    });
                }
                let mut names: Vec<String> = per_class.iter().map(|r| r.class.clone()).collect();
                names.sort_by_key(|c| ["titan", "hunter", "warlock"].iter().position(|x| x == c).unwrap_or(3));
                tag.classes = names;
                tag.runs = per_class;
            }
        }
    }

    FullClearStats {
        full_clears,
        raids_with_best: bests.len() as u32,
        sum_of_best_seconds: (!bests.is_empty()).then(|| bests.iter().sum()),
        best_full_seconds,
        raids,
        unknown_start,
        dungeons,
        exotics,
            pending,
    }
}

/// Each exotic mission's tags: its best lowman full clear (solo flawless,
/// solo, duo flawless, duo: a trio is its full team), on its normal
/// versions and apart on its master ones, from every run of it, the first
/// versions' and the portal's alike. Among equal lowmans the harder run
/// wins: its portal difficulty ("Ultimate"), then no boons on, then more
/// challenge triangles; the tag says the difficulty and the triangles of
/// the debuffs and buffs on.
async fn exotic_tags(
    app: &AppHandle,
    runs: &[Run],
    names: &HashMap<u64, (String, bool)>,
    reports: &HashMap<String, Report>,
) -> Vec<DungeonTags> {
    use crate::raidtags::RaidTag;
    // Each activity's difficulty tiers by name ("Training (1 of 6)" …
    // "Normal" … "Ultimate"), and every modifier's kind.
    let hashes: std::collections::HashSet<u64> = runs.iter().map(|r| r.activity_hash).collect();
    let tiers: HashMap<u64, Vec<String>> = futures::future::join_all(hashes.into_iter().map(|hash| async move {
        let def = crate::fireteam::definition(app, "DestinyActivityDefinition", hash).await;
        let mut tiers = Vec::new();
        if let Some(c) = def.as_ref().and_then(|d| d["difficultyTierCollectionHash"].as_u64()).filter(|&c| c != 0) {
            if let Some(c) = crate::fireteam::definition(app, "DestinyActivityDifficultyTierCollectionDefinition", c).await {
                tiers = c["difficultyTiers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|t| t["displayProperties"]["name"].as_str().unwrap_or_default().to_string())
                    .collect();
            }
        }
        (hash, tiers)
    }))
    .await
    .into_iter()
    .collect();
    let mods = crate::feats::definitions(app).await;
    let extras: HashMap<String, Extras> = {
        let feats = FEATS.lock().unwrap();
        let feats = feats.as_ref().expect("loaded");
        runs.iter().filter_map(|r| Some((r.instance_id.clone(), feats.get(&r.instance_id)?.clone()))).collect()
    };

    // (lowman, tier, no boons, challenge triangles): the higher wins, then
    // the earlier.
    type Key = (u8, usize, bool, u32);
    struct Best {
        key: Key,
        when: DateTime<Utc>,
        id: String,
        tier: Option<String>,
        /// Its modifiers' triangles: of the challenges (debuffs) and the
        /// boons (buffs) on.
        mods: Option<(u32, u32)>,
    }
    let mut per: HashMap<String, (Option<Best>, Option<Best>)> = HashMap::new();
    for run in runs {
        let (Some((name, master)), Some(report), Some(started)) =
            (names.get(&run.activity_hash), reports.get(&run.instance_id), run.period)
        else {
            continue;
        };
        // A mission is played from its start (no joining a checkpoint):
        // a run counts unless it says otherwise (Beyond Light's runs tell
        // nothing).
        if name.is_empty() || report.f == Some(false) || !(1..=2).contains(&report.p) {
            continue;
        }
        // Solo flawless 4, solo 3, duo flawless 2, duo 1.
        let lowman = (3 - report.p) * 2 - u8::from(report.d != 0);
        let extra = extras.get(&run.instance_id);
        let tier_index = extra.and_then(|e| e.t).map(usize::from);
        let tier = tier_index.and_then(|t| tiers.get(&run.activity_hash)?.get(t).cloned());
        // Only the modifiers picked (the rules come with the difficulty).
        let picked: Vec<&crate::feats::Feat> = extra
            .into_iter()
            .flat_map(|e| &e.s)
            .filter_map(|h| mods.get(h))
            .filter(|m| m.category_order != crate::feats::RULES_ORDER && m.kind != "feat")
            .collect();
        // "No buffs" only says something where modifiers could be picked.
        let no_boons = !picked.is_empty() && !picked.iter().any(|m| m.kind == "boon" || m.triangles < 0);
        // The portal's triangles: a debuff's up, a buff's down.
        let challenges: u32 = picked.iter().map(|m| m.triangles.max(0) as u32).sum();
        let key = (lowman, tier_index.unwrap_or(0), no_boons, challenges);
        let completed = started + chrono::Duration::seconds(run.seconds as i64);
        let (normal, hard) = per.entry(name.clone()).or_default();
        let slot = if *master { hard } else { normal };
        if slot.as_ref().is_none_or(|b| key > b.key || (key == b.key && completed < b.when)) {
            let boons: u32 = picked.iter().map(|m| (-m.triangles).max(0) as u32).sum();
            let mods = (!picked.is_empty()).then_some((challenges, boons));
            *slot = Some(Best { key, when: completed, id: run.instance_id.clone(), tier, mods });
        }
    }
    let mut out: Vec<DungeonTags> = per
        .into_iter()
        .map(|(name, (normal, hard))| {
            let tag = |b: Best, master: bool| {
                let mut label = ["", "Duo", "Duo Flawless", "Solo", "Solo Flawless"][b.key.0 as usize].to_string();
                // The portal's difficulty (not its plain or custom tiers).
                if let Some(tier) = b.tier.as_deref().filter(|t| !matches!(*t, "Normal" | "Standard" | "Custom" | "")) {
                    label = format!("{label} {tier}");
                } else if master {
                    label.push_str(" Master");
                }
                // Its debuffs' and buffs' triangles ("−12▲ +3▲"; "+0▲":
                // none helped).
                if let Some((debuffs, buffs)) = b.mods {
                    label = format!("{label} −{debuffs}▲ +{buffs}▲");
                }
                RaidTag {
                    label,
                    best: b.key.0 % 2 == 0,
                    checkpoint: false,
                    instance_id: b.id,
                    date: b.when.to_rfc3339(),
                    race: false,
                    race_best: None,
                    feats: Vec::new(),
                    classes: Vec::new(),
                    runs: Vec::new(),
                }
            };
            let tags = normal.map(|b| tag(b, false)).into_iter().chain(hard.map(|b| tag(b, true))).collect();
            DungeonTags { name, tags }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Each Pantheon version's tags (list item names): its best lowman full
/// clear (fewest players, flawless above not) and its race: a clear on its
/// day one (24 hours from its release), else in its week one (to the first
/// weekly reset after). Merged when one run made both ("Day One Duo").
fn pantheon_tags(
    runs: &[Run],
    names: &HashMap<u64, (String, bool)>,
    reports: &HashMap<String, Report>,
) -> HashMap<String, Vec<crate::raidtags::RaidTag>> {
    use chrono::{Datelike, TimeZone};
    use crate::raidtags::RaidTag;
    // (rank, completed, instance id): the higher rank, else the earlier.
    type Best = Option<(u8, DateTime<Utc>, String)>;
    let keep = |slot: &mut Best, rank: u8, when: DateTime<Utc>, id: &str| {
        if slot.as_ref().is_none_or(|(r, t, _)| rank > *r || (rank == *r && when < *t)) {
            *slot = Some((rank, when, id.to_string()));
        }
    };
    let mut per: HashMap<String, (Best, Best)> = HashMap::new();
    // The race may be a checkpoint clear (the Pantheon's start flag often
    // says so): the tag tells.
    let mut checkpoints = std::collections::HashSet::new();
    for run in runs {
        let Some((activity, _)) = crate::raidtags::activity_version(run.activity_hash) else { continue };
        if activity != 101 && !crate::raidtags::is_pantheon_version(run.activity_hash) {
            continue;
        }
        let (Some((name, _)), Some(report), Some(started)) =
            (names.get(&run.activity_hash), reports.get(&run.instance_id), run.period)
        else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let fresh = report.f == Some(true);
        let completed = started + chrono::Duration::seconds(run.seconds as i64);
        let (lowman, race) = per.entry(name.clone()).or_default();
        let id = run.instance_id.as_str();
        if !fresh {
            checkpoints.insert(run.instance_id.clone());
        }
        // Lowmans from every clear too (the start flag is no help here; a
        // checkpoint one says so): solo flawless 6, solo 5, duo flawless 4 …
        // trio 1.
        if (1..=3).contains(&report.p) {
            keep(lowman, (4 - report.p) * 2 - u8::from(report.d != 0), completed, id);
        }
        let Some(release) = crate::raidtags::release(run.activity_hash).and_then(|r| r.parse::<DateTime<Utc>>().ok()) else {
            continue;
        };
        let days = (8 - release.weekday().num_days_from_monday()) % 7;
        let days = if days == 0 { 7 } else { days };
        let reset = (release.date_naive() + chrono::Days::new(days as u64)).and_hms_opt(17, 0, 0).map(|r| Utc.from_utc_datetime(&r));
        if completed < release + chrono::Duration::days(1) {
            keep(race, 2, completed, id);
        } else if reset.is_some_and(|r| completed < r) {
            keep(race, 1, completed, id);
        }
    }
    per.into_iter()
        .map(|(name, (lowman, race))| {
            let tag = |label: &str, best: bool, is_race: bool, (_, when, id): (u8, DateTime<Utc>, String)| RaidTag {
                label: label.to_string(),
                best,
                checkpoint: checkpoints.contains(&id),
                instance_id: id,
                date: when.to_rfc3339(),
                race: is_race,
                race_best: is_race.then(|| "Day One".to_string()),
                feats: Vec::new(),
                classes: Vec::new(),
                runs: Vec::new(),
            };
            let mut tags = Vec::new();
            if let Some(run) = race {
                tags.push(tag(if run.0 == 2 { "Day One" } else { "Week One" }, false, true, run));
            }
            if let Some(run) = lowman {
                let label = ["", "Trio", "Trio Flawless", "Duo", "Duo Flawless", "Solo", "Solo Flawless"][run.0 as usize];
                tags.push(tag(label, run.0 % 2 == 0, false, run));
            }
            (name, crate::raidtags::merge_same_run(tags))
        })
        .collect()
}

/// A dungeon's tags: its day-one clear (the earliest within 24 hours of its
/// release); its solo flawless run (the earliest; or, with no run that
/// shows it, the triumph) on normal and on master; and on each of the newer
/// difficulties (Eternity, Ultimatum; Explorer earns nothing) the best solo run there:
/// solo flawless, else solo. The difficulty by the activity's
/// English name ("Prophecy: Ultimatum"): the same in every language.
async fn dungeon_tags(
    app: &AppHandle,
    runs: &[Run],
    names: &HashMap<u64, (String, bool)>,
    reports: &HashMap<String, Report>,
    triumphs: &std::collections::HashSet<&'static str>,
) -> Vec<DungeonTags> {
    use crate::raidtags::RaidTag;
    // Each dungeon activity's English name, difficulty and whether it is
    // the contest one.
    // All activities at once (and each one's modifiers at once).
    let hashes: std::collections::HashSet<u64> = runs.iter().map(|r| r.activity_hash).collect();
    let lookups = hashes.into_iter().map(|hash| async move {
        let def = crate::fireteam::definition_in(app, "DestinyActivityDefinition", hash, "en").await?;
        let full = def["displayProperties"]["name"].as_str().unwrap_or_default();
        let mut parts = full.splitn(2, ':');
        let name = parts.next().unwrap_or(full).trim().to_string();
        // The last part ("Exotic Quest: Presage: Master" too); "Explorer
        // (Matchmade)" is Explorer.
        let difficulty = full.rsplit_once(':').map(|(_, d)| d).unwrap_or("").split('(').next().unwrap_or("").trim().to_string();
        let modifiers = def["modifiers"].as_array().into_iter().flatten().filter_map(|m| m["activityModifierHash"].as_u64());
        let modifiers = futures::future::join_all(
            modifiers.map(|m| crate::fireteam::definition_in(app, "DestinyActivityModifierDefinition", m, "en")),
        )
        .await;
        let contest = modifiers.iter().flatten().any(|d| d["displayProperties"]["name"] == "Contest Mode");
        Some((hash, (name, difficulty, contest)))
    });
    let english: HashMap<u64, (String, String, bool)> =
        futures::future::join_all(lookups).await.into_iter().flatten().collect();
    type Best = Option<(u8, DateTime<Utc>, String)>;
    #[derive(Default)]
    struct Dungeon {
        /// The best race window a clear made (its rank, see race_window).
        race: Best,
        solo_flawless: Best,
        solo_flawless_master: Best,
        /// Solo without deaths, start unknown (for the triumph's date).
        likely_solo_flawless: Best,
        /// Eternity, Ultimatum: the best solo run there.
        difficulties: HashMap<String, Best>,
    }
    // Keep the run if it ranks higher, or as high and earlier.
    let keep = |slot: &mut Best, rank: u8, when: DateTime<Utc>, id: &str| {
        if slot.as_ref().is_none_or(|(r, t, _)| rank > *r || (rank == *r && when < *t)) {
            *slot = Some((rank, when, id.to_string()));
        }
    };
    let mut per: HashMap<String, Dungeon> = HashMap::new();
    let mut local: HashMap<String, String> = HashMap::new();
    for run in runs {
        let (Some((name, _)), Some(report), Some(started), Some((en, difficulty, contest))) =
            (names.get(&run.activity_hash), reports.get(&run.instance_id), run.period, english.get(&run.activity_hash))
        else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        local.entry(en.clone()).or_insert_with(|| name.clone());
        // Explorer runs earn no tag at all (no race, lowman or difficulty).
        if difficulty == "Explorer" {
            continue;
        }
        let completed = started + chrono::Duration::seconds(run.seconds as i64);
        let d = per.entry(name.clone()).or_default();
        let id = run.instance_id.as_str();
        if let Some((_, rank)) = race_window(en, completed, *contest) {
            keep(&mut d.race, rank, completed, id);
        }
        let (solo, flawless) = (report.p == 1, report.d == 0);
        let fresh = report.f == Some(true);
        match difficulty.as_str() {
            "Master" => {
                if solo && flawless && fresh {
                    keep(&mut d.solo_flawless_master, 0, completed, id);
                }
            }
            // Only solo runs there: solo flawless above solo.
            "Eternity" | "Ultimatum" if solo && fresh => {
                let rank = if flawless { 3 } else { 2 };
                keep(d.difficulties.entry(difficulty.clone()).or_default(), rank, completed, id);
            }
            "Eternity" | "Ultimatum" => {}
            _ => {
                if solo && flawless && fresh {
                    keep(&mut d.solo_flawless, 0, completed, id);
                }
                if solo && flawless && report.f.is_none() {
                    keep(&mut d.likely_solo_flawless, 0, completed, id);
                }
            }
        }
    }
    // The triumph where no report shows the run: most likely the earliest
    // solo one without deaths whose start isn't known (else no date).
    for en in triumphs {
        if let Some(d) = local.get(*en).and_then(|name| per.get_mut(name)) {
            if d.solo_flawless.is_none() {
                d.solo_flawless = d.likely_solo_flawless.clone().or(Some((0, DateTime::<Utc>::MIN_UTC, String::new())));
            }
        }
    }
    // A tag says so when its own run was on day one or in week one ("Week
    // One Solo Flawless"), whatever the dungeon's race tag is.
    let window: HashMap<String, &'static str> = runs
        .iter()
        .filter_map(|r| {
            let (en, _, contest) = english.get(&r.activity_hash)?;
            let completed = r.period? + chrono::Duration::seconds(r.seconds as i64);
            Some((r.instance_id.clone(), race_window(en, completed, *contest)?.0))
        })
        .collect();
    let tag = |label: String, best: bool, race: bool, (_, when, id): (u8, DateTime<Utc>, String)| RaidTag {
        label: match window.get(&id) {
            Some(prefix) if !race => format!("{prefix} {label}"),
            _ => label,
        },
        best,
        checkpoint: false,
        // From the triumph alone: no date.
        date: if id.is_empty() { String::new() } else { when.to_rfc3339() },
        instance_id: id,
        race,
        race_best: None,
        feats: Vec::new(),
        classes: Vec::new(),
        runs: Vec::new(),
    };
    // The dungeons with a contest mode (from Vesper's Host on), by the name
    // shown: their highest race is a day one contest.
    let contest_dungeons: std::collections::HashSet<String> = local
        .iter()
        .filter(|(en, _)| dungeon_release(en).is_some_and(|r| r >= "2024-10-11T17:00:00Z"))
        .map(|(_, name)| name.clone())
        .collect();
    let mut out: Vec<DungeonTags> = per
        .into_iter()
        .filter_map(|(name, d)| {
            let mut tags: Vec<RaidTag> = Vec::new();
            // The race tag: the best window a clear made.
            if let Some(run) = d.race {
                let label = ["", "Week One", "Day One", "Contest", "Day One Contest"][run.0 as usize];
                tags.push(tag(label.into(), false, true, run));
            }
            if let Some(run) = d.solo_flawless {
                tags.push(tag("Solo Flawless".into(), true, false, run));
            }
            if let Some(run) = d.solo_flawless_master {
                tags.push(tag("Solo Flawless Master".into(), true, false, run));
            }
            // Only the hardest difficulty a solo run made.
            let hardest = ["Ultimatum", "Eternity"]
                .into_iter()
                .find_map(|difficulty| Some((difficulty, d.difficulties.get(difficulty).cloned()??)));
            if let Some((difficulty, run)) = hardest {
                let what = ["", "Flawless ", "Solo ", "Solo Flawless "][run.0 as usize];
                tags.push(tag(format!("{what}{difficulty}"), run.0 == 3, false, run));
            }
            // Every tag its highest race: the race tag's colour and a
            // windowed one's ("Week One Solo Flawless") go by it.
            let race_best = if contest_dungeons.contains(&name) { "Day One Contest" } else { "Day One" };
            for t in &mut tags {
                t.race_best = Some(race_best.into());
            }
            (!tags.is_empty()).then(|| DungeonTags { name, tags: crate::raidtags::merge_same_run(tags) })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Full clears and best full-clear times for a player. The first call may
/// take a while (progress via "fullclears-progress"); later ones are quick.
#[tauri::command]
pub async fn fullclears_stats(app: AppHandle, membership_id: String) -> Result<FullClearStats, String> {
    let cache_key = format!("{}:{membership_id}", locale());
    let cached = RESULTS
        .lock()
        .unwrap()
        .get_or_insert_default()
        .get(&cache_key)
        .filter(|(at, _)| at.elapsed() < TTL)
        .map(|(_, s)| s.clone());
    if let Some(stats) = cached {
        return Ok(stats);
    }
    let stats = compute(&app, &membership_id).await?;
    let mut results = RESULTS.lock().unwrap();
    let results = results.get_or_insert_default();
    results.retain(|_, (at, _)| at.elapsed() < TTL);
    results.insert(cache_key, (Instant::now(), stats.clone()));
    Ok(stats)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRun {
    instance_id: String,
    /// When it started (RFC 3339).
    started: String,
    seconds: u64,
    /// The version as the game names it ("Master", "Contest"; empty: the
    /// plain one).
    version: String,
    /// From its report (None: not loaded yet).
    players: Option<u8>,
    deaths: Option<u32>,
    fresh: Option<bool>,
    /// The feats and modifiers it had on (runs since The Edge of Fate).
    feats: Vec<crate::feats::Feat>,
    /// Its difficulty ("Expert", "Ultimate"; the portal's versions).
    tier: Option<String>,
    /// The class it was played on (empty: a character deleted since).
    class_name: String,
}

/// Every completed run of one raid or dungeon (its name as the clears list
/// shows it), newest first: from the history and reports kept, with only
/// the runs since the last time asked for.
#[tauri::command]
pub async fn activity_runs(
    app: AppHandle,
    membership_id: String,
    name: String,
    raid: bool,
    exotic: Option<bool>,
) -> Result<Vec<ActivityRun>, String> {
    let member = crate::fireteam::resolve_member(&app, &membership_id)
        .await
        .ok_or(tr("Spieler nicht gefunden", "Player not found"))?;
    let mt = member.membership_type;
    let (runs, names) = if exotic.unwrap_or(false) {
        // Exotic missions: the first ones are story missions (mode 2), the
        // portal's in the strikes (3).
        let (story, strikes, names) = futures::join!(
            completed_runs(&app, mt, &membership_id, 2),
            completed_runs(&app, mt, &membership_id, 3),
            crate::fireteam::exotic_names(&app),
        );
        let mut runs = story?;
        runs.extend(strikes?);
        runs.sort_by(|a, b| a.instance_id.cmp(&b.instance_id));
        runs.dedup_by(|a, b| a.instance_id == b.instance_id);
        (runs, names?)
    } else {
        let (runs, names) = futures::join!(
            completed_runs(&app, mt, &membership_id, if raid { 4 } else { 82 }),
            async { if raid { crate::fireteam::raid_names(&app).await } else { crate::fireteam::dungeon_names(&app).await } },
        );
        (runs?, names?)
    };
    let runs: Vec<Run> = runs
        .into_iter()
        .filter(|r| names.get(&r.activity_hash).is_some_and(|(n, _)| *n == name))
        .collect();
    // Each version's name, as the game has it after the mission's own
    // ("Presage: Master" -> "Master", "Exotic Quest: Presage: Normal" ->
    // "Normal"), and its difficulty tiers by name.
    let hashes: std::collections::HashSet<u64> = runs.iter().map(|r| r.activity_hash).collect();
    let looked: Vec<(u64, String, Vec<String>)> = futures::future::join_all(hashes.into_iter().map(|hash| {
        let (app, name) = (&app, &name);
        async move {
            let def = crate::fireteam::definition(app, "DestinyActivityDefinition", hash).await;
            let full = def.as_ref().and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or_default();
            let version = match full.find(name.as_str()) {
                Some(at) => full[at + name.len()..].trim_start_matches([':', ' ']).trim(),
                None => full.split_once(':').map(|(_, v)| v.trim()).unwrap_or_default(),
            };
            // "(Expert)" alone: Expert.
            let version = match version.strip_prefix('(').and_then(|v| v.strip_suffix(')')) {
                Some(inner) => inner.to_string(),
                None => version.to_string(),
            };
            let mut tiers = Vec::new();
            if let Some(collection) = def.as_ref().and_then(|d| d["difficultyTierCollectionHash"].as_u64()).filter(|&c| c != 0) {
                if let Some(c) = crate::fireteam::definition(app, "DestinyActivityDifficultyTierCollectionDefinition", collection).await {
                    tiers = c["difficultyTiers"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|t| t["displayProperties"]["name"].as_str().unwrap_or_default().to_string())
                        .collect();
                }
            }
            (hash, version, tiers)
        }
    }))
    .await;
    let versions: HashMap<u64, String> = looked.iter().map(|(h, v, _)| (*h, v.clone())).collect();
    let tiers: HashMap<u64, Vec<String>> = looked.into_iter().map(|(h, _, t)| (h, t)).collect();
    let feat_names = crate::feats::definitions(&app).await;
    // Each character's class (the current ones; a deleted one has none).
    let classes: HashMap<String, String> = {
        let state = app.state::<BungieState>();
        let path = format!("/Destiny2/{mt}/Profile/{membership_id}/?components=200");
        match state.api_key() {
            Ok(key) => api(&state.http, &key, Method::GET, &path, None)
                .await
                .ok()
                .and_then(|p| p["characters"]["data"].as_object().cloned())
                .into_iter()
                .flatten()
                .map(|(id, c)| (id, crate::bungie::class_name(c["classType"].as_i64().unwrap_or(-1)).to_string()))
                .collect(),
            Err(_) => HashMap::new(),
        }
    };
    load_reports(&app);
    let reports = REPORTS.lock().unwrap();
    let reports = reports.as_ref().expect("loaded");
    let feats = FEATS.lock().unwrap();
    let feats = feats.as_ref().expect("loaded");
    let mut out: Vec<ActivityRun> = runs
        .iter()
        .map(|r| {
            let report = reports.get(&r.instance_id);
            ActivityRun {
                instance_id: r.instance_id.clone(),
                started: r.period.map(|p| p.to_rfc3339()).unwrap_or_default(),
                seconds: r.seconds,
                version: versions.get(&r.activity_hash).cloned().unwrap_or_default(),
                players: report.map(|rep| rep.p),
                deaths: report.map(|rep| rep.d),
                fresh: report.and_then(|rep| rep.f),
                feats: feats
                    .get(&r.instance_id)
                    .into_iter()
                    .flat_map(|e| &e.s)
                    .filter_map(|h| feat_names.get(h).cloned())
                    .collect(),
                tier: feats
                    .get(&r.instance_id)
                    .and_then(|e| e.t)
                    .and_then(|t| tiers.get(&r.activity_hash)?.get(t as usize).cloned()),
                class_name: classes.get(&r.character_id).cloned().unwrap_or_default(),
            }
        })
        .collect();
    out.sort_by(|a, b| b.started.cmp(&a.started));
    Ok(out)
}
