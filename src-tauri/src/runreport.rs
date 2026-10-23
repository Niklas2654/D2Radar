//! One run's report, for the Fireteam tab (a click on a raid or dungeon
//! tag): who played, their kills, deaths and weapons, from Bungie's PGCR.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::bungie::BungieState;
use crate::i18n::tr;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    instance_id: String,
    /// The activity as the game names it ("Vault of Glass: Master").
    activity: String,
    /// When it started (RFC 3339).
    started: String,
    duration_seconds: u64,
    /// Started from the beginning (None: Bungie didn't keep it then).
    fresh: Option<bool>,
    /// Nobody died (and started fresh).
    flawless: bool,
    /// Its difficulty ("Expert"; the portal's versions).
    tier: Option<String>,
    /// The feats and modifiers it had on (runs since The Edge of Fate).
    feats: Vec<crate::feats::Feat>,
    players: Vec<RunPlayer>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPlayer {
    membership_id: String,
    name: String,
    class_name: String,
    emblem: Option<String>,
    /// Stayed to the end.
    completed: bool,
    kills: u32,
    deaths: u32,
    assists: u32,
    precision_kills: u32,
    super_kills: u32,
    grenade_kills: u32,
    melee_kills: u32,
    seconds: u64,
    /// Their most used weapons (most kills first, three at most).
    weapons: Vec<RunWeapon>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWeapon {
    name: String,
    icon: Option<String>,
    kills: u32,
}

fn basic(v: &Value) -> f64 {
    v["basic"]["value"].as_f64().unwrap_or(0.0)
}

/// A run's report, per player (their characters added up).
#[tauri::command]
pub async fn run_report(app: AppHandle, instance_id: String) -> Result<RunReport, String> {
    if instance_id.is_empty() || !instance_id.chars().all(|c| c.is_ascii_digit()) {
        return Err(tr("Kein Lauf", "No run").into());
    }
    let state = app.state::<BungieState>();
    let (http, key) = (state.http.clone(), state.api_key()?);
    let report = crate::clears::fetch_report(&http, &key, &instance_id)
        .await
        .ok_or(tr("Bericht nicht verfügbar", "Report unavailable"))?;
    let fresh = crate::clears::started_fresh(&report);
    let details = &report["activityDetails"];
    let director = details["directorActivityHash"].as_u64().unwrap_or(0);
    let hash = details["referenceId"].as_u64().filter(|&r| r != 0).unwrap_or(director);
    let def = crate::fireteam::definition(&app, "DestinyActivityDefinition", hash).await;
    let activity = def
        .as_ref()
        .and_then(|d| d["displayProperties"]["name"].as_str().map(String::from))
        .unwrap_or_default();
    // Its difficulty: an index into its activity's tier list.
    let mut tier = None;
    if let (Some(index), Some(collection)) = (
        report["activityDifficultyTier"].as_u64(),
        def.as_ref().and_then(|d| d["difficultyTierCollectionHash"].as_u64()).filter(|&c| c != 0),
    ) {
        if let Some(c) = crate::fireteam::definition(&app, "DestinyActivityDifficultyTierCollectionDefinition", collection).await {
            tier = c["difficultyTiers"][index as usize]["displayProperties"]["name"].as_str().map(String::from);
        }
    }
    // Its feats and modifiers (listed once per slot and player: once each).
    let mut skulls: Vec<u32> = report["selectedSkullHashes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|h| h.as_u64().map(|h| h as u32))
        .filter(|&h| crate::feats::is_feat(h))
        .collect();
    skulls.sort_unstable();
    skulls.dedup();
    let feats = if skulls.is_empty() {
        Vec::new()
    } else {
        let names = crate::feats::definitions(&app).await;
        skulls.iter().filter_map(|h| names.get(h).cloned()).collect()
    };

    // A player per account; a character switch adds up.
    struct Sum {
        player: RunPlayer,
        weapons: HashMap<u64, u32>,
        /// Seconds on the character shown (the one played most).
        main_seconds: u64,
    }
    let mut players: Vec<Sum> = Vec::new();
    let mut duration = 0u64;
    for e in report["entries"].as_array().into_iter().flatten() {
        let info = &e["player"]["destinyUserInfo"];
        let id = info["membershipId"].as_str().unwrap_or_default().to_string();
        let v = &e["values"];
        let x = &e["extended"]["values"];
        duration = duration.max(basic(&v["activityDurationSeconds"]) as u64);
        let seconds = basic(&v["timePlayedSeconds"]) as u64;
        let name = match (info["bungieGlobalDisplayName"].as_str(), info["bungieGlobalDisplayNameCode"].as_u64()) {
            (Some(n), Some(code)) if !n.is_empty() => format!("{n}#{code:04}"),
            _ => info["displayName"].as_str().unwrap_or_default().to_string(),
        };
        let index = match players.iter().position(|p| p.player.membership_id == id) {
            Some(i) => i,
            None => {
                players.push(Sum {
                    player: RunPlayer {
                        membership_id: id,
                        name,
                        class_name: String::new(),
                        emblem: None,
                        completed: false,
                        kills: 0,
                        deaths: 0,
                        assists: 0,
                        precision_kills: 0,
                        super_kills: 0,
                        grenade_kills: 0,
                        melee_kills: 0,
                        seconds: 0,
                        weapons: Vec::new(),
                    },
                    weapons: HashMap::new(),
                    main_seconds: 0,
                });
                players.len() - 1
            }
        };
        let sum = &mut players[index];
        let p = &mut sum.player;
        p.kills += basic(&v["kills"]) as u32;
        p.deaths += basic(&v["deaths"]) as u32;
        p.assists += basic(&v["assists"]) as u32;
        p.precision_kills += basic(&x["precisionKills"]) as u32;
        p.super_kills += basic(&x["weaponKillsSuper"]) as u32;
        p.grenade_kills += basic(&x["weaponKillsGrenade"]) as u32;
        p.melee_kills += basic(&x["weaponKillsMelee"]) as u32;
        p.seconds += seconds;
        p.completed |= basic(&v["completed"]) >= 1.0 && v["completionReason"]["basic"]["value"].as_f64().unwrap_or(0.0) == 0.0;
        if seconds >= sum.main_seconds {
            sum.main_seconds = seconds;
            p.class_name = e["player"]["characterClass"].as_str().unwrap_or_default().to_string();
            p.emblem = info["iconPath"].as_str().map(|path| format!("https://www.bungie.net{path}"));
        }
        for w in e["extended"]["weapons"].as_array().into_iter().flatten() {
            if let Some(hash) = w["referenceId"].as_u64() {
                *sum.weapons.entry(hash).or_default() += basic(&w["values"]["uniqueWeaponKills"]) as u32;
            }
        }
    }
    // Weapons named (cached item lookups).
    let mut out = Vec::new();
    for mut sum in players {
        let mut top: Vec<(u64, u32)> = sum.weapons.into_iter().filter(|(_, k)| *k > 0).collect();
        top.sort_by(|a, b| b.1.cmp(&a.1));
        for (hash, kills) in top.into_iter().take(3) {
            let item = crate::fireteam::item(&app, hash).await;
            sum.player.weapons.push(RunWeapon {
                name: item.as_ref().map(|i| i.name.clone()).unwrap_or_default(),
                icon: item.as_ref().and_then(|i| i.icon().map(|p| format!("https://www.bungie.net{p}"))),
                kills,
            });
        }
        out.push(sum.player);
    }
    // Who stayed to the end first, then by kills.
    out.sort_by(|a, b| b.completed.cmp(&a.completed).then(b.kills.cmp(&a.kills)));
    let deaths: u32 = out.iter().map(|p| p.deaths).sum();
    Ok(RunReport {
        instance_id,
        activity,
        started: report["period"].as_str().unwrap_or_default().to_string(),
        duration_seconds: duration,
        fresh,
        flawless: deaths == 0 && fresh == Some(true),
        tier,
        feats,
        players: out,
    })
}
