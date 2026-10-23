import { useEffect, useSyncExternalStore } from "react";
import { call, hasBackend, isTauri } from "./tauri";

export interface ItemInfo {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  /** What it does (perks, exotic armor perks). */
  description?: string;
  /** Exact numbers (Destiny Data Compendium), in English. */
  exact?: string;
  exotic: boolean;
  /** 1 kinetic, 2 arc, 3 solar, 4 void, 6 stasis, 7 strand. */
  damageType?: number;
  /** Inventory bucket (slot). */
  bucket?: number;
  /** Equipped items: plugged perks (weapons) and mods. */
  perks?: ItemInfo[];
  mods?: ItemInfo[];
}

export interface ArmorSet {
  name: string;
  /** Equipped pieces of the set. */
  pieces: number;
  perks: {
    required: number;
    name: string;
    description: string;
    icon: string | null;
    active: boolean;
    /** Exact numbers (Destiny Data Compendium), in English. */
    exact?: string;
  }[];
}

export interface CharacterInfo {
  id: string;
  className: string;
  light: number;
  emblemPath: string | null;
  emblemBackgroundPath: string | null;
  /** The emblem as on the character screen: wide banner and the icon cut out. */
  emblemBanner?: string | null;
  emblemOverlay?: string | null;
  lastPlayed: string | null;
}

export interface Clears {
  name: string;
  clears: number;
  fastestMs: number | null;
  /** When it came out (newest first; none known: at the end). */
  released?: string | null;
  /** Its artwork (Bungie's PGCR image). */
  image?: string | null;
  /** The same artwork as an older one's ("Epic"): a look of its own. */
  imageVariant?: boolean;
}

/** One character's equipped build. */
export interface CharacterBuild {
  characterId: string;
  subclass: PlayerDetail["subclass"];
  weapons: ItemInfo[];
  armor: ItemInfo[];
  armorSets: ArmorSet[];
  stats: PlayerDetail["stats"];
}

export interface PlayerDetail {
  membershipId: string;
  membershipType: number;
  displayName: string;
  characters: CharacterInfo[];
  subclass: { item: ItemInfo; plugs: ItemInfo[] } | null;
  weapons: ItemInfo[];
  armor: ItemInfo[];
  armorSets: ArmorSet[];
  stats: { hash: number; name: string; icon: string | null; value: number }[];
  /** Every character's equipped build (older data: missing). */
  builds?: CharacterBuild[];
  totals: {
    raidClears: number | null;
    dungeonClears: number | null;
    pvpKd: number | null;
    pvpKda: number | null;
    pvpKills: number | null;
    pvpDeaths: number | null;
    pvpMatches: number | null;
    pvpWins: number | null;
    pvpBestGameKills: number | null;
    pvpLongestSpree: number | null;
    trialsKd: number | null;
    trialsKills: number | null;
    trialsMatches: number | null;
    trialsWins: number | null;
  };
  raids: Clears[];
  dungeons: Clears[];
  /** Exotic missions (older data: missing). */
  exotics?: Clears[];
  /** The Pantheon, apart from the raids (older data: missing). */
  pantheon?: Clears[];
  warnings: string[];
  fetchedAt: number;
}

interface Entry {
  detail: PlayerDetail | null;
  loading: boolean;
  error: string | null;
}

/*
 * Tiny stale-while-revalidate store: a profile that was loaded once is shown
 * immediately on the next visit while a fresh copy loads in the background.
 */
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function set(id: string, patch: Partial<Entry>) {
  const prev = entries.get(id) ?? { detail: null, loading: false, error: null };
  entries.set(id, { ...prev, ...patch });
  version++;
  listeners.forEach((l) => l());
}

export function loadPlayer(id: string, force = false): Promise<void> {
  if (!hasBackend) {
    if (MOCK) set(id, { detail: mockDetail(id), loading: false });
    return Promise.resolve();
  }
  const running = inflight.get(id);
  if (running && !force) return running;
  set(id, { loading: true, error: null });
  const promise = call<PlayerDetail>("fireteam_player", { membershipId: id, force })
    .then((detail) => set(id, { detail: detail ?? null, loading: false }))
    .catch((e) => set(id, { loading: false, error: String(e) }))
    .finally(() => inflight.delete(id));
  inflight.set(id, promise);
  return promise;
}

