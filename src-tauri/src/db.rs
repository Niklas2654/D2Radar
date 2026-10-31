//! Radar's local databases (SQLite).
//!
//! - `radar.db` (config folder): the player's own data – loadouts, presets
//!   and the profile as last fetched (vault, characters, …). Never shipped.
//! - `game.db` (cache folder): game data – the definitions Radar looks up
//!   (subclasses with their supers, abilities, aspects and fragments, mods,
//!   exotics, artifacts, sets, …) and the weapon index. The public repo's
//!   release "game-data" has it per language (game-<lang>.db.gz, made anew
//!   when Bungie's manifest changes: .github/workflows/game-data.yml, or by
//!   hand with `cargo test --lib build_game_db -- --ignored`). Radar
//!   downloads the app language's on the first start, for a language picked
//!   later, and when Bungie's manifest is newer than its own; until then it
//!   looks what changed up itself.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

static USER: Mutex<Option<Connection>> = Mutex::new(None);
static GAME: Mutex<Option<Connection>> = Mutex::new(None);

const USER_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS loadouts (
        membership TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (membership, id)
    );
    CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile (
        membership TEXT PRIMARY KEY,
        fetched INTEGER NOT NULL,
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

pub(crate) const GAME_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS definitions (
        lang TEXT NOT NULL,
        entity TEXT NOT NULL,
        hash INTEGER NOT NULL,
        version TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (lang, entity, hash)
    );
    CREATE TABLE IF NOT EXISTS weapon_index (
        lang TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

fn open(path: PathBuf, schema: &str) -> Option<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(&path).map_err(|e| eprintln!("[db] {}: {e}", path.display())).ok()?;
    // Readers don't wait for a writer; writes survive a crash; a bigger page
    // cache and temp tables in memory (lookups by the hundred).
    let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA cache_size = -32000; PRAGMA temp_store = MEMORY;");
    conn.set_prepared_statement_cache_capacity(32);
    conn.execute_batch(schema).map_err(|e| eprintln!("[db] schema: {e}")).ok()?;
    Some(conn)
}

/// Run `f` on the player's database (None: it couldn't be opened).
pub(crate) fn user<T>(app: &AppHandle, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let mut guard = USER.lock().unwrap();
    if guard.is_none() {
        let dir = app.path().app_config_dir().ok()?;
        *guard = open(dir.join("radar.db"), USER_SCHEMA);
    }
    f(guard.as_ref()?).map_err(|e| eprintln!("[db] user: {e}")).ok()
}

/// Run `f` on the game-data database.
pub(crate) fn game<T>(app: &AppHandle, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let mut guard = GAME.lock().unwrap();
    if guard.is_none() {
        let path = app.path().app_cache_dir().ok()?.join("game.db");
        *guard = open(path, GAME_SCHEMA);
    }
    f(guard.as_ref()?).map_err(|e| eprintln!("[db] game: {e}")).ok()
}

/* ---------- Loadouts ---------- */

/// The player's loadouts (DIM's shape), oldest first.
pub(crate) fn loadouts(app: &AppHandle, membership: &str) -> Vec<serde_json::Value> {
    user(app, |c| {
        let mut st = c.prepare("SELECT data FROM loadouts WHERE membership = ?1 ORDER BY rowid")?;
        let rows = st.query_map(params![membership], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
    })
    .unwrap_or_default()
}

/// Put the player's loadouts as given (all of them, in one go).
pub(crate) fn set_loadouts(app: &AppHandle, membership: &str, all: &[serde_json::Value]) -> Result<(), String> {
    user(app, |c| {
        let tx = c.unchecked_transaction()?;
        tx.execute("DELETE FROM loadouts WHERE membership = ?1", params![membership])?;
        let now = chrono::Utc::now().timestamp();
        for l in all {
            let id = l["id"].as_str().unwrap_or_default();
            tx.execute(
                "INSERT OR REPLACE INTO loadouts (membership, id, data, updated) VALUES (?1, ?2, ?3, ?4)",
                params![membership, id, l.to_string(), now],
            )?;
        }
        tx.commit()
    })
    .ok_or_else(|| "database not available".to_string())
}

/* ---------- Presets ---------- */

/// The presets (raw), in their order; None: none stored yet.
pub(crate) fn presets(app: &AppHandle) -> Option<Vec<serde_json::Value>> {
    user(app, |c| {
        let n: i64 = c.query_row("SELECT COUNT(*) FROM meta WHERE key = 'presets'", [], |r| r.get(0))?;
        if n == 0 {
            return Ok(None);
        }
        let mut st = c.prepare("SELECT data FROM presets ORDER BY position")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        Ok(Some(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect()))
    })
    .flatten()
}

pub(crate) fn set_presets(app: &AppHandle, all: &[serde_json::Value]) -> Result<(), String> {
    user(app, |c| {
        let tx = c.unchecked_transaction()?;
        tx.execute("DELETE FROM presets", [])?;
        for (i, p) in all.iter().enumerate() {
            let id = p["id"].as_str().unwrap_or_default();
            tx.execute("INSERT OR REPLACE INTO presets (id, data, position) VALUES (?1, ?2, ?3)", params![id, p.to_string(), i as i64])?;
        }
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('presets', '1')", [])?;
        tx.commit()
    })
    .ok_or_else(|| "database not available".to_string())
}

/* ---------- The profile as last fetched ---------- */

/// (when fetched, the profile JSON) for `membership`.
pub(crate) fn profile(app: &AppHandle, membership: &str) -> Option<(i64, String)> {
    user(app, |c| {
        c.query_row("SELECT fetched, data FROM profile WHERE membership = ?1", params![membership], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
    })
    .flatten()
}

pub(crate) fn set_profile(app: &AppHandle, membership: &str, fetched: i64, data: &str) {
    user(app, |c| {
        c.execute(
            "INSERT OR REPLACE INTO profile (membership, fetched, data) VALUES (?1, ?2, ?3)",
            params![membership, fetched, data],
        )
    });
}

/* ---------- Game data ---------- */

/// A definition as kept: (the manifest version it's of, its JSON).
pub(crate) fn definition(app: &AppHandle, lang: &str, entity: &str, hash: u64) -> Option<(String, String)> {
    game(app, |c| {
        // (Prepared once, reused: the perk editor asks hundreds at once.)
        c.prepare_cached("SELECT version, data FROM definitions WHERE lang = ?1 AND entity = ?2 AND hash = ?3")?
            .query_row(params![lang, entity, hash as i64], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
    })
    .flatten()
}

/// Keep definitions: (lang, entity, hash, manifest version, JSON).
pub(crate) fn set_definitions(app: &AppHandle, rows: &[(String, String, u64, String, String)]) {
    game(app, |c| {
        let tx = c.unchecked_transaction()?;
        {
            let mut st =
                tx.prepare_cached("INSERT OR REPLACE INTO definitions (lang, entity, hash, version, data) VALUES (?1, ?2, ?3, ?4, ?5)")?;
            for (lang, entity, hash, version, data) in rows {
                st.execute(params![lang, entity, *hash as i64, version, data])?;
            }
        }
        tx.commit()
    });
}

/// The game data for `lang` (see the module docs), downloaded and taken in
/// when there's none for it yet, or (`manifest`: Bungie's version now) when
/// what's here is of an older one; once per run, language and version (no
/// network, no file: Radar looks it all up as before).
pub(crate) async fn ensure_language(app: &AppHandle, lang: &str, manifest: Option<&str>) {
    static TRIED: tokio::sync::Mutex<Vec<String>> = tokio::sync::Mutex::const_new(Vec::new());
    let mut tried = TRIED.lock().await;
    let attempt = format!("{lang}@{}", manifest.unwrap_or_default());
    if tried.contains(&attempt) {
        return;
    }
    tried.push(attempt);
    let here = weapon_index(app, &crate::weapons::index_key(lang)).map(|(version, _)| version);
    match (&here, manifest) {
        (None, _) => {}
        (Some(v), Some(now)) if v != now => {}
        _ => return,
    }
    // (RADAR_GAME_DATA_DIR: from a folder instead, for trying it out
    // before a release has the files.)
    let local = std::env::var("RADAR_GAME_DATA_DIR").ok().map(|d| PathBuf::from(d).join(format!("game-{lang}.db.gz")));
    let bytes: Vec<u8> = match local.and_then(|p| std::fs::read(p).ok()) {
        Some(b) => b,
        None => {
            let url = format!("https://github.com/Niklas2654/D2Radar/releases/download/game-data/game-{lang}.db.gz");
            let http = app.state::<crate::bungie::BungieState>().http.clone();
            match http.get(&url).send().await.and_then(|r| r.error_for_status()) {
                Ok(r) => match r.bytes().await {
                    Ok(b) => b.to_vec(),
                    Err(e) => return eprintln!("[db] {url}: {e}"),
                },
                Err(e) => return eprintln!("[db] {url}: {e}"),
            }
        }
    };
    let app = app.clone();
    let lang = lang.to_string();
    let first = here.is_none();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let Ok(dir) = app.path().app_cache_dir() else { return };
        let file = dir.join(format!("game-{lang}.download.db"));
        let mut raw = Vec::new();
        if std::io::Read::read_to_end(&mut flate2::read::GzDecoder::new(&bytes[..]), &mut raw).is_err() || std::fs::write(&file, &raw).is_err() {
            return;
        }
        // Taken in when it's newer than what's here: definitions of another
        // version than the file's are replaced (one looked up just now, of
        // the same version, stays as it is), the index too. Not newer (the
        // file not made anew yet): left, Radar looks things up itself.
        game(&app, |c| {
            c.execute("ATTACH DATABASE ?1 AS src", params![file.to_string_lossy()])?;
            let theirs: Option<String> = c.query_row("SELECT value FROM src.meta WHERE key = 'version'", [], |r| r.get(0)).optional()?;
            let mine: Option<String> =
                c.query_row("SELECT version FROM weapon_index WHERE lang = ?1", params![crate::weapons::index_key(&lang)], |r| r.get(0)).optional()?;
            let done = if first || theirs != mine {
                c.execute_batch(
                    "INSERT OR REPLACE INTO definitions SELECT s.lang, s.entity, s.hash, s.version, s.data FROM src.definitions s
                       WHERE NOT EXISTS (SELECT 1 FROM definitions d
                         WHERE d.lang = s.lang AND d.entity = s.entity AND d.hash = s.hash AND d.version = s.version);
                     INSERT OR REPLACE INTO weapon_index SELECT lang, version, data FROM src.weapon_index;",
                )
            } else {
                Ok(())
            };
            c.execute("DETACH DATABASE src", [])?;
            done
        });
        let _ = std::fs::remove_file(&file);
        println!("[db] game data for {lang} taken in ({} MB)", raw.len() / 1_000_000);
    })
    .await;
}

/// The weapon index for `lang`: (manifest version, JSON).
pub(crate) fn weapon_index(app: &AppHandle, lang: &str) -> Option<(String, String)> {
    game(app, |c| {
        c.query_row("SELECT version, data FROM weapon_index WHERE lang = ?1", params![lang], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
    })
    .flatten()
}

pub(crate) fn set_weapon_index(app: &AppHandle, lang: &str, version: &str, data: &str) {
    game(app, |c| {
        c.execute("INSERT OR REPLACE INTO weapon_index (lang, version, data) VALUES (?1, ?2, ?3)", params![lang, version, data])
    });
}
