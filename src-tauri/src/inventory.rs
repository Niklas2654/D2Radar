//! The player's own items (inventory, vault, equipped) with their socketed
//! plugs, via the Bungie login. Used to show the actual roll of an
//! inspected weapon, and to pull a copy out of the vault.
//!
//! Fetched once and kept on disk too: the app has them at once on start.
//! They're fetched again in the background when they're read (the app
//! working with items) and two minutes old, every 30 minutes otherwise, when Radar comes
//! back to the front (after a while), on the reload button, and before
//! anything that moves or equips items (`invalidate`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::bungie::{api_as_user, class_name, BungieState};
use crate::i18n::tr;

/// Read when this old: fetched anew in the background (while the app works
/// with items, they're never much older; see the module docs).
const TTL: Duration = Duration::from_secs(2 * 60);
/// Nothing reading them: fetched anew this often anyway.
const IDLE_REFRESH: Duration = Duration::from_secs(30 * 60);

/// Where an item is ("equipped", "inventory", "vault"). (An alias: serde
/// would read a `&'static str` field as borrowed from the input.)
pub type Place = &'static str;

/// "equipped" / "inventory" / "vault" back from the copy on disk.
fn location_of<'de, D: Deserializer<'de>>(d: D) -> Result<&'static str, D::Error> {
    Ok(match String::deserialize(d)?.as_str() {
        "equipped" => "equipped",
        "inventory" => "inventory",
        _ => "vault",
    })
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OwnedItem {
    pub item_hash: u32,
    pub instance_id: String,
    /// The character holding it (None in the vault).
    pub character_id: Option<String>,
    /// "equipped", "inventory" or "vault".
    #[serde(deserialize_with = "location_of")]
    pub location: Place,
    /// The inventory bucket it's in (0: unknown).
    pub bucket: u64,
    /// Its gear tier (1–5; 0: none, older gear).
    #[serde(default)]
    pub gear_tier: u8,
    /// Plug hashes currently in the item's sockets.
    pub plugs: Vec<u32>,
    /// The plug in each socket, by socket index (0 = none).
    pub socket_plugs: Vec<u32>,
    /// Armor energy capacity (None for other items).
    pub energy_capacity: Option<u32>,
    /// Per socket index, the plugs Bungie lists as insertable there (only
    /// for sockets with a fixed choice, e.g. an armor piece's tuning).
    pub socket_options: Vec<(usize, Vec<u32>)>,
    /// Every plug the sockets can switch between (weapons that rolled
    /// several perks per column, crafted weapons), selected ones included.
    pub options: Vec<u32>,
}

static CACHE: Mutex<Option<(Instant, Vec<OwnedItem>)>> = Mutex::new(None);
/// The next call fetches anew and waits for it (something was moved).
static STALE: AtomicBool = AtomicBool::new(false);
/// When the items were last fetched (unix seconds; 0: not yet).
static FETCHED_AT: Mutex<i64> = Mutex::new(0);

/// The whole profile as last fetched (every component Radar reads, see
/// `SNAPSHOT`), for the membership it's of: `own_profile` answers from it.
static PROFILE: Mutex<Option<(String, std::sync::Arc<Value>)>> = Mutex::new(None);

/// The components fetched in one go: 100 profile, 102 vault, 104 profile
/// progression (artifact points), 200 characters, 201 character
/// inventories, 202 character progressions (artifact), 205 equipment, 206
/// in-game loadouts, 300 instances, 304 stats, 305 sockets (and plug
/// sets), 310 reusable plugs.
const SNAPSHOT: &str = "100,102,104,200,201,202,205,206,300,304,305,310";

/// Where each component's data sits in a profile.
fn component_keys(component: &str) -> &'static [&'static str] {
    match component {
        "100" => &["profile"],
        "102" => &["profileInventory"],
        "104" => &["profileProgression"],
        "200" => &["characters"],
        "201" => &["characterInventories"],
        "202" => &["characterProgressions"],
        "205" => &["characterEquipment"],
        "206" => &["characterLoadouts"],
        "300" => &["itemComponents.instances"],
        "304" => &["itemComponents.stats"],
        "305" => &["itemComponents.sockets", "profilePlugSets", "characterPlugSets"],
        "310" => &["itemComponents.reusablePlugs"],
        _ => &[],
    }
}

