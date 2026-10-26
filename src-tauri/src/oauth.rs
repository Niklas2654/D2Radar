//! Bungie login (OAuth, confidential client) for data the public API keeps
//! private: the player's inventory and vault, i.e. their actual weapon rolls.
//!
//! The authorize page opens in an app window; the redirect back (to whatever
//! https URL is registered for the Bungie app) is intercepted in that window,
//! so no local server is needed. Tokens are stored next to the other config
//! and refreshed automatically (access token ~1 h, refresh token ~90 days).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::bungie::BungieState;
use crate::i18n::tr;

const AUTHORIZE_URL: &str = "https://www.bungie.net/en/OAuth/Authorize";
const TOKEN_URL: &str = "https://www.bungie.net/platform/app/oauth/token/";
const LOGIN_WINDOW: &str = "bungie-login";
/// Refresh the access token this long before it expires.
const REFRESH_MARGIN_MS: i64 = 60_000;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct OAuthStore {
    client_id: Option<String>,
    client_secret: Option<String>,
    access_token: Option<String>,
    /// Expiry times in ms since the epoch.
    access_expires: i64,
    refresh_token: Option<String>,
    refresh_expires: i64,
}

/// Radar's own OAuth client id, built in (see build.rs); None in a build
/// without it, where the player enters their Bungie app's id and secret.
const BUILT_IN_CLIENT_ID: Option<&str> = option_env!("RADAR_BUNGIE_CLIENT_ID");
/// Its secret, only in a local build that has it (bungie.local.json): the
/// released app has none, its token requests go through TOKEN_SERVICE.
const BUILT_IN_CLIENT_SECRET: Option<&str> = option_env!("RADAR_BUNGIE_CLIENT_SECRET");
/// Where the released app trades codes and refresh tokens: the website's
/// /api/token, which adds the client secret (kept there, never in the app).
const TOKEN_SERVICE: &str = match option_env!("RADAR_TOKEN_SERVICE") {
    Some(url) => url,
    None => "https://d2radar.vercel.app/api/token",
};

static STORE: Mutex<Option<OAuthStore>> = Mutex::new(None);
/// Hands the authorization code from the login window to the waiting login.
static PENDING: Mutex<Option<(String, oneshot::Sender<String>)>> = Mutex::new(None);

fn store_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("oauth.json")
}

fn store(app: &AppHandle) -> OAuthStore {
    let mut s = STORE
        .lock()
        .unwrap()
        .get_or_insert_with(|| {
            std::fs::read_to_string(store_path(app))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        })
        .clone();
    if let Some(id) = BUILT_IN_CLIENT_ID {
        s.client_id = Some(id.to_string());
        // (Not kept in oauth.json: one saved by an older version goes.)
        s.client_secret = BUILT_IN_CLIENT_SECRET.map(String::from);
    }
    s
}

fn save(app: &AppHandle, s: OAuthStore) -> Result<(), String> {
    let path = store_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *STORE.lock().unwrap() = Some(s);
    let _ = app.emit("oauth-changed", status_of(&store(app)));
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    /// Client id and secret are set (or Radar's own client, see TOKEN_SERVICE).
    configured: bool,
    logged_in: bool,
    client_id: Option<String>,
    /// The client is Radar's own (nothing to enter or change).
    built_in: bool,
}

fn status_of(s: &OAuthStore) -> OAuthStatus {
    OAuthStatus {
        configured: s.client_id.is_some() && (s.client_secret.is_some() || BUILT_IN_CLIENT_ID.is_some()),
        logged_in: s.refresh_token.is_some() && s.refresh_expires > Utc::now().timestamp_millis(),
        client_id: s.client_id.clone(),
        built_in: BUILT_IN_CLIENT_ID.is_some(),
    }
}

