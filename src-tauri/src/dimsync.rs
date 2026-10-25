//! The player's DIM loadouts, read from DIM Sync (api.destinyitemmanager.com)
//! with their Bungie login, for the Loadouts tab.
//!
//! DIM hands out API keys to local development apps itself (POST /new_app,
//! localhost origins only); an app for the public needs the DIM team's
//! approval of its origin first.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::bungie::{api_as_user, class_name, BungieState};
use crate::fireteam::{definition, item, ItemInfo, SUBCLASS};
use crate::i18n::tr;
use crate::inventory::{own_profile, owned_items, pick_character, session, OwnedItem, Session};

const BASE: &str = "https://api.destinyitemmanager.com";
/// The origin the key is registered for (DIM only registers local ones).
const ORIGIN: &str = "http://localhost:1430";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DimStore {
    api_key: Option<String>,
    /// The Bungie API key it was registered with: DIM checks Bungie tokens
    /// with that one, so a new Bungie app needs a new registration.
    bungie_key: Option<String>,
}

static STORE: Mutex<Option<DimStore>> = Mutex::new(None);
/// DIM access token and when it expires.
static TOKEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("dim.json")
}

/// The DIM key, if registered with the Bungie key Radar uses now.
fn api_key(app: &AppHandle) -> Option<String> {
    let bungie_key = app.state::<BungieState>().api_key().ok();
    let mut store = STORE.lock().unwrap();
    let store = store.get_or_insert_with(|| {
        std::fs::read_to_string(path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    });
    if store.bungie_key.is_none() || store.bungie_key != bungie_key {
        return None;
    }
    store.api_key.clone()
}

/// The DIM key, registering (again) when there is none for this Bungie key.
async fn ensure_key(app: &AppHandle) -> Result<String, String> {
    // One registration at a time (at start and from the Loadouts tab alike).
    static REGISTERING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = REGISTERING.lock().await;
    match api_key(app) {
        Some(key) => Ok(key),
        None => register(app).await,
    }
}

/// At start: a player connected to DIM whose registration is for another
/// Bungie key (an update changed it) registers again now, in the
/// background. DIM's servers take a new app on only after about a minute;
/// by the time the Loadouts tab is opened it is mostly through.
pub fn start(app: &AppHandle) {
    let connected = {
        let _ = api_key(app);
        STORE.lock().unwrap().as_ref().is_some_and(|s| s.api_key.is_some())
    };
    if !connected || api_key(app).is_some() || !crate::oauth::logged_in(app) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = ensure_key(&app).await {
            println!("[dim-api] registering at start: {e}");
        }
    });
}

fn save_key(app: &AppHandle, key: &str, bungie_key: &str) {
    let store = DimStore { api_key: Some(key.into()), bungie_key: Some(bungie_key.into()) };
    if let Some(dir) = path(app).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&store) {
        let _ = std::fs::write(path(app), json);
    }
    *STORE.lock().unwrap() = Some(store);
}

async fn send(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let res = request
        .header("Origin", ORIGIN)
        .send()
        .await
        .map_err(|e| format!("DIM: {} ({e})", tr("Netzwerkfehler", "network error")))?;
    let status = res.status();
    let url = res.url().path().to_string();
    let text = res.text().await.unwrap_or_default();
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if status.is_success() {
        Ok(body)
    } else {
        println!("[dim-api] {url} -> {status}: {text}");
        let message = body["message"].as_str().or(body["error"].as_str()).unwrap_or(text.as_str()).to_string();
        Err(format!("DIM {url} ({status}): {message}"))
    }
}

