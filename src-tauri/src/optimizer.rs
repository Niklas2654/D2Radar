//! Armor optimizer: the player's armor combined into the builds that reach
//! the stats asked for, the way D2ArmorPicker does it, on Radar's own data.
//!
//! The search (`search`) knows nothing of Bungie: pieces in, builds out.
//! `optimize_armor` loads the pieces of the account.
//!
//! The rules (Armor 3.0, Edge of Fate on):
//! - a piece's roll is its stats without its mods, tuning and masterwork;
//! - a masterwork level adds 1 to each of the three stats the piece's
//!   archetype doesn't favor (5 at most); older Armor 2.0 adds 2 to all;
//! - each piece has one general mod socket: +10 (major) or +5 (minor) to one
//!   stat;
//! - a stat counts up to 200;
//! - one exotic at most.
//!
//! Not yet: the mods' energy cost.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::fireteam::definition;
use crate::i18n::tr;
use crate::inventory::{own_profile, pick_character, session};

/// The armor stats in the character screen's order: health, melee,
/// grenade, super, class, weapons.
pub const STATS: [u64; 6] = [392767087, 4244567218, 1735777505, 144602215, 1943323491, 2996146975];

/// Helmet, gauntlets, chest, legs, class item.
pub const SLOTS: [u64; 5] = [3448274439, 3551918588, 14239492, 20886954, 1585787867];

const MAX_STAT: i32 = 200;
const MAJOR_MOD: i32 = 10;
const MINOR_MOD: i32 = 5;
/// An artifice socket's mod; a tuning's +5 (and -5).
const ARTIFICE_MOD: i32 = 3;
const TUNING: i32 = 5;
/// Masterwork levels of Armor 3.0.
const MAX_MASTERWORK: u8 = 5;

/// One owned armor piece, as the search sees it.
#[derive(Clone, Debug)]
pub struct Piece {
    pub id: String,
    pub hash: u32,
    /// Index into `SLOTS`.
    pub slot: usize,
    pub exotic: bool,
    /// Its roll, without mods, tuning and masterwork.
    pub base: [i32; 6],
    /// Armor 3.0 (with a gear tier); else Armor 2.0.
    pub armor3: bool,
    /// Its masterwork level (0–5; Armor 2.0: 0 or 5).
    pub masterwork: u8,
    /// An exotic class item's two perks (spirits); else 0, 0.
    pub perks: [u32; 2],
    /// Its armor set (set bonuses), 0: none.
    pub set: u32,
    /// Its rarity (5 legendary, 6 exotic; less: common to rare).
    pub tier: u8,
    /// Its masterwork plug now (0: none found).
    pub masterwork_plug: u32,
    /// Its gear tier (1–5; Armor 2.0: 0): which run of masterwork steps it takes.
    pub gear_tier: u8,
    /// Armor 2.0 with an artifice socket (a +3 of its own).
    pub artifice: bool,
    /// Tier 5: the stat its tuning raises (its Tuned stat), and per other
    /// stat the tuning plug taking 5 from it (0: none).
    pub tuned: Option<usize>,
    pub tunings: [u32; 6],
    /// Its stats in game now (mods, tuning and masterwork as they are).
    pub now: [i32; 6],
    /// Its stat plugs in now: general-socket mods, an artifice +3, its
    /// tuning (each with its plug's hash).
    pub mods_now: Vec<StatMod>,
}

impl Piece {
    /// Its stats with the masterwork it has, or full with `assume`.
    fn stats(&self, assume: bool) -> [i32; 6] {
        let level = if assume { MAX_MASTERWORK } else { self.masterwork };
        let mut out = self.base;
        if level == 0 {
            return out;
        }
        if self.armor3 {
            // The three stats it doesn't roll in.
            for s in out.iter_mut().filter(|s| **s == 0) {
                *s += level as i32;
            }
        } else if level == MAX_MASTERWORK {
            out.iter_mut().for_each(|s| *s += 2);
        }
        out
    }
}

/// Which exotic the build is built around.
#[derive(Clone, Debug, PartialEq)]
pub enum Exotic {
    /// Any or none.
    Any,
    None,
    /// One exotic: its item hashes (reissues and copies of other versions
    /// count as the same).
    Piece(Vec<u32>),
}

#[derive(Clone, Debug)]
pub struct Request {
    /// Each stat at least this (0–200), in `STATS` order.
    pub mins: [i32; 6],
    pub exotic: Exotic,
    /// Legendary / exotic pieces counted as fully masterworked.
    pub masterwork_legendary: bool,
    pub masterwork_exotic: bool,
    /// Stat mods may fill what's missing.
    pub mods: bool,
    /// What each piece's general mod socket may take, by slot.
    pub mod_caps: [ModCap; 5],
    /// How many builds to keep.
    pub limit: usize,
    /// For an exotic class item: the perk wanted in each column (0: any).
    pub perks: [u32; 2],
    /// Added to every build (the subclass's fragments), in `STATS` order.
    pub bonus: [i32; 6],
    /// Armor sets wanted: (set, at least this many pieces).
    pub sets: Vec<(u32, usize)>,
    /// Which armor counts at all.
    pub filter: Filter,
    /// Pieces picked by hand per slot (instance ids, `SLOTS` order): in
    /// every build, whatever the rest asks of the armor.
    pub pinned: [Option<String>; 5],
    /// Artifice and tuning counted on.
    pub extras: Extras,
    /// Given up once the counter moved past this ask's number (a newer ask
    /// came: the slider moved on), so old searches don't pile up.
    pub cancel: Option<(&'static std::sync::atomic::AtomicU64, u64)>,
}

/// Stat plugs past the general mod socket the search may count on (with
/// mods allowed).
#[derive(Clone, Copy, Debug, Default)]
pub struct Extras {
    /// Armor 2.0 pieces counted as artifice (+3) though they aren't:
    /// legendary class items, every legendary piece, exotics.
    pub artifice_class: bool,
    pub artifice_legendary: bool,
    pub artifice_exotic: bool,
    /// Tier 5 pieces' tuning: +5 to their Tuned stat, -5 from another.
    pub tuning: bool,
}

/// What a build's pieces have past the general socket, by slot.
#[derive(Clone, Copy, Debug, Default)]
struct PieceExtras {
    artifice: [bool; 5],
    tuned: [Option<usize>; 5],
}

impl PieceExtras {
    fn any(&self) -> bool {
        self.artifice.iter().any(|&a| a) || self.tuned.iter().any(Option::is_some)
    }
}

/// Which of the player's armor the search takes.
#[derive(Clone, Debug)]
pub struct Filter {
    /// Only pieces masterworked already (legendary / exotic).
    pub only_masterworked_legendary: bool,
    pub only_masterworked_exotic: bool,
    /// Older Armor 2.0 pieces (no gear tier), legendary / exotic.
    pub legacy_legendary: bool,
    pub legacy_exotic: bool,
    /// Common, uncommon and rare pieces.
    pub lower_tiers: bool,
    /// Pieces the player left out (instance ids).
    pub excluded: HashSet<String>,
}

impl Default for Filter {
    fn default() -> Self {
        Filter {
            only_masterworked_legendary: false,
            only_masterworked_exotic: false,
            legacy_legendary: true,
            legacy_exotic: true,
            lower_tiers: true,
            excluded: HashSet::new(),
        }
    }
}

impl Filter {
    fn takes(&self, p: &Piece) -> bool {
        let (only_masterworked, legacy) =
            if p.exotic { (self.only_masterworked_exotic, self.legacy_exotic) } else { (self.only_masterworked_legendary, self.legacy_legendary) };
        !self.excluded.contains(&p.id)
            && (!only_masterworked || p.masterwork >= MAX_MASTERWORK)
            && (p.armor3 || legacy)
            && (p.exotic || p.tier >= 5 || self.lower_tiers)
    }
}

/// The asks for maxima and for builds: each new one gives the older up.
static LIMITS_ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SEARCH_ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Threads for a search: half the cores (the PC stays usable meanwhile).
fn search_threads() -> usize {
    std::thread::available_parallelism().map_or(4, |n| n.get() / 2).max(1)
}

impl Request {
    /// A newer ask came: this one's result isn't wanted any more.
    fn cancelled(&self) -> bool {
        self.cancel.is_some_and(|(asked, mine)| asked.load(std::sync::atomic::Ordering::Relaxed) != mine)
    }

    /// Whether `p` counts as fully masterworked.
    fn assumes(&self, p: &Piece) -> bool {
        if p.exotic {
            self.masterwork_exotic
        } else {
            self.masterwork_legendary
        }
    }
}

/// What a piece's general mod socket may take.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModCap {
    /// A +10 or a +5.
    Any,
    /// A +5 at most.
    Minor,
    /// None.
    Empty,
}

impl Request {
    /// The mod sockets there are: (taking a +10, in all).
    fn sockets(&self) -> (i32, i32) {
        if !self.mods {
            return (0, 0);
        }
        let majors = self.mod_caps.iter().filter(|&&c| c == ModCap::Any).count() as i32;
        let all = self.mod_caps.iter().filter(|&&c| c != ModCap::Empty).count() as i32;
        (majors, all)
    }

    /// What `p` has past its general socket for this search: an artifice
    /// +3 (its own, or counted on), the stat its tuning raises.
    fn extra(&self, p: &Piece) -> (bool, Option<usize>) {
        if !self.mods {
            return (false, None);
        }
        let e = &self.extras;
        let counted = if p.exotic { e.artifice_exotic } else { e.artifice_legendary || (p.slot == 4 && e.artifice_class) };
        let artifice = !p.armor3 && (p.artifice || counted);
        let tuned = if e.tuning && p.gear_tier == 5 { p.tuned } else { None };
        (artifice, tuned)
    }

    fn extras_of(&self, pieces: &[Piece], five: [usize; 5]) -> PieceExtras {
        let mut out = PieceExtras::default();
        for (slot, &i) in five.iter().enumerate() {
            (out.artifice[slot], out.tuned[slot]) = self.extra(&pieces[i]);
        }
        out
    }
}

/// How many +10s and +5s each stat takes for its deficit, with `majors`
/// sockets taking a +10 and `all` sockets in all; None when they don't do
/// it. A remainder of 5 or less takes a +5; short of +10 sockets, a +10
/// becomes two +5s.
fn mod_plan(deficits: &[i32; 6], majors: i32, all: i32) -> Option<[(i32, i32); 6]> {
    let mut plan = [(0, 0); 6];
    for (p, &d) in plan.iter_mut().zip(deficits) {
        let d = d.max(0);
        let (tens, rest) = (d / MAJOR_MOD, d % MAJOR_MOD);
        *p = match rest {
            0 => (tens, 0),
            r if r <= MINOR_MOD => (tens, 1),
            _ => (tens + 1, 0),
        };
    }
    let mut tens: i32 = plan.iter().map(|p| p.0).sum();
    while tens > majors {
        let p = plan.iter_mut().find(|p| p.0 > 0)?;
        p.0 -= 1;
        p.1 += 2;
        tens -= 1;
    }
    let used: i32 = plan.iter().map(|p| p.0 + p.1).sum();
    (used <= all).then_some(plan)
}

/// What a stat plug of a build is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ModKind {
    /// A +10 / +5 in the general socket.
    Mod,
    /// A +3 in the artifice socket.
    Artifice,
    /// A tuning: +5 to the stat, -5 from `from`.
    Tuning,
}

/// A stat mod a build needs: which stat (index into `STATS`), how much.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct StatMod {
    pub stat: usize,
    pub value: i32,
    /// The piece it goes on (index into `SLOTS`).
    pub slot: usize,
    /// The mod item the account can insert for it (0: none found).
    pub hash: u32,
    pub kind: ModKind,
    /// A tuning: the stat it takes from.
    pub from: Option<usize>,
}

/// `mods` added to `stats` (a tuning's minus too).
fn add_mods(stats: &mut [i32; 6], mods: &[StatMod]) {
    for m in mods {
        stats[m.stat] += m.value;
        if let Some(d) = m.from {
            stats[d] -= m.value;
        }
    }
}

/// Tuning and artifice +3s toward the minimums (into `stats` and `mods`):
/// each tuning +5 to its piece's Tuned stat while that's short, from the
/// stat with the most to spare; each +3 where it saves the most; tunings
/// left over move points past 200 to their stat (still below it).
fn extra_mods(stats: &mut [i32; 6], mins: &[i32; 6], extra: &PieceExtras, mods: &mut Vec<StatMod>) {
    extra_mods_with(stats, mins, extra, |m| mods.push(m));
}

