//! A player's raid tags (lowmans, flawless runs, Day One and the other
//! race tags) chosen and named as RaidHub does on its profile pages: a port of its Web-App (hooks/profile/
//! useRaidTags.ts, lib/activity/display.ts), with its checkpoint names (API,
//! services/manifest/checkpoint-names.ts) and its activity versions (Services,
//! infrastructure/postgres/seeds/default.json). Not ported: RaidHub's own
//! cheat flags (its servers'). Unlike RaidHub, a full clear isn't labelled
//! "Full": everything not marked a checkpoint is one.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;

/// A completed raid of the player's, as RaidHub's tags look at it.
pub struct Instance {
    pub id: String,
    pub hash: u64,
    pub players: u8,
    /// Started from the beginning (None: can't be told, see clears.rs).
    pub fresh: Option<bool>,
    pub deathless: bool,
    pub started: DateTime<Utc>,
    pub completed: DateTime<Utc>,
}

/// One tag ("Duo Flawless Master", "Solo Atheon").
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaidTag {
    pub label: String,
    /// The best this raid allows (RaidHub's diamond).
    pub best: bool,
    /// From a checkpoint (or of unknown start): not a full clear.
    pub checkpoint: bool,
    pub instance_id: String,
    /// When it was completed (RFC 3339).
    pub date: String,
    /// A race tag (Day One, Contest, Week One, Challenge), shown first.
    pub race: bool,
    /// A race tag's activity's highest race ("Day One Contest Challenge"
    /// where it had a challenge, "Day One Contest" where it had a contest,
    /// else "Day One"): its colour goes by how close to that it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub race_best: Option<String>,
    /// The feats its run had on (raids and dungeons since The Edge of Fate).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub feats: Vec<crate::feats::Feat>,
    /// A lowman's: the classes of the characters that made it ("hunter",
    /// "warlock": made on both).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub classes: Vec<String>,
    /// A lowman's: per class its newest run of it, the newest first (a
    /// click shows them one under the other).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<TagRun>,
}

/// A run that made a tag, on one class.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRun {
    pub class: String,
    pub instance_id: String,
    /// When it was completed (RFC 3339).
    pub date: String,
}

// (Bungie activity hash, RaidHub activity id, RaidHub version id)
const ACTIVITY_VERSIONS: [(u64, u16, u16); 89] = [
    (2693136600, 1, 1),
    (2693136601, 1, 1),
    (2693136602, 1, 1),
    (2693136603, 1, 1),
    (2693136604, 1, 1),
    (2693136605, 1, 1),
    (89727599, 1, 2),
    (287649202, 1, 2),
    (1699948563, 1, 2),
    (1875726950, 1, 2),
    (3916343513, 1, 2),
    (4039317196, 1, 2),
    (417231112, 1, 3),
    (508802457, 1, 3),
    (757116822, 1, 3),
    (771164842, 1, 3),
    (1685065161, 1, 3),
    (1800508819, 1, 3),
    (2449714930, 1, 3),
    (3446541099, 1, 3),
    (4206123728, 1, 3),
    (3912437239, 1, 3),
    (3879860661, 1, 3),
    (3857338478, 1, 3),
    (3089205900, 2, 1),
    (2164432138, 2, 2),
    (809170886, 2, 3),
    (119944200, 3, 1),
    (3004605630, 3, 2),
    (3213556450, 3, 3),
    (2122313384, 4, 1),
    (2214608157, 4, 1),
    (1661734046, 4, 2),
    (548750096, 5, 1),
    (2812525063, 5, 2),
    (3333172150, 6, 1),
    (960175301, 6, 2),
    (2659723068, 7, 1),
    (3458480158, 7, 1),
    (1042180643, 7, 1),
    (2497200493, 7, 2),
    (3845997235, 7, 2),
    (3823237780, 7, 2),
    (910380154, 8, 1),
    (3976949817, 8, 2),
    (3881495763, 9, 1),
    (3711931140, 9, 2),
    (1485585878, 9, 64),
    (1681562271, 9, 4),
    (3022541210, 9, 4),
    (1441982566, 10, 1),
    (2906950631, 10, 1),
    (4156879541, 10, 2),
    (4217492330, 10, 4),
    (3889634515, 10, 4),
    (1374392663, 11, 1),
    (2897223272, 11, 2),
    (1063970578, 11, 65),
    (2964135793, 11, 4),
    (3257594522, 11, 4),
    (2381413764, 12, 1),
    (1191701339, 12, 2),
    (2918919505, 12, 4),
    (4179289725, 13, 1),
    (107319834, 13, 1),
    (4103176774, 13, 2),
    (156253568, 13, 66),
    (1507509200, 13, 4),
    (4169648179, 101, 128),
    (4169648176, 101, 129),
    (4169648177, 101, 130),
    (4169648182, 101, 131),
    (1516551982, 102, 132),
    (2530656885, 102, 133),
    (747671496, 102, 134),
    (796488315, 102, 135),
    (1953549041, 102, 136),
    (1566552947, 102, 137),
    (145874766, 102, 138),
    (3975235718, 102, 139),
    (43862588, 102, 140),
    (206811036, 102, 141),
    (1541433876, 14, 1),
    (2192826039, 14, 32),
    (4129614942, 14, 4),
    (1044919065, 15, 1),
    (3896382790, 15, 32),
    (3817322389, 16, 1),
    (2586252122, 16, 32),
];

