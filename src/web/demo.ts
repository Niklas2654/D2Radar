/** The website's demo (?demo): the app's commands answered from data
 *  recorded once in the real app (public/demo/data.json, the player's name
 *  replaced), so the app looks and works like the real one without a login.
 *  Anything that would change the account answers with a hint instead; what
 *  wasn't recorded answers nothing (as the app before data arrives). The
 *  autopilot (autopilot.ts) drives it until the visitor takes over. */

import { ACCENTS, updateSettings, type AccentId } from "../lib/settings";
import { emit, on } from "./events";
import { startAutopilot } from "./autopilot";
import { gearSearch } from "./demoSearch";

interface Recorded {
  cmd: string;
  args: unknown;
  result: unknown;
}

/** Commands that change something (the account, the app's settings): not
 *  in the demo. */
const ACTIONS = new Set([
  "weapon_pull",
  "armor_pull",
  "armor_set_mod",
  "loadout_set_save",
  "loadout_set_plug",
  "loadout_set_delete",
  "loadout_clear",
  "loadout_to_dim",
  "preset_save",
  "dim_loadout_apply",
  "dim_loadout_delete",
  "oauth_login",
  "oauth_logout",
  "oauth_set_client",
  "bungie_set_api_key",
  "bungie_find_player",
  "bungie_clear_player",
  "hotkey_set",
]);

const NOT_IN_DEMO = "Not in the demo – download Radar to do this with your own Guardian.";

/** JSON with sorted keys, so the same arguments give the same key. */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}

const isEmpty = (args: unknown) => !args || (typeof args === "object" && Object.keys(args as object).length === 0);

const data: Promise<{ exact: Map<string, unknown>; any: Map<string, unknown> }> = fetch("demo/data.json")
  .then((r) => r.json() as Promise<Recorded[]>)
  .catch(() => [] as Recorded[])
  .then((calls) => {
    const exact = new Map<string, unknown>();
    const any = new Map<string, unknown>();
    for (const c of calls) {
      exact.set(`${c.cmd} ${stable(c.args)}`, c.result);
      // Commands without arguments (snapshots, status): the last answer.
      if (isEmpty(c.args)) any.set(c.cmd, c.result);
    }
    return { exact, any };
  });

/** The recording's "updated" times moved to a minute ago (it's a few hours
 *  old by the time anyone sees it), and the app's own pictures ("/raids/…")
 *  found where the demo is (the website has it under /app/). */
function fresh<T>(v: T): T {
  if (Array.isArray(v)) return v.map(fresh) as T;
  if (typeof v === "string" && v.startsWith("/raids/")) return v.slice(1) as T;
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = (k === "updatedAt" || k === "fetchedAt") && typeof x === "number" ? Date.now() - 60_000 : fresh(x);
  }
  return out as T;
}

