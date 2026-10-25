//! Bungie.net connection using only an API key (no OAuth): reads the
//! player's public profile and activity history and derives session stats.
//!
//! A background task polls every 30 s (or immediately when woken) and
//! broadcasts a `Snapshot` to both windows via the "bungie-update" event.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Notify;

use crate::i18n::{locale, tr};

const BASE: &str = "https://www.bungie.net/Platform";
const POLL_INTERVAL: Duration = Duration::from_secs(30);
/// While online, the fireteam alone is checked this often (one small request;
/// Bungie caches profile responses for 5 s anyway).
const PARTY_POLL_INTERVAL: Duration = Duration::from_secs(5);
/// After an activity ends, Bungie needs a moment to publish its report (and
/// with it the matchmade players). Poll this often meanwhile…
const FAST_POLL_INTERVAL: Duration = Duration::from_secs(10);
/// …for this long.
const FAST_POLL_FOR: Duration = Duration::from_secs(180);
/// Activity history page size and how many pages to read per character.
const PAGE_SIZE: usize = 50;
const MAX_PAGES: usize = 4;
const ORBIT_ACTIVITY_HASH: u64 = 82913930;
/// A break between activities longer than this starts a new session.
const SESSION_GAP_MINUTES: i64 = 45;
/// How far back the activity history is read when looking for the session.
const HISTORY_HOURS: i64 = 24;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    membership_type: i64,
    membership_id: String,
    display_name: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    api_key: Option<String>,
    player: Option<Player>,
    /// "Session neu starten": activities that ended before this (ms) are ignored.
    session_reset_at: Option<i64>,
    /// App language ("de", "en", "fr", …), so the first poll after start uses it.
    language: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Character {
    class_name: String,
    light: i64,
    emblem_path: Option<String>,
    emblem_background_path: Option<String>,
    /// Stat hash -> value (Weapons, Health, Class, Grenade, Super, Melee).
    #[serde(default)]
    stats: HashMap<String, i64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Activity {
    name: String,
    mode: Option<String>,
    started_at: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionStats {
    activities: u32,
    completions: u32,
    kills: u32,
    deaths: u32,
    assists: u32,
}

/// A member of the player's current fireteam.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartyMember {
    membership_id: String,
    display_name: Option<String>,
    is_leader: bool,
    is_self: bool,
}

/// An activity of the current session (for the session team).
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRun {
    pub(crate) instance_id: String,
    pub(crate) activity_hash: u64,
    /// When it ended (ms).
    pub(crate) ended_at: i64,
}

/// Result of the last poll.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Live {
    #[serde(skip)]
    error: Option<String>,
    character: Option<Character>,
    online: Option<bool>,
    activity: Option<Activity>,
    #[serde(default)]
    party: Vec<PartyMember>,
    /// Players in the current activity (fireteam + matchmade), from Bungie.
    #[serde(default)]
    activity_players: Option<u32>,
    session: SessionStats,
    /// This session's activities, most recent first.
    #[serde(default)]
    session_runs: Vec<SessionRun>,
    session_start: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// "unconfigured" | "loading" | "ok" | "error"
    status: &'static str,
    error: Option<String>,
    has_api_key: bool,
    /// The key is Radar's own (nothing to enter or change).
    api_key_built_in: bool,
    player: Option<Player>,
    character: Option<Character>,
    online: Option<bool>,
    activity: Option<Activity>,
    party: Vec<PartyMember>,
    activity_players: Option<u32>,
    session: SessionStats,
    /// None when the player has no ongoing session.
    session_start: Option<i64>,
    updated_at: Option<i64>,
    /// True while showing data from the previous run, before the first poll.
    cached: bool,
}

/// Last poll result on disk, so the UI has data the moment the app starts.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cache {
    membership_id: String,
    live: Live,
}

struct Inner {
    config: Config,
    live: Live,
    /// See Snapshot::cached.
    cached: bool,
    /// Bumped whenever the config changes so stale poll results are dropped.
    generation: u64,
    /// "<Entity>:<hash>" -> localized display name.
    names: HashMap<String, String>,
    /// Bungie mint time of the newest live data (fireteam, online, current
    /// activity) accepted so far. Bungie's servers sometimes answer with an
    /// older cached profile; those answers are ignored for live data.
    live_minted: Option<DateTime<Utc>>,
    /// A fireteam that differs from the shown one, and how many fresh
    /// answers in a row reported it (see `confirm_party`).
    party_candidate: Option<(Vec<(String, bool)>, u8)>,
    /// Start time of the current activity as last seen by the fireteam watch.
    activity_started: Option<String>,
    /// Poll quickly until then (an activity just ended).
    fast_poll_until: Option<std::time::Instant>,
}