/// Tags from the same run as one ("Day One" and "Solo Flawless" of one run:
/// "Day One Solo Flawless"), the race tag's word first; in the order of
/// their first part.
pub fn merge_same_run(tags: Vec<RaidTag>) -> Vec<RaidTag> {
    let mut out: Vec<RaidTag> = Vec::new();
    for tag in tags {
        match out.iter_mut().find(|t| !t.instance_id.is_empty() && t.instance_id == tag.instance_id) {
            Some(same) => {
                // One already says the other ("Day One" and "Day One Solo
                // Flawless"): the longer one.
                same.label = if same.label.starts_with(&format!("{} ", tag.label)) {
                    same.label.clone()
                } else if tag.label.starts_with(&format!("{} ", same.label)) {
                    tag.label.clone()
                } else if tag.race && !same.race {
                    format!("{} {}", tag.label, same.label)
                } else {
                    format!("{} {}", same.label, tag.label)
                };
                same.best |= tag.best;
                same.race |= tag.race;
                same.checkpoint |= tag.checkpoint;
                if same.race_best.is_none() {
                    same.race_best = tag.race_best.clone();
                }
            }
            None => out.push(tag),
        }
    }
    out
}

/// RaidHub's activity and version for a Bungie activity hash.
pub fn activity_version(hash: u64) -> Option<(u16, u16)> {
    ACTIVITY_VERSIONS.iter().find(|(h, _, _)| *h == hash).map(|&(_, a, v)| (a, v))
}

// Its version ids: prestige and master are the elevated difficulties.
const PRESTIGE: u16 = 3;
const MASTER: u16 = 4;
const CONTEST: u16 = 32;
const LAST_WISH: u16 = 4;