/** Reload every profile seen so far, e.g. after the language changed. */
export function reloadAllPlayers() {
  for (const id of entries.keys()) void loadPlayer(id);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders whenever any cached profile changes. */
export function usePlayers() {
  useSyncExternalStore(subscribe, () => version);
  return (id: string): Entry => entries.get(id) ?? { detail: null, loading: false, error: null };
}

/** Profile for `id`, loading (or refreshing) it when the id changes. */
export function usePlayer(id: string | null): Entry {
  const get = usePlayers();
  useEffect(() => {
    if (id) void loadPlayer(id);
  }, [id]);
  return id ? get(id) : { detail: null, loading: false, error: null };
}

export async function searchPlayer(name: string): Promise<string | undefined> {
  return call<string>("fireteam_search", { name });
}

export interface PlayerSuggestion {
  /** "Name#1234" */
  name: string;
  membershipId: string;
  membershipType: number;
}

export interface PlayerCard {
  emblem: string | null;
  online: boolean;
  /** No Destiny 2 profile (Bungie's name search finds those too). */
  noDestiny?: boolean;
}

/** Cards (emblem, online) of suggested players, reused for a minute. */
const cards = new Map<string, { at: number; card: Promise<PlayerCard> }>();
const CARD_TTL_MS = 60_000;
export function playerCard(s: PlayerSuggestion): Promise<PlayerCard> {
  if (MOCK) return Promise.resolve({ emblem: null, online: s.name.length % 2 === 0 });
  const cached = cards.get(s.membershipId);
  if (cached && Date.now() - cached.at < CARD_TTL_MS) return cached.card;
  const card = call<PlayerCard>("fireteam_player_card", { membershipType: s.membershipType, membershipId: s.membershipId })
    .then((c) => c ?? { emblem: null, online: false })
    .catch(() => ({ emblem: null, online: false }));
  cards.set(s.membershipId, { at: Date.now(), card });
  return card;
}

/** Players whose Bungie name starts with what was typed. */
export async function suggestPlayers(prefix: string): Promise<PlayerSuggestion[]> {
  if (MOCK) {
    const names = ["Guardian#0420", "Guardian#1337", "Guardsman#7777", "Sherpa#1337", "Shaxx#0001"];
    return names
      .filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((name, i) => ({ name, membershipId: `46116860184${i}`, membershipType: 3 }));
  }
  return (await call<PlayerSuggestion[]>("fireteam_suggest", { prefix })) ?? [];
}

export const BUNGIE = "https://www.bungie.net";

/** External profile pages for a player. */
export function profileLinks(detail: Pick<PlayerDetail, "membershipId">) {
  return [{ label: "RaidHub", url: `https://raidhub.io/profile/${detail.membershipId}` }];
}

/** "1:23:45" / "34:56" */
export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Browser-only sample data for UI work (open the page with ?mock).
const MOCK = !isTauri && location.search.includes("mock");

function mockDetail(id: string): PlayerDetail {
  const seed = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const item = (name: string, typeName: string, exotic = false, perks?: string[], mods?: string[]): ItemInfo => ({
    hash: name.length * 7919 + typeName.length,
    name,
    icon: null,
    typeName,
    exotic,
    perks: perks?.map((p) => ({ hash: p.length, name: p, icon: null, typeName: "Perk", exotic: false })),
    mods: mods?.map((m) => ({ hash: m.length, name: m, icon: null, typeName: "Mod", exotic: false })),
  });
  return {
    membershipId: id,
    membershipType: 3,
    displayName: `Guardian${seed % 1000}#${1000 + (seed % 9000)}`,
    characters: [
      { id: "1", className: "Jäger", light: 2010, emblemPath: null, emblemBackgroundPath: null, lastPlayed: null },
      { id: "2", className: "Warlock", light: 1998, emblemPath: null, emblemBackgroundPath: null, lastPlayed: null },
    ],
    subclass: {
      item: item("Prisma-Jäger", "Jäger-Fokus"),
      plugs: [
        item("Schattenschuss: Totfalle", "Leere-Super"),
        item("Waghalsiges Ausweichen", "Klassenfähigkeit"),
        item("Fadenspitze", "Strang-Nahkampf"),
        item("Geflochtene Täuschung", "Strang-Aspekt"),
        item("Aufstieg", "Arkus-Aspekt"),
        item("Facette des Mutes", "Prismatisches Fragment"),
        item("Facette des Schutzes", "Prismatisches Fragment"),
        item("Facette des Ruins", "Prismatisches Fragment"),
      ],
    },
    weapons: [
      item("Zitterknochen", "Impulsgewehr", false, ["Pfeilspitzenbremse", "Zusatzmagazin", "Kill-Clip", "Ausgeglichen"], ["Gegenmaßnahme"]),
      item("VS-Geschwindigkeitsstab", "Granatenwerfer", false, ["Schneller Abschuss", "Federgeladen", "Kettenreaktion"]),
      item("Heze-Rache", "Raketenwerfer", false, ["Lineare Kompensation", "Impakt-Zünder", "Bait and Switch", "Bremse"], ["Bosse-Bezwinger"]),
    ],
    armor: [
      item("Finstergruben-Maske", "Helm", false, undefined, ["Heckenschützen-Zielerfassung", "Ladestrom", "Granaten-Kickstart"]),
      item("Krystokren-Greifer", "Panzerhandschuhe", false, undefined, ["Fasttrack-Reload", "Nahkampf-Faust"]),
      item("Finstergruben-Chiton", "Brustschutz"),
      item("Krystokren-Hose", "Beinschutz"),
      item("Relativismus", "Jäger-Umhang", true),
    ],
    armorSets: [
      {
        name: "Finstergruben",
        pieces: 2,
        perks: [
          { required: 2, name: "Schattenjäger", description: "Präzisionstreffer laden deine Klassenfähigkeit schneller auf.", icon: null, active: true },
          { required: 4, name: "Dunkle Ernte", description: "Besiegte Gegner hinterlassen eine Kugel aus Dunkelheit.", icon: null, active: false },
        ],
      },
      {
        name: "Krystokren",
        pieces: 2,
        perks: [
          { required: 2, name: "Kristallpanzer", description: "Erhöhter Schadenswiderstand gegen Kämpfer.", icon: null, active: true },
          { required: 4, name: "Splitterwelle", description: "Nahkampf-Finisher erzeugen eine Splitterwelle.", icon: null, active: false },
        ],
      },
    ],
    stats: [
      { hash: 2996146975, name: "Waffen", icon: null, value: 20 },
      { hash: 392767087, name: "Gesundheit", icon: null, value: 65 },
      { hash: 1943323491, name: "Klasse", icon: null, value: 90 },
      { hash: 1735777505, name: "Granate", icon: null, value: 75 },
      { hash: 144602215, name: "Super", icon: null, value: 80 },
      { hash: 4244567218, name: "Nahkampf", icon: null, value: 180 },
    ],
    totals: {
      // Spread across the tiers so every color shows up in the preview.
      raidClears: [12, 48, 130, 310, 648, 1240][seed % 6],
      dungeonClears: [0, 30, 95, 260, 752, 1100][(seed + 3) % 6],
      pvpKd: 1.37,
      pvpKda: 1.92,
      pvpKills: 54127,
      pvpDeaths: 39509,
      pvpMatches: 4190,
      pvpWins: 2090,
      pvpBestGameKills: 41,
      pvpLongestSpree: 17,
      trialsKd: 1.08,
      trialsKills: 1376,
      trialsMatches: 299,
      trialsWins: 147,
    },
    raids: [
      { name: "Wurzel der Albträume", clears: 174, fastestMs: 1_134_000 },
      { name: "Gläserne Kammer", clears: 76, fastestMs: 1_512_000 },
      { name: "Tiefsteinkrypta", clears: 70, fastestMs: 1_689_000 },
      { name: "Letzter Wunsch", clears: 34, fastestMs: 2_405_000 },
    ],
    dungeons: [
      { name: "Sog der Habsucht", clears: 157, fastestMs: 1_021_000 },
      { name: "Grube der Ketzerei", clears: 141, fastestMs: 798_000 },
      { name: "Prophezeiung", clears: 44, fastestMs: null },
    ],
    exotics: [
      { name: "Doppeltes Schicksal", clears: 12, fastestMs: 1_310_000 },
      { name: "Vorahnung", clears: 9, fastestMs: 845_000 },
    ],
    warnings: [],
    fetchedAt: Date.now() - 40_000,
  };
}