/// The parts of `profile` for `components` (as Bungie would answer them).
fn part_of(profile: &Value, components: &str) -> Value {
    let mut out = json!({});
    for c in components.split(',').map(str::trim) {
        for key in component_keys(c) {
            match key.split_once('.') {
                Some((outer, inner)) => {
                    if !out[outer].is_object() {
                        out[outer] = json!({});
                    }
                    out[outer][inner] = profile[outer][inner].clone();
                }
                None => out[*key] = profile[*key].clone(),
            }
        }
    }
    out
}

/// The copy on disk: when it was fetched, and the profile.
#[derive(Serialize, Deserialize)]
struct Saved {
    at: i64,
    profile: Value,
}

fn saved_path(app: &AppHandle, membership: &str) -> Option<std::path::PathBuf> {
    Some(app.path().app_cache_dir().ok()?.join(format!("inventory-{membership}.json")))
}

/// `components` is the profile's itemComponents (300 instances, 305
/// sockets, 310 reusable plugs).
fn collect(items: &Value, location: &'static str, character_id: Option<&str>, components: &Value, out: &mut Vec<OwnedItem>) {
    let sockets = &components["sockets"]["data"];
    let reusable = &components["reusablePlugs"]["data"];
    for item in items.as_array().into_iter().flatten() {
        let Some(instance) = item["itemInstanceId"].as_str() else { continue };
        let socket_plugs: Vec<u32> = sockets[instance]["sockets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| s["plugHash"].as_u64().unwrap_or(0) as u32)
            .collect();
        let plugs: Vec<u32> = socket_plugs.iter().copied().filter(|&h| h != 0).collect();
        let mut options: Vec<u32> = reusable[instance]["plugs"]
            .as_object()
            .into_iter()
            .flatten()
            .flat_map(|(_, list)| list.as_array().into_iter().flatten())
            .filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32))
            .chain(plugs.iter().copied())
            .collect();
        options.sort_unstable();
        options.dedup();
        let socket_options = reusable[instance]["plugs"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(index, list)| {
                let index: usize = index.parse().ok()?;
                // Every plug the socket offers, also those Bungie marks as not
                // insertable right now (it does so for the one already in it,
                // among others): a loadout naming one of them is fine. And the
                // plug in it now.
                let mut plugs: Vec<u32> = list
                    .as_array()?
                    .iter()
                    .filter_map(|p| p["plugItemHash"].as_u64().map(|h| h as u32))
                    .chain(socket_plugs.get(index).copied().filter(|&h| h != 0))
                    .collect();
                plugs.sort_unstable();
                plugs.dedup();
                Some((index, plugs))
            })
            .collect();
        out.push(OwnedItem {
            item_hash: item["itemHash"].as_u64().unwrap_or(0) as u32,
            instance_id: instance.to_string(),
            character_id: character_id.map(Into::into),
            location,
            bucket: item["bucketHash"].as_u64().unwrap_or(0),
            gear_tier: components["instances"]["data"][instance]["gearTier"].as_u64().unwrap_or(0).min(5) as u8,
            plugs,
            socket_plugs,
            socket_options,
            energy_capacity: components["instances"]["data"][instance]["energy"]["energyCapacity"]
                .as_u64()
                .map(|e| e as u32),
            options,
        });
    }
}

/// Forget the cached inventory (after moving or equipping items): the next
/// call fetches it anew and waits for it.
pub(crate) fn invalidate() {
    STALE.store(true, Ordering::SeqCst);
}

/// The inventory right away (for the weapon overlay, which shouldn't wait
/// seconds for Bungie): as kept, fetched anew in the background once it's
/// a minute old (a weapon just dropped is inspected in game, with Radar in
/// the back).
pub async fn owned_items_quick(app: &AppHandle) -> Option<Vec<OwnedItem>> {
    let kept = CACHE.lock().unwrap().clone();
    if let Some((at, _)) = kept.filter(|_| !STALE.load(Ordering::SeqCst)) {
        if at.elapsed() >= QUICK_TTL {
            refresh_in_background(app);
        }
    }
    owned_items(app).await
}

/// See `owned_items_quick`.
const QUICK_TTL: Duration = Duration::from_secs(60);

/// All instanced items the player owns, or None when not logged in: as
/// kept (in memory, else from disk), fetched anew in the background when
/// that's older than two minutes; fetched and waited for after `invalidate`.
pub async fn owned_items(app: &AppHandle) -> Option<Vec<OwnedItem>> {
    if !STALE.load(Ordering::SeqCst) {
        let kept = CACHE.lock().unwrap().clone();
        let kept = match kept {
            Some(k) => Some(k),
            // (Reading and parsing the copy takes a moment: not on the async
            // threads, which would wait for it meanwhile.)
            None => {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || from_disk(&app)).await.ok().flatten()
            }
        };
        if let Some((at, items)) = kept {
            if at.elapsed() >= TTL {
                refresh_in_background(app);
            }
            return Some(items);
        }
    }
    fetch(app).await
}