/// Register Radar with DIM (once) and remember the key.
async fn register(app: &AppHandle) -> Result<String, String> {
    let bungie_key = app.state::<BungieState>().api_key()?;
    let http = app.state::<BungieState>().http.clone();
    // Ids are global at DIM; a random suffix keeps them apart.
    let suffix = chrono::Utc::now().timestamp_millis() % 1_000_000_000;
    let body = json!({ "id": format!("radar-{suffix}-dev"), "bungieApiKey": bungie_key, "origin": ORIGIN });
    let res = send(http.post(format!("{BASE}/new_app")).json(&body)).await?;
    let key = res["app"]["dimApiKey"]
        .as_str()
        .or(res["dimApiKey"].as_str())
        .ok_or(tr("DIM hat keinen Schlüssel geschickt", "DIM sent no key"))?
        .to_string();
    save_key(app, &key, &bungie_key);
    // A token from the old registration is no good with the new key.
    *TOKEN.lock().unwrap() = None;
    Ok(key)
}

/// Waiting for DIM to take on a newly registered app: how often, how long.
const NEW_APP_TRIES: u32 = 12;
const NEW_APP_WAIT: Duration = Duration::from_secs(15);

/// A DIM access token for the logged-in player.
async fn token(app: &AppHandle, s: &Session, key: &str) -> Result<String, String> {
    if let Some((token, until)) = TOKEN.lock().unwrap().as_ref() {
        if Instant::now() < *until {
            return Ok(token.clone());
        }
    }
    let state = app.state::<BungieState>();
    let http = state.http.clone();
    // DIM checks the token against the Bungie.net account id (not the Destiny one).
    let user = api_as_user(&http, &state.api_key()?, s.token(), "/User/GetMembershipsForCurrentUser/").await?;
    let bungie_net_id = user["bungieNetUser"]["membershipId"]
        .as_str()
        .ok_or(tr("Bungie.net-Konto nicht gefunden", "Bungie.net account not found"))?
        .to_string();
    let body = json!({ "bungieAccessToken": s.token(), "membershipId": bungie_net_id });
    // DIM's servers take a new app on about a minute after it registered
    // (they reload their list of apps every minute): until then, quietly
    // asked again (the list shows as loading meanwhile).
    let mut tries = 0;
    let res = loop {
        match send(http.post(format!("{BASE}/auth/token")).header("X-API-Key", key).json(&body)).await {
            Err(e) if e.contains("No app found") && tries < NEW_APP_TRIES => {
                tries += 1;
                tokio::time::sleep(NEW_APP_WAIT).await;
            }
            Err(e) if e.contains("No app found") => {
                return Err(tr(
                    "DIM richtet Radars Zugang noch ein – gleich nochmal aktualisieren",
                    "DIM is still setting up Radar's access – refresh again shortly",
                )
                .to_string())
            }
            other => break other?,
        }
    };
    let token = res["accessToken"].as_str().ok_or("DIM: no token")?.to_string();
    let seconds = res["expiresInSeconds"].as_u64().unwrap_or(3600).saturating_sub(60);
    *TOKEN.lock().unwrap() = Some((token.clone(), Instant::now() + Duration::from_secs(seconds)));
    Ok(token)
}

/// All DIM loadouts of the player (raw DIM shape).
async fn raw_loadouts(app: &AppHandle, s: &Session) -> Result<Vec<Value>, String> {
    let key = ensure_key(app).await?;
    let token = token(app, s, &key).await?;
    let http = app.state::<BungieState>().http.clone();
    let url = format!("{BASE}/profile?platformMembershipId={}&components=loadouts", s.membership_id());
    let res = send(http.get(url).header("X-API-Key", &key).bearer_auth(token)).await?;
    let loadouts = res["loadouts"].as_array().cloned().unwrap_or_default();
    // Deleted ones stay hidden while DIM still lists them (it lags behind).
    let mut deleted = deleted(app);
    let listed: std::collections::HashSet<&str> = loadouts.iter().filter_map(|l| l["id"].as_str()).collect();
    let before = deleted.len();
    deleted.retain(|id, at| listed.contains(id.as_str()) && chrono::Utc::now().timestamp() - *at < DELETED_FOR_SECS);
    if deleted.len() != before {
        store_deleted(app, &deleted);
    }
    let mut edited = EDITED.lock().unwrap();
    let edited = edited.get_or_insert_default();
    edited.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(DELETED_FOR_SECS as u64));
    let stamp = |l: &Value| l["lastUpdatedAt"].as_i64().unwrap_or(0);
    // Saved in Radar and not listed by DIM yet (it lags behind): shown
    // already, newest first.
    let mut new: Vec<Value> = edited
        .iter()
        .filter(|(id, _)| !listed.contains(id.as_str()) && !deleted.contains_key(id.as_str()))
        .map(|(_, (_, l))| l.clone())
        .collect();
    new.sort_by_key(|l| std::cmp::Reverse(stamp(l)));
    Ok(new
        .into_iter()
        .chain(
            loadouts
                .into_iter()
                .filter(|l| l["id"].as_str().is_none_or(|id| !deleted.contains_key(id)))
                .map(|l| match l["id"].as_str().and_then(|id| edited.get(id)) {
                    Some((_, mine)) if stamp(mine) > stamp(&l) => mine.clone(),
                    _ => l,
                }),
        )
        .collect())
}

