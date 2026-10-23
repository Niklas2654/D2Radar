/** The demo's weapon and armor search: the app's `gear_search`
 *  (src-tauri/src/weapons.rs) over an index exported from it once
 *  (public/demo/search.json: every weapon and armor piece with the hit the
 *  app shows for it, their versions, set names and sources). Same rules:
 *  the start of a name beats a match inside it, typos still find a name
 *  (Jaro-Winkler ≥ 0.85), armor also by its set, `source:` by raid,
 *  dungeon or place, written however. */

interface SearchIndex {
  weapons: { n: string; v: number[]; hit: { weapon: { name: string } } }[];
  armor: { n: string; sets: string[]; hit: { armor: { hashes: number[] } } }[];
  /** Item hash -> its source text (lower case). */
  sources: Record<string, string>;
  /** Sources by name, with what their source texts contain. */
  table: [string, string[]][];
}

let index: Promise<SearchIndex> | null = null;
const load = () =>
  (index ??= fetch("demo/search.json")
    .then((r) => r.json() as Promise<SearchIndex>)
    .catch((): SearchIndex => ({ weapons: [], armor: [], sources: {}, table: [] })));

/** Upper case, words only (the app's `normalize`). */
const normalize = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

/** Plain letters and digits (the app's `source_key`: "xur" for Xûr). */
const sourceKey = (s: string) => s.toLowerCase().replace(/û/g, "u").replace(/[^a-z0-9]/g, "");

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

export async function gearSearch(query: string): Promise<unknown[]> {
  const db = await load();
  const lower = query.toLowerCase();
  const at = lower.indexOf("source:");
  const words = (at < 0 ? lower : lower.slice(0, at)).split(/\s+/).filter(Boolean);
  let wanted: string[][] | null = null;
  if (at >= 0) {
    // As many words after "source:" as still start a source's name.
    const rest = lower.slice(at + "source:".length).split(/\s+/).filter(Boolean);
    let key = "";
    let taken = 0;
    for (const word of rest) {
      const next = key + sourceKey(word);
      if (!db.table.some(([n]) => sourceKey(n).startsWith(next))) break;
      key = next;
      taken++;
    }
    words.push(...rest.slice(taken));
    const exact = db.table.filter(([n]) => sourceKey(n) === key).map(([, needles]) => needles);
    const starting = db.table.filter(([n]) => sourceKey(n).startsWith(key)).map(([, needles]) => needles);
    if (key) wanted = exact.length ? exact : starting;
  }
  const text = normalize(words.join(" "));
  if (!text && !wanted) return [];

  const sourced = (hashes: number[]) =>
    !wanted || wanted.some((needles) => hashes.some((h) => needles.some((n) => db.sources[h]?.includes(n))));
  const score = (name: string): number | null => {
    if (!text) return 1;
    if (name.startsWith(text)) return 2;
    if (name.includes(text)) return 1.5;
    const s = jaroWinkler(text, name);
    return s >= 0.85 ? s : null;
  };
  const limit = wanted ? 200 : 20;

  const weapons = db.weapons
    .map((w) => ({ w, s: score(w.n) }))
    .filter((x): x is { w: SearchIndex["weapons"][number]; s: number } => x.s !== null && sourced(x.w.v))
    .sort((a, b) => b.s - a.s || a.w.hit.weapon.name.localeCompare(b.w.hit.weapon.name))
    .slice(0, limit)
    .map((x) => x.w.hit);
  const armor = db.armor
    .map((a) => {
      // Its own name, or its set's ("Atheon's Memory": every piece).
      let s = score(a.n);
      if (s === null) {
        for (const set of a.sets) {
          const t = score(set);
          if (t !== null && (s === null || t > s)) s = t;
        }
      }
      return { a, s };
    })
    .filter((x): x is { a: SearchIndex["armor"][number]; s: number } => x.s !== null && sourced(x.a.hit.armor.hashes))
    .sort((a, b) => b.s - a.s || a.a.n.localeCompare(b.a.n))
    .slice(0, limit)
    .map((x) => x.a.hit);
  return [...weapons, ...armor];
}