pub struct BungieState {
    inner: Mutex<Inner>,
    wake: Notify,
    pub(crate) http: reqwest::Client,
    config_path: PathBuf,
    cache_path: PathBuf,
}

/// Radar's own Bungie API key, built in (see build.rs); None in a build
/// without it, where the player enters theirs.
const BUILT_IN_API_KEY: Option<&str> = option_env!("RADAR_BUNGIE_API_KEY");

impl BungieState {
    pub fn load(app: &AppHandle) -> Self {
        let config_dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        let config_path = config_dir.join("bungie.json");
        // Fall back to the config from before the app was renamed to Radar.
        let legacy_path = config_dir.with_file_name("com.d2overlay.app").join("bungie.json");
        let mut config: Config = std::fs::read_to_string(&config_path)
            .or_else(|_| std::fs::read_to_string(&legacy_path))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if let Some(key) = BUILT_IN_API_KEY {
            config.api_key = Some(key.to_string());
        }

        crate::i18n::set_language(config.language.as_deref().unwrap_or("de"));

        // Only reuse cached data that belongs to the configured player.
        let cache_path = config_dir.join("bungie-cache.json");
        let cached_live = std::fs::read_to_string(&cache_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Cache>(&s).ok())
            .filter(|c| {
                config.player.as_ref().is_some_and(|p| p.membership_id == c.membership_id)
            })
            .map(|c| c.live);
        let cached = cached_live.is_some();

        Self {
            inner: Mutex::new(Inner {
                config,
                live: cached_live.unwrap_or_default(),
                cached,
                generation: 0,
                names: HashMap::new(),
                live_minted: None,
                party_candidate: None,
                activity_started: None,
                fast_poll_until: None,
            }),
            wake: Notify::new(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent(concat!("radar/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("failed to build HTTP client"),
            config_path,
            cache_path,
        }
    }

    fn snapshot(&self) -> Snapshot {
        let i = self.inner.lock().unwrap();
        let configured = i.config.api_key.is_some() && i.config.player.is_some();
        let status = if !configured {
            "unconfigured"
        } else if i.live.error.is_some() {
            "error"
        } else if i.live.updated_at.is_none() {
            "loading"
        } else {
            "ok"
        };
        Snapshot {
            status,
            error: i.live.error.clone(),
            has_api_key: i.config.api_key.is_some(),
            api_key_built_in: BUILT_IN_API_KEY.is_some(),
            player: i.config.player.clone(),
            character: i.live.character.clone(),
            online: i.live.online,
            activity: i.live.activity.clone(),
            party: i.live.party.clone(),
            activity_players: i.live.activity_players,
            session: i.live.session.clone(),
            session_start: i.live.session_start,
            updated_at: i.live.updated_at,
            cached: i.cached,
        }
    }

    /// Apply a config change, persist it, reset live data and trigger a poll.
    fn update_config(&self, f: impl FnOnce(&mut Config)) -> Result<(), String> {
        let config = {
            let mut i = self.inner.lock().unwrap();
            f(&mut i.config);
            i.live = Live::default();
            i.cached = false;
            i.live_minted = None;
            i.party_candidate = None;
            i.generation += 1;
            i.config.clone()
        };
        self.save(&config)?;
        self.wake.notify_one();
        Ok(())
    }

    fn save_cache(&self, membership_id: String, live: Live) {
        let cache = Cache { membership_id, live };
        if let Ok(json) = serde_json::to_string(&cache) {
            let _ = std::fs::write(&self.cache_path, json);
        }
    }

    /// Session activities plus the ids to leave out of the session team
    /// (the player and their current fireteam).
    pub(crate) fn session_view(&self) -> (Vec<SessionRun>, Vec<String>) {
        let i = self.inner.lock().unwrap();
        let mut exclude: Vec<String> = i.live.party.iter().map(|m| m.membership_id.clone()).collect();
        exclude.extend(i.config.player.as_ref().map(|p| p.membership_id.clone()));
        (i.live.session_runs.clone(), exclude)
    }

    /// The connected player as (membership type, membership id).
    pub(crate) fn player(&self) -> Option<(i64, String)> {
        let i = self.inner.lock().unwrap();
        i.config.player.as_ref().map(|p| (p.membership_type, p.membership_id.clone()))
    }

    /// You and your fireteam: (Bungie name "Name#1234", membership id,
    /// membership type; the fireteam's type as yours).
    pub(crate) fn known_players(&self) -> Vec<(String, String, i64)> {
        let i = self.inner.lock().unwrap();
        let Some(me) = i.config.player.as_ref() else { return Vec::new() };
        let mut out = vec![(me.display_name.clone(), me.membership_id.clone(), me.membership_type)];
        for m in &i.live.party {
            if let Some(name) = &m.display_name {
                if m.membership_id != me.membership_id {
                    out.push((name.clone(), m.membership_id.clone(), me.membership_type));
                }
            }
        }
        out
    }

    pub(crate) fn player_id(&self) -> Option<String> {
        let i = self.inner.lock().unwrap();
        i.config.player.as_ref().map(|p| p.membership_id.clone())
    }

    fn save(&self, config: &Config) -> Result<(), String> {
        if let Some(dir) = self.config_path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        std::fs::write(&self.config_path, json).map_err(|e| e.to_string())
    }

    pub(crate) fn api_key(&self) -> Result<String, String> {
        self.inner
            .lock()
            .unwrap()
            .config
            .api_key
            .clone()
            .ok_or_else(|| tr("Kein API-Key hinterlegt", "No API key set").to_string())
    }
}

pub(crate) fn publish(app: &AppHandle) {
    let _ = app.emit("bungie-update", app.state::<BungieState>().snapshot());
}

/* ---------- HTTP ---------- */

/// Whether an error from `api` says the account plays no Destiny 2 (a
/// Bungie.net account without a profile: Destiny 1 only, or never played).
pub(crate) fn no_destiny_account(error: &str) -> bool {
    error == friendly_error(1601, "")
}

fn friendly_error(code: i64, message: &str) -> String {
    match code {
        5 => tr("Bungie.net ist gerade in Wartung", "Bungie.net is down for maintenance").into(),
        2101 | 2102 | 2107 => tr("API-Key ungültig – bitte prüfen", "Invalid API key – please check it").into(),
        1665 => tr(
            "Profil ist privat – in den Bungie.net-Datenschutzeinstellungen freigeben",
            "Profile is private – allow it in your Bungie.net privacy settings",
        )
        .into(),
        1601 => tr("Destiny-Account nicht gefunden", "Destiny account not found").into(),
        36 | 51 => tr("Zu viele Anfragen – kurz warten", "Too many requests – wait a moment").into(),
        _ => format!("{} {code}: {message}", tr("Bungie-Fehler", "Bungie error")),
    }
}

pub(crate) async fn api(
    http: &reqwest::Client,
    key: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    api_url(http, key, method, &format!("{BASE}{path}"), body).await
}

/// Like `api`, with a full URL (e.g. stats.bungie.net for PGCRs).
pub(crate) async fn api_url(
    http: &reqwest::Client,
    key: &str,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    api_request(http, key, None, method, url, body).await
}

/// Like `api`, on behalf of the logged-in user (private data).
pub(crate) async fn api_as_user(http: &reqwest::Client, key: &str, token: &str, path: &str) -> Result<Value, String> {
    api_request(http, key, Some(token), Method::GET, &format!("{BASE}{path}"), None).await
}

async fn api_request(
    http: &reqwest::Client,
    key: &str,
    token: Option<&str>,
    method: Method,
    url: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let build = || {
        let mut req = http.request(method.clone(), url).header("X-API-Key", key);
        if let Some(token) = token {
            req = req.bearer_auth(token);
        }
        if let Some(body) = &body {
            req = req.json(body);
        }
        req
    };
    // Bungie.net drops a connection now and then: one more try after a
    // moment before it counts as an error.
    let res = match build().send().await {
        Ok(res) => res,
        Err(_) => {
            tokio::time::sleep(Duration::from_millis(700)).await;
            build()
                .send()
                .await
                .map_err(|e| format!("{}: {e}", tr("Netzwerkfehler", "Network error")))?
        }
    };
    let status = res.status();
    let v: Value = res
        .json()
        .await
        .map_err(|_| {
            let what = tr("Unerwartete Antwort von Bungie.net", "Unexpected response from Bungie.net");
            format!("{what} (HTTP {status})")
        })?;
    let code = v["ErrorCode"].as_i64().unwrap_or(0);
    if code != 1 {
        println!("[bungie] {url} -> {} {}", v["ErrorStatus"].as_str().unwrap_or("?"), v["Message"].as_str().unwrap_or(""));
        return Err(friendly_error(code, v["Message"].as_str().unwrap_or("unbekannt")));
    }
    Ok(v["Response"].clone())
}

/// Localized display name of a manifest definition, cached in memory.
pub(crate) async fn definition_name(app: &AppHandle, entity: &str, hash: u64) -> Option<String> {
    if hash == 0 {
        return None;
    }
    let state = app.state::<BungieState>();
    let cache_key = format!("{}:{entity}:{hash}", locale());
    if let Some(name) = state.inner.lock().unwrap().names.get(&cache_key) {
        return Some(name.clone());
    }
    let key = state.api_key().ok()?;
    let path = format!("/Destiny2/Manifest/{entity}/{hash}/?lc={}", locale());
    let def = api(&state.http, &key, Method::GET, &path, None).await.ok()?;
    let name = def["displayProperties"]["name"]
        .as_str()
        .filter(|s| !s.is_empty())?
        .to_string();
    state.inner.lock().unwrap().names.insert(cache_key, name.clone());
    Some(name)
}

/* ---------- Polling ---------- */

fn parse_str(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

fn parse_date(v: &Value) -> Option<DateTime<Utc>> {
    parse_str(v.as_str()?)
}

fn stat(activity: &Value, name: &str) -> f64 {
    activity["values"][name]["basic"]["value"].as_f64().unwrap_or(0.0)
}

pub(crate) fn class_name(class_type: i64) -> &'static str {
    match class_type {
        0 => "Titan",
        1 => tr("Jäger", "Hunter"),
        2 => "Warlock",
        _ => tr("Hüter", "Guardian"),
    }
}

/// Unique query parameter so Bungie's CDN doesn't hand out a cached profile
/// (those can be minutes old); live data like the fireteam needs fresh answers.
fn cache_bust() -> String {
    format!("&cb={}", Utc::now().timestamp_millis())
}

fn response_minted(profile: &Value) -> Option<DateTime<Utc>> {
    parse_date(&profile["responseMintedTimestamp"])
}

/// Record the mint time of a profile answer. Returns false if it is older
/// than live data already shown, i.e. a stale answer to ignore.
fn accept_live(app: &AppHandle, profile: &Value) -> bool {
    let Some(minted) = response_minted(profile) else { return true };
    let state = app.state::<BungieState>();
    let mut i = state.inner.lock().unwrap();
    if i.live_minted.is_some_and(|last| minted < last) {
        return false;
    }
    i.live_minted = Some(minted);
    true
}

/// Bungie's servers occasionally contradict each other even with fresh
/// answers, so a changed fireteam is only taken over once two fresh answers
/// in a row agree on it. Returns true when `members` should be applied.
fn confirm_party(app: &AppHandle, members: &[(String, bool)]) -> bool {
    let mut members = members.to_vec();
    members.sort();
    let state = app.state::<BungieState>();
    let mut i = state.inner.lock().unwrap();
    let mut shown: Vec<(String, bool)> = i
        .live
        .party
        .iter()
        .map(|m| (m.membership_id.clone(), m.is_leader))
        .collect();
    shown.sort();
    if members == shown {
        i.party_candidate = None;
        return false;
    }
    // Nothing shown yet (first poll): no need to wait.
    if i.live.party.is_empty() {
        i.party_candidate = None;
        return true;
    }
    match &mut i.party_candidate {
        Some((candidate, seen)) if *candidate == members => {
            *seen += 1;
            if *seen >= 2 {
                i.party_candidate = None;
                return true;
            }
            false
        }
        _ => {
            i.party_candidate = Some((members, 1));
            false
        }
    }
}

async fn build_party(app: &AppHandle, profile: &Value, self_id: &str) -> Vec<PartyMember> {
    let mut party = Vec::new();
    for (id, is_leader) in party_members(profile, self_id) {
        party.push(PartyMember {
            display_name: crate::fireteam::resolve_member(app, &id).await.map(|m| m.display_name),
            is_self: id == self_id,
            membership_id: id,
            is_leader,
        });
    }
    party
}

/// Fireteam members as (membership id, is leader), in Bungie's order.
/// DestinyPartyMemberStates: 1 = fireteam member, 8 = party leader.
fn party_members(profile: &Value, self_id: &str) -> Vec<(String, bool)> {
    profile["profileTransitoryData"]["data"]["partyMembers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["membershipId"].as_str()?;
            let status = m["status"].as_u64().unwrap_or(0);
            (status & 1 != 0 || id == self_id).then(|| (id.to_string(), status & 8 != 0))
        })
        .collect()
}

async fn fetch(app: &AppHandle) -> Result<Live, String> {
    let state = app.state::<BungieState>();
    let (key, player, reset_at, previous) = {
        let i = state.inner.lock().unwrap();
        // The session shown so far, if the player was online in it.
        let previous = (i.live.online == Some(true)).then_some(i.live.session_start).flatten();
        (i.config.api_key.clone(), i.config.player.clone(), i.config.session_reset_at, previous)
    };
    let reset_at = reset_at.and_then(DateTime::from_timestamp_millis);
    let (Some(key), Some(player)) = (key, player) else {
        return Err(tr("Nicht eingerichtet", "Not set up").into());
    };
    let (mt, mid) = (player.membership_type, &player.membership_id);

    // 100 Profiles, 200 Characters, 204 CharacterActivities, 1000 Transitory
    let profile = api(
        &state.http,
        &key,
        Method::GET,
        &format!("/Destiny2/{mt}/Profile/{mid}/?components=100,200,204,1000{}", cache_bust()),
        None,
    )
    .await?;

    let characters = profile["characters"]["data"]
        .as_object()
        .filter(|c| !c.is_empty())
        .ok_or(tr("Keine Charaktere gefunden", "No characters found"))?;
    let (active_id, active) = characters
        .iter()
        .max_by_key(|(_, c)| parse_date(&c["dateLastPlayed"]))
        .expect("non-empty");

    let character = Character {
        class_name: class_name(active["classType"].as_i64().unwrap_or(-1)).into(),
        light: active["light"].as_i64().unwrap_or(0),
        emblem_path: active["emblemPath"].as_str().map(Into::into),
        emblem_background_path: active["emblemBackgroundPath"].as_str().map(Into::into),
        stats: active["stats"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(hash, v)| Some((hash.clone(), v.as_i64()?)))
            .collect(),
    };

    // Live data (online, fireteam, current activity) only from answers that
    // are at least as new as what's already shown; otherwise keep that.
    let fresh = accept_live(app, &profile);
    let (online, party, mut activity, activity_players) = if fresh {
        // Transitory data only exists while the player is online.
        let transitory = &profile["profileTransitoryData"]["data"];
        let online = transitory.is_object();
        let party = if confirm_party(app, &party_members(&profile, mid)) {
            build_party(app, &profile, mid).await
        } else {
            state.inner.lock().unwrap().live.party.clone()
        };
        let players = transitory["currentActivity"]["numberOfPlayers"].as_u64().map(|n| n as u32);
        (online, party, None, players)
    } else {
        let i = state.inner.lock().unwrap();
        (
            i.live.online.unwrap_or(false),
            i.live.party.clone(),
            i.live.activity.clone(),
            i.live.activity_players,
        )
    };

    if fresh && online {
        let current = &profile["characterActivities"]["data"][active_id];
        let hash = current["currentActivityHash"].as_u64().unwrap_or(0);
        if hash == ORBIT_ACTIVITY_HASH {
            // The Orbit definition has no name; it is also not an activity
            // that ever produces stats.
            activity = Some(Activity { name: "Orbit".into(), mode: None, started_at: None });
        } else if let Some(name) = definition_name(app, "DestinyActivityDefinition", hash).await {
            let mode_hash = current["currentActivityModeHash"].as_u64().unwrap_or(0);
            activity = Some(Activity {
                name,
                mode: definition_name(app, "DestinyActivityModeDefinition", mode_hash).await,
                started_at: current["dateActivityStarted"].as_str().map(Into::into),
            });
        }
    }

    // Recent activity history across all characters played in the window.
    let now = Utc::now();
    let horizon = now - chrono::Duration::hours(HISTORY_HOURS);
    let mut history: Vec<(DateTime<Utc>, DateTime<Utc>, Value)> = Vec::new();
    for (cid, c) in characters {
        if parse_date(&c["dateLastPlayed"]).is_none_or(|d| d < horizon) {
            continue;
        }
        for page in 0..MAX_PAGES {
            let path = format!(
                "/Destiny2/{mt}/Account/{mid}/Character/{cid}/Stats/Activities/?count={PAGE_SIZE}&page={page}"
            );
            let response = api(&state.http, &key, Method::GET, &path, None).await?;
            let Some(list) = response["activities"].as_array() else { break };
            let mut reached_horizon = false;
            for a in list {
                let Some(begin) = parse_date(&a["period"]) else { continue };
                let end = begin + chrono::Duration::seconds(stat(a, "activityDurationSeconds") as i64);
                if end < horizon {
                    reached_horizon = true;
                    break;
                }
                history.push((begin, end, a.clone()));
            }
            if reached_horizon || list.len() < PAGE_SIZE {
                break;
            }
        }
    }
    history.sort_by_key(|h| std::cmp::Reverse(h.0));

    // The session is the chain of activities with no break longer than
    // SESSION_GAP, anchored at the running activity (or now) while online,
    // otherwise at the latest finished activity.
    let gap = chrono::Duration::minutes(SESSION_GAP_MINUTES);
    let running_start = activity.as_ref().and_then(|a| a.started_at.as_deref()).and_then(parse_str);
    // Only a real activity starts a session: in orbit (or nothing running)
    // it is anchored like offline, at the latest finished activity, so it
    // goes on after one but doesn't start from sitting in orbit.
    let in_activity = activity.as_ref().is_some_and(|a| a.name != "Orbit");
    let anchor = if online && in_activity {
        Some(running_start.unwrap_or(now))
    } else {
        history
            .first()
            .map(|h| h.1)
            .filter(|end| now - *end <= gap)
            .map(|end| if online { now } else { end })
    };
    let mut session = SessionStats::default();
    let mut session_runs = Vec::new();
    let mut session_start = anchor;
    if let Some(mut cursor) = anchor {
        for (begin, end, a) in &history {
            if cursor - *end > gap || reset_at.is_some_and(|r| *end < r) {
                break;
            }
            session.activities += 1;
            if let Some(instance_id) = a["activityDetails"]["instanceId"].as_str() {
                session_runs.push(SessionRun {
                    instance_id: instance_id.to_string(),
                    activity_hash: a["activityDetails"]["referenceId"].as_u64().unwrap_or(0),
                    ended_at: end.timestamp_millis(),
                });
            }
            session.kills += stat(a, "kills") as u32;
            session.deaths += stat(a, "deaths") as u32;
            session.assists += stat(a, "assists") as u32;
            if stat(a, "completed") >= 1.0 {
                session.completions += 1;
            }
            cursor = cursor.min(*begin);
            session_start = Some(cursor);
        }
    }
    // Still online since the last poll: the session goes on (its start
    // doesn't move later, e.g. while Bungie's history lags behind).
    if online {
        if let (Some(start), Some(prev)) = (session_start, previous.and_then(DateTime::from_timestamp_millis)) {
            session_start = Some(start.min(prev));
        }
    }
    if let (Some(start), Some(reset)) = (session_start, reset_at) {
        session_start = Some(start.max(reset));
    }

    Ok(Live {
        error: None,
        character: Some(character),
        online: Some(online),
        activity,
        party,
        activity_players,
        session,
        session_runs,
        session_start: session_start.map(|d| d.timestamp_millis()),
        updated_at: Some(now.timestamp_millis()),
    })
}

/// Check only the fireteam every few seconds while the player is online and
/// apply changes (join, leave, new leader) right away.
fn start_party_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(PARTY_POLL_INTERVAL).await;
            let state = app.state::<BungieState>();
            let (key, player, online, generation) = {
                let i = state.inner.lock().unwrap();
                (i.config.api_key.clone(), i.config.player.clone(), i.live.online, i.generation)
            };
            let (Some(key), Some(player), Some(true)) = (key, player, online) else { continue };
            let path = format!(
                "/Destiny2/{}/Profile/{}/?components=1000{}",
                player.membership_type,
                player.membership_id,
                cache_bust()
            );
            let Ok(profile) = api(&state.http, &key, Method::GET, &path, None).await else { continue };
            if !accept_live(&app, &profile) {
                continue;
            }
            if !profile["profileTransitoryData"]["data"].is_object() {
                // Went offline: let the full poll update everything.
                state.wake.notify_one();
                continue;
            }
            // A new activity start means the previous one ended: refresh now
            // and keep polling quickly until its report (session team) is in.
            let started = profile["profileTransitoryData"]["data"]["currentActivity"]["startTime"]
                .as_str()
                .map(String::from);
            let activity_changed = {
                let mut i = state.inner.lock().unwrap();
                let changed = i.activity_started.is_some() && started.is_some() && i.activity_started != started;
                if started.is_some() {
                    i.activity_started = started;
                }
                if changed {
                    i.fast_poll_until = Some(std::time::Instant::now() + FAST_POLL_FOR);
                }
                changed
            };
            if activity_changed {
                state.wake.notify_one();
            }
            if !confirm_party(&app, &party_members(&profile, &player.membership_id)) {
                continue;
            }
            let party = build_party(&app, &profile, &player.membership_id).await;
            {
                let mut i = state.inner.lock().unwrap();
                if i.generation != generation {
                    continue;
                }
                i.live.party = party;
            }
            publish(&app);
        }
    });
}

