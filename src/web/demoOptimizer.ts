/** The demo's loadout builder and armor optimizer (?demo): their commands
 *  answered in the browser from public/demo/opt.json (the recorded armor,
 *  weapons and subclasses, made once by a script from the recording and the
 *  game's definitions). The search is a small one of its own: every slot's
 *  most promising pieces tried together, stat mods filling what's missing,
 *  the best first – the same answers' shapes as optimizer.rs, close enough
 *  to show the page working. */

import type { ArmorSet, ItemInfo } from "../lib/fireteam";
import type { Choice } from "../lib/presets";

type Cls = "Hunter" | "Warlock" | "Titan";

interface Piece {
  id: string;
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  exotic: boolean;
  cls: Cls;
  slot: number;
  tier: number;
  mw: boolean;
  legacy: boolean;
  /** Backend order (health, melee, grenade, super, class, weapons). */
  roll: number[];
  full: number[];
  set: number;
  arch: number;
  loc: string;
  char: string | null;
  eq: boolean;
  exo?: number;
  spirits?: number[];
}

interface SetDef {
  name: string;
  perks: { required: number; name: string; description: string; icon: string | null; exact?: string }[];
}

interface Plug {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  description: string;
  stats: number[];
  capacity: number;
  ability: string;
  cooldown: number | null;
  exact: string | null;
}

interface Opt {
  pieces: Piece[];
  sets: Record<string, SetDef>;
  archetypes: Record<string, ItemInfo>;
  exotics: Record<Cls, { hash: number; name: string; icon: string | null; watermark: null; slot: number; owned: boolean; exact: string | null }[]>;
  spirits: [ItemInfo[], ItemInfo[]];
  subclasses: Record<string, { choice: Choice; sockets: { index: number; kind: string; empty: number; current: number; options: number[] }[] }[]>;
  plugs: Record<string, Plug>;
  weapons: { id: string; hash: number; name: string; icon: string | null; typeName: string; exotic: boolean; watermark: string | null; tier: number; bucket: number; loc: string }[];
  artifacts: unknown[];
}

const SUBCLASS_BUCKET = 3284755031;
const WEAPON_BUCKETS = [1498876634, 2465295065, 953998645];
const ARMOR_BUCKETS = [3448274439, 3551918588, 14239492, 20886954, 1585787867];

/** The recorded characters (the first: the one the demo shows). */
const CHARACTERS: { id: string; cls: Cls; classType: number }[] = [
  { id: "2305843009461719105", cls: "Hunter", classType: 1 },
  { id: "2305843010899358445", cls: "Warlock", classType: 2 },
  { id: "2305843009762373817", cls: "Titan", classType: 0 },
];
const character = (id: unknown) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

let loaded: Promise<Opt | null> | null = null;
const opt = () =>
  (loaded ??= fetch("demo/opt.json")
    .then((r) => (r.ok ? (r.json() as Promise<Opt>) : null))
    .catch(() => null));

