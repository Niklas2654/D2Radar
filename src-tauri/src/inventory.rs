//! The player's own items (inventory, vault, equipped) with their socketed
//! plugs, via the Bungie login. Used to show the actual roll of an
//! inspected weapon, and to pull a copy out of the vault.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::bungie::{api_as_user, class_name, BungieState};
use crate::i18n::tr;

/// The inventory is reused this long (detection asks once per weapon).
const TTL: Duration = Duration::from_secs(20);

#[derive(Clone)]
pub struct OwnedItem {
    pub item_hash: u32,
    pub instance_id: String,
    /// The character holding it (None in the vault).
    pub character_id: Option<String>,
    /// "equipped", "inventory" or "vault".
    pub location: &'static str,
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

/// Forget the cached inventory (after moving or equipping items).
pub(crate) fn invalidate() {
    *CACHE.lock().unwrap() = None;
}

/// The inventory right away, even a little old, refreshed in the background
/// when it is (for the weapon overlay, which shouldn't wait seconds for
/// Bungie). Only the very first call waits.
pub async fn owned_items_quick(app: &AppHandle) -> Option<Vec<OwnedItem>> {
    let cached = CACHE.lock().unwrap().clone();
    match cached {
        Some((at, items)) => {
            if at.elapsed() >= TTL {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    owned_items(&app).await;
                });
            }
            Some(items)
        }
        None => owned_items(app).await,
    }
}

/// All instanced items the player owns, or None when not logged in.
pub async fn owned_items(app: &AppHandle) -> Option<Vec<OwnedItem>> {
    let cached = || {
        CACHE.lock().unwrap().as_ref().filter(|(at, _)| at.elapsed() < TTL).map(|(_, items)| items.clone())
    };
    if let Some(items) = cached() {
        return Some(items);
    }
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
    // 102 vault, 201 character inventories, 205 equipment, 300 instances
    // (armor energy), 305 sockets, 310 reusable plugs (all perk options per socket)
    let path = format!("/Destiny2/{mt}/Profile/{mid}/?components=102,201,205,300,305,310");
    let profile = api_as_user(&state.http, &key, &token, &path).await.ok()?;
    let components = &profile["itemComponents"];

    let mut items = Vec::new();
    collect(&profile["profileInventory"]["data"]["items"], "vault", None, components, &mut items);
    for (id, c) in profile["characterInventories"]["data"].as_object().into_iter().flatten() {
        collect(&c["items"], "inventory", Some(id), components, &mut items);
    }
    for (id, c) in profile["characterEquipment"]["data"].as_object().into_iter().flatten() {
        collect(&c["items"], "equipped", Some(id), components, &mut items);
    }
    *CACHE.lock().unwrap() = Some((Instant::now(), items.clone()));
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

/// GET a profile with the given components, as the logged-in player.
pub(crate) async fn own_profile(app: &AppHandle, session: &Session, components: &str) -> Result<Value, String> {
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
    *CACHE.lock().unwrap() = None;
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