/// Failed polls in a row before the error shows (with data on screen).
const ERRORS_TO_SHOW: u32 = 3;

/// Spawn the background poller.
pub fn start(app: &AppHandle) {
    start_party_watch(app.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Logged in with Bungie but no player yet (logged in before Radar
        // took the player from the login): the one logged in, once.
        let needs_player = app.state::<BungieState>().inner.lock().unwrap().config.player.is_none();
        if needs_player && crate::oauth::logged_in(&app) {
            if let Err(e) = set_player_from_login(&app).await {
                eprintln!("[bungie] player from login: {e}");
            }
        }
        // Failed polls in a row.
        let mut failures = 0u32;
        loop {
            let state = app.state::<BungieState>();
            let (ready, generation) = {
                let i = state.inner.lock().unwrap();
                (i.config.api_key.is_some() && i.config.player.is_some(), i.generation)
            };
            if ready {
                let result = fetch(&app).await;
                let to_cache = {
                    let mut i = state.inner.lock().unwrap();
                    if i.generation != generation {
                        None
                    } else {
                        match result {
                            Ok(live) => {
                                failures = 0;
                                i.live = live;
                                i.cached = false;
                                let id = i.config.player.as_ref().map(|p| p.membership_id.clone());
                                id.map(|id| (id, i.live.clone()))
                            }
                            // Keep the last good data; flag the error only when
                            // it lasts (a single failed poll is often just
                            // Bungie.net dropping a connection) or there is
                            // nothing to show yet.
                            Err(e) => {
                                failures += 1;
                                if failures >= ERRORS_TO_SHOW || i.live.updated_at.is_none() {
                                    i.live.error = Some(e);
                                } else {
                                    eprintln!("[bungie] poll failed ({failures}): {e}");
                                }
                                None
                            }
                        }
                    }
                };
                if let Some((id, live)) = to_cache {
                    state.save_cache(id, live);
                }
            }
            publish(&app);
            let interval = {
                let i = state.inner.lock().unwrap();
                match i.fast_poll_until {
                    Some(until) if std::time::Instant::now() < until => FAST_POLL_INTERVAL,
                    _ => POLL_INTERVAL,
                }
            };
            tokio::select! {
                _ = tokio::time::sleep(interval) => {}
                _ = state.wake.notified() => {}
            }
        }
    });
}