/** Exported per item (public/demo/w, /a): fetched when opened, kept. */
const files = new Map<string, Promise<unknown>>();
function file<T>(path: string): Promise<T | null> {
  if (!files.has(path)) files.set(path, fetch(`demo/${path}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return files.get(path) as Promise<T | null>;
}

interface ArmorFile {
  detail: unknown;
  copies: unknown;
  mods: unknown;
  modsByCopy: Record<string, unknown>;
  compare: unknown;
}

/** Every weapon and armor piece, as the app has them (exported from it). */
async function item(cmd: string, args: Record<string, unknown>): Promise<{ found: boolean; value?: unknown }> {
  if (cmd === "gear_search") return { found: true, value: await gearSearch(String(args.query ?? "")) };
  if (cmd === "weapon_detail") {
    const w = await file(`w/${Number(args.hash)}.json`);
    return w ? { found: true, value: w } : { found: false };
  }
  if (cmd === "clarity_perks") {
    const all = (await file<Record<string, unknown>>("clarity.json")) ?? {};
    const out: Record<string, unknown> = {};
    for (const h of (args.hashes as number[]) ?? []) if (all[h]) out[h] = all[h];
    return { found: true, value: out };
  }
  const first = Array.isArray(args.hashes) ? Number(args.hashes[0]) : Number(args.itemHash);
  if (!["armor_detail", "armor_copies", "armor_mods", "armor_compare"].includes(cmd) || !first) return { found: false };
  const a = await armorFile(first);
  if (!a) return { found: false };
  if (cmd === "armor_detail") return { found: true, value: a.detail };
  if (cmd === "armor_copies") return { found: true, value: a.copies };
  if (cmd === "armor_compare") return { found: true, value: a.compare };
  const copy = args.instanceId ? a.modsByCopy[String(args.instanceId)] : undefined;
  return { found: true, value: copy ?? a.mods };
}

/* ---------- The website's in-game preview ----------
 * The website draws a game screen; the overlay (overlay.html?demo) and the
 * inspect page (index.html?demo&inspect) lie over it. It tells them what's
 * looked at, as the app's screen reading would:
 *   { radarDemo: "detect", weapon?: hash, armor?: hashes, artifact?: name }
 *                       (nothing: nothing looked at) -> the overlay's notice
 *   { radarDemo: "inspect", same }  -> the inspect page shows it (F10)
 * and hears { radarDemo: "inspect-close" } when the page is closed. */

interface Looked {
  weapon?: number;
  armor?: number[];
  artifact?: string;
}

let inspected: { weapon: unknown; armor: unknown; guardian: null; artifact: string | null; latest: string } = {
  weapon: null,
  armor: null,
  guardian: null,
  artifact: null,
  latest: "",
};

/** The armor file of any version of a piece (kept under the first hash of
 *  its name's versions, see search.json). */
let armorKeys: Promise<Map<number, number>> | null = null;
async function armorFile(hash: number) {
  armorKeys ??= file<{ armor: { hit: { armor: { hashes: number[] } } }[] }>("search.json").then((idx) => {
    const keys = new Map<number, number>();
    for (const a of idx?.armor ?? []) for (const h of a.hit.armor.hashes) keys.set(h, a.hit.armor.hashes[0]);
    return keys;
  });
  return file<ArmorFile>(`a/${(await armorKeys).get(hash) ?? hash}.json`);
}

async function lookedAt(l: Looked) {
  const weapon = l.weapon ? await file(`w/${l.weapon}.json`) : null;
  const armor = l.armor?.length ? ((await armorFile(l.armor[0]))?.detail ?? null) : null;
  return { weapon, armor, artifact: l.artifact ?? null };
}

window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || !e.data?.radarDemo) return;
  if (e.data.radarDemo === "detect") {
    const { weapon, armor, artifact } = await lookedAt(e.data as Looked);
    emit("weapon-detected", weapon ? fresh(weapon) : null);
    emit("armor-detected", armor ? fresh(armor) : null);
    emit("artifact-present", artifact);
  }
  // The website's colour (picked in its live app): this one too, at once.
  if (e.data.radarDemo === "set-accent") {
    const accent = String(e.data.accent);
    if (accent in ACCENTS) updateSettings({ accent: accent as AccentId }, true);
    else if (/^#[0-9a-f]{6}$/i.test(accent)) updateSettings({ accent: "custom", customAccent: accent }, true);
  }
  if (e.data.radarDemo === "inspect") {
    const { weapon, armor, artifact } = await lookedAt(e.data as Looked);
    inspected = { weapon: fresh(weapon), armor: fresh(armor), guardian: null, artifact, latest: artifact ? "artifact" : "gear" };
    emit("inspect-open", null);
  }
});

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (ACTIONS.has(cmd)) throw NOT_IN_DEMO;
  if (cmd === "inspect_last") return inspected as T;
  if (cmd === "inspect_close") {
    window.parent?.postMessage({ radarDemo: "inspect-close" }, location.origin);
    return undefined;
  }
  if (cmd === "artifact_detail") {
    const all = (await file<Record<string, unknown>>("artifacts.json")) ?? {};
    return (all[String(args?.name)] ?? null) as T;
  }
  // Search and item pages: from the exported index (any item, as in the app).
  const exported = await item(cmd, args ?? {});
  if (exported.found) return fresh(exported.value) as T;
  const { exact, any } = await data;
  const key = `${cmd} ${stable(args ?? {})}`;
  if (exact.has(key)) return fresh(exact.get(key)) as T;
  if (isEmpty(args) && any.has(cmd)) return fresh(any.get(cmd)) as T;
  // A search or a player not recorded: say so where the app shows errors.
  if (cmd === "weapons_search" || cmd === "armor_search" || cmd === "gear_search") return [] as T;
  if (cmd === "fireteam_player" || cmd === "fireteam_search" || cmd === "weapon_detail" || cmd === "run_report") {
    throw NOT_IN_DEMO;
  }
  return undefined;
}

export const subscribe = on;

startAutopilot();
// Loaded: the website may send what's looked at now.
window.parent?.postMessage({ radarDemo: "backend" }, location.origin);
