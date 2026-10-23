import { useEffect, useState } from "react";
import type { Translate } from "./i18n";
import { call, isTauri, subscribe } from "./tauri";

export interface Player {
  membershipType: number;
  membershipId: string;
  displayName: string;
}

export interface Character {
  className: string;
  light: number;
  emblemPath: string | null;
  emblemBackgroundPath: string | null;
  /** Stat hash -> value (Weapons, Health, Class, Grenade, Super, Melee). */
  stats?: Record<string, number>;
}

export interface Activity {
  name: string;
  mode: string | null;
  startedAt: string | null;
}

export interface SessionStats {
  activities: number;
  completions: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface PartyMember {
  membershipId: string;
  displayName: string | null;
  isLeader: boolean;
  isSelf: boolean;
}

export interface Snapshot {
  status: "unconfigured" | "loading" | "ok" | "error";
  error: string | null;
  hasApiKey: boolean;
  /** The key is Radar's own (nothing to enter or change). */
  apiKeyBuiltIn?: boolean;
  player: Player | null;
  character: Character | null;
  online: boolean | null;
  activity: Activity | null;
  party: PartyMember[];
  /** Players in the current activity, matchmade ones included. */
  activityPlayers: number | null;
  session: SessionStats;
  sessionStart: number | null;
  updatedAt: number | null;
  /** Data from the previous app run, shown until the first fresh poll. */
  cached: boolean;
}

const EMPTY: Snapshot = {
  status: "unconfigured",
  error: null,
  hasApiKey: false,
  player: null,
  character: null,
  online: null,
  activity: null,
  party: [],
  activityPlayers: null,
  session: { activities: 0, completions: 0, kills: 0, deaths: 0, assists: 0 },
  sessionStart: null,
  updatedAt: null,
  cached: false,
};

// Browser-only sample data for UI work: open the page with ?mock.
const MOCK: Snapshot = {
  ...EMPTY,
  status: "ok",
  hasApiKey: true,
  player: { membershipType: 3, membershipId: "0", displayName: "Guardian#0420" },
  character: {
    className: "Warlock",
    light: 2010,
    emblemPath: null,
    emblemBackgroundPath: null,
    stats: { "2996146975": 70, "392767087": 120, "1943323491": 30, "1735777505": 100, "144602215": 30, "4244567218": 143 },
  },
  online: true,
  activity: { name: "Kontrolle", mode: "Schmelztiegel", startedAt: null },
  party: [
    { membershipId: "4611686018000000001", displayName: "Guardian#0420", isLeader: true, isSelf: true },
    { membershipId: "4611686018000000002", displayName: "Sherpa#1337", isLeader: false, isSelf: false },
    { membershipId: "4611686018000000003", displayName: "NewLight#0001", isLeader: false, isSelf: false },
  ],
  activityPlayers: 5,
  session: { activities: 6, completions: 5, kills: 87, deaths: 41, assists: 33 },
  sessionStart: Date.now() - 47 * 60_000,
  updatedAt: Date.now(),
};

const initial = !isTauri && location.search.includes("mock") ? MOCK : EMPTY;

export const BUNGIE_ORIGIN = "https://www.bungie.net";

export const PLATFORMS: Record<number, string> = {
  1: "Xbox",
  2: "PlayStation",
  3: "Steam",
  5: "Stadia",
  6: "Epic Games",
  10: "Demon",
  254: "Bungie.net",
};

export function useBungie(): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  useEffect(() => {
    void call<Snapshot>("bungie_snapshot").then((s) => s && setSnapshot(s));
    return subscribe<Snapshot>("bungie-update", setSnapshot);
  }, []);
  return snapshot;
}

export const bungie = {
  setApiKey: (key: string) => call<Snapshot>("bungie_set_api_key", { key }),
  findPlayer: (name: string) => call<Snapshot>("bungie_find_player", { name }),
  clearPlayer: () => call("bungie_clear_player"),
  refresh: () => call("bungie_refresh"),
  resetSession: () => call("bungie_reset_session"),
};

export function kd({ kills, deaths }: SessionStats): string {
  return (deaths === 0 ? kills : kills / deaths).toFixed(2);
}

/** "just now", "42 s ago", "3 min ago" in the app language. */
export function formatAgo(ts: number, now: number, t: Translate): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return t("ago.justNow");
  if (s < 60) return t("ago.seconds", { n: s });
  return t("ago.minutes", { n: Math.floor(s / 60) });
}