/* ---------- Commands ---------- */

#[tauri::command]
pub fn bungie_snapshot(state: State<'_, BungieState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub async fn bungie_set_api_key(
    app: AppHandle,
    state: State<'_, BungieState>,
    key: String,
) -> Result<Snapshot, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        state.update_config(|c| c.api_key = None)?;
    } else {
        // The manifest is readable without a key, so validate via player search.
        api(
            &state.http,
            &key,
            Method::POST,
            "/Destiny2/SearchDestinyPlayerByBungieName/All/",
            Some(json!({ "displayName": "radar", "displayNameCode": 1 })),
        )
        .await?;
        state.update_config(|c| c.api_key = Some(key))?;
    }
    publish(&app);
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn bungie_find_player(
    app: AppHandle,
    state: State<'_, BungieState>,
    name: String,
) -> Result<Snapshot, String> {
    let (display_name, code) = name
        .trim()
        .rsplit_once('#')
        .and_then(|(n, c)| Some((n.trim(), c.trim().parse::<u32>().ok()?)))
        .filter(|(n, _)| !n.is_empty())
        .ok_or(tr("Bitte im Format Name#1234 eingeben", "Please use the format Name#1234"))?;

    let key = state.api_key()?;
    let results = api(
        &state.http,
        &key,
        Method::POST,
        "/Destiny2/SearchDestinyPlayerByBungieName/All/",
        Some(json!({ "displayName": display_name, "displayNameCode": code })),
    )
    .await?;
    let cards = results
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or(tr("Spieler nicht gefunden", "Player not found"))?;

    // With Cross Save, only the override platform holds the real profile.
    let cross_save = cards[0]["crossSaveOverride"].as_i64().unwrap_or(0);
    let card = cards
        .iter()
        .find(|c| cross_save != 0 && c["membershipType"].as_i64() == Some(cross_save))
        .or_else(|| {
            cards.iter().find(|c| {
                c["applicableMembershipTypes"].as_array().is_some_and(|a| !a.is_empty())
            })
        })
        .unwrap_or(&cards[0]);

    let player = Player {
        membership_type: card["membershipType"].as_i64().unwrap_or(-1),
        membership_id: card["membershipId"].as_str().unwrap_or_default().to_string(),
        display_name: format!(
            "{}#{:04}",
            card["bungieGlobalDisplayName"].as_str().unwrap_or(display_name),
            card["bungieGlobalDisplayNameCode"].as_u64().unwrap_or(code as u64)
        ),
    };
    state.update_config(|c| c.player = Some(player))?;
    publish(&app);
    Ok(state.snapshot())
}