/// The copy on disk (as of when it was fetched), into memory.
fn from_disk(app: &AppHandle) -> Option<(Instant, Vec<OwnedItem>)> {
    let state = app.state::<BungieState>();
    let (_, membership) = state.player()?;
    let saved = match crate::db::profile(app, &membership) {
        Some((at, data)) => Saved { at, profile: serde_json::from_str(&data).ok()? },
        // (Kept in a file before the database.)
        None => serde_json::from_slice(&std::fs::read(saved_path(app, &membership)?).ok()?).ok()?,
    };
    let age = (chrono::Utc::now().timestamp() - saved.at).max(0) as u64;
    let at = Instant::now().checked_sub(Duration::from_secs(age)).unwrap_or_else(Instant::now);
    let items = items_of(&saved.profile);
    *CACHE.lock().unwrap() = Some((at, items.clone()));
    *PROFILE.lock().unwrap() = Some((membership, std::sync::Arc::new(saved.profile)));
    *FETCHED_AT.lock().unwrap() = saved.at;
    Some((at, items))
}

/// Every instanced item in a profile (vault, inventories, equipped).
fn items_of(profile: &Value) -> Vec<OwnedItem> {
    let components = &profile["itemComponents"];
    let mut items = Vec::new();
    collect(&profile["profileInventory"]["data"]["items"], "vault", None, components, &mut items);
    for (id, c) in profile["characterInventories"]["data"].as_object().into_iter().flatten() {
        collect(&c["items"], "inventory", Some(id), components, &mut items);
    }
    for (id, c) in profile["characterEquipment"]["data"].as_object().into_iter().flatten() {
        collect(&c["items"], "equipped", Some(id), components, &mut items);
    }
    items
}

/// Fetch anew without waiting for it (one at a time).
fn refresh_in_background(app: &AppHandle) {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        fetch(&app).await;
        RUNNING.store(false, Ordering::SeqCst);
    });
}

/// When the items were last fetched (unix seconds; 0: never).
#[tauri::command]
pub fn inventory_fetched_at(app: AppHandle) -> i64 {
    if *FETCHED_AT.lock().unwrap() == 0 {
        from_disk(&app);
    }
    *FETCHED_AT.lock().unwrap()
}

/// Fetch the items now (the reload button; `older_than` seconds: only if
/// they're older, e.g. when Radar comes back to the front). Resolves to
/// when they were fetched.
#[tauri::command]
pub async fn inventory_refresh(app: AppHandle, older_than: Option<i64>) -> Result<i64, String> {
    let now = chrono::Utc::now().timestamp();
    if let Some(secs) = older_than {
        let at = inventory_fetched_at(app.clone());
        if at > 0 && now - at < secs {
            return Ok(at);
        }
    }
    fetch(&app).await.ok_or(tr("Erst mit Bungie einloggen", "Log in with Bungie first"))?;
    Ok(*FETCHED_AT.lock().unwrap())
}

/// Every 30 minutes, the items fetched anew (when logged in), read or not.
pub(crate) fn start_hourly_refresh(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(IDLE_REFRESH).await;
            fetch(&app).await;
        }
    });
}