/// Percent-encoding for form values (tokens may contain + / =).
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Token request (authorization code or refresh): with the client's secret
/// straight to Bungie when the app has one (a player's own Bungie app, a
/// local build), else through Radar's token service, which has it.
async fn token_request(app: &AppHandle, form: &[(&str, &str)]) -> Result<(), String> {
    let mut s = store(app);
    let http = app.state::<BungieState>().http.clone();
    let request = match (s.client_id.clone(), s.client_secret.clone()) {
        (Some(id), Some(secret)) => {
            let body = form.iter().map(|(k, v)| format!("{k}={}", encode(v))).collect::<Vec<_>>().join("&");
            let basic = base64::engine::general_purpose::STANDARD.encode(format!("{id}:{secret}"));
            http.post(TOKEN_URL)
                .header("Authorization", format!("Basic {basic}"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(body)
        }
        (Some(_), None) if BUILT_IN_CLIENT_ID.is_some() => {
            let mut body: serde_json::Map<String, Value> = form.iter().map(|(k, v)| (k.to_string(), Value::from(*v))).collect();
            // Not to be counted among Radar's users (Settings → Privacy).
            if !usage_count(app) {
                body.insert("count".into(), Value::Bool(false));
            }
            http.post(TOKEN_SERVICE).json(&body)
        }
        _ => return Err(tr("Client-ID und Secret fehlen", "Client id and secret missing").into()),
    };
    let res = request.send().await.map_err(|e| format!("{}: {e}", tr("Netzwerkfehler", "Network error")))?;
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let Some(access) = v["access_token"].as_str() else {
        let reason = v["error_description"].as_str().or(v["error"].as_str()).unwrap_or("?");
        return Err(format!("{}: {reason}", tr("Bungie-Login fehlgeschlagen", "Bungie login failed")));
    };
    let now = Utc::now().timestamp_millis();
    s.access_token = Some(access.to_string());
    s.access_expires = now + v["expires_in"].as_i64().unwrap_or(3600) * 1000;
    if let Some(refresh) = v["refresh_token"].as_str() {
        s.refresh_token = Some(refresh.to_string());
        s.refresh_expires = now + v["refresh_expires_in"].as_i64().unwrap_or(7_776_000) * 1000;
    }
    save(app, s)
}

/// A valid access token (refreshed if needed), or None when not logged in.
pub async fn access_token(app: &AppHandle) -> Option<String> {
    let s = store(app);
    let now = Utc::now().timestamp_millis();
    if let Some(token) = s.access_token.as_ref().filter(|_| s.access_expires - REFRESH_MARGIN_MS > now) {
        return Some(token.clone());
    }
    let refresh = s.refresh_token.filter(|_| s.refresh_expires > now)?;
    token_request(app, &[("grant_type", "refresh_token"), ("refresh_token", &refresh)]).await.ok()?;
    store(app).access_token
}

#[tauri::command]
pub fn oauth_status(app: AppHandle) -> OAuthStatus {
    status_of(&store(&app))
}

/// Save the Bungie app's OAuth client id and secret (Confidential client).
#[tauri::command]
pub fn oauth_set_client(app: AppHandle, client_id: String, client_secret: String) -> Result<OAuthStatus, String> {
    let mut s = store(&app);
    let (id, secret) = (client_id.trim().to_string(), client_secret.trim().to_string());
    if id.is_empty() || secret.is_empty() {
        return Err(tr("Client-ID und Secret eingeben", "Enter client id and secret").into());
    }
    // A different client invalidates existing tokens.
    if s.client_id.as_deref() != Some(&id) {
        s.access_token = None;
        s.refresh_token = None;
    }
    s.client_id = Some(id);
    s.client_secret = Some(secret);
    save(&app, s)?;
    Ok(status_of(&store(&app)))
}

/// Open the Bungie authorize page and wait for the user to approve.
#[tauri::command]
pub async fn oauth_login(app: AppHandle) -> Result<OAuthStatus, String> {
    let s = store(&app);
    let client_id = s.client_id.ok_or(tr("Client-ID fehlt", "Client id missing"))?;
    let state = format!("{:x}", Utc::now().timestamp_nanos_opt().unwrap_or_default());
    let url: Url = format!("{AUTHORIZE_URL}?client_id={client_id}&response_type=code&state={state}")
        .parse()
        .map_err(|_| tr("Ungültige Client-ID", "Invalid client id").to_string())?;

    let (tx, rx) = oneshot::channel();
    *PENDING.lock().unwrap() = Some((state, tx));
    if let Some(old) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = old.close();
    }

    let window_app = app.clone();
    WebviewWindowBuilder::new(&app, LOGIN_WINDOW, WebviewUrl::External(url))
        .title("Bungie Login")
        .inner_size(520.0, 780.0)
        .center()
        .on_navigation(move |url| {
            // Bungie redirects to the registered URL with ?code=…&state=…;
            // take the code here and never actually load that page.
            let query: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
            let get = |k: &str| query.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
            let (Some(code), Some(state)) = (get("code"), get("state")) else { return true };
            let mut pending = PENDING.lock().unwrap();
            if pending.as_ref().is_some_and(|(expected, _)| *expected == state) {
                if let Some((_, tx)) = pending.take() {
                    let _ = tx.send(code);
                }
                let app = window_app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
                        let _ = w.close();
                    }
                });
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    // Closing the window drops the sender, which ends the wait.
    let code = tokio::time::timeout(Duration::from_secs(600), rx)
        .await
        .map_err(|_| tr("Login abgelaufen", "Login timed out").to_string())?
        .map_err(|_| tr("Login abgebrochen", "Login cancelled").to_string())?;
    token_request(&app, &[("grant_type", "authorization_code"), ("code", &code)]).await?;
    // The one who logged in is the player (no name to type in).
    if let Err(e) = crate::bungie::set_player_from_login(&app).await {
        eprintln!("[oauth] player from login: {e}");
    }
    Ok(status_of(&store(&app)))
}

/// Logged in with Bungie (a refresh token that hasn't run out).
/// Whether the token service may count this player among Radar's users
/// (anonymously, see the website's api/token.ts). On unless turned off.
fn usage_count_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("privacy.json")
}

fn usage_count(app: &AppHandle) -> bool {
    std::fs::read_to_string(usage_count_path(app))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["count"].as_bool())
        .unwrap_or(true)
}

#[tauri::command]
pub fn usage_count_get(app: AppHandle) -> bool {
    usage_count(&app)
}

#[tauri::command]
pub fn usage_count_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let path = usage_count_path(&app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, serde_json::json!({ "count": on }).to_string()).map_err(|e| e.to_string())?;
    Ok(on)
}

pub(crate) fn logged_in(app: &AppHandle) -> bool {
    status_of(&store(app)).logged_in
}

/// Called when the login window is closed, so a waiting login ends.
pub fn login_window_closed() {
    PENDING.lock().unwrap().take();
}

#[tauri::command]
pub fn oauth_logout(app: AppHandle) -> Result<OAuthStatus, String> {
    let mut s = store(&app);
    s.access_token = None;
    s.refresh_token = None;
    save(&app, s)?;
    Ok(status_of(&store(&app)))
}