/// `extra_mods`, each plug handed to `put` (no list built: the maxima ask
/// this millions of times).
fn extra_mods_with(stats: &mut [i32; 6], mins: &[i32; 6], extra: &PieceExtras, mut put: impl FnMut(StatMod)) {
    let donor = |stats: &[i32; 6], t: usize, past: bool| {
        (0..6)
            .filter(|&d| d != t && stats[d] - TUNING >= if past { MAX_STAT } else { mins[d] })
            .max_by_key(|&d| stats[d] - mins[d])
    };
    let mut used = [false; 5];
    for slot in 0..5 {
        let Some(t) = extra.tuned[slot] else { continue };
        if stats[t] >= mins[t] {
            continue;
        }
        let Some(d) = donor(stats, t, false) else { continue };
        stats[t] += TUNING;
        stats[d] -= TUNING;
        used[slot] = true;
        put(StatMod { stat: t, value: TUNING, slot, hash: 0, kind: ModKind::Tuning, from: Some(d) });
    }
    // Steps of 5 a deficit takes.
    let units = |d: i32| (d.max(0) + MINOR_MOD - 1) / MINOR_MOD;
    for slot in (0..5).filter(|&s| extra.artifice[s]) {
        let deficit = |x: usize| mins[x] - stats[x];
        // The most steps saved, then the smallest deficit.
        let best = (0..6)
            .filter(|&x| deficit(x) > 0)
            .max_by_key(|&x| (units(deficit(x)) - units(deficit(x) - ARTIFICE_MOD), -deficit(x)));
        let Some(x) = best else { break };
        stats[x] += ARTIFICE_MOD;
        put(StatMod { stat: x, value: ARTIFICE_MOD, slot, hash: 0, kind: ModKind::Artifice, from: None });
    }
    for slot in 0..5 {
        let Some(t) = extra.tuned[slot] else { continue };
        if used[slot] || stats[t] > MAX_STAT - TUNING {
            continue;
        }
        let Some(d) = donor(stats, t, true) else { continue };
        stats[t] += TUNING;
        stats[d] -= TUNING;
        put(StatMod { stat: t, value: TUNING, slot, hash: 0, kind: ModKind::Tuning, from: Some(d) });
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    /// Instance ids in `SLOTS` order.
    pub items: Vec<String>,
    pub hashes: Vec<u32>,
    /// With masterwork and mods (uncapped), in `STATS` order.
    pub stats: [i32; 6],
    /// The mods it needs for the minimums.
    pub mods: Vec<StatMod>,
    /// General mod sockets still free.
    pub free_mods: usize,
    /// The stats counted (each up to 200).
    pub total: i32,
    /// Points past 200.
    pub waste: i32,
}

/// The mods that lift `stats` to `mins`, each on a piece whose socket takes
/// it (`caps`, by slot), or None when the sockets don't do it; the pieces'
/// tuning and artifice +3s (`extra`) first.
fn mods_for(stats: &[i32; 6], mins: &[i32; 6], caps: &[ModCap; 5], allowed: bool, extra: &PieceExtras) -> Option<Vec<StatMod>> {
    let req_caps = if allowed { *caps } else { [ModCap::Empty; 5] };
    let majors = req_caps.iter().filter(|&&c| c == ModCap::Any).count() as i32;
    let all = req_caps.iter().filter(|&&c| c != ModCap::Empty).count() as i32;
    // (A stat below 0, a fragment's minus, counts as 0, as in game.)
    let mut stats = stats.map(|s| s.max(0));
    let mut mods = Vec::new();
    if allowed && extra.any() {
        extra_mods(&mut stats, mins, extra, &mut mods);
    }
    let deficits: [i32; 6] = std::array::from_fn(|x| (mins[x] - stats[x]).max(0));
    let plan = mod_plan(&deficits, majors, all)?;
    // The +10s on the pieces taking them, then the +5s on what's left.
    let mut free: Vec<usize> = (0..5).filter(|&i| req_caps[i] == ModCap::Any).collect();
    let mut minor_only: Vec<usize> = (0..5).filter(|&i| req_caps[i] == ModCap::Minor).collect();
    for (stat, &(tens, _)) in plan.iter().enumerate() {
        for _ in 0..tens {
            let slot = free.remove(0);
            mods.push(StatMod { stat, value: MAJOR_MOD, slot, hash: 0, kind: ModKind::Mod, from: None });
        }
    }
    minor_only.append(&mut free);
    for (stat, &(_, fives)) in plan.iter().enumerate() {
        for _ in 0..fives {
            let slot = minor_only.remove(0);
            mods.push(StatMod { stat, value: MINOR_MOD, slot, hash: 0, kind: ModKind::Mod, from: None });
        }
    }
    Some(mods)
}

/// Mod sockets the deficits need at least (each takes up to 10).
fn slots_needed(stats: &[i32; 6], mins: &[i32; 6]) -> usize {
    stats.iter().zip(mins).map(|(&h, &w)| ((w - h.max(0)).max(0) as usize).div_ceil(MAJOR_MOD as usize)).sum()
}

/// Pieces no other piece of its kind beats in every stat (its kind: the
/// same exotic, or legendary): the dominated can't make a better build.
fn undominated(pieces: Vec<(usize, [i32; 6])>, of: &[Piece], req: &Request, each_exotic: bool) -> Vec<(usize, [i32; 6])> {
    // Its kind: which exotic (or legendary), and which wanted set (or none):
    // a piece of a wanted set counts for more than its stats.
    let kind = |i: usize| {
        let set = if req.sets.iter().any(|&(s, _)| s == of[i].set) { of[i].set } else { 0 };
        let exotic = match (of[i].exotic, each_exotic) {
            (false, _) => 0,
            (true, true) => of[i].hash,
            (true, false) => 1,
        };
        (exotic, set)
    };
    // Another beats a piece only above what it can make of its stats: +3
    // on any with an artifice socket (with one too: above its stats). Its
    // tuning only moves 5 points (the total stays), so it doesn't count
    // here: telling pieces apart by it kept nearly every piece (half a
    // minute per search with any exotic).
    let artifice = |i: usize| req.extra(&of[i]).0;
    let beats = |a: usize, sa: &[i32; 6], b: usize, sb: &[i32; 6]| {
        let lift = if artifice(b) && !artifice(a) { ARTIFICE_MOD } else { 0 };
        kind(a) == kind(b) && sa.iter().zip(sb).all(|(x, y)| *x >= y + lift)
    };
    let mut keep: Vec<(usize, [i32; 6])> = Vec::new();
    for (i, s) in pieces {
        if keep.iter().any(|(k, ks)| beats(*k, ks, i, &s)) {
            continue;
        }
        keep.retain(|(k, ks)| !beats(i, &s, *k, ks));
        keep.push((i, s));
    }
    keep
}

/// A candidate while searching: ranked by total, then free mod sockets,
/// then the least waste; the pieces by index.
type Ranked = (i32, usize, Reverse<i32>, [usize; 5]);

/// The best builds of `pieces` for `req`, best first.
/// Per slot: the pieces that may go there for `req`, with their stats
/// (the dominated ones dropped); None when a slot has none.
/// `each_exotic`: every exotic its own kind (a list of builds shows each
/// one); else only stats count among exotics (the maxima: far fewer pieces).
fn candidates(pieces: &[Piece], req: &Request, each_exotic: bool) -> Option<Vec<Vec<(usize, [i32; 6])>>> {
    let perks_fit = |p: &Piece| p.perks.iter().zip(req.perks).all(|(&have, want)| want == 0 || have == want);
    let allowed = |p: &Piece| match &req.exotic {
        Exotic::None => !p.exotic,
        Exotic::Piece(h) => !p.exotic || (h.contains(&p.hash) && perks_fit(p)),
        Exotic::Any => true,
    };
    let mut by_slot: Vec<Vec<(usize, [i32; 6])>> = vec![Vec::new(); SLOTS.len()];
    for (i, p) in pieces.iter().enumerate().filter(|(_, p)| allowed(p) && req.filter.takes(p)) {
        by_slot[p.slot].push((i, p.stats(req.assumes(p))));
    }
    let mut by_slot: Vec<Vec<(usize, [i32; 6])>> = by_slot.into_iter().map(|s| undominated(s, pieces, req, each_exotic)).collect();
    // A piece picked by hand: only it in its slot (filters or not).
    for (slot, id) in req.pinned.iter().enumerate() {
        let Some(id) = id else { continue };
        let Some(i) = pieces.iter().position(|p| &p.id == id && p.slot == slot) else { return None };
        by_slot[slot] = vec![(i, pieces[i].stats(req.assumes(&pieces[i])))];
    }
    if by_slot.iter().any(|s| s.is_empty()) {
        return None;
    }
    // The chosen exotic must be in: only it in its slot.
    let wanted_slot = match &req.exotic {
        Exotic::Piece(h) => pieces.iter().find(|p| h.contains(&p.hash)).map(|p| p.slot),
        _ => None,
    };
    let by_slot: Vec<Vec<(usize, [i32; 6])>> = by_slot
        .into_iter()
        .enumerate()
        .map(|(slot, list)| {
            if Some(slot) == wanted_slot && req.pinned[slot].is_none() {
                list.into_iter().filter(|(i, _)| pieces[*i].exotic).collect()
            } else {
                list
            }
        })
        .collect();
    (!by_slot.iter().any(|s| s.is_empty())).then_some(by_slot)
}

/// Every allowed set of five (one exotic at most, the wanted sets in),
/// split over the threads: `each(pieces, stats)` per set, the stats with
/// the bonus and floored at 0; each thread's `T` merged with `merge`.
fn each_build<T: Send + Default>(
    pieces: &[Piece],
    req: &Request,
    by_slot: &[Vec<(usize, [i32; 6])>],
    each: impl Fn(&mut T, [usize; 5], [i32; 6]) + Sync,
    merge: impl Fn(T, T) -> T,
) -> T {
    let threads = search_threads().min(by_slot[0].len()).max(1);
    let helmets: Vec<&(usize, [i32; 6])> = by_slot[0].iter().collect();
    std::thread::scope(|scope| {
        let workers: Vec<_> = helmets
            .chunks(helmets.len().div_ceil(threads))
            .map(|chunk| {
                let each = &each;
                scope.spawn(move || {
                    let mut acc = T::default();
                    for &&(h, hs) in chunk {
                        if req.cancelled() {
                            break;
                        }
                        for &(g, gs) in &by_slot[1] {
                            for &(c, cs) in &by_slot[2] {
                                for &(l, ls) in &by_slot[3] {
                                    let exotics = [h, g, c, l].iter().filter(|&&i| pieces[i].exotic).count();
                                    if exotics > 1 {
                                        continue;
                                    }
                                    for &(k, ks) in &by_slot[4] {
                                        if exotics == 1 && pieces[k].exotic {
                                            continue;
                                        }
                                        let five = [h, g, c, l, k];
                                        if !req.sets.iter().all(|&(set, n)| five.iter().filter(|&&i| pieces[i].set == set).count() >= n) {
                                            continue;
                                        }
                                        let mut stats = req.bonus;
                                        for x in 0..6 {
                                            stats[x] = (stats[x] + hs[x] + gs[x] + cs[x] + ls[x] + ks[x]).max(0);
                                        }
                                        each(&mut acc, five, stats);
                                    }
                                }
                            }
                        }
                    }
                    acc
                })
            })
            .collect();
        workers.into_iter().map(|w| w.join().unwrap_or_default()).fold(T::default(), &merge)
    })
}

/// The most each stat can reach (up to 200) with the other stats at their
/// minimums: mods left over after those go to it. 0 for a stat no build
/// reaches anything in (no build at all: all 0).
pub fn limits(pieces: &[Piece], req: &Request) -> [i32; 6] {
    let Some(by_slot) = candidates(pieces, req, false) else { return [0; 6] };
    let (majors, all) = req.sockets();
    each_build(
        pieces,
        req,
        &by_slot,
        |best: &mut [i32; 6], five, stats| {
            let extra = req.extras_of(pieces, five);
            if extra.any() {
                for x in 0..6 {
                    let most = reach_with_extras(&stats, x, req, &extra);
                    best[x] = best[x].max(most.min(MAX_STAT));
                }
                return;
            }
            let deficits: [i32; 6] = std::array::from_fn(|x| (req.mins[x] - stats[x]).max(0));
            for x in 0..6 {
                // The others at their minimums; what's left goes to this one.
                let mut others = deficits;
                others[x] = 0;
                let Some(plan) = mod_plan(&others, majors, all) else { continue };
                let tens: i32 = plan.iter().map(|p| p.0).sum();
                let used: i32 = plan.iter().map(|p| p.0 + p.1).sum();
                let left = all - used;
                let left_tens = (majors - tens).min(left);
                let most = stats[x] + left_tens * MAJOR_MOD + (left - left_tens) * MINOR_MOD;
                best[x] = best[x].max(most.min(MAX_STAT));
            }
        },
        |a, b| std::array::from_fn(|x| a[x].max(b[x])),
    )
}

/// A loadout's own armor (`own`: instance ids) as a build, as it is in game:
/// each piece's stats now (its mods, tuning and masterwork as they are) and
/// the subclass's fragments; whether it falls short of the minimums. None
/// unless there's a piece for every slot.
fn own_build(pieces: &[Piece], own: &[String], req: &Request) -> Option<(Build, bool)> {
    let mut by_slot: [Option<&Piece>; 5] = [None; 5];
    for p in pieces.iter().filter(|p| own.contains(&p.id)) {
        by_slot[p.slot] = Some(p);
    }
    let mine: Vec<&Piece> = by_slot.into_iter().collect::<Option<_>>()?;
    let mut stats = req.bonus;
    for p in &mine {
        stats.iter_mut().zip(p.now).for_each(|(s, v)| *s += v);
    }
    stats.iter_mut().for_each(|s| *s = (*s).max(0));
    let mods: Vec<StatMod> = mine.iter().flat_map(|p| p.mods_now.iter().copied()).collect();
    let general = mods.iter().filter(|m| m.kind == ModKind::Mod).count();
    let short = (0..6).any(|i| stats[i] < req.mins[i]);
    let build = Build {
        items: mine.iter().map(|p| p.id.clone()).collect(),
        hashes: mine.iter().map(|p| p.hash).collect(),
        stats,
        mods,
        free_mods: 5usize.saturating_sub(general),
        total: stats.iter().map(|s| (*s).clamp(0, MAX_STAT)).sum(),
        waste: stats.iter().map(|s| (s - MAX_STAT).max(0)).sum(),
    };
    Some((build, short))
}

/// How far stat `x` gets with the others at their minimums, the pieces'
/// artifice +3s and tuning counted (see `limits`).
fn reach_with_extras(stats: &[i32; 6], x: usize, req: &Request, extra: &PieceExtras) -> i32 {
    let (majors, all) = req.sockets();
    let mut others = req.mins;
    others[x] = 0;
    let mut s = stats.map(|v| v.max(0));
    // Tuning and artifice first (which slots' are taken), then the stat mods.
    let (mut artifice_taken, mut tuning_taken) = ([false; 5], [false; 5]);
    if req.mods {
        extra_mods_with(&mut s, &others, extra, |m| match m.kind {
            ModKind::Artifice => artifice_taken[m.slot] = true,
            ModKind::Tuning => tuning_taken[m.slot] = true,
            ModKind::Mod => {}
        });
    }
    let deficits: [i32; 6] = std::array::from_fn(|i| (others[i] - s[i]).max(0));
    let Some(plan) = mod_plan(&deficits, majors, all) else { return 0 };
    for (v, (tens, fives)) in s.iter_mut().zip(plan) {
        *v += tens * MAJOR_MOD + fives * MINOR_MOD;
    }
    let tens: i32 = plan.iter().map(|p| p.0).sum();
    let left = all - plan.iter().map(|p| p.0 + p.1).sum::<i32>();
    let left_tens = (majors - tens).min(left);
    // Artifice +3s and tunings for it not taken go to it too (a tuning as
    // far as the other stats can give 5 each).
    let artifice = (0..5).filter(|&sl| extra.artifice[sl] && !artifice_taken[sl]).count() as i32;
    let spare: i32 = (0..6).filter(|&d| d != x).map(|d| (s[d] - req.mins[d]).max(0) / TUNING).sum();
    let tunings = ((0..5).filter(|&sl| extra.tuned[sl] == Some(x) && !tuning_taken[sl]).count() as i32).min(spare);
    s[x] + left_tens * MAJOR_MOD + (left - left_tens) * MINOR_MOD + artifice * ARTIFICE_MOD + tunings * TUNING
}

/// The best builds of `pieces` for `req`, best first.
pub fn search(pieces: &[Piece], req: &Request) -> Vec<Build> {
    let Some(by_slot) = candidates(pieces, req, true) else { return Vec::new() };
    // The most a class item adds to each stat (to give up on four pieces early).
    let mut best_class = [0; 6];
    for (_, s) in &by_slot[4] {
        for (b, v) in best_class.iter_mut().zip(s) {
            *b = (*b).max(*v);
        }
    }
    // Each artifice +3 or tuning saves one mod socket at most: the early
    // give-up allows for as many (the class item's at most one).
    let has_extra = |i: usize| {
        let (a, t) = req.extra(&pieces[i]);
        a || t.is_some()
    };
    let class_extra = by_slot[4].iter().any(|&(k, _)| has_extra(k)) as usize;
    // The most mods, artifice +3s and tuning (points past 200 moved) can
    // add to a build's total: for giving up on four pieces that can't make
    // the list even with the best class item.
    let extra_cap = req.sockets().1 * MAJOR_MOD + 5 * ARTIFICE_MOD + 5 * TUNING;
    let limit = req.limit.max(1);
    let threads = search_threads().min(by_slot[0].len()).max(1);
    let helmets: Vec<&(usize, [i32; 6])> = by_slot[0].iter().collect();
    let found: Vec<Ranked> = std::thread::scope(|scope| {
        let workers: Vec<_> = helmets
            .chunks(helmets.len().div_ceil(threads))
            .map(|chunk| {
                let by_slot = &by_slot;
                scope.spawn(move || {
                    let mut top: BinaryHeap<Reverse<Ranked>> = BinaryHeap::new();
                    for &&(h, hs) in chunk {
                        if req.cancelled() {
                            break;
                        }
                        for &(g, gs) in &by_slot[1] {
                            for &(c, cs) in &by_slot[2] {
                                for &(l, ls) in &by_slot[3] {
                                    let four = [h, g, c, l];
                                    let exotics = four.iter().filter(|&&i| pieces[i].exotic).count();
                                    if exotics > 1 {
                                        continue;
                                    }
                                    let mut sum = req.bonus;
                                    for k in 0..6 {
                                        sum[k] += hs[k] + gs[k] + cs[k] + ls[k];
                                    }
                                    let mut bound = sum;
                                    bound.iter_mut().zip(best_class).for_each(|(b, c)| *b += c);
                                    // Can't beat the worst kept, even at best: skip.
                                    let best_total = bound.iter().map(|v| (*v).clamp(0, MAX_STAT)).sum::<i32>() + extra_cap;
                                    if top.len() >= limit && top.peek().is_some_and(|Reverse(worst)| best_total < worst.0) {
                                        continue;
                                    }
                                    let spare = four.iter().filter(|&&i| has_extra(i)).count() + class_extra;
                                    if slots_needed(&bound, &req.mins) > req.sockets().1 as usize + spare {
                                        continue;
                                    }
                                    for &(k, ks) in &by_slot[4] {
                                        if exotics == 1 && pieces[k].exotic {
                                            continue;
                                        }
                                        // The wanted sets: enough pieces of each.
                                        let five = [h, g, c, l, k];
                                        if !req.sets.iter().all(|&(set, n)| five.iter().filter(|&&i| pieces[i].set == set).count() >= n) {
                                            continue;
                                        }
                                        let mut stats = sum;
                                        stats.iter_mut().zip(ks).for_each(|(s, v)| *s += v);
                                        // Below 0 (a fragment's minus) is 0 in game; mods add from there.
                                        stats.iter_mut().for_each(|s| *s = (*s).max(0));
                                        let extra = req.extras_of(pieces, five);
                                        let Some(mods) = mods_for(&stats, &req.mins, &req.mod_caps, req.mods, &extra) else { continue };
                                        add_mods(&mut stats, &mods);
                                        let total = stats.iter().map(|s| (*s).clamp(0, MAX_STAT)).sum();
                                        let waste = stats.iter().map(|s| (s - MAX_STAT).max(0)).sum();
                                        let used = mods.iter().filter(|m| m.kind == ModKind::Mod).count();
                                        let ranked = (total, req.sockets().1 as usize - used, Reverse(waste), [h, g, c, l, k]);
                                        if top.len() < limit {
                                            top.push(Reverse(ranked));
                                        } else if top.peek().is_some_and(|Reverse(worst)| ranked > *worst) {
                                            top.pop();
                                            top.push(Reverse(ranked));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    top.into_iter().map(|Reverse(r)| r).collect::<Vec<_>>()
                })
            })
            .collect();
        workers.into_iter().flat_map(|w| w.join().unwrap_or_default()).collect()
    });
    let mut found = found;
    found.sort_by(|a, b| b.cmp(a));
    found.truncate(limit);
    found
        .into_iter()
        .map(|(total, free_mods, Reverse(waste), idx)| {
            let mut stats = req.bonus;
            for &i in &idx {
                stats.iter_mut().zip(pieces[i].stats(req.assumes(&pieces[i]))).for_each(|(s, v)| *s += v);
            }
            stats.iter_mut().for_each(|s| *s = (*s).max(0));
            let extra = req.extras_of(pieces, idx);
            let mods = mods_for(&stats, &req.mins, &req.mod_caps, req.mods, &extra).unwrap_or_default();
            add_mods(&mut stats, &mods);
            Build {
                items: idx.iter().map(|&i| pieces[i].id.clone()).collect(),
                hashes: idx.iter().map(|&i| pieces[i].hash).collect(),
                stats,
                mods,
                free_mods,
                total,
                waste,
            }
        })
        .collect()
}

/* ---------- The account's armor ---------- */

/// A plug's part in a piece's stats.
#[derive(Clone, Copy)]
struct PlugPart {
    /// It counts against the roll (a mod, tuning, the masterwork).
    counts: bool,
    adds: [i32; 6],
    /// Its masterwork level, if it's the masterwork.
    level: Option<u8>,
    /// An artifice socket's plug; a tuning socket's; a general mod socket's.
    artifice: bool,
    tuning: bool,
    general: bool,
    /// Part of its roll (Armor 3.0: its three stats, e.g. +30 / +25 / +20).
    roll: bool,
}

/// A plug's part in a piece's stats.
async fn plug_part(app: &AppHandle, hash: u64) -> Option<PlugPart> {
    let def = definition(app, "DestinyInventoryItemDefinition", hash).await?;
    let category = def["plug"]["plugCategoryIdentifier"].as_str().unwrap_or_default();
    let masterwork = category.contains("masterwork");
    // Mods, tuning and the masterwork; not the intrinsic roll.
    let counts = masterwork || category.starts_with("enhancements.") || category.contains("tuning");
    let mut adds = [0; 6];
    for s in def["investmentStats"].as_array().into_iter().flatten() {
        if let Some(i) = STATS.iter().position(|&h| Some(h) == s["statTypeHash"].as_u64()) {
            adds[i] += s["value"].as_i64().unwrap_or(0) as i32;
        }
    }
    let level = masterwork.then(|| adds.iter().copied().max().unwrap_or(0).clamp(0, MAX_MASTERWORK as i32) as u8);
    Some(PlugPart { counts, adds, level, artifice: category == "enhancements.artifice", tuning: category.contains("tuning"), general: category == "enhancements.v2_general", roll: category == "armor_stats" })
}

/// An exotic class item's perk sockets: its two intrinsic ones (the
/// spirits), by index.
pub(crate) async fn spirit_sockets(app: &AppHandle, hash: u32) -> Option<[usize; 2]> {
    let def = definition(app, "DestinyInventoryItemDefinition", hash as u64).await?;
    let mut at = Vec::new();
    for (i, entry) in def["sockets"]["socketEntries"].as_array()?.iter().enumerate() {
        let Some(initial) = entry["singleInitialItemHash"].as_u64().filter(|&h| h != 0) else { continue };
        let Some(plug) = definition(app, "DestinyInventoryItemDefinition", initial).await else { continue };
        if plug["plug"]["plugCategoryIdentifier"].as_str() == Some("intrinsics") {
            at.push(i);
        }
    }
    (at.len() == 2).then(|| [at[0], at[1]])
}

/// The account's armor that `class_type` can wear (vault and characters).
async fn pieces(app: &AppHandle, profile: &Value, class_type: i64) -> Result<Vec<Piece>, String> {
    let gear = crate::weapons::gear(app).await?;
    let mut items: Vec<&Value> = profile["profileInventory"]["data"]["items"].as_array().into_iter().flatten().collect();
    for part in ["characterInventories", "characterEquipment"] {
        for inv in profile[part]["data"].as_object().into_iter().flatten().map(|(_, v)| v) {
            items.extend(inv["items"].as_array().into_iter().flatten());
        }
    }
    let components = &profile["itemComponents"];
    // (piece, its plugs)
    let mut found: Vec<(Piece, Vec<u64>)> = Vec::new();
    for item in items {
        let (Some(id), Some(hash)) = (item["itemInstanceId"].as_str(), item["itemHash"].as_u64()) else { continue };
        let Some(info) = gear.get(hash as u32) else { continue };
        let Some(slot) = SLOTS.iter().position(|&b| b == info.bucket) else { continue };
        if info.class_type != class_type && info.class_type != 3 {
            continue;
        }
        let stats = &components["stats"]["data"][id]["stats"];
        if stats[STATS[0].to_string()].is_null() {
            continue;
        }
        let mut base = [0; 6];
        for (b, h) in base.iter_mut().zip(STATS) {
            *b = stats[h.to_string()]["value"].as_i64().unwrap_or(0) as i32;
        }
        // Its plugs by socket index (an empty or disabled socket: 0).
        let plugs: Vec<u64> = components["sockets"]["data"][id]["sockets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|s| if s["isEnabled"].as_bool() == Some(false) { 0 } else { s["plugHash"].as_u64().unwrap_or(0) })
            .collect();
        let gear_tier = components["instances"]["data"][id]["gearTier"].as_i64().unwrap_or(0).clamp(0, 5) as u8;
        let armor3 = gear_tier > 0;
        let piece = Piece {
            id: id.to_string(),
            hash: hash as u32,
            slot,
            exotic: info.exotic,
            base,
            armor3,
            masterwork: 0,
            perks: [0, 0],
            set: info.set,
            tier: info.tier,
            masterwork_plug: 0,
            gear_tier,
            artifice: false,
            tuned: None,
            tunings: [0; 6],
            now: base,
            mods_now: Vec::new(),
        };
        found.push((piece, plugs));
    }
    // Exotic class items: their two perks (each version's own sockets).
    let class_items: HashSet<u32> = found.iter().filter(|(p, _)| p.exotic && p.slot == 4).map(|(p, _)| p.hash).collect();
    let mut spirits: HashMap<u32, [usize; 2]> = HashMap::new();
    for hash in class_items {
        if let Some(at) = spirit_sockets(app, hash).await {
            spirits.insert(hash, at);
        }
    }
    for (piece, plugs) in &mut found {
        if let Some(at) = spirits.get(&piece.hash) {
            piece.perks = at.map(|i| plugs.get(i).copied().unwrap_or(0) as u32);
        }
    }
    // Each plug looked up once.
    let unique: Vec<u64> = found.iter().flat_map(|(_, p)| p.iter().copied().filter(|&h| h != 0)).collect::<HashSet<_>>().into_iter().collect();
    let look_up = |hashes: Vec<u64>| async move {
        futures::future::join_all(hashes.iter().map(|&h| plug_part(app, h)))
            .await
            .into_iter()
            .zip(hashes)
            .filter_map(|(part, h)| Some((h, part?)))
            .collect::<Vec<(u64, PlugPart)>>()
    };
    let mut parts: HashMap<u64, PlugPart> = look_up(unique).await.into_iter().collect();
    // A tier 5 piece's tunings: those its tuning socket offers (component 310).
    let offered = |id: &str, plugs: &[u64]| -> Vec<u64> {
        let Some(index) = plugs.iter().position(|h| parts.get(h).is_some_and(|p| p.tuning)) else { return Vec::new() };
        components["reusablePlugs"]["data"][id]["plugs"][index.to_string()]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p["plugItemHash"].as_u64())
            .collect()
    };
    let tunings: Vec<Vec<u64>> = found.iter().map(|(p, plugs)| if p.gear_tier == 5 { offered(&p.id, plugs) } else { Vec::new() }).collect();
    let new: Vec<u64> = tunings.iter().flatten().copied().filter(|h| !parts.contains_key(h)).collect::<HashSet<_>>().into_iter().collect();
    parts.extend(look_up(new).await);
    Ok(found
        .into_iter()
        .zip(tunings)
        .map(|((mut piece, plugs), tunings)| {
            for (&h, part) in plugs.iter().filter_map(|h| Some((h, parts.get(h)?))) {
                // A stat plug in now (as the game counts it).
                let plus = part.adds.iter().position(|&a| a > 0);
                let minus = part.adds.iter().position(|&a| a < 0);
                if let Some(stat) = plus.filter(|_| part.level.is_none()) {
                    let value = part.adds[stat];
                    let (kind, from) = if part.tuning {
                        (Some(ModKind::Tuning), minus)
                    } else if part.artifice {
                        (Some(ModKind::Artifice), None)
                    } else if part.general {
                        (Some(ModKind::Mod), None)
                    } else {
                        (None, None)
                    };
                    if let Some(kind) = kind {
                        piece.mods_now.push(StatMod { stat, value, slot: piece.slot, hash: h as u32, kind, from });
                    }
                }
                if part.counts {
                    piece.base.iter_mut().zip(part.adds).for_each(|(b, a)| *b = (*b - a).max(0));
                }
                piece.artifice |= part.artifice && !piece.armor3;
                if let Some(level) = part.level {
                    piece.masterwork_plug = plugs.iter().copied().find(|h| parts.get(h).is_some_and(|p| p.level.is_some())).unwrap_or(0) as u32;
                    // Armor 2.0's masterwork adds 2: full.
                    piece.masterwork = if piece.armor3 { level } else if level > 0 { MAX_MASTERWORK } else { 0 };
                }
            }
            // Armor 3.0: its roll is its roll plugs. (Taking the plugs off its
            // stats went wrong: the masterwork lists +5 on all six stats but
            // raises only the three it doesn't roll in.)
            if piece.armor3 {
                let rolls: Vec<&PlugPart> = plugs.iter().filter_map(|h| parts.get(h)).filter(|p| p.roll).collect();
                if !rolls.is_empty() {
                    let mut base = [0; 6];
                    for r in rolls {
                        base.iter_mut().zip(r.adds).for_each(|(b, a)| *b += a);
                    }
                    piece.base = base;
                }
            }
            // "+Health / -Melee": +5 to the Tuned stat, -5 from one other.
            for h in tunings {
                let Some(part) = parts.get(&h) else { continue };
                let plus = part.adds.iter().position(|&a| a == TUNING);
                let minus = part.adds.iter().position(|&a| a == -TUNING);
                if let (Some(t), Some(d)) = (plus, minus) {
                    piece.tuned = Some(t);
                    piece.tunings[d] = h as u32;
                }
            }
            piece
        })
        .collect())
}

/// The stat mods the account can insert, cheapest first: (stat index,
/// value) -> mod item; the general socket's (+10, +5) and the artifice
/// socket's (+3, from an artifice piece).
async fn stat_mod_items(app: &AppHandle, profile: &Value, pieces: &[Piece]) -> HashMap<(usize, i32), u32> {
    let all: Vec<&Piece> = pieces.iter().collect();
    let artifice: Vec<&Piece> = pieces.iter().filter(|p| p.artifice).collect();
    let mut out = socket_mod_items(app, profile, &all, "enhancements.v2_general").await;
    out.extend(socket_mod_items(app, profile, &artifice, "enhancements.artifice").await);
    out
}

/// One mod socket's stat mods (its empty plug's `category`) the account can
/// insert, cheapest first: from its plug set as Bungie lists it for the
/// account (profile component 305), else as the manifest does.
async fn socket_mod_items(app: &AppHandle, profile: &Value, pieces: &[&Piece], category: &str) -> HashMap<(usize, i32), u32> {
    // The socket's plug set: on any of the pieces (they share it).
    let mut set = None;
    for p in pieces.iter().take(8) {
        let Some(def) = definition(app, "DestinyInventoryItemDefinition", p.hash as u64).await else { continue };
        for entry in def["sockets"]["socketEntries"].as_array().into_iter().flatten() {
            let Some(empty) = entry["singleInitialItemHash"].as_u64().filter(|&h| h != 0) else { continue };
            let Some(e) = definition(app, "DestinyInventoryItemDefinition", empty).await else { continue };
            if e["plug"]["plugCategoryIdentifier"].as_str() == Some(category) {
                set = entry["reusablePlugSetHash"].as_u64().filter(|&h| h != 0);
                break;
            }
        }
        if set.is_some() {
            break;
        }
    }
    let Some(set) = set else { return HashMap::new() };
    let key = set.to_string();
    let lists = std::iter::once(&profile["profilePlugSets"]["data"]["plugs"][&key])
        .chain(profile["characterPlugSets"]["data"].as_object().into_iter().flatten().map(|(_, c)| &c["plugs"][&key]));
    let mut hashes: Vec<u64> = lists
        .flat_map(|l| l.as_array().into_iter().flatten())
        .filter(|p| p["canInsert"].as_bool() == Some(true) && p["enabled"].as_bool() != Some(false))
        .filter_map(|p| p["plugItemHash"].as_u64())
        .collect();
    if hashes.is_empty() {
        if let Some(d) = definition(app, "DestinyPlugSetDefinition", set).await {
            hashes = d["reusablePlugItems"].as_array().into_iter().flatten().filter_map(|p| p["plugItemHash"].as_u64()).collect();
        }
    }
    hashes.sort_unstable();
    hashes.dedup();
    let defs = futures::future::join_all(hashes.iter().map(|&h| definition(app, "DestinyInventoryItemDefinition", h))).await;
    // (stat, value) -> (energy cost, hash)
    let mut best: HashMap<(usize, i32), (i64, u32)> = HashMap::new();
    for (def, &hash) in defs.iter().zip(&hashes) {
        let Some(def) = def else { continue };
        if def["plug"]["plugCategoryIdentifier"].as_str() != Some(category) {
            continue;
        }
        let stats: Vec<(usize, i32)> = def["investmentStats"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| Some((STATS.iter().position(|&h| Some(h) == s["statTypeHash"].as_u64())?, s["value"].as_i64()? as i32)))
            .filter(|&(_, v)| v != 0)
            .collect();
        let [(stat, value)] = stats[..] else { continue };
        if ![MAJOR_MOD, MINOR_MOD, ARTIFICE_MOD].contains(&value) {
            continue;
        }
        let cost = def["plug"]["energyCost"]["energyCost"].as_i64().unwrap_or(0);
        let entry = best.entry((stat, value)).or_insert((cost, hash as u32));
        if cost < entry.0 {
            *entry = (cost, hash as u32);
        }
    }
    best.into_iter().map(|(k, (_, h))| (k, h)).collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeRequest {
    /// Minimums in `STATS` order (health, melee, grenade, super, class,
    /// weapons).
    mins: [i32; 6],
    /// An exotic's item hash; 0 any or none; -1 none.
    exotic: i64,
    /// Every piece counted as fully masterworked (the older switch: both).
    #[serde(default)]
    assume_masterwork: bool,
    /// Legendary / exotic pieces counted as fully masterworked.
    #[serde(default)]
    masterwork_legendary: Option<bool>,
    #[serde(default)]
    masterwork_exotic: Option<bool>,
    mods: bool,
    /// What each piece's general mod socket may take (helmet … class item).
    #[serde(default)]
    mod_caps: Option<[ModCap; 5]>,
    limit: Option<usize>,
    /// An exotic class item's perks wanted (0: any).
    #[serde(default)]
    perks: [u32; 2],
    /// The subclass's fragments' stats, added to every build.
    #[serde(default)]
    bonus: [i32; 6],
    /// Armor sets wanted: [set hash, at least this many pieces].
    #[serde(default)]
    sets: Vec<[u32; 2]>,
    /// Which armor counts (each left out: as by default).
    #[serde(default)]
    only_masterworked_legendary: Option<bool>,
    #[serde(default)]
    only_masterworked_exotic: Option<bool>,
    #[serde(default)]
    legacy_legendary: Option<bool>,
    #[serde(default)]
    legacy_exotic: Option<bool>,
    #[serde(default)]
    lower_tiers: Option<bool>,
    /// Pieces left out (instance ids).
    #[serde(default)]
    excluded: Vec<String>,
    /// A loadout's own armor (instance ids): worked out apart, as `own`.
    #[serde(default)]
    own: Vec<String>,
    /// Pieces picked by hand per slot (instance ids, "" none).
    #[serde(default)]
    pinned: Vec<String>,
    /// Armor 2.0 counted as artifice: legendary class items, legendary
    /// pieces, exotics; tier 5 tuning counted on.
    #[serde(default)]
    artifice_class: bool,
    #[serde(default)]
    artifice_legendary: bool,
    #[serde(default)]
    artifice_exotic: bool,
    #[serde(default)]
    tuning: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeResult {
    builds: Vec<Build>,
    /// The `own` armor as a build: with the mods for the minimums, else
    /// (`own_short`: it doesn't reach them) as it is.
    own: Option<Build>,
    own_short: bool,
    /// Pieces the character can wear.
    pieces: usize,
    millis: u64,
}

/// The best builds of the account's armor for the character (else the
/// last played one).
#[tauri::command]
pub async fn optimize_armor(app: AppHandle, character_id: Option<String>, mut request: OptimizeRequest) -> Result<OptimizeResult, String> {
    let pieces = armor_of(&app, character_id.as_deref(), true).await?;
    // The account's plug sets (for the mods' items): read now, not kept.
    let s = session(&app).await?;
    let profile = own_profile(&app, &s, "305").await?;
    let own = std::mem::take(&mut request.own);
    let all = pieces.clone();
    let mut req = request_of(&app, &pieces, request).await?;
    let asked = SEARCH_ASKED.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    req.cancel = Some((&SEARCH_ASKED, asked));
    let items = stat_mod_items(&app, &profile, &pieces).await;
    drop(profile);
    let started = std::time::Instant::now();
    let count = pieces.len();
    let (mut builds, mut own, own_short) = tauri::async_runtime::spawn_blocking(move || {
        let builds = search(&pieces, &req);
        match own_build(&pieces, &own, &req) {
            Some((b, short)) => (builds, Some(b), short),
            None => (builds, None, false),
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    for b in builds.iter_mut().chain(own.iter_mut()) {
        for m in &mut b.mods {
            // (The loadout's own: the plugs in now.)
            if m.hash != 0 {
                continue;
            }
            m.hash = match m.from {
                // A tuning: the piece's own plug for it.
                Some(d) => all.iter().find(|p| Some(&p.id) == b.items.get(m.slot)).map_or(0, |p| p.tunings[d]),
                None => items.get(&(m.stat, m.value)).copied().unwrap_or(0),
            };
        }
    }
    Ok(OptimizeResult { builds, own, own_short, pieces: count, millis: started.elapsed().as_millis() as u64 })
}

/// The most each stat can reach (in `STATS` order) with the other stats at
/// their minimums, for showing on the sliders before calculating. The
/// armor is read again only every so often (it's asked on every change).
#[tauri::command]
pub async fn optimizer_limits(app: AppHandle, character_id: Option<String>, request: OptimizeRequest) -> Result<[i32; 6], String> {
    let pieces = armor_of(&app, character_id.as_deref(), false).await?;
    let mut req = request_of(&app, &pieces, request).await?;
    let asked = LIMITS_ASKED.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    req.cancel = Some((&LIMITS_ASKED, asked));
    let out = tauri::async_runtime::spawn_blocking(move || (limits(&pieces, &req), req.cancelled())).await.map_err(|e| e.to_string())?;
    if out.1 {
        return Err("superseded".into());
    }
    Ok(out.0)
}

/// The character's armor; `fresh`: read now, else as read
/// within the last two minutes (per character).
async fn armor_of(app: &AppHandle, character_id: Option<&str>, fresh: bool) -> Result<std::sync::Arc<Vec<Piece>>, String> {
    // The pieces only: the profile they're read from is dropped (a copy of
    // it per character kept ~50 MB each).
    type Cached = (std::time::Instant, std::sync::Arc<Vec<Piece>>);
    static CACHE: tokio::sync::Mutex<Option<HashMap<String, Cached>>> = tokio::sync::Mutex::const_new(None);
    let key = character_id.unwrap_or_default().to_string();
    let mut cache = CACHE.lock().await;
    let cache = cache.get_or_insert_default();
    if !fresh {
        if let Some((at, pieces)) = cache.get(&key) {
            if at.elapsed() < std::time::Duration::from_secs(120) {
                return Ok(pieces.clone());
            }
        }
    }
    let s = session(app).await?;
    let found = {
        let profile = own_profile(app, &s, "102,200,201,205,300,304,305,310").await?;
        let (_, class_type) = pick_character(&profile, character_id)?;
        pieces(app, &profile, class_type).await?
    };
    if found.is_empty() {
        return Err(tr("Keine Rüstung gefunden", "No armor found").into());
    }
    let found = std::sync::Arc::new(found);
    cache.insert(key, (std::time::Instant::now(), found.clone()));
    Ok(found)
}

/// The search's request from the app's.
async fn request_of(app: &AppHandle, pieces: &[Piece], request: OptimizeRequest) -> Result<Request, String> {
    Ok(Request {
        mins: request.mins.map(|m| m.clamp(0, MAX_STAT)),
        exotic: match request.exotic {
            0 => Exotic::Any,
            h if h < 0 => Exotic::None,
            h => {
                // Every version of it (same name).
                let gear = crate::weapons::gear(app).await?;
                let name = gear.get(h as u32).map(|g| g.name.clone()).unwrap_or_default();
                let mut same: Vec<u32> = pieces.iter().filter(|p| p.exotic && gear.get(p.hash).is_some_and(|g| g.name == name)).map(|p| p.hash).collect();
                same.push(h as u32);
                Exotic::Piece(same)
            }
        },
        masterwork_legendary: request.masterwork_legendary.unwrap_or(request.assume_masterwork),
        masterwork_exotic: request.masterwork_exotic.unwrap_or(request.assume_masterwork),
        mods: request.mods,
        mod_caps: request.mod_caps.unwrap_or([ModCap::Any; 5]),
        limit: request.limit.unwrap_or(50).min(500),
        perks: request.perks,
        bonus: request.bonus,
        sets: request.sets.iter().filter(|s| s[0] != 0 && s[1] > 0).map(|s| (s[0], s[1] as usize)).collect(),
        filter: {
            let d = Filter::default();
            Filter {
                only_masterworked_legendary: request.only_masterworked_legendary.unwrap_or(d.only_masterworked_legendary),
                only_masterworked_exotic: request.only_masterworked_exotic.unwrap_or(d.only_masterworked_exotic),
                legacy_legendary: request.legacy_legendary.unwrap_or(d.legacy_legendary),
                legacy_exotic: request.legacy_exotic.unwrap_or(d.legacy_exotic),
                lower_tiers: request.lower_tiers.unwrap_or(d.lower_tiers),
                excluded: request.excluded.iter().cloned().collect(),
            }
        },
        pinned: std::array::from_fn(|i| request.pinned.get(i).filter(|id| !id.is_empty()).cloned()),
        extras: Extras {
            artifice_class: request.artifice_class,
            artifice_legendary: request.artifice_legendary,
            artifice_exotic: request.artifice_exotic,
            tuning: request.tuning,
        },
        cancel: None,
    })
}

/// An exotic armor piece the class can wear, for picking one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExoticChoice {
    hash: u32,
    name: String,
    icon: Option<String>,
    watermark: Option<String>,
    /// Index into `SLOTS`.
    slot: usize,
    /// A copy is in the vault or on a character.
    owned: bool,
    /// What it does with the numbers (Destiny Data Compendium, English).
    exact: Option<String>,
}

/// Every exotic armor piece of the character's class, one per name (an
/// owned version first), by slot then name.
#[tauri::command]
pub async fn optimizer_exotics(app: AppHandle, character_id: Option<String>) -> Result<Vec<ExoticChoice>, String> {
    let s = session(&app).await?;
    let (profile, gear) = futures::join!(own_profile(&app, &s, "200"), crate::weapons::gear(&app));
    let (_, class_type) = pick_character(&profile?, character_id.as_deref())?;
    let gear = gear?;
    let owned: HashSet<u32> = crate::inventory::owned_items(&app).await.unwrap_or_default().iter().map(|o| o.item_hash).collect();
    let mut by_name: HashMap<String, ExoticChoice> = HashMap::new();
    for (hash, g) in gear.iter() {
        let Some(slot) = SLOTS.iter().position(|&b| b == g.bucket) else { continue };
        if !g.exotic || g.class_type != class_type || g.name.is_empty() || g.icon.is_none() {
            continue;
        }
        let choice = ExoticChoice {
            hash,
            name: g.name.clone(),
            icon: g.icon.clone(),
            watermark: g.watermark.clone(),
            slot,
            owned: owned.contains(&hash),
            exact: None,
        };
        match by_name.get(&g.name) {
            // An owned version wins over one that isn't.
            Some(have) if have.owned || !choice.owned => {}
            _ => {
                by_name.insert(g.name.clone(), choice);
            }
        }
    }
    let mut list: Vec<ExoticChoice> = by_name.into_values().collect();
    list.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.name.cmp(&b.name)));
    // Exact numbers by the English name.
    let english = futures::future::join_all(list.iter().map(|e| crate::fireteam::definition_in(&app, "DestinyInventoryItemDefinition", e.hash as u64, "en"))).await;
    for (e, def) in list.iter_mut().zip(english) {
        e.exact = def.as_ref().and_then(|d| d["displayProperties"]["name"].as_str()).and_then(crate::compendium::exact);
    }
    Ok(list)
}

/// Where the optimizer starts when a saved loadout is edited: its exotic
/// (the pick as `optimizer_exotics` lists it; -1 none), an exotic class
/// item's perks, the stats it reaches (`STATS` order: its armor with the
/// masterwork it has, plus `mods` and the subclass's `plugs`), so its own
/// build is among those found, and the set bonuses its armor has (set,
/// 2 or 4 pieces).
pub(crate) async fn edit_start(
    app: &AppHandle,
    character_id: Option<String>,
    armor: &[String],
    mods: &[u32],
    plugs: &[u32],
) -> (i64, [u32; 2], [i32; 6], Vec<(u32, usize)>) {
    let Ok(pieces) = armor_of(app, character_id.as_deref(), false).await else { return (0, [0, 0], [0; 6], Vec::new()) };
    let mut stats = [0; 6];
    let mut exotic = None;
    let mut by_set: HashMap<u32, usize> = HashMap::new();
    for p in pieces.iter().filter(|p| armor.contains(&p.id)) {
        for (s, v) in stats.iter_mut().zip(p.stats(false)) {
            *s += v;
        }
        if p.exotic {
            exotic = Some(p.clone());
        }
        if p.set != 0 {
            *by_set.entry(p.set).or_default() += 1;
        }
    }
    let mut sets: Vec<(u32, usize)> = by_set.into_iter().filter(|&(_, n)| n >= 2).map(|(set, n)| (set, if n >= 4 { 4 } else { 2 })).collect();
    sets.sort_unstable();
    for &hash in mods.iter().chain(plugs) {
        let Some(def) = definition(app, "DestinyInventoryItemDefinition", hash as u64).await else { continue };
        for st in def["investmentStats"].as_array().into_iter().flatten() {
            let Some(i) = STATS.iter().position(|&h| Some(h) == st["statTypeHash"].as_u64()) else { continue };
            stats[i] += st["value"].as_i64().unwrap_or(0) as i32;
        }
    }
    let stats = stats.map(|s| s.clamp(0, MAX_STAT));
    let Some(piece) = exotic else { return (-1, [0, 0], stats, sets) };
    // Listed by name (one version each).
    let name = crate::weapons::gear(app).await.ok().and_then(|g| g.get(piece.hash).map(|g| g.name.clone()));
    let listed = optimizer_exotics(app.clone(), character_id).await.unwrap_or_default();
    let hash = listed.iter().find(|e| Some(&e.name) == name.as_ref()).map_or(piece.hash, |e| e.hash);
    (hash as i64, piece.perks, stats, sets)
}

/* ---------- The subclass: super, abilities, aspects, fragments ---------- */

/// The socket categories of a subclass (DestinySocketCategoryDefinition):
/// each element has its own aspect and fragment ones.
const SUPER: [u64; 1] = [457473665];
const ABILITIES: [u64; 2] = [309722977, 3218807805];
const ASPECTS: [u64; 4] = [764703411, 3400923910, 2047681910, 2140934067];
const FRAGMENTS: [u64; 4] = [193371309, 2819965312, 271461480, 1313488945];

/// Something a subclass socket takes.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubclassPlug {
    hash: u32,
    name: String,
    icon: Option<String>,
    type_name: String,
    description: String,
    /// What it adds to the armor stats, in `STATS` order (fragments).
    stats: [i32; 6],
    /// An aspect's fragment slots.
    capacity: i64,
    /// An ability: which stat speeds it up ("grenade", "melee", "class",
    /// "super"; else empty), and its base cooldown in seconds (Compendium).
    ability: &'static str,
    cooldown: Option<f64>,
    /// What it does with the numbers (Destiny Data Compendium, English).
    exact: Option<String>,
}

/// One socket of the subclass.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubclassSocket {
    index: usize,
    /// "super", "abilities", "aspects" or "fragments".
    kind: &'static str,
    /// Its empty plug (an aspect or fragment socket left empty).
    empty: u32,
    /// What's in it now.
    current: u32,
    /// What the character can put in.
    options: Vec<SubclassPlug>,
}

async fn subclass_plug(app: &AppHandle, hash: u64) -> Option<SubclassPlug> {
    let (def, english) = futures::join!(
        definition(app, "DestinyInventoryItemDefinition", hash),
        crate::fireteam::definition_in(app, "DestinyInventoryItemDefinition", hash, "en"),
    );
    let def = def?;
    let category = def["plug"]["plugCategoryIdentifier"].as_str().unwrap_or_default();
    let ability = if category.ends_with(".grenades") {
        "grenade"
    } else if category.ends_with(".melee") {
        "melee"
    } else if category.ends_with(".class_abilities") {
        "class"
    } else if category.ends_with(".supers") {
        "super"
    } else {
        ""
    };
    let cooldown = match ability {
        "" => None,
        _ => english.as_ref().and_then(|e| e["displayProperties"]["name"].as_str()).and_then(crate::compendium::base_cooldown),
    };
    let name = def["displayProperties"]["name"].as_str().unwrap_or_default().to_string();
    if name.is_empty() {
        return None;
    }
    // A stand-in for an empty or locked socket ("Empty Fragment Socket",
    // "Locked Aspect Socket", …): not something to pick.
    let english_name = english.as_ref().and_then(|e| e["displayProperties"]["name"].as_str()).unwrap_or(&name);
    let exact = crate::compendium::exact(english_name);
    if english_name.starts_with("Empty ") || english_name.starts_with("Locked ") || english_name.ends_with(" Socket") {
        return None;
    }
    let mut stats = [0; 6];
    for st in def["investmentStats"].as_array().into_iter().flatten() {
        if let Some(i) = STATS.iter().position(|&h| Some(h) == st["statTypeHash"].as_u64()) {
            stats[i] += st["value"].as_i64().unwrap_or(0) as i32;
        }
    }
    Some(SubclassPlug {
        hash: hash as u32,
        name,
        icon: def["displayProperties"]["icon"].as_str().map(String::from),
        type_name: def["itemTypeDisplayName"].as_str().unwrap_or_default().to_string(),
        description: def["displayProperties"]["description"].as_str().unwrap_or_default().to_string(),
        stats,
        capacity: def["plug"]["energyCapacity"]["capacityValue"].as_i64().unwrap_or(0),
        ability,
        cooldown,
        exact,
    })
}

/// The profile the subclass setups are read from: asked once for all the
/// subclasses loaded together (the app loads them all ahead), kept a minute.
async fn subclass_profile(app: &AppHandle, s: &crate::inventory::Session) -> Result<std::sync::Arc<Value>, String> {
    static CACHE: tokio::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Value>)>> = tokio::sync::Mutex::const_new(None);
    let mut cache = CACHE.lock().await;
    if let Some((_, p)) = cache.as_ref().filter(|(at, _)| at.elapsed() < std::time::Duration::from_secs(60)) {
        return Ok(p.clone());
    }
    let p = std::sync::Arc::new(own_profile(app, s, "102,200,201,205,305").await?);
    *cache = Some((std::time::Instant::now(), p.clone()));
    Ok(p)
}

/// A subclass (the player's copy, by instance id): its super, abilities,
/// aspects and fragments sockets, each with what's in it now and what the
/// character can put in.
#[tauri::command]
pub async fn optimizer_subclass(app: AppHandle, character_id: Option<String>, instance_id: String) -> Result<Vec<SubclassSocket>, String> {
    let s = session(&app).await?;
    let profile = subclass_profile(&app, &s).await?;
    let profile = profile.as_ref();
    let (character, _) = pick_character(profile, character_id.as_deref())?;
    // The copy: its item hash (wherever it is) and its plugs now.
    let mut hash = None;
    for part in ["characterInventories", "characterEquipment"] {
        for inv in profile[part]["data"].as_object().into_iter().flatten().map(|(_, v)| v) {
            for item in inv["items"].as_array().into_iter().flatten() {
                if item["itemInstanceId"].as_str() == Some(instance_id.as_str()) {
                    hash = item["itemHash"].as_u64();
                }
            }
        }
    }
    let hash = hash.ok_or(tr("Subklasse nicht gefunden", "Subclass not found"))?;
    let now: Vec<u64> = profile["itemComponents"]["sockets"]["data"][&instance_id]["sockets"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|x| x["plugHash"].as_u64().unwrap_or(0))
        .collect();
    let def = definition(&app, "DestinyInventoryItemDefinition", hash).await.ok_or(tr("Subklasse nicht gefunden", "Subclass not found"))?;
    let entries = def["sockets"]["socketEntries"].as_array().cloned().unwrap_or_default();
    let mut wanted: Vec<(usize, &'static str)> = Vec::new();
    for cat in def["sockets"]["socketCategories"].as_array().into_iter().flatten() {
        let Some(category) = cat["socketCategoryHash"].as_u64() else { continue };
        let kind = if SUPER.contains(&category) {
            "super"
        } else if ABILITIES.contains(&category) {
            "abilities"
        } else if ASPECTS.contains(&category) {
            "aspects"
        } else if FRAGMENTS.contains(&category) {
            "fragments"
        } else {
            continue;
        };
        for i in cat["socketIndexes"].as_array().into_iter().flatten().filter_map(|i| i.as_u64()) {
            wanted.push((i as usize, kind));
        }
    }
    // A plug set as Bungie lists it for the player: (listed as usable,
    // listed as locked). Its list leaves out plugs the player has (Gambler's
    // Dodge on an Arc hunter), so it only adds to the manifest's and takes
    // out what it says is locked. (Not "canInsert": Bungie says no to most
    // abilities there, e.g. for a subclass not equipped.)
    let listed = |set: u64| -> (Vec<u64>, HashSet<u64>) {
        let key = set.to_string();
        let mut usable = Vec::new();
        let mut locked = HashSet::new();
        for p in std::iter::once(&profile["profilePlugSets"]["data"]["plugs"][&key])
            .chain(std::iter::once(&profile["characterPlugSets"]["data"][&character]["plugs"][&key]))
            .flat_map(|l| l.as_array().into_iter().flatten())
        {
            let Some(h) = p["plugItemHash"].as_u64() else { continue };
            if p["enabled"].as_bool() == Some(false) {
                locked.insert(h);
            } else {
                usable.push(h);
            }
        }
        (usable, locked)
    };
    let mut out = Vec::new();
    let mut known: HashMap<u64, Option<SubclassPlug>> = HashMap::new();
    for (index, kind) in wanted {
        let entry = &entries[index];
        // An aspect or fragment socket starts empty (its initial plug is
        // the empty one); a super or ability socket starts with a real one
        // (Gambler's Dodge on an Arc hunter), which is an option like any.
        let empty = match kind {
            "aspects" | "fragments" => entry["singleInitialItemHash"].as_u64().unwrap_or(0),
            _ => 0,
        };
        let Some(set) = entry["reusablePlugSetHash"].as_u64().filter(|&h| h != 0) else { continue };
        // The manifest's plug set (what can roll there now), plus what
        // Bungie lists as usable, less what it lists as locked; what's in
        // it now is the player's either way.
        let (usable, locked) = listed(set);
        let mut hashes: Vec<u64> = match definition(&app, "DestinyPlugSetDefinition", set).await {
            Some(d) => d["reusablePlugItems"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["currentlyCanRoll"].as_bool() != Some(false))
                .filter_map(|p| p["plugItemHash"].as_u64())
                .collect(),
            None => Vec::new(),
        };
        hashes.extend(usable);
        hashes.retain(|h| !locked.contains(h));
        let current = now.get(index).copied().unwrap_or(0);
        if current != 0 {
            hashes.push(current);
        }
        hashes.sort_unstable();
        hashes.dedup();
        let missing: Vec<u64> = hashes.iter().copied().filter(|h| !known.contains_key(h)).collect();
        let found = futures::future::join_all(missing.iter().map(|&h| subclass_plug(&app, h))).await;
        known.extend(missing.into_iter().zip(found));
        // Not the empty plug: leaving a socket empty is "none".
        let mut options: Vec<SubclassPlug> = hashes.iter().filter(|&&h| h != empty).filter_map(|h| known.get(h).cloned().flatten()).collect();
        options.sort_by(|a, b| a.name.cmp(&b.name));
        out.push(SubclassSocket {
            index,
            kind,
            empty: empty as u32,
            current: now.get(index).copied().unwrap_or(0) as u32,
            options,
        });
    }
    Ok(out)
}

/// An armor set the character's armor has pieces of.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedSet {
    hash: u32,
    /// Name and bonuses (`pieces`: the slots owned, so a bonus within
    /// reach shows as active).
    set: crate::fireteam::ArmorSet,
    /// Slots the player has a piece of it for (most a build can have).
    slots: usize,
    /// Which (indexes into `SLOTS`): an exotic picked takes one of them.
    in_slots: Vec<usize>,
    /// Pieces owned in all.
    pieces: usize,
    /// Where its pieces come from (as the searches take them), each once.
    sources: Vec<String>,
}

/// The armor sets of the character's armor (vault included): most slots
/// covered first.
#[tauri::command]
pub async fn optimizer_sets(app: AppHandle, character_id: Option<String>) -> Result<Vec<OwnedSet>, String> {
    let s = session(&app).await?;
    let profile = own_profile(&app, &s, "102,200,201,205,300,304,305,310").await?;
    let (_, class_type) = pick_character(&profile, character_id.as_deref())?;
    let pieces = pieces(&app, &profile, class_type).await?;
    // set -> (slots covered, pieces, their item hashes)
    let mut by_set: HashMap<u32, ([bool; 5], usize, Vec<u32>)> = HashMap::new();
    for p in pieces.iter().filter(|p| p.set != 0) {
        let e = by_set.entry(p.set).or_default();
        e.0[p.slot] = true;
        e.1 += 1;
        e.2.push(p.hash);
    }
    let hashes: Vec<u32> = by_set.values().flat_map(|(_, _, h)| h.iter().copied()).collect::<HashSet<_>>().into_iter().collect();
    let sources = std::sync::Arc::new(crate::weapons::source_of(&app, &hashes).await);
    let found = futures::future::join_all(by_set.into_iter().map(|(hash, (slots, count, items))| {
        let (app, sources) = (app.clone(), sources.clone());
        async move {
            let in_slots: Vec<usize> = slots.iter().enumerate().filter(|(_, &s)| s).map(|(i, _)| i).collect();
            let slots = in_slots.len();
            let set = crate::fireteam::armor_set(&app, hash as u64, slots as u32).await?;
            let mut sources: Vec<String> = items.iter().filter_map(|h| sources.get(h).cloned()).collect();
            sources.sort();
            sources.dedup();
            Some(OwnedSet { hash, set, slots, in_slots, pieces: count, sources })
        }
    }))
    .await;
    let mut sets: Vec<OwnedSet> = found.into_iter().flatten().collect();
    sets.sort_by(|a, b| b.slots.cmp(&a.slots).then(b.pieces.cmp(&a.pieces)));
    Ok(sets)
}

/* ---------- What a build's masterworks cost ---------- */

/// An amount of a material (Glimmer, Enhancement Cores …).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    hash: u32,
    name: String,
    icon: Option<String>,
    count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upgrade {
    /// Instance id.
    id: String,
    /// Masterwork level now, and the most (5).
    level: u8,
    max: u8,
    /// Older Armor 2.0: upgraded differently (no costs given).
    legacy: bool,
    /// What the rest of the way to the most costs.
    costs: Vec<Cost>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upgrades {
    pieces: Vec<Upgrade>,
    /// All of them together.
    total: Vec<Cost>,
}

/// A masterwork plug's level (its stats' bonus), its group (the plug set
/// holds a run of levels per energy: the other stats it gives), and what
/// putting it in costs.
async fn masterwork_step(app: &AppHandle, hash: u64) -> Option<(u8, Vec<(u64, i64)>, Vec<(u32, i64)>)> {
    let def = definition(app, "DestinyInventoryItemDefinition", hash).await?;
    let mut level = 0;
    let mut group = Vec::new();
    for st in def["investmentStats"].as_array().into_iter().flatten() {
        let (Some(h), Some(v)) = (st["statTypeHash"].as_u64(), st["value"].as_i64()) else { continue };
        if STATS.contains(&h) {
            level = level.max(v.clamp(0, MAX_MASTERWORK as i64) as u8);
        } else {
            group.push((h, v));
        }
    }
    group.sort_unstable();
    let mut costs = Vec::new();
    if let Some(req) = def["plug"]["insertionMaterialRequirementHash"].as_u64().filter(|&h| h != 0) {
        if let Some(set) = definition(app, "DestinyMaterialRequirementSetDefinition", req).await {
            for m in set["materials"].as_array().into_iter().flatten() {
                let (Some(item), Some(count)) = (m["itemHash"].as_u64(), m["count"].as_i64()) else { continue };
                if count > 0 {
                    costs.push((item as u32, count));
                }
            }
        }
    }
    Some((level, group, costs))
}

/// For each piece (instance ids): its masterwork level and what getting it
/// to the most costs, from the steps in its masterwork plug set.
#[tauri::command]
pub async fn optimizer_upgrades(app: AppHandle, character_id: Option<String>, items: Vec<String>) -> Result<Upgrades, String> {
    let pieces = armor_of(&app, character_id.as_deref(), false).await?;
    let mut out = Vec::new();
    let mut total: Vec<(u32, i64)> = Vec::new();
    for id in &items {
        let Some(p) = pieces.iter().find(|p| &p.id == id) else { continue };
        let mut upgrade = Upgrade { id: id.clone(), level: p.masterwork, max: MAX_MASTERWORK, legacy: !p.armor3, costs: Vec::new() };
        if p.armor3 && p.masterwork < MAX_MASTERWORK {
            let mut sum: Vec<(u32, i64)> = Vec::new();
            // The piece's masterwork socket: its plug set's steps.
            let def = definition(&app, "DestinyInventoryItemDefinition", p.hash as u64).await;
            let mut set = None;
            for entry in def.as_ref().and_then(|d| d["sockets"]["socketEntries"].as_array()).into_iter().flatten() {
                let Some(initial) = entry["singleInitialItemHash"].as_u64().filter(|&h| h != 0) else { continue };
                let Some(plug) = definition(&app, "DestinyInventoryItemDefinition", initial).await else { continue };
                if plug["plug"]["plugCategoryIdentifier"].as_str().is_some_and(|c| c.contains("masterwork")) {
                    set = entry["reusablePlugSetHash"].as_u64().filter(|&h| h != 0);
                    break;
                }
            }
            if let Some(set) = set {
                let hashes: Vec<u64> = definition(&app, "DestinyPlugSetDefinition", set)
                    .await
                    .map(|d| d["reusablePlugItems"].as_array().into_iter().flatten().filter_map(|x| x["plugItemHash"].as_u64()).collect())
                    .unwrap_or_default();
                let steps = futures::future::join_all(hashes.iter().map(|&h| masterwork_step(&app, h))).await;
                // The set lists a run of steps (level 1 up, or 0 up) per gear
                // tier, in order; their stat groups don't tell the tiers apart.
                let mut runs: Vec<Vec<(u64, u8, Vec<(u32, i64)>)>> = Vec::new();
                for (&hash, step) in hashes.iter().zip(steps) {
                    let Some((level, _, costs)) = step else { continue };
                    match runs.last_mut() {
                        Some(run) if run.last().is_some_and(|(_, l, _)| level > *l) => run.push((hash, level, costs)),
                        _ => runs.push(vec![(hash, level, costs)]),
                    }
                }
                // The run its plug now is in (past level 0), else the one of
                // its gear tier (the runs starting at level 1, cheapest first).
                let tiered: Vec<&Vec<_>> = runs.iter().filter(|r| r.first().is_some_and(|(_, l, _)| *l >= 1)).collect();
                let run = runs
                    .iter()
                    .find(|r| p.masterwork > 0 && r.iter().any(|(h, _, _)| *h == p.masterwork_plug as u64))
                    .or_else(|| tiered.get(p.gear_tier.saturating_sub(1) as usize).copied())
                    .or(runs.first());
                for (_, level, costs) in run.into_iter().flatten() {
                    if *level > p.masterwork {
                        for &(item, count) in costs {
                            match sum.iter_mut().find(|(i, _)| *i == item) {
                                Some(e) => e.1 += count,
                                None => sum.push((item, count)),
                            }
                        }
                    }
                }
            }
            for &(item, count) in &sum {
                match total.iter_mut().find(|(i, _)| *i == item) {
                    Some(e) => e.1 += count,
                    None => total.push((item, count)),
                }
            }
            upgrade.costs = costs_of(&app, &sum).await;
        }
        out.push(upgrade);
    }
    Ok(Upgrades { pieces: out, total: costs_of(&app, &total).await })
}

/// Materials with their names and icons, Glimmer first, then by amount.
async fn costs_of(app: &AppHandle, list: &[(u32, i64)]) -> Vec<Cost> {
    let defs = futures::future::join_all(list.iter().map(|&(h, _)| definition(app, "DestinyInventoryItemDefinition", h as u64))).await;
    let mut out: Vec<Cost> = list
        .iter()
        .zip(defs)
        .map(|(&(hash, count), d)| Cost {
            hash,
            name: d.as_ref().and_then(|d| d["displayProperties"]["name"].as_str()).unwrap_or_default().to_string(),
            icon: d.as_ref().and_then(|d| d["displayProperties"]["icon"].as_str()).map(String::from),
            count,
        })
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.count));
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExoticPerks {
    /// The perks owned copies have, per column.
    columns: [Vec<crate::fireteam::ItemInfo>; 2],
    /// The pairs owned (perk hashes), to tell which go together.
    combos: Vec<[u32; 2]>,
}

/// An exotic class item's perks as the player's copies (any version) have
/// them.
#[tauri::command]
pub async fn optimizer_exotic_perks(app: AppHandle, character_id: Option<String>, hash: u32) -> Result<ExoticPerks, String> {
    let s = session(&app).await?;
    let profile = own_profile(&app, &s, "102,200,201,205,300,304,305,310").await?;
    let (_, class_type) = pick_character(&profile, character_id.as_deref())?;
    let gear = crate::weapons::gear(&app).await?;
    let name = gear.get(hash).map(|g| g.name.clone()).unwrap_or_default();
    let mut combos: Vec<[u32; 2]> = pieces(&app, &profile, class_type)
        .await?
        .into_iter()
        .filter(|p| p.exotic && p.slot == 4 && gear.get(p.hash).is_some_and(|g| g.name == name))
        .map(|p| p.perks)
        .filter(|c| c.iter().all(|&h| h != 0))
        .collect();
    combos.sort_unstable();
    combos.dedup();
    let column = |i: usize| {
        let mut hashes: Vec<u32> = combos.iter().map(|c| c[i]).collect();
        hashes.sort_unstable();
        hashes.dedup();
        hashes
    };
    let (first, second) = (column(0), column(1));
    let infos = |hashes: Vec<u32>| {
        let app = app.clone();
        async move {
            let mut list: Vec<crate::fireteam::ItemInfo> =
                futures::future::join_all(hashes.iter().map(|&h| crate::fireteam::item(&app, h as u64))).await.into_iter().flatten().collect();
            list.sort_by(|a, b| a.name.cmp(&b.name));
            list
        }
    };
    let (first, second) = futures::join!(infos(first), infos(second));
    Ok(ExoticPerks { columns: [first, second], combos })
}

/// One armor piece as the slot picker shows it on hover.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceInfo {
    /// Its stats with the masterwork it has (`STATS` order), and without it.
    stats: [i32; 6],
    base: [i32; 6],
    masterwork: u8,
    gear_tier: u8,
    /// Its armor set's name, if any.
    set: Option<String>,
    /// An exotic class item's two spirits (with their numbers).
    perks: Vec<crate::fireteam::ItemInfo>,
    /// An exotic's own perk, with the numbers (Destiny Data Compendium).
    exact: Option<String>,
    /// Its archetype (Armor 3.0: "Specialist" – its primary and secondary
    /// stat in the description).
    archetype: Option<crate::fireteam::ItemInfo>,
}

/// Piece `id`'s stats, spirits, archetype and exotic numbers.
#[tauri::command]
pub async fn optimizer_piece(app: AppHandle, character_id: Option<String>, id: String) -> Result<PieceInfo, String> {
    let pieces = armor_of(&app, character_id.as_deref(), false).await?;
    let p = pieces.iter().find(|p| p.id == id).ok_or(tr("Teil nicht gefunden", "Piece not found"))?;
    let perks = futures::future::join_all(p.perks.iter().filter(|&&h| h != 0).map(|&h| crate::fireteam::item(&app, h as u64))).await;
    let exact = if p.exotic {
        crate::fireteam::definition_in(&app, "DestinyInventoryItemDefinition", p.hash as u64, "en")
            .await
            .and_then(|d| d["displayProperties"]["name"].as_str().and_then(crate::compendium::exact))
    } else {
        None
    };
    // The archetype: the plug of that category in its sockets.
    let owned = crate::inventory::owned_items(&app).await.unwrap_or_default();
    let mut archetype = None;
    for &plug in owned.iter().find(|o| o.instance_id == id).map(|o| o.socket_plugs.as_slice()).unwrap_or_default() {
        if plug == 0 {
            continue;
        }
        if let Some(info) = crate::fireteam::item(&app, plug as u64).await.filter(|i| i.plug_category.contains("archetype")) {
            archetype = Some(info);
            break;
        }
    }
    let set = match p.set {
        0 => None,
        h => crate::fireteam::definition(&app, "DestinyEquipableItemSetDefinition", h as u64)
            .await
            .and_then(|d| d["displayProperties"]["name"].as_str().map(String::from)),
    };
    Ok(PieceInfo {
        stats: p.stats(false),
        base: p.base,
        masterwork: p.masterwork,
        gear_tier: p.gear_tier,
        set,
        perks: perks.into_iter().flatten().collect(),
        exact,
        archetype,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(id: &str, slot: usize, base: [i32; 6]) -> Piece {
        Piece { id: id.into(), hash: 1000 + slot as u32, slot, exotic: false, base, armor3: true, masterwork: 0, perks: [0, 0], set: 0, tier: 5, masterwork_plug: 0, gear_tier: 5, artifice: false, tuned: None, tunings: [0; 6], now: [0; 6], mods_now: Vec::new() }
    }

    fn exotic(id: &str, slot: usize, hash: u32, base: [i32; 6]) -> Piece {
        Piece { exotic: true, hash, ..piece(id, slot, base) }
    }

    fn req(mins: [i32; 6]) -> Request {
        Request { mins, exotic: Exotic::Any, masterwork_legendary: false, masterwork_exotic: false, mods: true, mod_caps: [ModCap::Any; 5], limit: 10, perks: [0, 0], bonus: [0; 6], sets: Vec::new(), filter: Filter::default(), pinned: Default::default(), extras: Extras::default(), cancel: None }
    }

    /// One plain piece per slot: 30 health, 25 melee, 20 grenade.
    fn plain() -> Vec<Piece> {
        (0..5).map(|s| piece(&format!("p{s}"), s, [30, 25, 20, 0, 0, 0])).collect()
    }

    #[test]
    fn masterwork_raises_the_other_three() {
        let mut p = piece("a", 0, [30, 25, 20, 0, 0, 0]);
        assert_eq!(p.stats(false), [30, 25, 20, 0, 0, 0]);
        assert_eq!(p.stats(true), [30, 25, 20, 5, 5, 5]);
        p.masterwork = 3;
        assert_eq!(p.stats(false), [30, 25, 20, 3, 3, 3]);
        p.armor3 = false;
        p.masterwork = 5;
        assert_eq!(p.stats(false), [32, 27, 22, 2, 2, 2]);
    }

    #[test]
    fn fills_with_the_fewest_mods() {
        let any = [ModCap::Any; 5];
        assert_eq!(mods_for(&[0; 6], &[0; 6], &any, true, &PieceExtras::default()), Some(vec![]));
        // 23 missing: 10, 10, then 5 for the last 3.
        let m = mods_for(&[0; 6], &[0, 0, 0, 23, 0, 0], &any, true, &PieceExtras::default()).unwrap();
        assert_eq!(m.iter().map(|m| m.value).collect::<Vec<_>>(), [10, 10, 5]);
        // 60 missing: more than five sockets.
        assert_eq!(mods_for(&[0; 6], &[60, 0, 0, 0, 0, 0], &any, true, &PieceExtras::default()), None);
        assert_eq!(mods_for(&[0; 6], &[5, 0, 0, 0, 0, 0], &any, false, &PieceExtras::default()), None);
        // Legs take a +5 at most, the class item none: 30 still goes
        // (+10 +10 +10 on helmet, arms, chest), 40 not (+10 x3, +5 on legs).
        let caps = [ModCap::Any, ModCap::Any, ModCap::Any, ModCap::Minor, ModCap::Empty];
        let m = mods_for(&[0; 6], &[0, 0, 0, 30, 0, 0], &caps, true, &PieceExtras::default()).unwrap();
        assert_eq!(m.iter().map(|m| (m.value, m.slot)).collect::<Vec<_>>(), [(10, 0), (10, 1), (10, 2)]);
        let m = mods_for(&[0; 6], &[0, 0, 0, 35, 0, 0], &caps, true, &PieceExtras::default()).unwrap();
        assert_eq!(m.last().map(|m| (m.value, m.slot)), Some((5, 3)));
        assert_eq!(mods_for(&[0; 6], &[0, 0, 0, 40, 0, 0], &caps, true, &PieceExtras::default()), None);
        // Short of +10 sockets: two +5s for a +10.
        let caps = [ModCap::Any, ModCap::Minor, ModCap::Minor, ModCap::Minor, ModCap::Empty];
        let m = mods_for(&[0; 6], &[0, 0, 0, 20, 0, 0], &caps, true, &PieceExtras::default()).unwrap();
        assert_eq!(m.iter().map(|m| m.value).sum::<i32>(), 20);
        assert!(m.iter().all(|m| m.value == 5 || m.slot == 0));
    }

    #[test]
    fn finds_a_build_with_mods() {
        // 150 health, 125 melee, 100 grenade from the pieces; 30 super needs 3 mods.
        let builds = search(&plain(), &req([150, 0, 0, 30, 0, 0]));
        assert_eq!(builds.len(), 1);
        let b = &builds[0];
        assert_eq!(b.items, ["p0", "p1", "p2", "p3", "p4"]);
        assert_eq!(b.stats, [150, 125, 100, 30, 0, 0]);
        assert_eq!(b.free_mods, 2);
        assert_eq!(b.total, 405);
        // Out of reach.
        assert!(search(&plain(), &req([200, 0, 0, 60, 0, 0])).is_empty());
    }

    #[test]
    fn artifice_and_tuning_fill_deficits() {
        let none = PieceExtras::default();
        let any = [ModCap::Any; 5];
        // 63 short of 66: one +3, no mod.
        let artifice = PieceExtras { artifice: [true, false, false, false, false], ..none };
        let m = mods_for(&[0, 0, 0, 63, 0, 0], &[0, 0, 0, 66, 0, 0], &any, true, &artifice).unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!((m[0].kind, m[0].value, m[0].stat), (ModKind::Artifice, 3, 3));
        // 8 short: a +3 and a +5 (not a +10).
        let m = mods_for(&[0; 6], &[8, 0, 0, 0, 0, 0], &any, true, &artifice).unwrap();
        assert_eq!(m.iter().map(|m| m.value).sum::<i32>(), 8);
        // Tuning: +5 to the Tuned stat from the one with the most to spare.
        let tuned = PieceExtras { tuned: [Some(0), None, None, None, None], ..none };
        let m = mods_for(&[95, 0, 0, 0, 0, 40], &[100, 0, 0, 0, 0, 30], &[ModCap::Empty; 5], true, &tuned).unwrap();
        assert_eq!((m[0].kind, m[0].stat, m[0].from), (ModKind::Tuning, 0, Some(5)));
        let mut s = [95, 0, 0, 0, 0, 40];
        add_mods(&mut s, &m);
        assert_eq!(s, [100, 0, 0, 0, 0, 35]);
        // None to spare: no tuning, and no sockets: no build.
        assert_eq!(mods_for(&[95, 0, 0, 0, 0, 30], &[100, 0, 0, 0, 0, 30], &[ModCap::Empty; 5], true, &tuned), None);
        // Points past 200 go to the Tuned stat.
        let m = mods_for(&[150, 0, 0, 0, 0, 210], &[0; 6], &any, true, &tuned).unwrap();
        assert_eq!((m[0].stat, m[0].from), (0, Some(5)));
    }

    #[test]
    fn counted_artifice_finds_more_builds() {
        let pieces: Vec<Piece> = (0..5)
            .map(|slot| {
                let mut p = piece(&format!("{slot}"), slot, [20, 0, 0, 0, 0, 10]);
                p.armor3 = false;
                p.gear_tier = 0;
                p
            })
            .collect();
        // 120 health with no stat mods: 110 (22 each), with four +3s on top.
        let r = Request { mins: [120, 0, 0, 0, 0, 0], masterwork_legendary: true, mod_caps: [ModCap::Empty; 5], ..req([0; 6]) };
        assert!(search(&pieces, &r).is_empty());
        let counted = Request { extras: Extras { artifice_legendary: true, ..Extras::default() }, ..r.clone() };
        let builds = search(&pieces, &counted);
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].stats[0], 122);
        assert_eq!(limits(&pieces, &counted)[0], 125);
    }

    #[test]
    fn pinned_pieces_are_in_every_build() {
        let pieces = plain();
        // Not the best helmet for the minimums, but picked.
        let worst = pieces.iter().filter(|p| p.slot == 0).min_by_key(|p| p.base.iter().sum::<i32>()).unwrap().id.clone();
        let mut r = req([0; 6]);
        r.pinned[0] = Some(worst.clone());
        let builds = search(&pieces, &r);
        assert!(!builds.is_empty() && builds.iter().all(|b| b.items[0] == worst));
        // A piece not there: no builds.
        r.pinned[0] = Some("nope".into());
        assert!(search(&pieces, &r).is_empty());
    }

    #[test]
    fn one_exotic_at_most() {
        let mut pieces = plain();
        pieces.push(exotic("e0", 0, 1, [40, 30, 20, 0, 0, 0]));
        pieces.push(exotic("e2", 2, 2, [40, 30, 20, 0, 0, 0]));
        let builds = search(&pieces, &req([0; 6]));
        assert!(builds.iter().all(|b| b.items.iter().filter(|i| i.starts_with('e')).count() <= 1));
        // The best has one of them.
        assert!(builds[0].items.iter().any(|i| i.starts_with('e')));
        // Built around exotic 2: it's in every build.
        let around = search(&pieces, &Request { exotic: Exotic::Piece(vec![2]), ..req([0; 6]) });
        assert!(!around.is_empty() && around.iter().all(|b| b.items[2] == "e2"));
        let none = search(&pieces, &Request { exotic: Exotic::None, ..req([0; 6]) });
        assert!(none.iter().all(|b| b.items.iter().all(|i| i.starts_with('p'))));
    }

    #[test]
    fn class_item_perks_filter_the_exotic() {
        let mut pieces = plain();
        let mut a = exotic("ea", 4, 9, [40, 30, 20, 0, 0, 0]);
        a.perks = [1, 2];
        let mut b = exotic("eb", 4, 9, [30, 25, 20, 0, 0, 0]);
        b.perks = [1, 3];
        pieces.extend([a, b]);
        let around = |perks| search(&pieces, &Request { exotic: Exotic::Piece(vec![9]), perks, ..req([0; 6]) });
        // Any perks: the better roll.
        assert_eq!(around([0, 0])[0].items[4], "ea");
        // Second perk 3: only that copy.
        assert!(around([0, 3]).iter().all(|b| b.items[4] == "eb"));
        // A pair no copy has: nothing.
        assert!(around([2, 3]).is_empty());
    }

    #[test]
    fn fragments_count_for_every_build() {
        // 30 super is out of reach without mods; fragments give +10, so two
        // mods do (+10 and +10).
        let mut r = req([0, 0, 0, 30, 0, 0]);
        r.mods = false;
        assert!(search(&plain(), &r).is_empty());
        r.mods = true;
        r.bonus = [0, 0, 0, 10, 0, -10];
        let b = &search(&plain(), &r)[0];
        assert_eq!(b.stats[3], 30);
        assert_eq!(b.free_mods, 3);
        assert_eq!(b.stats[5], 0);
    }

    #[test]
    fn wanted_sets_are_in_every_build() {
        let mut pieces = plain();
        // Two pieces of set 7, weaker than the plain ones.
        for slot in [0, 2] {
            let mut p = piece(&format!("s{slot}"), slot, [20, 20, 20, 0, 0, 0]);
            p.set = 7;
            pieces.push(p);
        }
        // Without a wish: the plain ones.
        assert!(search(&pieces, &req([0; 6])).iter().take(1).all(|b| !b.items.iter().any(|i| i.starts_with('s'))));
        // Two of set 7: both in, every build.
        let builds = search(&pieces, &Request { sets: vec![(7, 2)], ..req([0; 6]) });
        assert!(!builds.is_empty());
        assert!(builds.iter().all(|b| b.items[0] == "s0" && b.items[2] == "s2"));
        // Four of it: not owned.
        assert!(search(&pieces, &Request { sets: vec![(7, 4)], ..req([0; 6]) }).is_empty());
    }

    #[test]
    fn limits_are_what_one_stat_can_reach() {
        // 150 health, 125 melee, 100 grenade, 0 else; five mods of 10.
        assert_eq!(limits(&plain(), &req([0; 6])), [200, 175, 150, 50, 50, 50]);
        // 30 super asked takes three mods: two left for the others.
        assert_eq!(limits(&plain(), &req([0, 0, 0, 30, 0, 0])), [170, 145, 120, 50, 20, 20]);
        // Without mods: what the pieces give.
        assert_eq!(limits(&plain(), &Request { mods: false, ..req([0; 6]) }), [150, 125, 100, 0, 0, 0]);
        // 60 super is out of reach: super shows its most (50), the others
        // nothing (no build meets the 60).
        assert_eq!(limits(&plain(), &req([0, 0, 0, 60, 0, 0])), [0, 0, 0, 50, 0, 0]);
    }

    #[test]
    fn masterwork_assumed_per_kind() {
        let mut pieces = plain();
        pieces.push(exotic("e0", 0, 1, [30, 25, 20, 0, 0, 0]));
        let only = |legendary, exotic_mw| {
            let r = Request { exotic: Exotic::Piece(vec![1]), masterwork_legendary: legendary, masterwork_exotic: exotic_mw, ..req([0; 6]) };
            search(&pieces, &r)[0].stats
        };
        // Four legendaries + the exotic: +5 each to the three unrolled stats.
        assert_eq!(only(false, false)[3], 0);
        assert_eq!(only(true, false)[3], 20);
        assert_eq!(only(false, true)[3], 5);
        assert_eq!(only(true, true)[3], 25);
    }

    #[test]
    fn filters_leave_pieces_out() {
        let mut pieces = plain();
        // A better helmet that is legacy armor, not masterworked.
        let mut old = piece("old", 0, [40, 30, 25, 0, 0, 0]);
        old.armor3 = false;
        pieces.push(old);
        let best = |filter: Filter| search(&pieces, &Request { filter, ..req([0; 6]) })[0].items[0].clone();
        assert_eq!(best(Filter::default()), "old");
        assert_eq!(best(Filter { legacy_legendary: false, ..Filter::default() }), "p0");
        // Left out by hand: the next best.
        let left_out = Filter { excluded: ["old".to_string()].into(), ..Filter::default() };
        assert_eq!(best(left_out), "p0");
        // Only masterworked pieces: none of these is, so no build.
        let none = search(&pieces, &Request { filter: Filter { only_masterworked_legendary: true, ..Filter::default() }, ..req([0; 6]) });
        assert!(none.is_empty());
    }

    #[test]
    fn drops_dominated_pieces() {
        let mut pieces = plain();
        // Better than p1 in everything: p1 never shows up.
        pieces.push(piece("g1", 1, [31, 26, 21, 0, 0, 0]));
        let builds = search(&pieces, &req([0; 6]));
        assert!(builds.iter().all(|b| b.items[1] == "g1"));
        // A different strength stays.
        pieces.push(piece("s1", 1, [0, 0, 0, 30, 25, 20]));
        // 60 super: out of reach with g1's 0 (six mods), in reach with s1's 30.
        let builds = search(&pieces, &req([0, 0, 0, 60, 0, 0]));
        assert_eq!(builds[0].items[1], "s1");
    }
}

#[cfg(test)]
mod speed {
    use super::*;

    /// A full vault: 60 pieces per slot, the six archetypes' stat spreads.
    #[test]
    #[ignore = "timing: cargo test --release -- --ignored speed"]
    fn full_vault() {
        let mut seed = 7u32;
        let mut next = |n: i32| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (seed >> 16) as i32 % n
        };
        let mut pieces = Vec::new();
        for slot in 0..5 {
            for i in 0..60 {
                let mut base = [0; 6];
                let (a, b, c) = (i % 6, (i + 1 + next(4) as usize) % 6, (i + 3) % 6);
                base[a] = 25 + next(6);
                base[b] += 15 + next(6);
                base[c] += 10 + next(6);
                pieces.push(Piece { id: format!("{slot}-{i}"), hash: slot as u32, slot, exotic: false, base, armor3: true, masterwork: 5, perks: [0, 0], set: 0, tier: 5, masterwork_plug: 0, gear_tier: 5, artifice: false, tuned: None, tunings: [0; 6], now: [0; 6], mods_now: Vec::new() });
            }
        }
        let started = std::time::Instant::now();
        let builds = search(&pieces, &Request { mins: [100, 0, 0, 0, 0, 100], exotic: Exotic::None, masterwork_legendary: true, masterwork_exotic: true, mods: true, mod_caps: [ModCap::Any; 5], limit: 50, perks: [0, 0], bonus: [0; 6], sets: Vec::new(), filter: Filter::default(), pinned: Default::default(), extras: Extras::default(), cancel: None });
        println!("{} builds in {:?}", builds.len(), started.elapsed());
        assert!(!builds.is_empty());
    }
}