/// The player is whoever logged in with Bungie: their Destiny membership (the
/// Cross Save one, else the primary one) becomes the player, so their name
/// needn't be typed in. Called right after a login.
pub(crate) async fn set_player_from_login(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<BungieState>();
    let key = state.api_key()?;
    let token = crate::oauth::access_token(app)
        .await
        .ok_or(tr("Nicht mit Bungie eingeloggt", "Not logged in with Bungie"))?;
    let me = api_as_user(&state.http, &key, &token, "/User/GetMembershipsForCurrentUser/").await?;
    let cards = me["destinyMemberships"].as_array().cloned().unwrap_or_default();
    let primary = me["primaryMembershipId"].as_str();
    let card = cards
        .iter()
        .find(|c| c["crossSaveOverride"].as_i64().is_some_and(|o| o != 0 && c["membershipType"].as_i64() == Some(o)))
        .or_else(|| cards.iter().find(|c| primary.is_some() && c["membershipId"].as_str() == primary))
        .or_else(|| cards.first())
        .ok_or(tr("Kein Destiny-Account an diesem Bungie-Konto", "No Destiny account on this Bungie account"))?;
    let user = &me["bungieNetUser"];
    let name = user["cachedBungieGlobalDisplayName"].as_str().or(card["bungieGlobalDisplayName"].as_str());
    let code = user["cachedBungieGlobalDisplayNameCode"].as_u64().or(card["bungieGlobalDisplayNameCode"].as_u64());
    let player = Player {
        membership_type: card["membershipType"].as_i64().unwrap_or(-1),
        membership_id: card["membershipId"].as_str().unwrap_or_default().to_string(),
        display_name: match (name, code) {
            (Some(n), Some(c)) => format!("{n}#{c:04}"),
            _ => card["displayName"].as_str().unwrap_or_default().to_string(),
        },
    };
    let changed = state.inner.lock().unwrap().config.player.as_ref().map(|p| p.membership_id.clone()) != Some(player.membership_id.clone());
    state.update_config(|c| c.player = Some(player))?;
    if changed {
        state.wake.notify_one();
    }
    publish(app);
    Ok(())
}