/// The checkpoint encounter of each raid (RaidHub's names).
fn checkpoint_name(activity: u16, version: u16) -> Option<String> {
    // Pantheon: the version's name without its last word ("Oryx Exalted" ->
    // "Oryx"; a one-word name as it is).
    let pantheon = match version {
        128 => Some("Atraks Sovereign"),
        129 => Some("Oryx Exalted"),
        130 => Some("Rhulk Indomitable"),
        131 => Some("Nezarec Sublime"),
        132 => Some("Calus Resplendent"),
        133 => Some("Morgeth Surpassing"),
        134 => Some("Insurrection Prime Revolutionary"),
        135 => Some("Argos"),
        136 => Some("Gahlran"),
        137 => Some("Calus"),
        138 => Some("Warpriest"),
        139 => Some("Consecrated Mind"),
        140 => Some("Morgeth"),
        141 => Some("Insurrection Prime"),
        _ => None,
    };
    if let Some(name) = pantheon {
        let words: Vec<&str> = name.split_whitespace().collect();
        return Some(if words.len() == 1 { words[0].to_string() } else { words[..words.len() - 1].join(" ") });
    }
    let name = match activity {
        1 => "Calus",
        2 => "Argos",
        3 => "Val Ca'uor",
        4 => "Queenswalk",
        5 => "Insurrection Prime",
        6 => "Gahlran",
        7 => "Sanctified Mind",
        8 => "Taniks",
        9 => "Atheon",
        10 => "Rhulk",
        11 => "Oryx",
        12 => "Nezarec",
        13 => "Crota",
        14 => "Witness",
        15 | 16 => "Koregos",
        _ => return None,
    };
    Some(name.to_string())
}

/// Weeks an item made raids easy to cheese: runs in them don't count.
fn during_op_item_event(started: DateTime<Utc>) -> bool {
    let at = |s: &str| -> DateTime<Utc> { s.parse().expect("valid date") };
    // (As RaidHub has them; its last one ends before it starts.)
    [
        ("2023-04-26T17:00:00Z", "2023-04-28T17:00:00Z"),
        ("2023-09-15T17:00:00Z", "2023-09-21T17:00:00Z"),
        ("2025-09-16T17:00:00Z", "2025-09-23T17:00:00Z"),
        ("2026-01-27T17:00:00Z", "2025-02-03T17:00:00Z"),
    ]
    .iter()
    .any(|(start, end)| started >= at(start) && started <= at(end))
}

const SOLO: u32 = 0b101010; // includes trio and duo
const FLAWLESS: u32 = 0b010100; // includes fresh
const DUO: u32 = 0b001010; // includes trio
const FRESH: u32 = 0b000100;
const TRIO: u32 = 0b000010;
const TIER2: u32 = 0b000001;

fn matches(a: u32, b: u32) -> bool {
    a & b == b
}

/// RaidHub's flawless: no deaths and started fresh (unknown if the start is).
fn flawless(i: &Instance) -> Option<bool> {
    if i.deathless {
        i.fresh
    } else {
        Some(false)
    }
}

fn weight(i: &Instance, version: u16) -> u32 {
    let flawless = flawless(i) == Some(true);
    if i.players > 3 && !flawless {
        return 0;
    }
    let mut w = match i.players {
        1 => SOLO,
        2 => DUO,
        3 => TRIO,
        _ => 0,
    };
    if flawless {
        w |= FLAWLESS;
    }
    if i.fresh == Some(true) {
        w |= FRESH;
    }
    if version == PRESTIGE || version == MASTER {
        w |= TIER2;
    }
    w
}

/// Tags RaidHub doesn't count: impossible, or only possible through a cheese.
fn illegal(activity: u16, version: u16, completed: DateTime<Utc>, w: u32) -> bool {
    let at = |s: &str| -> DateTime<Utc> { s.parse().expect("valid date") };
    match activity {
        101 => match version {
            129 => matches(w, SOLO | FRESH),
            130 | 131 => matches(w, DUO | FRESH),
            _ => false,
        },
        102 => matches(w, SOLO) && matches!(version, 132 | 133 | 134),
        16 => false,
        15 => matches(w, SOLO) || (matches(w, DUO) && !matches(w, SOLO)),
        14 => matches(w, TRIO | FRESH) && completed < at("2025-01-01T00:00:00Z"),
        13 => (matches(w, TRIO) && !matches(w, FRESH)) || matches(w, SOLO | FRESH),
        11 => matches(w, DUO | FRESH) || matches(w, SOLO),
        10 => matches(w, DUO),
        8 => matches(w, SOLO) && completed < at("2024-09-12T17:00:00Z"),
        7 => matches(w, DUO | FRESH),
        6 => matches(w, SOLO),
        5 => matches(w, SOLO) || matches(w, DUO | FLAWLESS),
        4 => matches(w, DUO | FLAWLESS),
        3 => matches(w, TRIO),
        2 => matches(w, TRIO | FRESH),
        1 => matches(w, TRIO | FRESH) || matches(w, SOLO),
        _ => false,
    }
}