/// Loadouts deleted in Radar: id -> when (unix seconds). DIM's own list
/// can still include them for a while after the delete went through.
const DELETED_FOR_SECS: i64 = 15 * 60;

fn deleted_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("dim-deleted.json")
}

fn deleted(app: &AppHandle) -> std::collections::HashMap<String, i64> {
    std::fs::read_to_string(deleted_path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn store_deleted(app: &AppHandle, deleted: &std::collections::HashMap<String, i64>) {
    if let Ok(json) = serde_json::to_string(deleted) {
        let _ = std::fs::write(deleted_path(app), json);
    }
}

/// Loadouts saved in Radar (new or changed), by id: DIM's list can still
/// hold the old version, or none, for a while.
static EDITED: Mutex<Option<std::collections::HashMap<String, (Instant, Value)>>> = Mutex::new(None);

/// Keep a loadout just saved from Radar over DIM's (possibly older) copy.
pub(crate) fn remember_raw(l: &Value) {
    if let Some(id) = l["id"].as_str() {
        EDITED.lock().unwrap().get_or_insert_default().insert(id.to_string(), (Instant::now(), l.clone()));
    }
}

/// The raw DIM loadouts, with when they were fetched.
static RAW_CACHE: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);
/// Described loadouts per (character id, loadout id).
type DetailsCache = std::collections::HashMap<(String, String), (Instant, DimLoadoutOut)>;
static DETAILS_CACHE: Mutex<Option<DetailsCache>> = Mutex::new(None);
/// Long: the app refreshes them itself (see src/lib/preload.ts).
const LOADOUTS_TTL: Duration = Duration::from_secs(600);

/// Forget the cached loadouts (after equipping, saving …).
pub(crate) fn invalidate_loadouts() {
    *RAW_CACHE.lock().unwrap() = None;
    *DETAILS_CACHE.lock().unwrap() = None;
}

/// Forget everything that holds item names (the language changed).
pub(crate) fn forget_names() {
    invalidate_loadouts();
    *ARTIFACT_LAYOUT.lock().unwrap() = None;
}

/// The character (id, class) picked for an id, per requested id.
static CHARACTER_CACHE: Mutex<Option<std::collections::HashMap<String, (Instant, (String, i64))>>> = Mutex::new(None);

/// `pick_character`, reused for a while (details load one loadout at a time).
pub(crate) async fn cached_character(app: &AppHandle, s: &Session, key: &str) -> Result<(String, i64), String> {
    if let Some((at, c)) = CHARACTER_CACHE.lock().unwrap().get_or_insert_default().get(key) {
        if at.elapsed() < LOADOUTS_TTL {
            return Ok(c.clone());
        }
    }
    let profile = own_profile(app, s, "200").await?;
    let wanted = (!key.is_empty()).then_some(key);
    let c = pick_character(&profile, wanted)?;
    CHARACTER_CACHE.lock().unwrap().get_or_insert_default().insert(key.to_string(), (Instant::now(), c.clone()));
    Ok(c)
}

/// `raw_loadouts`, reused for a while.
pub(crate) async fn cached_raw(app: &AppHandle, s: &Session) -> Result<Vec<Value>, String> {
    if let Some((at, raw)) = RAW_CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < LOADOUTS_TTL {
            return Ok(raw.clone());
        }
    }
    let raw = raw_loadouts(app, s).await?;
    *RAW_CACHE.lock().unwrap() = Some((Instant::now(), raw.clone()));
    Ok(raw)
}