#[tauri::command]
pub fn bungie_clear_player(app: AppHandle, state: State<'_, BungieState>) -> Result<(), String> {
    state.update_config(|c| c.player = None)?;
    publish(&app);
    Ok(())
}

#[tauri::command]
pub fn bungie_refresh(state: State<'_, BungieState>) {
    state.wake.notify_one();
}

#[tauri::command]
pub fn bungie_reset_session(app: AppHandle, state: State<'_, BungieState>) {
    let config = {
        let mut i = state.inner.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        i.config.session_reset_at = Some(now);
        i.live.session = SessionStats::default();
        i.live.session_start = Some(now);
        i.generation += 1;
        i.config.clone()
    };
    let _ = state.save(&config);
    publish(&app);
    state.wake.notify_one();
}

/// Switch the language of Rust-side texts and Bungie content, then refresh
/// so activity names follow. Called by the frontend on start and on change.
#[tauri::command]
pub fn set_language(app: tauri::AppHandle, state: State<'_, BungieState>, language: String) -> Result<(), String> {
    let config = {
        let mut i = state.inner.lock().unwrap();
        if i.config.language.as_deref() == Some(language.as_str()) && crate::i18n::language() == language {
            return Ok(());
        }
        crate::i18n::set_language(&language);
        i.config.language = Some(language);
        i.config.clone()
    };
    // What was named in the old language is looked up anew; open pages of
    // the weapon statistic reload it.
    crate::usage::forget_summary();
    crate::dimsync::forget_names();
    crate::fireteam::forget_names();
    let _ = app.emit("weapon-usage-updated", ());
    crate::discord::push_language(&app);
    state.save(&config)?;
    state.wake.notify_one();
    Ok(())
}
