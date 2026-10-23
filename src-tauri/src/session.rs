//! The "session team": everyone the player played with during the current
//! session, from the post-game carnage reports (PGCRs) of the session's
//! activities. Matchmade players (strikes, Crucible, …) are not part of the
//! fireteam and Bungie only reveals them in the PGCR once an activity ends.

use std::collections::HashMap;
use std::sync::Mutex;

use futures::future::join_all;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::bungie::{api_url, definition_name, BungieState, SessionRun};
use crate::i18n::locale;

const PGCR_BASE: &str = "https://stats.bungie.net/Platform";
/// Only the most recent activities of a session are shown.
const MAX_ACTIVITIES: usize = 8;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPlayer {
    membership_id: String,
    display_name: String,
    class_name: Option<String>,
    light: Option<i64>,
    emblem_path: Option<String>,
    /// Stayed until the end of the activity.
    completed: bool,
    /// When they were in it (seconds into the activity).
    #[serde(skip)]
    from: f64,
    #[serde(skip)]
    until: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionActivity {
    instance_id: String,
    name: Option<String>,
    ended_at: i64,
    players: Vec<TeamPlayer>,
}

/// "locale:instanceId" -> players of that activity (PGCRs never change).
static PLAYERS: Mutex<Option<HashMap<String, Vec<TeamPlayer>>>> = Mutex::new(None);

fn display_name(info: &Value) -> String {
    let name = info["bungieGlobalDisplayName"].as_str().filter(|n| !n.is_empty());
    match (name, info["bungieGlobalDisplayNameCode"].as_u64()) {
        (Some(n), Some(code)) => format!("{n}#{code:04}"),
        _ => info["displayName"].as_str().unwrap_or("?").to_string(),
    }
}

async fn players_of(app: &AppHandle, instance_id: &str) -> Option<Vec<TeamPlayer>> {
    let cache_key = format!("{}:{instance_id}", locale());
    if let Some(players) = PLAYERS.lock().unwrap().get_or_insert_default().get(&cache_key) {
        return Some(players.clone());
    }
    let state = app.state::<BungieState>();
    let key = state.api_key().ok()?;
    let url = format!(
        "{PGCR_BASE}/Destiny2/Stats/PostGameCarnageReport/{instance_id}/?lc={}",
        locale()
    );
    let report = api_url(&state.http, &key, Method::GET, &url, None).await.ok()?;

    // One entry per character; a player who switched characters appears twice.
    let mut players: Vec<TeamPlayer> = Vec::new();
    for entry in report["entries"].as_array().into_iter().flatten() {
        let info = &entry["player"]["destinyUserInfo"];
        let Some(id) = info["membershipId"].as_str() else { continue };
        let value = |k: &str| entry["values"][k]["basic"]["value"].as_f64().unwrap_or(0.0);
        let completed = value("completed") >= 1.0;
        let from = value("startSeconds");
        let until = from + value("timePlayedSeconds");
        if let Some(existing) = players.iter_mut().find(|p| p.membership_id == id) {
            existing.completed |= completed;
            existing.from = existing.from.min(from);
            existing.until = existing.until.max(until);
            continue;
        }
        players.push(TeamPlayer {
            membership_id: id.to_string(),
            display_name: display_name(info),
            class_name: entry["player"]["characterClass"].as_str().map(Into::into),
            light: entry["player"]["lightLevel"].as_i64(),
            emblem_path: info["iconPath"].as_str().map(Into::into),
            completed,
            from,
            until,
        });
    }
    let mut cached = PLAYERS.lock().unwrap();
    let cached = cached.get_or_insert_default();
    // One entry per activity played: start over past a couple hundred.
    if cached.len() >= 200 {
        cached.clear();
    }
    cached.insert(cache_key, players.clone());
    Some(players)
}

async fn activity(app: &AppHandle, run: SessionRun, me: Option<&str>, exclude: &[String]) -> Option<SessionActivity> {
    let (players, name) = futures::join!(
        players_of(app, &run.instance_id),
        definition_name(app, "DestinyActivityDefinition", run.activity_hash),
    );
    let players = players?;
    // Only who was in it together with the player: after leaving, the
    // ones who took their place (joined later) aren't their team.
    let mine = me.and_then(|me| players.iter().find(|p| p.membership_id == me)).map(|p| (p.from, p.until));
    let players: Vec<TeamPlayer> = players
        .into_iter()
        .filter(|p| !exclude.contains(&p.membership_id))
        .filter(|p| mine.is_none_or(|(from, until)| p.from < until && p.until > from))
        .collect();
    (!players.is_empty()).then_some(SessionActivity {
        instance_id: run.instance_id,
        name,
        ended_at: run.ended_at,
        players,
    })
}

/// Players from this session's activities, most recent activity first,
/// without the player themself and their current fireteam.
#[tauri::command]
pub async fn session_team(app: AppHandle) -> Result<Vec<SessionActivity>, String> {
    let (runs, exclude) = app.state::<BungieState>().session_view();
    let me = app.state::<BungieState>().player_id();
    let recent = runs.into_iter().take(MAX_ACTIVITIES);
    Ok(join_all(recent.map(|run| activity(&app, run, me.as_deref(), &exclude)))
        .await
        .into_iter()
        .flatten()
        .collect())
}
