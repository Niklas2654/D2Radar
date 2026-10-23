import { useEffect, useSyncExternalStore } from "react";
import { call, hasBackend, isTauri, subscribe as subscribeEvent } from "./tauri";

/** A lowman or flawless run, as RaidHub picks and names it. */
export interface RaidTag {
  /** "Duo Flawless Master", "Solo Atheon". */
  label: string;
  /** The best this raid allows (RaidHub's diamond). */
  best: boolean;
  /** From a checkpoint (or of unknown start): not a full clear. */
  checkpoint: boolean;
  instanceId: string;
  /** When it was completed (ISO date). */
  date: string;
  /** A race tag (Day One, Contest, Week One, Challenge), shown first. */
  race: boolean;
  /** A race tag's activity's highest race ("Day One Contest Challenge"):
   *  its colour goes by how close to that it is. */
  raceBest?: string;
  /** The feats its run had on (shown as small icons on it). */
  feats?: { name: string; icon: string | null; description: string }[];
  /** A lowman's: the classes it was made on (one symbol each). */
  classes?: ("titan" | "hunter" | "warlock")[];
  /** A lowman's: per class its newest run of it, the newest first. */
  runs?: { class: "titan" | "hunter" | "warlock"; instanceId: string; date: string }[];
}

export interface RaidFullClears {
  name: string;
  fullClears: number;
  bestSeconds: number | null;
  tags: RaidTag[];
}

export interface FullClearStats {
  fullClears: number;
  raids: RaidFullClears[];
  sumOfBestSeconds: number | null;
  /** Each dungeon's and exotic mission's best full-clear time (no
   *  checkpoint run), by name. */
  bestFullSeconds?: Record<string, number>;
  raidsWithBest: number;
  /** Completions whose start can't be told (not counted as full clears). */
  unknownStart: number;
  /** Dungeons: solo flawless runs and day-one clears. */
  dungeons: { name: string; tags: RaidTag[] }[];
  /** Exotic missions: the same (no race; older data: missing). */
  exotics?: { name: string; tags: RaidTag[] }[];
  /** While loading: the list items still waiting for reports. */
  pending?: string[];
}

interface Entry {
  stats: FullClearStats | null;
  /** While loading: what's known so far (each list item as it's done). */
  partial: FullClearStats | null;
  /** Raid reports loaded so far on a first (slow) load. */
  progress: { done: number; total: number } | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: Entry = { stats: null, partial: null, progress: null, loading: false, error: null };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function set(id: string, patch: Partial<Entry>) {
  entries.set(id, { ...(entries.get(id) ?? EMPTY), ...patch });
  version++;
  listeners.forEach((l) => l());
}

subscribeEvent<{ membershipId: string; done: number; total: number }>("fullclears-progress", (p) =>
  set(p.membershipId, { progress: { done: p.done, total: p.total } }),
);
subscribeEvent<{ membershipId: string; stats: FullClearStats }>("fullclears-partial", (p) => {
  // A late one after the result: not over it.
  if (!entries.get(p.membershipId)?.stats) set(p.membershipId, { partial: p.stats });
});

const MOCK = !isTauri && location.search.includes("mock");

function mockStats(id: string): FullClearStats {
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    fullClears: [8, 60, 140, 401, 620, 1050][seed % 6],
    raids: [
      { name: "Wurzel der Albträume", fullClears: 120, bestSeconds: 1_134, tags: [{ label: "Solo Flawless", best: true, checkpoint: false, race: false, instanceId: "1", date: "2026-01-16T20:00:00Z" }, { label: "Duo Flawless Master", best: true, checkpoint: false, race: false, instanceId: "2", date: "2026-01-11T20:00:00Z" }] },
      { name: "Gläserne Kammer", fullClears: 41, bestSeconds: 1_512, tags: [{ label: "Day One", best: false, checkpoint: false, race: true, instanceId: "6", date: "2021-05-23T03:00:00Z" }, { label: "Solo Atheon", best: true, checkpoint: true, race: false, instanceId: "3", date: "2023-09-17T20:00:00Z" }, { label: "Duo Flawless Master", best: true, checkpoint: false, race: false, instanceId: "4", date: "2026-06-05T20:00:00Z" }] },
      { name: "Tiefsteinkrypta", fullClears: 33, bestSeconds: 1_689, tags: [{ label: "Trio", best: false, checkpoint: false, race: false, instanceId: "5", date: "2026-02-14T20:00:00Z" }] },
      { name: "Letzter Wunsch", fullClears: 12, bestSeconds: 2_405, tags: [] },
    ],
    sumOfBestSeconds: 6_740,
    raidsWithBest: 4,
    unknownStart: 12,
    dungeons: [
      { name: "Grube der Ketzerei", tags: [{ label: "Solo Flawless", best: true, checkpoint: false, race: false, instanceId: "7", date: "2024-02-03T20:00:00Z" }] },
      { name: "Prophezeiung", tags: [{ label: "Day One", best: false, checkpoint: false, race: true, instanceId: "8", date: "2020-06-09T21:00:00Z" }] },
    ],
  };
}

/** The error of a load Bungie didn't answer (shown translated). */
export const FULL_CLEARS_STUCK = "fullclears-stuck";

export function loadFullClears(id: string): void {
  if (!hasBackend) {
    if (MOCK) set(id, { stats: mockStats(id) });
    return;
  }
  if (entries.get(id)?.loading) return;
  set(id, { loading: true, error: null });
  // Bungie stuck: an error after a while (a reload tries again), not
  // loading forever.
  const stuck = new Promise<never>((_, reject) =>
    window.setTimeout(() => reject(FULL_CLEARS_STUCK), 180_000),
  );
  Promise.race([call<FullClearStats>("fullclears_stats", { membershipId: id }), stuck])
    .then((stats) => set(id, { stats: stats ?? null, partial: null, loading: false, progress: null }))
    .catch((e) => set(id, { loading: false, partial: null, progress: null, error: String(e) }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFullClears(id: string): Entry {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!entries.has(id)) loadFullClears(id);
  }, [id]);
  return entries.get(id) ?? EMPTY;
}