/// Fetch every item from Bungie now, keep it (memory and disk) and tell
/// the app ("inventory-updated", when it was fetched).
async fn fetch(app: &AppHandle) -> Option<Vec<OwnedItem>> {
    let started = Instant::now();
    let cached = || CACHE.lock().unwrap().as_ref().filter(|(at, _)| *at >= started).map(|(_, items)| items.clone());
    // One download at a time: callers at the same moment (loadouts loading
    // side by side) wait for it instead of each fetching the whole profile.
    static FETCHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = FETCHING.lock().await;
    if let Some(items) = cached() {
        return Some(items);
    }
    let token = crate::oauth::access_token(app).await?;
    let state = app.state::<BungieState>();
    let key = state.api_key().ok()?;
    let (mt, mid) = state.player()?;
    // Everything Radar reads in one go (see SNAPSHOT); cache-busted, so a
    // move just made shows.
    let path = format!("/Destiny2/{mt}/Profile/{mid}/?components={SNAPSHOT}&cb={}", chrono::Utc::now().timestamp_millis());
    let profile = api_as_user(&state.http, &key, &token, &path).await.ok()?;
    let items = items_of(&profile);
    let profile = std::sync::Arc::new(profile);
    *PROFILE.lock().unwrap() = Some((mid.clone(), profile.clone()));
    *CACHE.lock().unwrap() = Some((Instant::now(), items.clone()));
    STALE.store(false, Ordering::SeqCst);
    let at = chrono::Utc::now().timestamp();
    *FETCHED_AT.lock().unwrap() = at;
    // The copy on disk (written aside, then put in place).
    {
        let (app, mid) = (app.clone(), mid.clone());
        let old = saved_path(&app, &mid);
        tauri::async_runtime::spawn_blocking(move || {
            crate::db::set_profile(&app, &mid, at, &profile.to_string());
            if let Some(old) = old.filter(|p| p.exists()) {
                let _ = std::fs::remove_file(old);
            }
        });
    }
    let _ = app.emit("inventory-updated", at);
    // Weapons gone from the account: out of the loadouts too.
    {
        let (app, items) = (app.clone(), items.clone());
        tauri::async_runtime::spawn(async move { crate::dimsync::drop_missing_weapons(&app, &mid, &items).await });
    }
    Some(items)
}

/// What a logged-in action needs: OAuth token, API key and the player.
pub(crate) struct Session {
    token: String,
    key: String,
    pub membership_type: i64,
    membership_id: String,
}

impl Session {
    /// The Bungie OAuth access token.
    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    /// Destiny membership id of the player.
    pub(crate) fn membership_id(&self) -> &str {
        &self.membership_id
    }
}

pub(crate) async fn session(app: &AppHandle) -> Result<Session, String> {
    let token = crate::oauth::access_token(app)
        .await
        .ok_or(tr("Erst in den Einstellungen mit Bungie einloggen", "Log in with Bungie in the settings first"))?;
    let state = app.state::<BungieState>();
    let key = state.api_key()?;
    let (membership_type, membership_id) = state.player().ok_or(tr("Kein Spieler verbunden", "No player connected"))?;
    Ok(Session { token, key, membership_type, membership_id })
}

/// A profile with the given components, as the logged-in player: from the
/// profile as kept (see the module docs) when it has them all, else
/// fetched for these.
pub(crate) async fn own_profile(app: &AppHandle, session: &Session, components: &str) -> Result<Value, String> {
    let kept = components.split(',').map(str::trim).all(|c| !component_keys(c).is_empty());
    if kept {
        // As kept (fetched first after `invalidate`, or when there's none).
        owned_items(app).await;
        let profile = PROFILE.lock().unwrap().clone();
        if let Some((membership, profile)) = profile.filter(|(m, _)| *m == session.membership_id) {
            let _ = membership;
            return Ok(part_of(&profile, components));
        }
    }
    let state = app.state::<BungieState>();
    // Cache-busted: right after moving or plugging items, a cached answer
    // would still show the old state.
    let path = format!(
        "/Destiny2/{}/Profile/{}/?components={components}&cb={}",
        session.membership_type,
        session.membership_id,
        chrono::Utc::now().timestamp_millis()
    );
    api_as_user(&state.http, &session.key, &session.token, &path).await
}

/// The most recently played character in a profile with component 200:
/// (character id, class type).
pub(crate) fn current_character(profile: &Value) -> Result<(String, i64), String> {
    profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .max_by_key(|(_, c)| c["dateLastPlayed"].as_str().unwrap_or("").to_string())
        .map(|(id, c)| (id.clone(), c["classType"].as_i64().unwrap_or(-1)))
        .ok_or(tr("Kein Charakter gefunden", "No character found").into())
}

/// The character `wanted` (if it exists in a profile with component 200),
/// else the most recently played one: (character id, class type).
pub(crate) fn pick_character(profile: &Value, wanted: Option<&str>) -> Result<(String, i64), String> {
    if let Some(id) = wanted {
        let c = &profile["characters"]["data"][id];
        if let Some(class_type) = c["classType"].as_i64() {
            return Ok((id.to_string(), class_type));
        }
    }
    current_character(profile)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnCharacter {
    id: String,
    class_type: i64,
    class_name: String,
    light: i64,
    emblem_path: Option<String>,
    emblem_background_path: Option<String>,
}

/// The player's characters, most recently played first.
#[tauri::command]
pub async fn own_characters(app: AppHandle) -> Result<Vec<OwnCharacter>, String> {
    let session = session(&app).await?;
    let profile = own_profile(&app, &session, "200").await?;
    let mut list: Vec<(String, OwnCharacter)> = profile["characters"]["data"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, c)| {
            let class_type = c["classType"].as_i64().unwrap_or(-1);
            (
                c["dateLastPlayed"].as_str().unwrap_or("").to_string(),
                OwnCharacter {
                    id: id.clone(),
                    class_type,
                    class_name: class_name(class_type).into(),
                    light: c["light"].as_i64().unwrap_or(0),
                    emblem_path: c["emblemPath"].as_str().map(Into::into),
                    emblem_background_path: c["emblemBackgroundPath"].as_str().map(Into::into),
                },
            )
        })
        .collect();
    list.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(list.into_iter().map(|(_, c)| c).collect())
}

