//! Exact numbers where Clarity has none: the Destiny Data Compendium
//! (a community spreadsheet of in-game values). Radar uses these
//! sheets: "Armor Perks" (every armor set bonus), "Exotic Class" (the
//! spirits of exotic class items) and "Armor Mods", looked up by the
//! English name, and "Artifact Perks" (every artifact's perks, by tier).
//!
//! Only a copy shipped with the app is used (data/compendium-snapshot.json):
//! nothing is fetched at run time, so a change to the sheet can't break the
//! app. New numbers come with an app update; the copy is made again from the
//! sheet with
//!   cargo test --lib refresh_compendium_snapshot -- --ignored
//! (it checks that the sheet still reads as much as before).

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

/// The copy shipped with the app.
const SNAPSHOT: &str = include_str!("../data/compendium-snapshot.json");

/// Perk name (lower case, English) -> what it does, with the numbers; also
/// set bonuses by set and pieces (see `set_key`).
#[derive(Default, Serialize, Deserialize)]
struct Texts {
    /// When the copy was made from the sheet (unix seconds).
    fetched: i64,
    perks: HashMap<String, String>,
    /// Every artifact (past seasons' ones are equippable too).
    #[serde(default)]
    artifacts: Vec<Artifact>,
}

/// An artifact as the sheet lists it: its perks per tier (one, two and
/// three diamonds in game), with exact numbers.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Artifact {
    pub name: String,
    /// Its season ("Wish").
    pub season: String,
    /// What it works best with ("Solar | Stasis | Strand ⯁ Rocket Launcher | …").
    pub focus: String,
    pub tiers: Vec<Vec<ArtifactPerk>>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct ArtifactPerk {
    pub name: String,
    pub text: String,
}

static TEXTS: LazyLock<Texts> = LazyLock::new(|| serde_json::from_str(SNAPSHOT).unwrap_or_default());

fn key(name: &str) -> String {
    name.trim().trim_end_matches('.').to_lowercase()
}

/// The key of a set's bonus by the set's name and its piece count (the
/// sheet's bonus names don't always match Bungie's).
fn set_key(set: &str, pieces: u32) -> String {
    format!("set:{}#{pieces}", key(set))
}

/// The exact description of a set's bonus by the set's English name and the
/// pieces it needs.
pub(crate) fn set_bonus(english_set: &str, pieces: u32) -> Option<String> {
    TEXTS.perks.get(&set_key(english_set, pieces)).cloned()
}

/// The exact description of an armor mod by its English name. The sheet
/// names them generally ("Ammo Scout"), the game by kind ("Heavy Ammo
/// Scout", "Arc Weapon Surge"): those words are left off when needed.
pub(crate) fn mod_exact(english_name: &str) -> Option<String> {
    const KINDS: [&str; 11] = ["heavy", "special", "primary", "kinetic", "arc", "solar", "void", "stasis", "strand", "harmonic", "prismatic"];
    let mut name = key(english_name);
    loop {
        if let Some(text) = TEXTS.perks.get(&format!("mod:{name}")) {
            return Some(text.clone());
        }
        let first = name.split(' ').next().unwrap_or_default().to_string();
        if !KINDS.contains(&first.as_str()) || !name.contains(' ') {
            return None;
        }
        name = name[first.len() + 1..].to_string();
    }
}

/// The exact description of a perk (set bonus, exotic class spirit) by
/// its English name.
pub(crate) fn exact(english_name: &str) -> Option<String> {
    TEXTS.perks.get(&key(english_name)).cloned()
}

/// Every artifact the sheet lists.
pub(crate) fn artifacts() -> &'static [Artifact] {
    &TEXTS.artifacts
}

/// Reading the sheets: only for making the copy (see the module docs).
#[cfg(test)]
mod sheet {
    use super::*;

    pub const SHEET: &str = "1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4";