/// The best tag a raid allows (RaidHub's diamond).
fn best(activity: u16, w: u32) -> bool {
    match activity {
        16 => matches(w, SOLO),
        15 => matches(w, TRIO | FLAWLESS),
        14 => matches(w, TIER2 | FLAWLESS) || matches(w, DUO | TIER2) || matches(w, SOLO),
        13 => matches(w, DUO | FLAWLESS | TIER2),
        12 => matches(w, SOLO | FLAWLESS) || matches(w, DUO | FLAWLESS | TIER2),
        11 => matches(w, DUO | TIER2) || matches(w, TRIO | FLAWLESS | TIER2),
        10 => matches(w, TRIO | FLAWLESS | TIER2),
        9 => matches(w, SOLO) || matches(w, DUO | FLAWLESS | TIER2),
        8 => matches(w, SOLO | FLAWLESS),
        7 => matches(w, SOLO) || matches(w, TRIO | FLAWLESS),
        6 => matches(w, DUO | FLAWLESS),
        5 => matches(w, DUO) || matches(w, TRIO | FLAWLESS),
        4 => matches(w, SOLO) || matches(w, TRIO | FLAWLESS),
        3 => matches(w, FLAWLESS | TIER2),
        2 => matches(w, SOLO),
        1 => matches(w, DUO),
        _ => false,
    }
}

/// A tag's words, as RaidHub labels it ("Duo Flawless Master", "Solo
/// Atheon"), without its "Full"; and whether it's a checkpoint's.
fn label(i: &Instance, activity: u16, version: u16) -> (String, bool) {
    let flawless = flawless(i) == Some(true);
    let fresh = i.fresh == Some(true);
    let mut tags: Vec<String> = Vec::new();
    match i.players {
        1 => tags.push("Solo".into()),
        2 => tags.push("Duo".into()),
        3 => tags.push("Trio".into()),
        _ => {}
    }
    if flawless {
        tags.push("Flawless".into());
    }
    if version == MASTER {
        tags.push("Master".into());
    } else if version == CONTEST {
        tags.push("Contest".into());
    }
    let wish_wall = activity == LAST_WISH && i.players <= 2 && fresh;
    let mut checkpoint = false;
    if wish_wall {
        tags.push("Wish Wall".into());
    } else if !fresh && !flawless {
        checkpoint = true;
        if i.players <= 3 {
            if let Some(name) = checkpoint_name(activity, version) {
                tags.push(name);
            }
        } else {
            tags.push("Checkpoint".into());
        }
    }
    (tags.join(" "), checkpoint)
}

/// RaidHub's raids: release, end of contest mode, end of the first week.
const RACES: [(u16, &str, Option<&str>, &str); 16] = [
    (1, "2017-09-13T17:00:00Z", None, "2017-09-19T17:00:00Z"),
    (2, "2017-12-08T18:00:00Z", None, "2017-12-12T17:00:00Z"),
    (3, "2018-05-11T17:00:00Z", None, "2018-05-15T17:00:00Z"),
    (4, "2018-09-14T17:00:00Z", None, "2018-09-18T17:00:00Z"),
    (5, "2018-12-07T17:00:00Z", None, "2018-12-11T17:00:00Z"),
    (6, "2019-06-04T23:00:00Z", Some("2019-06-05T23:00:00Z"), "2019-06-11T17:00:00Z"),
    (7, "2019-10-05T17:00:00Z", Some("2019-10-06T17:00:00Z"), "2019-10-08T17:00:00Z"),
    (8, "2020-11-21T18:00:00Z", Some("2020-11-22T18:00:00Z"), "2020-11-24T17:00:00Z"),
    (9, "2021-05-22T17:00:00Z", Some("2021-05-23T17:00:00Z"), "2021-05-25T17:00:00Z"),
    (10, "2022-03-05T18:00:00Z", Some("2022-03-07T18:00:00Z"), "2022-03-08T17:00:00Z"),
    (11, "2022-08-26T17:00:00Z", Some("2022-08-27T17:00:00Z"), "2022-08-30T17:00:00Z"),
    (12, "2023-03-10T17:00:00Z", Some("2023-03-12T17:00:00Z"), "2023-03-14T17:00:00Z"),
    (13, "2023-09-01T17:00:00Z", Some("2023-09-03T17:00:00Z"), "2023-09-05T17:00:00Z"),
    (14, "2024-06-07T17:00:00Z", Some("2024-06-09T17:00:00Z"), "2024-06-11T17:00:00Z"),
    (15, "2025-07-19T17:00:00Z", Some("2025-07-21T17:00:00Z"), "2025-07-22T17:00:00Z"),
    (16, "2025-09-27T17:00:00Z", Some("2025-09-29T17:00:00Z"), "2025-09-30T17:00:00Z"),
];