/// POST a Destiny2/Actions request; Ok holds Bungie's Response. Err holds
/// its ErrorStatus and a message (see `action_error` for the common ones).
/// Retried a few times when Bungie throttles (item actions in quick
/// succession, e.g. while applying a preset).
pub(crate) async fn post_action(app: &AppHandle, session: &Session, path: &str, body: Value) -> Result<Value, (String, String)> {
    let state = app.state::<BungieState>();
    let mut attempt = 0;
    loop {
        let res: Value = state
            .http
            .post(format!("https://www.bungie.net/Platform/Destiny2/Actions/{path}"))
            .header("X-API-Key", &session.key)
            .bearer_auth(&session.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| (String::new(), format!("{}: {e}", tr("Netzwerkfehler", "Network error"))))?
            .json()
            .await
            .map_err(|_| (String::new(), tr("Unerwartete Antwort von Bungie.net", "Unexpected response from Bungie.net").into()))?;
        let status = res["ErrorStatus"].as_str().unwrap_or("");
        if status == "Success" {
            // Something changed in game: the profile as kept is out of date.
            invalidate();
            return Ok(res["Response"].clone());
        }
        attempt += 1;
        if status.contains("Throttle") && attempt < 4 {
            let wait = res["ThrottleSeconds"].as_u64().unwrap_or(1).max(1);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            continue;
        }
        println!("[bungie] Actions/{path} -> {status} {}", res["Message"].as_str().unwrap_or(""));
        return Err((status.to_string(), res["Message"].as_str().unwrap_or("Bungie.net error").to_string()));
    }
}

/// Message for the errors every item action can hit.
pub(crate) fn action_error((status, message): (String, String)) -> String {
    match status.as_str() {
        "AccessNotPermittedByApplicationScope" => tr(
            "Radar darf noch keine Gegenstände bewegen: im Bungie-Developer-Portal bei deiner App „Move or equip Destiny gear“ anhaken, dann in Radar ab- und wieder einloggen.",
            "Radar may not move items yet: tick “Move or equip Destiny gear” for your app in the Bungie developer portal, then log out and back in to Radar.",
        )
        .into(),
        "DestinyCannotPerformActionAtThisLocation" => tr(
            "Geht nur im Orbit, in einem sozialen Raum (z. B. Turm) oder offline – Bungie sperrt das in Aktivitäten",
            "Only works in orbit, in a social space (e.g. the Tower) or offline – Bungie blocks it in activities",
        )
        .into(),
        _ => message,
    }
}

/// Move a weapon from the vault to the most recently played character.
/// Returns that character's class name.
pub async fn pull_from_vault(app: &AppHandle, instance_id: &str, item_hash: u32) -> Result<String, String> {
    let session = session(app).await?;
    // 200 characters: the transfer goes to the one played last.
    let (character_id, class_type) = current_character(&own_profile(app, &session, "200").await?)?;
    let body = json!({
        "itemReferenceHash": item_hash,
        "stackSize": 1,
        "transferToVault": false,
        "itemId": instance_id,
        "characterId": character_id,
        "membershipType": session.membership_type,
    });
    let result = post_action(app, &session, "Items/TransferItem/", body).await.map(|_| ());
    // The inventory changed either way (or is stale).
    invalidate();
    match result {
        Ok(()) => Ok(class_name(class_type).to_string()),
        Err((status, _)) if status == "DestinyNoRoomInDestination" => Err(tr(
            "Kein Platz im Inventar für diese Waffenart – mach erst einen Slot frei",
            "No room in your inventory for this weapon type – free a slot first",
        )
        .into()),
        Err((status, _)) if status == "DestinyItemNotFound" => Err(tr(
            "Waffe nicht mehr im Tresor – schon verschoben?",
            "Weapon no longer in the vault – already moved?",
        )
        .into()),
        Err(e) => Err(action_error(e)),
    }
}