    /// A CSV as Google Sheets writes it (every cell quoted, "" for a quote).
    pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
        let mut rows = Vec::new();
        let mut row = Vec::new();
        let mut cell = String::new();
        let mut quoted = false;
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            match (c, quoted) {
                ('"', true) if chars.peek() == Some(&'"') => {
                    cell.push('"');
                    chars.next();
                }
                ('"', true) => quoted = false,
                ('"', false) => quoted = true,
                (',', false) => row.push(std::mem::take(&mut cell)),
                ('\n', false) => {
                    row.push(std::mem::take(&mut cell));
                    rows.push(std::mem::take(&mut row));
                }
                ('\r', false) => {}
                (c, _) => cell.push(c),
            }
        }
        if !cell.is_empty() || !row.is_empty() {
            row.push(cell);
            rows.push(row);
        }
        rows
    }

    /// "Armor Perks": a set's name in the first cell of its row ("Crystocrene\n\n
    /// Europa…"), cells like "2 Piece | Name\n\nWhat it does…" after it (the
    /// 4-piece one in the next row).
    pub fn read_set_bonuses(rows: &[Vec<String>], out: &mut HashMap<String, String>) {
        let mut set = String::new();
        for row in rows {
            if let Some(first) = row.first().map(|c| c.trim()).filter(|c| !c.is_empty() && !c.contains(" Piece | ")) {
                set = first.lines().next().unwrap_or_default().to_string();
            }
            for cell in row {
                let (pieces, rest) = match (cell.strip_prefix("2 Piece | "), cell.strip_prefix("4 Piece | ")) {
                    (Some(rest), _) => (2, rest),
                    (_, Some(rest)) => (4, rest),
                    _ => continue,
                };
                let Some((name, text)) = rest.split_once('\n') else { continue };
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                out.insert(key(name), text.to_string());
                if !set.is_empty() {
                    out.insert(set_key(&set, pieces), text.to_string());
                }
            }
        }
    }

    /// "Armor Mods": a mod's name and cost in one cell ("Ammo Scout", then
    /// "[1 Energy]" on the next line), what it does in the next non-empty one.
    pub fn read_mods(rows: &[Vec<String>], out: &mut HashMap<String, String>) {
        for row in rows {
            let cells: Vec<&String> = row.iter().filter(|c| !c.trim().is_empty()).collect();
            for pair in cells.windows(2) {
                let mut lines = pair[0].trim().lines();
                let (Some(name), Some(cost)) = (lines.next(), lines.next()) else { continue };
                if cost.trim().starts_with('[') && cost.contains("Energy]") {
                    out.insert(format!("mod:{}", key(name)), pair[1].trim().to_string());
                }
            }
        }
    }

    /// "Artifact Perks": an artifact's title alone in its row ("Queensfoil
    /// Censer (Wish)"), maybe what it works best with in the next (a cell
    /// with "⯁"), then rows of perk names (one per tier, left to right),
    /// each followed by a row with what they do, in the same order.
    pub fn read_artifacts(rows: &[Vec<String>]) -> Vec<Artifact> {
        let mut out: Vec<Artifact> = Vec::new();
        let mut names: Option<Vec<String>> = None;
        for row in rows {
            let cells: Vec<&str> = row.iter().map(|c| c.trim()).filter(|c| !c.is_empty()).collect();
            if let [only] = cells[..] {
                // A title: "Name (Season)", short, one line.
                if let Some((name, season)) = only.strip_suffix(')').and_then(|t| t.rsplit_once(" (")) {
                    if !only.contains('\n') && only.len() < 60 {
                        out.push(Artifact { name: name.trim().into(), season: season.trim().into(), ..Default::default() });
                        names = None;
                        continue;
                    }
                }
                if only.contains('⯁') {
                    if let Some(a) = out.last_mut().filter(|a| a.tiers.is_empty() && a.focus.is_empty()) {
                        a.focus = only.split_whitespace().collect::<Vec<_>>().join(" ");
                    }
                }
                continue;
            }
            let Some(artifact) = out.last_mut() else { continue };
            if cells.len() < 2 {
                continue;
            }
            match names.take() {
                // What the perks named above do.
                Some(above) => {
                    for (tier, (name, text)) in above.into_iter().zip(cells).enumerate() {
                        if artifact.tiers.len() <= tier {
                            artifact.tiers.resize(tier + 1, Vec::new());
                        }
                        artifact.tiers[tier].push(ArtifactPerk { name, text: text.to_string() });
                    }
                }
                // Perk names: short, one line each.
                None if cells.iter().all(|c| !c.contains('\n') && c.len() < 48) => {
                    names = Some(cells.iter().map(|c| c.to_string()).collect());
                }
                None => {}
            }
        }
        out.retain(|a| a.tiers.iter().map(Vec::len).sum::<usize>() > 0);
        out
    }

    /// "Exotic Class": a spirit's name in one cell, what it does in the next
    /// non-empty one.
    pub fn read_spirits(rows: &[Vec<String>], out: &mut HashMap<String, String>) {
        for row in rows {
            let cells: Vec<&String> = row.iter().filter(|c| !c.trim().is_empty()).collect();
            for pair in cells.windows(2) {
                let name = pair[0].trim();
                if name.starts_with("Spirit of") && !name.contains('\n') {
                    out.insert(key(name), pair[1].trim().to_string());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::sheet::*;
    use super::*;

    #[test]
    fn reads_sheet_cells() {
        let csv = "\"Smoke Jumper\n\nLost Sectors\",\"\",\"2 Piece | Ride Together, Die Together\n\nOn Orb of Power Pickup: 40% [5%] Damage Resist.\"\n\"Spirit of Caliban\",\"\",\"Powered Melee Kills trigger an Ignition.\",\"Spirit of the Coyote \",\"\",\"Grants an extra Class Ability Charge.\"\n";
        let rows = parse_csv(csv);
        let mut out = HashMap::new();
        read_set_bonuses(&rows, &mut out);
        read_spirits(&rows, &mut out);
        assert_eq!(out["ride together, die together"], "On Orb of Power Pickup: 40% [5%] Damage Resist.");
        assert_eq!(out["set:smoke jumper#2"], "On Orb of Power Pickup: 40% [5%] Damage Resist.");
        assert_eq!(out["spirit of caliban"], "Powered Melee Kills trigger an Ignition.");
        assert_eq!(out["spirit of the coyote"], "Grants an extra Class Ability Charge.");
        let mods = parse_csv("\"Ammo Scout
[1 Energy]\",\"Upon spawning a brick: allies get a copy.\"
");
        read_mods(&mods, &mut out);
        assert_eq!(out["mod:ammo scout"], "Upon spawning a brick: allies get a copy.");
        let art = parse_csv("\"\",\"⯁\",\"\",\"\",\"⯁ ⯁\"
\"\",\"\",\"\",\"Queensfoil Censer (Wish)\"
\"\",\"\",\"\",\"Solar | Strand ⯁  Bow\"
\"\",\"\",\"Torch\",\"\",\"\",\"Pillar of Ice\"
\"\",\"While Radiant:

5% damage.\",\"\",\"\",\"Upon killing a Frozen Enemy: 1 crystal.\"
");
        let arts = read_artifacts(&art);
        assert_eq!(arts.len(), 1);
        assert_eq!((arts[0].name.as_str(), arts[0].season.as_str(), arts[0].focus.as_str()), ("Queensfoil Censer", "Wish", "Solar | Strand ⯁ Bow"));
        assert_eq!(arts[0].tiers[0][0].name, "Torch");
        assert_eq!(arts[0].tiers[0][0].text, "While Radiant:

5% damage.");
        assert_eq!(arts[0].tiers[1][0].name, "Pillar of Ice");
    }

    #[test]
    fn shipped_copy_reads() {
        assert!(TEXTS.perks.len() > 200, "copy has {} entries", TEXTS.perks.len());
        assert!(set_bonus("Crystocrene", 2).is_some());
    }

    /// Makes the shipped copy again from the sheet (run by hand, see the
    /// module docs). Refuses when the sheet reads much less than the copy:
    /// then it was rearranged and the reading needs a look first.
    #[test]
    #[ignore]
    fn refresh_compendium_snapshot() {
        let fetch = |sheet: &str| -> Vec<Vec<String>> {
            let url = format!(
                "https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:csv&sheet={}",
                sheet.replace(' ', "%20")
            );
            let text = tauri::async_runtime::block_on(async { reqwest::get(url).await?.error_for_status()?.text().await })
                .expect("sheet download");
            parse_csv(&text)
        };
        let mut perks = HashMap::new();
        read_set_bonuses(&fetch("Armor Perks"), &mut perks);
        read_spirits(&fetch("Exotic Class"), &mut perks);
        read_mods(&fetch("Armor Mods"), &mut perks);
        assert!(
            perks.len() as f64 >= TEXTS.perks.len() as f64 * 0.9,
            "the sheet reads {} entries, the copy has {}: check the sheet's layout first",
            perks.len(),
            TEXTS.perks.len()
        );
        let artifacts = read_artifacts(&fetch("Artifact Perks"));
        assert!(artifacts.len() >= TEXTS.artifacts.len(), "the sheet reads {} artifacts, the copy has {}", artifacts.len(), TEXTS.artifacts.len());
        let texts = Texts { fetched: chrono::Utc::now().timestamp(), perks, artifacts };
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/data/compendium-snapshot.json");
        std::fs::write(path, serde_json::to_string_pretty(&texts).unwrap()).unwrap();
        println!("wrote {} entries, {} artifacts to {path}", texts.perks.len(), texts.artifacts.len());
    }
}