/** Weapon files (public/demo/w), fetched once. */
const weaponFiles = new Map<number, Promise<WeaponFile | null>>();
interface DefPerk extends ItemInfo {
  enhanced?: ItemInfo;
}
interface WeaponFile {
  columns: { label: string; random: boolean; perks: DefPerk[] }[];
  origins?: DefPerk[];
  copies: { id: string; perks: number[]; selected: number[] }[];
}
const weaponFile = (hash: number) => {
  if (!weaponFiles.has(hash))
    weaponFiles.set(
      hash,
      fetch(`demo/w/${hash}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<WeaponFile>) : null))
        .catch(() => null),
    );
  return weaponFiles.get(hash)!;
};

/* ---------- Pieces ---------- */

/** Its masterwork level (0–5). The recorded account has nearly every piece
 *  masterworked; for the showcase about a third of the legendaries are
 *  taken as some way up (so builds have masterwork costs to show). */
const level = (p: Piece) => {
  if (p.legacy) return 0;
  const n = Number(p.id.slice(-3));
  if (!p.exotic && n % 3 === 0) return 2 + ((n >> 2) % 3);
  return p.mw ? 5 : n % 5;
};
/** Masterworked as the demo takes it. */
const mastered = (p: Piece) => !p.legacy && level(p) >= 5;

/** Its stats now: the roll, and its masterwork as far as it is. */
function now(p: Piece): number[] {
  const l = level(p);
  return p.roll.map((v, i) => v + Math.round(((p.full[i] - v) * l) / 5));
}

const choiceOf = (p: Piece, o: Opt): Choice => ({
  id: p.id,
  hash: p.hash,
  name: p.name,
  icon: p.icon,
  typeName: p.typeName,
  exotic: p.exotic,
  watermark: null,
  location: p.loc,
  tier: p.tier,
  set: p.set,
  ...(p.spirits
    ? {
        perkHashes: p.spirits,
        perks: p.spirits.map((h) => spirit(o, h)?.name ?? "").filter(Boolean),
      }
    : {}),
});

const spirit = (o: Opt, hash: number) => o.spirits[0].find((s) => s.hash === hash) ?? o.spirits[1].find((s) => s.hash === hash);

const byExoticThenName = (a: { exotic: boolean; name: string }, b: { exotic: boolean; name: string }) =>
  Number(b.exotic) - Number(a.exotic) || a.name.localeCompare(b.name);

const plugInfo = (p: Plug): ItemInfo => ({ hash: p.hash, name: p.name, icon: p.icon, typeName: p.typeName, description: p.description, exotic: false });

function setsOf(o: Opt, pieces: Piece[]): ArmorSet[] {
  const count = new Map<number, number>();
  for (const p of pieces) if (p.set) count.set(p.set, (count.get(p.set) ?? 0) + 1);
  return [...count]
    .filter(([h]) => o.sets[h])
    .map(([h, n]) => ({
      name: o.sets[h].name,
      pieces: n,
      perks: o.sets[h].perks.map((k) => ({ ...k, active: n >= k.required })),
    }));
}

/* ---------- The search ---------- */

/** Stat mod items: [stat (backend order)] -> [+5, +10]. */
const MOD_ITEMS: [number, number][] = [
  [2532323436, 1180408010], // health
  [2639422088, 4287799666], // melee
  [4021790309, 1435557120], // grenade
  [350061697, 2724608735], // super
  [1237786518, 4204488676], // class
  [1703647492, 4183296050], // weapons
];
const MAX_STAT = 200;

interface Request {
  mins: number[];
  exotic: number;
  masterworkLegendary: boolean;
  masterworkExotic: boolean;
  onlyMasterworkedLegendary: boolean;
  onlyMasterworkedExotic: boolean;
  legacyLegendary: boolean;
  legacyExotic: boolean;
  mods: boolean;
  modCaps: ("any" | "minor" | "empty")[];
  limit: number;
  perks: [number, number];
  bonus: number[];
  sets: [number, number][];
  pinned: string[];
  fixed: { general: boolean; stats: number[] }[];
  excluded: string[];
  own: string[];
}

/** What the search counts for a piece (with its masterwork as assumed). */
const counted = (p: Piece, r: Request) => ((p.exotic ? r.masterworkExotic : r.masterworkLegendary) ? p.full : now(p));

/** Every slot's pieces that may go in, and the best of them to try. */
function slotPieces(o: Opt, r: Request, cls: Cls): { all: Piece[]; tried: Piece[][] } {
  const excluded = new Set(r.excluded);
  const wanted = new Set(r.sets.map(([h]) => h));
  const exoticSlot = r.exotic > 0 ? (o.exotics[cls].find((e) => e.hash === r.exotic)?.slot ?? -1) : -1;
  const all = o.pieces.filter(
    (p) =>
      p.cls === cls &&
      !excluded.has(p.id) &&
      !(p.legacy && !(p.exotic ? r.legacyExotic : r.legacyLegendary)) &&
      !(!mastered(p) && (p.exotic ? r.onlyMasterworkedExotic : r.onlyMasterworkedLegendary)),
  );
  // How much a piece helps: its stats, those asked for more.
  const weight = r.mins.map((m) => 1 + (3 * Math.min(m, MAX_STAT)) / MAX_STAT);
  const score = (p: Piece) => counted(p, r).reduce((s, v, i) => s + v * weight[i], 0);
  const tried = [0, 1, 2, 3, 4].map((slot) => {
    const pin = r.pinned[slot] ? all.find((p) => p.id === r.pinned[slot]) : undefined;
    if (pin) return [pin];
    let here = all.filter((p) => p.slot === slot);
    if (r.exotic === -1) here = here.filter((p) => !p.exotic);
    else if (r.exotic > 0) {
      here =
        slot === exoticSlot
          ? here.filter(
              (p) => p.exo === r.exotic && r.perks.every((h, i) => !h || p.spirits?.[i] === h),
            )
          : here.filter((p) => !p.exotic);
    }
    const ranked = [...here].sort((a, b) => score(b) - score(a));
    const pick = new Set<Piece>(ranked.filter((p) => !p.exotic).slice(0, 6));
    ranked.filter((p) => p.exotic).slice(0, r.exotic > 0 ? 6 : 2).forEach((p) => pick.add(p));
    // The best for each stat on its own, and each wanted set's best.
    for (let i = 0; i < 6; i++) {
      const best = here.reduce<Piece | null>((b, p) => (!b || counted(p, r)[i] > counted(b, r)[i] ? p : b), null);
      if (best) pick.add(best);
    }
    for (const h of wanted) ranked.filter((p) => p.set === h).slice(0, 3).forEach((p) => pick.add(p));
    return [...pick];
  });
  return { all, tried };
}

/** Stat mods filling what `stats` lacks to `mins` (skipping `free` stat if
 *  set), the sockets as `caps` allow: the mods by slot, or null. */
function fill(stats: number[], mins: number[], caps: ("any" | "minor" | "empty")[], skip = -1): { stat: number; value: number; slot: number }[] | null {
  const majors: number[] = [];
  const minors: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (i === skip) continue;
    let d = mins[i] - stats[i];
    while (d > 5) {
      majors.push(i);
      d -= 10;
    }
    if (d > 0) minors.push(i);
  }
  if (majors.length === 0 && minors.length === 0) return [];
  const any = caps.map((c, s) => (c === "any" ? s : -1)).filter((s) => s >= 0);
  const minor = caps.map((c, s) => (c === "minor" ? s : -1)).filter((s) => s >= 0);
  const out: { stat: number; value: number; slot: number }[] = [];
  for (const i of majors) {
    const s = any.shift();
    if (s !== undefined) out.push({ stat: i, value: 10, slot: s });
    else if (minor.length >= 2) {
      out.push({ stat: i, value: 5, slot: minor.shift()! }, { stat: i, value: 5, slot: minor.shift()! });
    } else return null;
  }
  for (const i of minors) {
    const s = minor.shift() ?? any.shift();
    if (s === undefined) return null;
    out.push({ stat: i, value: 5, slot: s });
  }
  return out;
}

/** Each slot's socket for a stat mod: as the settings and fixed mods leave it. */
const capsOf = (r: Request): ("any" | "minor" | "empty")[] =>
  [0, 1, 2, 3, 4].map((s) => (!r.mods || r.fixed[s]?.general ? "empty" : (r.modCaps[s] ?? "any")));

/** Every combination of the slots' pieces that the exotic and the sets allow. */
function* combos(tried: Piece[][], r: Request): Generator<Piece[]> {
  const picked: Piece[] = [];
  function* go(slot: number, exotics: number): Generator<Piece[]> {
    if (slot === 5) {
      if (r.exotic > 0 && exotics !== 1) return;
      for (const [h, n] of r.sets) if (picked.filter((p) => p.set === h).length < n) return;
      yield picked;
      return;
    }
    for (const p of tried[slot]) {
      if (p.exotic && exotics > 0) continue;
      picked[slot] = p;
      yield* go(slot + 1, exotics + Number(p.exotic));
    }
  }
  yield* go(0, 0);
}

function base(pieces: Piece[], r: Request): number[] {
  const s = [...r.bonus];
  for (const p of pieces) counted(p, r).forEach((v, i) => (s[i] += v));
  r.fixed.forEach((f) => f?.stats?.forEach((v, i) => (s[i] += v)));
  return s;
}

const cache = new Map<string, unknown>();
function remember<T>(key: string, f: () => T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const v = f();
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  cache.set(key, v);
  return v;
}

function limits(o: Opt, r: Request, cls: Cls): number[] {
  const { tried } = slotPieces(o, r, cls);
  const caps = capsOf(r);
  const most = [0, 0, 0, 0, 0, 0];
  for (const pieces of combos(tried, r)) {
    const s = base(pieces, r);
    for (let i = 0; i < 6; i++) {
      const mods = fill(s, r.mins, caps, i);
      if (!mods) continue;
      // What's left over goes to this stat.
      const used = new Set(mods.map((m) => m.slot));
      const extra = caps.reduce((n, c, slot) => n + (used.has(slot) ? 0 : c === "any" ? 10 : c === "minor" ? 5 : 0), 0);
      most[i] = Math.max(most[i], Math.min(MAX_STAT, s[i] + extra));
    }
  }
  return most;
}

function search(o: Opt, r: Request, cls: Cls) {
  const started = performance.now();
  const { all, tried } = slotPieces(o, r, cls);
  const caps = capsOf(r);
  type Found = { pieces: Piece[]; stats: number[]; mods: { stat: number; value: number; slot: number }[]; total: number; free: number; waste: number };
  const best: Found[] = [];
  const limit = Math.max(1, r.limit || 30);
  const worse = (a: Found, b: Found) => a.total - b.total || a.free - b.free || b.waste - a.waste;
  for (const pieces of combos(tried, r)) {
    const s = base(pieces, r);
    const mods = fill(s, r.mins, caps);
    if (!mods) continue;
    const stats = [...s];
    for (const m of mods) stats[m.stat] += m.value;
    const found: Found = {
      pieces: [...pieces],
      stats,
      mods,
      total: stats.reduce((t, v) => t + Math.min(MAX_STAT, Math.max(0, v)), 0),
      free: caps.filter((c) => c !== "empty").length - new Set(mods.map((m) => m.slot)).size,
      waste: stats.reduce((t, v) => t + Math.max(0, v - MAX_STAT), 0),
    };
    if (best.length >= limit && worse(found, best[best.length - 1]) <= 0) continue;
    best.push(found);
    best.sort((a, b) => worse(b, a));
    if (best.length > limit) best.pop();
  }
  const build = (f: Found) => ({
    items: f.pieces.map((p) => p.id),
    hashes: f.pieces.map((p) => p.hash),
    stats: f.stats,
    mods: f.mods.map((m) => ({ ...m, hash: MOD_ITEMS[m.stat][m.value === 10 ? 1 : 0], kind: "mod" as const })),
    freeMods: f.free,
    total: f.total,
    waste: f.waste,
    pieces: f.pieces.map((p, slot) => {
      const c = counted(p, r);
      const withMods = c.map((v, i) => v + f.mods.filter((m) => m.slot === slot && m.stat === i).reduce((t, m) => t + m.value, 0) + (r.fixed[slot]?.stats?.[i] ?? 0));
      return { roll: p.roll, masterwork: c, stats: withMods };
    }),
  });
  // The loadout's own armor (editing one): as it is now.
  let own = null;
  let ownShort = false;
  const mine = [0, 1, 2, 3, 4].map((slot) => all.find((p) => p.slot === slot && r.own.includes(p.id)));
  if (mine.every(Boolean)) {
    const pieces = mine as Piece[];
    const stats = [...r.bonus];
    for (const p of pieces) now(p).forEach((v, i) => (stats[i] += v));
    ownShort = stats.some((v, i) => v < r.mins[i]);
    own = {
      items: pieces.map((p) => p.id),
      hashes: pieces.map((p) => p.hash),
      stats,
      mods: [],
      freeMods: 5,
      total: stats.reduce((t, v) => t + Math.min(MAX_STAT, Math.max(0, v)), 0),
      waste: stats.reduce((t, v) => t + Math.max(0, v - MAX_STAT), 0),
      pieces: pieces.map((p) => ({ roll: p.roll, masterwork: now(p), stats: now(p) })),
    };
  }
  return {
    builds: best.map(build),
    own,
    ownShort,
    pieces: all.length,
    millis: Math.max(1, Math.round(performance.now() - started)),
  };
}

/* ---------- Costs ---------- */

const MATERIALS = {
  glimmer: { hash: 3159615086, name: "Glimmer", icon: "/common/destiny2_content/icons/88993eaeedad32f42072df6f77f47311.png" },
  core: { hash: 3853748946, name: "Enhancement Core", icon: "/common/destiny2_content/icons/0a4eb695ed55b4e720ddc401460cc0f9.jpg" },
  prism: { hash: 4257549984, name: "Enhancement Prism", icon: "/common/destiny2_content/icons/dea2a35badf7466d4c2c2697ce6e8d87.jpg" },
  shard: { hash: 4257549985, name: "Ascendant Shard", icon: "/common/destiny2_content/icons/0271d214fc3ec91b3def799a4b286b46.jpg" },
};

/** What the masterwork steps from `from` to 5 cost (made up, in the game's spirit). */
function stepsCost(from: number) {
  const n = { glimmer: 0, core: 0, prism: 0, shard: 0 };
  for (let l = from + 1; l <= 5; l++) {
    n.glimmer += 2500 * l;
    n.core += l <= 2 ? 2 : 3;
    if (l >= 3) n.prism += l === 5 ? 2 : 1;
    if (l === 5) n.shard += 1;
  }
  return n;
}
const costsOf = (n: Record<keyof typeof MATERIALS, number>) =>
  (Object.keys(MATERIALS) as (keyof typeof MATERIALS)[]).filter((k) => n[k] > 0).map((k) => ({ ...MATERIALS[k], count: n[k] }));

/* ---------- The commands ---------- */

export async function demoOptimizer(cmd: string, args: Record<string, unknown>): Promise<{ found: boolean; value?: unknown }> {
  if (!cmd.startsWith("preset_") && !cmd.startsWith("optimiz") && cmd !== "weapon_sockets" && cmd !== "artifact_options") return { found: false };
  if (cmd === "preset_save" || cmd === "preset_edit") return { found: false };
  const o = await opt();
  if (!o) return { found: false };
  const who = character(args.characterId);
  const mine = (p: Piece) => p.cls === who.cls;
  const done = (value: unknown) => ({ found: true, value });

  switch (cmd) {
    case "artifact_options":
      return done(o.artifacts);
    case "preset_draft":
      return done({
        classType: who.classType,
        className: who.cls,
        slots: [SUBCLASS_BUCKET, ...WEAPON_BUCKETS, ...ARMOR_BUCKETS].map((bucket) => ({ bucket, item: null })),
      });
    case "preset_candidates": {
      const bucket = Number(args.bucket);
      if (bucket === SUBCLASS_BUCKET) return done((o.subclasses[who.id] ?? []).map((s) => s.choice));
      const slot = ARMOR_BUCKETS.indexOf(bucket);
      if (slot >= 0)
        return done(
          o.pieces
            .filter((p) => mine(p) && p.slot === slot)
            .map((p) => choiceOf(p, o))
            .sort(byExoticThenName),
        );
      return done(
        o.weapons
          .filter((w) => w.bucket === bucket)
          .map(
            (w): Choice => ({ id: w.id, hash: w.hash, name: w.name, icon: w.icon, typeName: w.typeName, exotic: w.exotic, watermark: w.watermark, location: w.loc, tier: w.tier }),
          )
          .sort(byExoticThenName),
      );
    }
    case "preset_preview": {
      const ids = new Set((args.items as string[] | undefined) ?? []);
      const sub = (o.subclasses[who.id] ?? []).find((s) => ids.has(s.choice.id));
      const overrides = (args.subclassPlugs as Record<string, number> | null) ?? {};
      const subclassPlugs = sub
        ? sub.sockets
            .map((s) => o.plugs[overrides[s.index] ?? s.current])
            .filter((p): p is Plug => !!p && !/empty/i.test(p.name))
            .map(plugInfo)
        : [];
      const armor = o.pieces.filter((p) => mine(p) && ids.has(p.id));
      const weapons = await Promise.all(
        o.weapons
          .filter((w) => ids.has(w.id))
          .map(async (w): Promise<ItemInfo> => {
            const f = await weaponFile(w.hash);
            const copy = f?.copies.find((c) => c.id === w.id);
            const perks = copy ? copy.selected.map((h) => perkInfo(f!, h)).filter((p): p is ItemInfo => !!p) : [];
            return { hash: w.hash, name: w.name, icon: w.icon, typeName: w.typeName, exotic: w.exotic, bucket: w.bucket, perks };
          }),
      );
      return done({
        loadout: {
          id: "preview",
          name: "",
          notes: "",
          classType: who.classType,
          className: who.cls,
          subclass: sub ? { hash: sub.choice.hash, name: sub.choice.name, icon: sub.choice.icon, typeName: sub.choice.typeName, exotic: false } : null,
          subclassPlugs,
          items: armor.map((p) => ({ hash: p.hash, name: p.name, icon: p.icon, typeName: p.typeName, exotic: p.exotic, bucket: ARMOR_BUCKETS[p.slot] })),
          mods: [],
          icon: null,
          color: null,
          issues: [],
          artifact: [],
        },
        weapons,
        armorSets: setsOf(o, armor),
      });
    }
    case "weapon_sockets": {
      const w = o.weapons.find((x) => x.id === args.instanceId);
      const f = w ? await weaponFile(w.hash) : null;
      const copy = f?.copies.find((c) => c.id === args.instanceId);
      if (!f || !copy) return done([]);
      const has = new Set(copy.perks);
      const columns = [...f.columns.filter((c) => c.random), ...(f.origins?.length ? [{ label: "Origin Trait", random: true, perks: f.origins }] : [])];
      return done(
        columns.map((c, i) => {
          const options = c.perks
            .map((p) => (p.enhanced && has.has(p.enhanced.hash) ? p.enhanced : has.has(p.hash) ? p : null))
            .filter((p): p is ItemInfo => !!p);
          const current = options.find((p) => copy.selected.includes(p.hash)) ?? null;
          const pool = c.perks.filter((p) => !options.some((x) => x.name === p.name)).map(({ enhanced: _, ...p }) => p);
          return { index: i + 1, label: c.label, current, options, pool, perk: true };
        }),
      );
    }
    case "optimizer_subclass": {
      const sub = (o.subclasses[who.id] ?? []).find((s) => s.choice.id === args.instanceId);
      return done(
        (sub?.sockets ?? []).map((s) => ({
          ...s,
          options: s.options.map((h) => o.plugs[h]).filter(Boolean),
        })),
      );
    }
    case "optimizer_sets": {
      const by = new Map<number, Piece[]>();
      for (const p of o.pieces) if (mine(p) && p.set && o.sets[p.set]) by.set(p.set, [...(by.get(p.set) ?? []), p]);
      return done(
        [...by]
          .map(([hash, ps]) => {
            const inSlots = [...new Set(ps.map((p) => p.slot))].sort();
            return {
              hash,
              set: { name: o.sets[hash].name, pieces: 0, perks: o.sets[hash].perks.map((k) => ({ ...k, active: false })) },
              slots: inSlots.length,
              inSlots,
              pieces: ps.length,
            };
          })
          .sort((a, b) => b.slots - a.slots || b.pieces - a.pieces || a.set.name.localeCompare(b.set.name)),
      );
    }
    case "optimizer_exotics": {
      const owned = new Set(o.pieces.filter(mine).map((p) => p.exo));
      return done(o.exotics[who.cls].map((e) => ({ ...e, owned: owned.has(e.hash) })));
    }
    case "optimizer_exotic_perks": {
      const seen = new Set<string>();
      const combos: [number, number][] = [];
      for (const p of o.pieces)
        if (mine(p) && p.exo === Number(args.hash) && p.spirits?.length === 2) {
          const k = p.spirits.join();
          if (!seen.has(k)) {
            seen.add(k);
            combos.push([p.spirits[0], p.spirits[1]]);
          }
        }
      return done({ columns: o.spirits, combos });
    }
    case "optimizer_limits": {
      const r = args.request as Request;
      return done(remember(`l${who.id}${JSON.stringify(r)}`, () => limits(o, r, who.cls)));
    }
    case "optimize_armor": {
      const r = args.request as Request;
      return done(remember(`s${who.id}${JSON.stringify(r)}`, () => search(o, r, who.cls)));
    }
    case "optimizer_piece": {
      const p = o.pieces.find((x) => x.id === args.id);
      if (!p) return done(null);
      return done({
        stats: now(p),
        base: p.roll,
        masterwork: level(p),
        gearTier: p.tier,
        set: p.set ? (o.sets[p.set]?.name ?? null) : null,
        perks: (p.spirits ?? []).map((h) => spirit(o, h)).filter(Boolean),
        exact: p.exo ? (o.exotics[p.cls].find((e) => e.hash === p.exo)?.exact ?? null) : null,
        archetype: o.archetypes[p.arch] ?? null,
      });
    }
    case "optimizer_upgrades": {
      const total = { glimmer: 0, core: 0, prism: 0, shard: 0 };
      const pieces = ((args.items as string[] | undefined) ?? []).flatMap((id) => {
        const p = o.pieces.find((x) => x.id === id);
        if (!p) return [];
        const n = p.legacy ? { glimmer: 0, core: 0, prism: 0, shard: 0 } : stepsCost(level(p));
        (Object.keys(total) as (keyof typeof total)[]).forEach((k) => (total[k] += n[k]));
        return [{ id, level: level(p), max: 5, legacy: p.legacy, costs: costsOf(n) }];
      });
      return done({ pieces, total: costsOf(total) });
    }
  }
  return { found: false };
}

/** A weapon's perk by hash (or its enhanced version's). */
function perkInfo(f: WeaponFile, hash: number): ItemInfo | null {
  for (const p of [...f.columns.flatMap((c) => c.perks), ...(f.origins ?? [])]) {
    if (p.hash === hash) {
      const { enhanced: _, ...plain } = p;
      return plain;
    }
    if (p.enhanced?.hash === hash) return p.enhanced;
  }
  return null;
}