/// When a raid activity (hash) came out: its race's start; the Pantheon
/// (no race) at its launch: the first one in 2024, the new one's versions
/// in 2026 (Insurrection Prime the Saturday after the other two).
pub fn release(hash: u64) -> Option<&'static str> {
    let (activity, version) = activity_version(hash)?;
    match (activity, version) {
        // The first one: a boss more each week.
        (101, 128) => Some("2024-04-30T17:00:00Z"),
        (101, 129) => Some("2024-05-07T17:00:00Z"),
        (101, 130) => Some("2024-05-14T17:00:00Z"),
        (101, 131) => Some("2024-05-21T17:00:00Z"),
        (101, _) => Some("2024-04-30T17:00:00Z"),
        (102, 132 | 133) => Some("2026-06-09T17:00:00Z"),
        (102, 134) => Some("2026-06-13T17:00:00Z"),
        (102, _) => None,
        _ => RACES.iter().find(|r| r.0 == activity).map(|r| r.1),
    }
}

/// The new Pantheon's own versions (Calus Resplendent, Morgeth Surpassing,
/// Insurrection Prime Revolutionary), not its featured playlists.
pub fn is_pantheon_version(hash: u64) -> bool {
    activity_version(hash).is_some_and(|(a, v)| a == 102 && (132..=134).contains(&v))
}

/// Raids with a contest version of their own: only that one counts there.
const CONTEST_VERSION_RAIDS: [u16; 3] = [14, 15, 16];
/// Challenge versions of reprised raids (Tempo's Edge, Regicide, Superior
/// Swordplay).
const CHALLENGE_VERSIONS: [u16; 3] = [64, 65, 66];