/// Create or replace a loadout in DIM.
pub(crate) async fn save_loadout(app: &AppHandle, s: &Session, loadout: Value) -> Result<(), String> {
    let key = ensure_key(app).await?;
    let token = token(app, s, &key).await?;
    let http = app.state::<BungieState>().http.clone();
    let body = json!({
        "platformMembershipId": s.membership_id(),
        "destinyVersion": 2,
        "updates": [{ "action": "loadout", "payload": loadout }],
    });
    let res = send(http.post(format!("{BASE}/profile")).header("X-API-Key", &key).bearer_auth(token).json(&body)).await?;
    invalidate_loadouts();
    // Shown as saved right away, DIM's list catching up meanwhile.
    if res["results"][0]["status"].as_str() == Some("Success") {
        remember_raw(&loadout);
    }
    let result = &res["results"][0];
    match result["status"].as_str() {
        Some("Success") => Ok(()),
        _ => Err(format!("DIM: {}", result["message"].as_str().or(result["status"].as_str()).unwrap_or("?"))),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimStatus {
    connected: bool,
}

#[tauri::command]
pub fn dim_status(app: AppHandle) -> DimStatus {
    // Connected once is enough: a new Bungie key re-registers on the next read.
    let _ = api_key(&app);
    DimStatus { connected: STORE.lock().unwrap().as_ref().is_some_and(|s| s.api_key.is_some()) }
}

/// Register with DIM if needed and check that the loadouts can be read.
#[tauri::command]
pub async fn dim_connect(app: AppHandle) -> Result<DimStatus, String> {
    let s = session(&app).await?;
    raw_loadouts(&app, &s).await?;
    Ok(DimStatus { connected: true })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimLoadoutOut {
    id: String,
    name: String,
    notes: Option<String>,
    class_type: i64,
    class_name: String,
    subclass: Option<ItemInfo>,
    /// Super, abilities, aspects and fragments set on the subclass.
    subclass_plugs: Vec<ItemInfo>,
    /// Weapons and armor.
    items: Vec<ItemInfo>,
    mods: Vec<ItemInfo>,
    /// In-game loadout icon / color the loadout uses, if any.
    icon: Option<String>,
    color: Option<String>,
    /// What wouldn't work putting it on the character (empty = all fine).
    issues: Vec<String>,
    /// Artifact perks saved with it (set in game).
    artifact: Vec<ItemInfo>,
    /// Hashes of its items the player doesn't own (anymore).
    missing: Vec<u32>,
}

/// The armor slot a mod's plug category belongs to (None: any piece).
fn mod_slot(category: &str) -> Option<u64> {
    let [head, arms, chest, legs, class] = crate::fireteam::ARMOR_BUCKETS;
    [("_head", head), ("_arms", arms), ("_chest", chest), ("_legs", legs), ("_class", class)]
        .into_iter()
        .find(|(suffix, _)| category.contains(suffix))
        .map(|(_, bucket)| bucket)
}

/// Show a loadout's mods next to its armor, like the character screen: mods
/// for a slot on that piece, the others spread over the pieces with the
/// fewest. Mods that fit no piece (no armor in the loadout) stay a list.
fn mods_onto_armor(items: Vec<ItemInfo>, mods: Vec<ItemInfo>, by_bucket: Vec<(u64, ItemInfo)>) -> (Vec<ItemInfo>, Vec<ItemInfo>) {
    let armor: Vec<u64> = items
        .iter()
        .map(|i| i.bucket)
        .filter(|b| crate::fireteam::ARMOR_BUCKETS.contains(b))
        .collect();
    if armor.is_empty() {
        return (items, mods);
    }
    let mut per: std::collections::HashMap<u64, Vec<ItemInfo>> = std::collections::HashMap::new();
    let mut free = Vec::new();
    for (bucket, m) in by_bucket {
        if armor.contains(&bucket) {
            per.entry(bucket).or_default().push(m);
        } else {
            free.push(m);
        }
    }
    for m in mods {
        match mod_slot(&m.plug_category).filter(|b| armor.contains(b)) {
            Some(bucket) => per.entry(bucket).or_default().push(m),
            None => free.push(m),
        }
    }
    for m in free {
        let bucket = *armor.iter().min_by_key(|b| per.get(b).map_or(0, Vec::len)).expect("armor");
        per.entry(bucket).or_default().push(m);
    }
    let items = items
        .into_iter()
        .map(|i| match per.remove(&i.bucket) {
            Some(mods) => i.with_mods(mods),
            None => i,
        })
        .collect();
    (items, Vec::new())
}

pub(crate) async fn describe(app: &AppHandle, l: &Value, character: &str, class_type: i64, owned: &[OwnedItem]) -> DimLoadoutOut {
    let equipped: Vec<u64> = l["equipped"].as_array().into_iter().flatten().filter_map(|i| i["hash"].as_u64()).collect();
    let infos: Vec<ItemInfo> = join_all(equipped.iter().map(|h| item(app, *h))).await.into_iter().flatten().collect();
    let (subclasses, items): (Vec<ItemInfo>, Vec<ItemInfo>) = infos.into_iter().partition(|i| i.bucket == SUBCLASS);
    // Weapons with their perks and mods: the owned copy's, with the
    // loadout's own choices (socket overrides) on top.
    let items = join_all(items.into_iter().map(|info| async move {
        let weapon = crate::fireteam::WEAPON_BUCKETS.contains(&info.bucket);
        let exotic_armor = info.exotic && crate::fireteam::ARMOR_BUCKETS.contains(&info.bucket);
        if !weapon && !exotic_armor {
            return info;
        }
        let Some(entry) = l["equipped"].as_array().into_iter().flatten().find(|e| e["hash"].as_u64() == Some(info.hash())) else {
            return info;
        };
        let it = crate::apply::PlanItem {
            id: entry["id"].as_str().filter(|id| *id != "0").map(Into::into),
            hash: info.hash() as u32,
            overrides: Vec::new(),
        };
        let mut plugs: Vec<u64> = match crate::apply::find_owned(owned, &it, character) {
            Some(o) => o.socket_plugs.iter().map(|&p| p as u64).collect(),
            None => Vec::new(),
        };
        for (index, plug) in entry["socketOverrides"].as_object().into_iter().flatten() {
            let (Ok(index), Some(plug)) = (index.parse::<usize>(), plug.as_u64()) else { continue };
            if plugs.len() <= index {
                plugs.resize(index + 1, 0);
            }
            plugs[index] = plug;
        }
        if plugs.is_empty() {
            return info;
        }
        let Some(plugged) = crate::fireteam::item_with_plugs(app, info.hash(), &plugs).await else { return info };
        // Armor keeps the loadout's mods (set below); only its exotic perks.
        if exotic_armor { info.with_perks(plugged.perks().to_vec()) } else { plugged }
    }))
    .await;
    // The subclass setup: its socket overrides, in socket order.
    let mut overrides: Vec<(usize, u64)> = Vec::new();
    for entry in l["equipped"].as_array().into_iter().flatten() {
        let Some(hash) = entry["hash"].as_u64() else { continue };
        if subclasses.iter().any(|s| s.hash() == hash) {
            overrides = entry["socketOverrides"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(index, plug)| Some((index.parse().ok()?, plug.as_u64()?)))
                .collect();
        }
    }
    overrides.sort_by_key(|(index, _)| *index);
    let subclass_plugs: Vec<ItemInfo> = join_all(overrides.iter().map(|(_, h)| item(app, *h)))
        .await
        .into_iter()
        .flatten()
        .filter(|p| p.icon_present())
        .collect();
    let params = &l["parameters"];
    let artifact_hashes: Vec<u64> = params["artifactUnlocks"]["unlockedItemHashes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect();
    let artifact = join_all(artifact_hashes.iter().map(|h| item(app, *h))).await.into_iter().flatten().collect();
    let mod_hashes: Vec<u64> = params["mods"].as_array().into_iter().flatten().filter_map(Value::as_u64).collect();
    let mods: Vec<ItemInfo> = join_all(mod_hashes.iter().map(|h| item(app, *h))).await.into_iter().flatten().collect();
    // Mods saved per armor slot (newer DIM loadouts).
    let mut by_bucket: Vec<(u64, ItemInfo)> = Vec::new();
    for (bucket, list) in params["modsByBucket"].as_object().into_iter().flatten() {
        let Ok(bucket) = bucket.parse::<u64>() else { continue };
        let hashes: Vec<u64> = list.as_array().into_iter().flatten().filter_map(Value::as_u64).collect();
        // Only armor mods; shaders and ornaments live here too.
        for info in join_all(hashes.iter().map(|h| item(app, *h))).await.into_iter().flatten() {
            if info.plug_category.starts_with("enhancements") {
                by_bucket.push((bucket, info));
            }
        }
    }
    // An armor piece's own plugs (its tuning) are on that piece.
    for entry in l["equipped"].as_array().into_iter().flatten() {
        let Some(hash) = entry["hash"].as_u64() else { continue };
        let Some(bucket) = items.iter().find(|i| i.hash() == hash).map(|i| i.bucket) else { continue };
        if !crate::fireteam::ARMOR_BUCKETS.contains(&bucket) {
            continue;
        }
        let plugs: Vec<u64> = entry["socketOverrides"].as_object().into_iter().flatten().filter_map(|(_, p)| p.as_u64()).collect();
        for info in join_all(plugs.iter().map(|h| item(app, *h))).await.into_iter().flatten() {
            if info.plug_category.contains("tuning") {
                by_bucket.push((bucket, info));
            }
        }
    }
    let (items, mods) = mods_onto_armor(items, mods, by_bucket);
    let ids = &params["inGameIdentifiers"];
    let (icon, color) = futures::join!(
        async {
            match ids["iconHash"].as_u64() {
                Some(h) => definition(app, "DestinyLoadoutIconDefinition", h).await,
                None => None,
            }
        },
        async {
            match ids["colorHash"].as_u64() {
                Some(h) => definition(app, "DestinyLoadoutColorDefinition", h).await,
                None => None,
            }
        },
    );
    let plan = crate::apply::plan_from_dim(l);
    let issues = crate::apply::validate(app, &plan, character, class_type, owned).await;
    // Without the inventory (not logged in) nothing counts as missing.
    let missing = if owned.is_empty() {
        Vec::new()
    } else {
        plan.equipped.iter().filter(|it| crate::apply::find_owned(owned, it, character).is_none()).map(|it| it.hash).collect()
    };
    let class_type = l["classType"].as_i64().unwrap_or(3);
    DimLoadoutOut {
        id: l["id"].as_str().unwrap_or_default().into(),
        name: l["name"].as_str().unwrap_or_default().into(),
        notes: l["notes"].as_str().filter(|n| !n.is_empty()).map(Into::into),
        class_type,
        class_name: class_name(class_type).into(),
        subclass: subclasses.into_iter().next(),
        subclass_plugs,
        items,
        mods,
        icon: icon.and_then(|d| d["iconImagePath"].as_str().map(Into::into)),
        color: color.and_then(|d| d["colorImagePath"].as_str().map(Into::into)),
        issues,
        artifact,
        missing,
    }
}

impl DimLoadoutOut {
    pub(crate) fn items(&self) -> &[ItemInfo] {
        &self.items
    }
}

/// A loadout in the list: just enough to show it (details come per page).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimSummary {
    id: String,
    name: String,
    class_type: i64,
    class_name: String,
    subclass: Option<ItemInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimLoadoutList {
    class_type: i64,
    class_name: String,
    loadouts: Vec<DimSummary>,
}

/// All DIM loadouts, light: those for the character's class (and
/// class-less ones) first, newest first. Cheap: no inventory, no checks;
/// the subclass comes from Radar's own item table.
#[tauri::command]
pub async fn dim_loadout_list(app: AppHandle, character_id: Option<String>, fresh: Option<bool>) -> Result<DimLoadoutList, String> {
    if fresh == Some(true) {
        invalidate_loadouts();
    }
    let s = session(&app).await?;
    let (raw, profile, gear) = futures::join!(cached_raw(&app, &s), own_profile(&app, &s, "200"), crate::weapons::gear(&app));
    let (_, class_type) = pick_character(&profile?, character_id.as_deref())?;
    let gear = gear.ok();
    let mut raw = raw?;
    raw.sort_by_key(|l| {
        let fits = l["classType"].as_i64().is_none_or(|c| c == class_type || c == 3);
        (!fits, std::cmp::Reverse(l["lastUpdatedAt"].as_i64().unwrap_or(0)))
    });
    // The subclass of each (from the item table), with its full info (the
    // element colors the card): only a handful of different ones.
    let subclass_of = |l: &Value| -> Option<u64> {
        let gear = gear.as_ref()?;
        l["equipped"].as_array().into_iter().flatten().find_map(|i| {
            let hash = i["hash"].as_u64()?;
            gear.get(hash as u32).filter(|g| g.bucket == SUBCLASS).map(|_| hash)
        })
    };
    let mut hashes: Vec<u64> = raw.iter().filter_map(subclass_of).collect();
    hashes.sort_unstable();
    hashes.dedup();
    let infos: std::collections::HashMap<u64, ItemInfo> =
        join_all(hashes.iter().map(|h| item(&app, *h))).await.into_iter().flatten().map(|i| (i.hash(), i)).collect();
    let loadouts = raw
        .iter()
        .map(|l| {
            let c = l["classType"].as_i64().unwrap_or(3);
            DimSummary {
                id: l["id"].as_str().unwrap_or_default().into(),
                name: l["name"].as_str().unwrap_or_default().into(),
                class_type: c,
                class_name: class_name(c).into(),
                subclass: subclass_of(l).and_then(|h| infos.get(&h).cloned()),
            }
        })
        .collect();
    Ok(DimLoadoutList { class_type, class_name: class_name(class_type).into(), loadouts })
}

/// Full details (items, mods, checks against the character) for some
/// loadouts – the ones on screen. Cached per character and loadout.
#[tauri::command]
pub async fn dim_loadout_details(app: AppHandle, character_id: Option<String>, ids: Vec<String>) -> Result<Vec<DimLoadoutOut>, String> {
    let key = character_id.clone().unwrap_or_default();
    let mut out = Vec::new();
    let mut missing = Vec::new();
    {
        let mut cache = DETAILS_CACHE.lock().unwrap();
        let cache = cache.get_or_insert_default();
        for id in &ids {
            match cache.get(&(key.clone(), id.clone())) {
                Some((at, d)) if at.elapsed() < LOADOUTS_TTL => out.push(d.clone()),
                _ => missing.push(id.clone()),
            }
        }
    }
    if missing.is_empty() {
        return Ok(out);
    }
    let started = Instant::now();
    let s = session(&app).await?;
    let (raw, character, owned) = futures::join!(cached_raw(&app, &s), cached_character(&app, &s, &key), owned_items(&app));
    let fetched = started.elapsed();
    let (character, class_type) = character?;
    let owned = owned.unwrap_or_default();
    let raw = raw?;
    let wanted: Vec<&Value> = raw.iter().filter(|l| missing.iter().any(|id| l["id"].as_str() == Some(id))).collect();
    let described = join_all(wanted.into_iter().map(|l| describe(&app, l, &character, class_type, &owned))).await;
    println!(
        "[dim-details] {} – data {} ms, total {} ms",
        missing.join(","),
        fetched.as_millis(),
        started.elapsed().as_millis()
    );
    let mut cache = DETAILS_CACHE.lock().unwrap();
    let cache = cache.get_or_insert_default();
    for d in described {
        cache.insert((key.clone(), d.id.clone()), (Instant::now(), d.clone()));
        out.push(d);
    }
    Ok(out)
}

/// Delete a loadout from DIM.
#[tauri::command]
pub async fn dim_loadout_delete(app: AppHandle, id: String) -> Result<(), String> {
    let s = session(&app).await?;
    let key = api_key(&app).ok_or(tr("Erst „Mit DIM verbinden“ klicken", "Click “Connect DIM” first"))?;
    let token = token(&app, &s, &key).await?;
    let http = app.state::<BungieState>().http.clone();
    let body = json!({
        "platformMembershipId": s.membership_id(),
        "destinyVersion": 2,
        "updates": [{ "action": "delete_loadout", "payload": id }],
    });
    let res = send(http.post(format!("{BASE}/profile")).header("X-API-Key", &key).bearer_auth(token).json(&body)).await?;
    invalidate_loadouts();
    let result = &res["results"][0];
    match result["status"].as_str() {
        Some("Success") => {
            let mut deleted = deleted(&app);
            deleted.insert(id, chrono::Utc::now().timestamp());
            store_deleted(&app, &deleted);
            Ok(())
        }
        _ => Err(format!("DIM: {}", result["message"].as_str().or(result["status"].as_str()).unwrap_or("?"))),
    }
}

/// Put a DIM loadout on a character (default: the one played last), and
/// with `slot` save it as that in-game loadout slot. Returns warnings for
/// parts that didn't work.
#[tauri::command]
pub async fn dim_loadout_apply(
    app: AppHandle,
    id: String,
    slot: Option<usize>,
    character_id: Option<String>,
    identifiers: Option<[u32; 3]>,
) -> Result<Vec<String>, String> {
    let s = session(&app).await?;
    let loadout = raw_loadouts(&app, &s)
        .await?
        .into_iter()
        .find(|l| l["id"].as_str() == Some(id.as_str()))
        .ok_or(tr("Loadout nicht mehr in DIM", "Loadout no longer in DIM"))?;
    let mut plan = crate::apply::plan_from_dim(&loadout);
    // Name / color / icon chosen for the slot (preset) win over the loadout's.
    if let Some([name, color, icon]) = identifiers.filter(|ids| ids.iter().all(|&h| h != 0)) {
        plan.identifiers = Some((name, color, icon));
    }
    let result = crate::apply::apply(&app, &plan, slot, character_id.as_deref()).await;
    invalidate_loadouts();
    result
}

/// The season's artifact: its perks per column (tier), as the game shows
/// it. The same for every character; loaded once per run.
static ARTIFACT_LAYOUT: Mutex<Option<Vec<Vec<ItemInfo>>>> = Mutex::new(None);

#[tauri::command]
pub async fn artifact_layout(app: AppHandle) -> Result<Vec<Vec<ItemInfo>>, String> {
    if let Some(layout) = ARTIFACT_LAYOUT.lock().unwrap().clone() {
        return Ok(layout);
    }
    let s = session(&app).await?;
    let profile = own_profile(&app, &s, "200,202").await?;
    let (character, _) = pick_character(&profile, None)?;
    let tiers: Vec<Vec<u64>> = profile["characterProgressions"]["data"][&character]["seasonalArtifact"]["tiers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|tier| {
            tier["items"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|i| i["isVisible"].as_bool() != Some(false))
                .filter_map(|i| i["itemHash"].as_u64())
                .collect()
        })
        .filter(|t: &Vec<u64>| !t.is_empty())
        .collect();
    let mut layout = Vec::new();
    for tier in tiers {
        layout.push(join_all(tier.iter().map(|h| item(&app, *h))).await.into_iter().flatten().collect::<Vec<_>>());
    }
    if !layout.is_empty() {
        *ARTIFACT_LAYOUT.lock().unwrap() = Some(layout.clone());
    }
    Ok(layout)
}
