//! Exact numbers for perks: Clarity's community research database
//! (https://d2clarity.com), the source DIM uses for its detailed tooltips.
//! Bungie's own descriptions say "increases damage"; Clarity says by how
//! much, for how long, and what differs in PvP.
//!
//! The database (~2 MB) is downloaded once, kept in the cache folder and
//! replaced when Clarity's versions.json says there is a newer one (checked
//! every few hours). Only the entries asked for go to the frontend.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const BASE: &str = "https://database-clarity.github.io/Live-Clarity-Database";
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Perk hash -> its English description blocks (Clarity's "dim" format),
/// and item hash -> the perks Clarity lists for that item (an exotic's own
/// perk), with their names.
struct Data {
    perks: HashMap<u32, Value>,
    items: HashMap<u32, Vec<(String, Value)>>,
}
type Db = Arc<Data>;
static DB: Mutex<Option<(Instant, Db)>> = Mutex::new(None);
static LOADING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn path(app: &AppHandle, name: &str) -> PathBuf {
    app.path().app_cache_dir().unwrap_or_else(|_| PathBuf::from(".")).join(name)
}

fn parse(raw: &Value) -> Data {
    let mut perks = HashMap::new();
    let mut items: HashMap<u32, Vec<(String, Value)>> = HashMap::new();
    for (hash, entry) in raw.as_object().into_iter().flatten() {
        let text = entry["descriptions"]["en"].clone();
        let Ok(hash) = hash.parse::<u32>() else { continue };
        if !text.is_array() {
            continue;
        }
        if let Some(item) = entry["itemHash"].as_u64() {
            let name = entry["name"].as_str().unwrap_or_default().to_string();
            items.entry(item as u32).or_default().push((name, text.clone()));
        }
        perks.insert(hash, text);
    }
    Data { perks, items }
}

async fn fetch_json(http: &reqwest::Client, url: &str) -> Option<Value> {
    http.get(url).send().await.ok()?.error_for_status().ok()?.json().await.ok()
}

/// The database: in memory, from disk, or downloaded (newer version).
async fn db(app: &AppHandle) -> Db {
    if let Some((at, db)) = DB.lock().unwrap().clone() {
        if at.elapsed() < CHECK_EVERY {
            return db;
        }
    }
    let _guard = LOADING.lock().await;
    if let Some((at, db)) = DB.lock().unwrap().clone() {
        if at.elapsed() < CHECK_EVERY {
            return db;
        }
    }
    let http = app.state::<crate::bungie::BungieState>().http.clone();
    let file = path(app, "clarity-dim.json");
    let version_file = path(app, "clarity-version.txt");
    let stored = std::fs::read_to_string(&version_file).unwrap_or_default();
    let latest = fetch_json(&http, &format!("{BASE}/versions.json"))
        .await
        .and_then(|v| v["descriptions"].as_f64())
        .map(|v| v.to_string());

    let fresh = match &latest {
        // Up to date on disk: no download.
        Some(v) if *v == stored && file.exists() => None,
        _ => fetch_json(&http, &format!("{BASE}/descriptions/dim.json")).await,
    };
    let db = match fresh {
        Some(raw) => {
            let _ = std::fs::create_dir_all(file.parent().unwrap_or(&file));
            let _ = std::fs::write(&file, raw.to_string());
            if let Some(v) = &latest {
                let _ = std::fs::write(&version_file, v);
            }
            parse(&raw)
        }
        // Offline or unchanged: the copy on disk.
        None => std::fs::read_to_string(&file)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .map(|raw| parse(&raw))
            .unwrap_or_else(|| Data { perks: HashMap::new(), items: HashMap::new() }),
    };
    let db = Arc::new(db);
    if !db.perks.is_empty() {
        *DB.lock().unwrap() = Some((Instant::now(), db.clone()));
    }
    db
}

/// Clarity's descriptions for these perks (only the ones it has).
#[tauri::command]
pub async fn clarity_perks(app: AppHandle, hashes: Vec<u32>) -> Result<HashMap<u32, Value>, String> {
    let db = db(&app).await;
    Ok(hashes.into_iter().filter_map(|h| db.perks.get(&h).map(|d| (h, d.clone()))).collect())
}

/// What Clarity says about these items' own perks (an exotic armor piece's
/// perk): item hash -> [{ name, text }].
#[tauri::command]
pub async fn clarity_items(app: AppHandle, hashes: Vec<u32>) -> Result<HashMap<u32, Vec<Value>>, String> {
    let db = db(&app).await;
    Ok(hashes
        .into_iter()
        .filter_map(|h| {
            let list = db.items.get(&h)?;
            Some((h, list.iter().map(|(name, text)| serde_json::json!({ "name": name, "text": text })).collect()))
        })
        .collect())
}

/// Load it in the background at start, so the first weapon shows numbers.
pub(crate) fn preload(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        db(&app).await;
    });
}