/// A raid's race tag, as RaidHub's raid card picks it: the earliest clear
/// that is (in this order) a challenge clear of a reprised raid, a contest
/// clear on day one, a contest clear, a day-one clear, a week-one clear.
fn race_tag(activity: u16, clears: &[(&Instance, u16)]) -> Option<RaidTag> {
    let at = |s: &str| -> DateTime<Utc> { s.parse().expect("valid date") };
    let &(_, release, contest_end, week_one_end) = RACES.iter().find(|r| r.0 == activity)?;
    let day_one_end = at(release) + chrono::Duration::days(1);
    let day_one = |i: &Instance| i.completed < day_one_end;
    let week_one = |i: &Instance| i.completed < at(week_one_end);
    let contest = |i: &Instance, version: u16| {
        contest_end.is_some_and(|end| {
            i.completed < at(end) && (!CONTEST_VERSION_RAIDS.contains(&activity) || version == CONTEST)
        })
    };
    let earliest = |keep: &dyn Fn(&Instance, u16) -> bool| {
        clears.iter().filter(|(i, v)| keep(i, *v)).min_by_key(|(i, _)| i.completed).map(|(i, _)| *i)
    };
    let reprised = clears.iter().any(|(_, v)| CHALLENGE_VERSIONS.contains(v)) || [9, 11, 13].contains(&activity);
    let (instance, label) = None
        .or_else(|| {
            reprised
                .then(|| earliest(&|_, v| CHALLENGE_VERSIONS.contains(&v)))
                .flatten()
                .map(|i| (i, if day_one(i) { "Day One Contest Challenge" } else { "Contest Challenge" }))
        })
        .or_else(|| earliest(&|i, v| contest(i, v) && day_one(i)).map(|i| (i, "Day One Contest")))
        .or_else(|| earliest(&|i, v| contest(i, v)).map(|i| (i, "Contest")))
        .or_else(|| earliest(&|i, _| day_one(i)).map(|i| (i, "Day One")))
        .or_else(|| earliest(&|i, _| week_one(i)).map(|i| (i, "Week One")))?;
    let race_best = if [9, 11, 13].contains(&activity) {
        "Day One Contest Challenge"
    } else if contest_end.is_some() {
        "Day One Contest"
    } else {
        "Day One"
    };
    Some(RaidTag {
        label: label.to_string(),
        best: false,
        checkpoint: false,
        instance_id: instance.id.clone(),
        date: instance.completed.to_rfc3339(),
        race: true,
        race_best: Some(race_best.into()),
        feats: Vec::new(),
        classes: Vec::new(),
        runs: Vec::new(),
    })
}

/// Up to three tags per RaidHub activity and difficulty (normal and the
/// elevated ones apart: a master solo flawless doesn't hide a normal one),
/// picked as RaidHub's profile does: the fewest players first, then the
/// heaviest; each one adding something.
pub fn tags(instances: &[Instance]) -> HashMap<u16, Vec<RaidTag>> {
    let mut by_activity: HashMap<u16, Vec<(&Instance, u16, u32)>> = HashMap::new();
    // Race tags look at every clear (no cheese weeks or illegal lowmans).
    let mut clears: HashMap<u16, Vec<(&Instance, u16)>> = HashMap::new();
    for i in instances {
        let Some((activity, version)) = activity_version(i.hash) else {
            continue;
        };
        clears.entry(activity).or_default().push((i, version));
        if during_op_item_event(i.started) {
            continue;
        }
        let w = weight(i, version);
        if illegal(activity, version, i.completed, w) {
            continue;
        }
        by_activity.entry(activity).or_default().push((i, version, w));
    }
    let mut result: HashMap<u16, Vec<RaidTag>> = by_activity
        .into_iter()
        .map(|(activity, mut list)| {
            list.sort_by(|a, b| {
                a.0.players.cmp(&b.0.players).then(b.2.cmp(&a.2)).then(if a.0.completed < b.0.completed {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                })
            });
            let (mut bits, mut bits_elevated) = (0u32, 0u32);
            let (mut normal, mut elevated_count) = (0, 0);
            let mut out = Vec::new();
            for (i, version, w) in list {
                let elevated = w & TIER2 != 0;
                let (seen, count) =
                    if elevated { (&mut bits_elevated, &mut elevated_count) } else { (&mut bits, &mut normal) };
                if w & !*seen == 0 || *count >= 3 {
                    continue;
                }
                *seen |= w;
                *count += 1;
                let (label, checkpoint) = label(i, activity, version);
                out.push(RaidTag {
                    label,
                    best: best(activity, w),
                    checkpoint,
                    instance_id: i.id.clone(),
                    date: i.completed.to_rfc3339(),
                    race: false,
                    race_best: None,
                    feats: Vec::new(),
                    classes: Vec::new(),
                    runs: Vec::new(),
                });
            }
            (activity, out)
        })
        .collect();
    // The race tag first (on top of the three), as one with a tag of the
    // same run.
    for (activity, list) in &clears {
        if let Some(race) = race_tag(*activity, list) {
            result.entry(*activity).or_default().insert(0, race);
        }
    }
    result.into_iter().map(|(activity, tags)| (activity, merge_same_run(tags))).collect()
}
