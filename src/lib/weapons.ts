import { useEffect, useState } from "react";
import { call, hasBackend, isTauri, subscribe } from "./tauri";

export interface Perk {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  description: string;
  /** Its enhanced version (crafted / enhanced weapons). */
  enhanced?: Perk;
}

export interface WeaponColumn {
  label: string;
  /** Random roll pool (vs. a fixed perk). */
  random: boolean;
  perks: Perk[];
}

export interface WeaponDetail {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  /** 5 legendary, 6 exotic. */
  tier: number;
  /** 1 primary, 2 special, 3 heavy. */
  ammo: number;
  /** Season symbol drawn over the icon. */
  watermark: string | null;
  frame: Perk | null;
  origins: Perk[];
  columns: WeaponColumn[];
  stats: { name: string; value: number; numeric: boolean }[];
  /** All versions of the weapon (reissues), newest first. */
  versions: { hash: number; watermark: string | null }[];
  /** Perks read on the inspect screen: the inspected roll. */
  rolled: number[];
  /** How the version was found: owned copy, season watermark, perks on screen, or newest. */
  matchedBy: "owned" | "watermark" | "perks" | "newest";
  /** The player's own copies of this version (Bungie login) and their perks. */
  copies: WeaponCopy[];
  /** Several seasons exist but neither the icon region nor the login is set up. */
  seasonNeedsSetup?: boolean;
  /** The weapon's lore line. */
  flavor?: string;
  /** An exotic's catalyst and what it adds. */
  catalyst?: Perk | null;
  /** Can be crafted (a pattern exists). */
  craftable?: boolean;
  /** Some perks have enhanced versions. */
  enhanceable?: boolean;
}

export interface WeaponCopy {
  /** Item instance id. */
  id: string;
  location: "equipped" | "inventory" | "vault";
  /** Every perk the copy can switch to. */
  perks: number[];
  /** The perks currently selected on it. */
  selected: number[];
  /** Of its perks, the ones it has enhanced. */
  enhanced?: number[];
}

export interface WeaponSummary {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  tier: number;
  watermark: string | null;
  /** All versions (reissues per season), newest first. */
  versions: { hash: number; watermark: string | null }[];
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectConfig {
  auto: boolean;
  /** Where the weapon name is. */
  region: Region;
  /** Where the weapon icon is (season watermark). */
  icon: Region | null;
}

let mockHash = 0;
const perk = (name: string, typeName: string): Perk => ({
  hash: ++mockHash,
  name,
  icon: null,
  typeName,
  description: "",
});

/** Sample weapon for the browser preview (?mock). */
export const MOCK_WEAPON: WeaponDetail = {
  hash: 4184168210,
  name: "Schicksalsbringer",
  icon: null,
  typeName: "Handfeuerwaffe",
  tier: 5,
  ammo: 1,
  watermark: null,
  frame: perk("Adaptives Gehäuse", "Intrinsisch"),
  origins: [perk("Zeitverirrt-Magazin", "Ursprungsattribut")],
  columns: [
    { label: "Lauf", random: true, perks: ["Kannelierter Lauf", "Pfeilspitzenbremse", "Gekammerter Kompensator", "Korkenzieher-Drall", "Verlängerter Lauf", "Weiter Lauf", "Hammergeschmiedeter Drall", "Polygonlauf", "Kleinkaliber", "Vollchoke", "Gezogener Lauf"].map((n) => perk(n, "Lauf")) },
    { label: "Magazin", random: true, perks: ["Verbesserte Geschosse", "Zusatzmagazin", "Taktisches Magazin", "Vergrößertes Magazin", "Stabile Geschosse", "Legiertes Magazin", "Prallgeschosse", "Leichtmagazin", "Panzerbrechende Geschosse", "Fallmagazin", "Angriffsmagazin", "Großkalibergeschosse"].map((n) => perk(n, "Magazin")) },
    { label: "Eigenschaft", random: true, perks: ["Osmose", "Erster Schuss", "Auf Abstand", "Rückspulgeschosse", "Angenehmer Schmerz", "Kinetik-Beben", "Explosivladung", "Feuerkraft", "Sofort-Munition"].map((n) => perk(n, "Eigenschaft")) },
    { label: "Eigenschaft", random: true, perks: ["Präzisions-Instrument", "Raserei", "Auge des Sturms", "Glühwürmchen", "Elementares Feinschleifen", "Einer für alle", "Prächtiges Jaulen", "All-Star", "Binärer Orbit"].map((n) => perk(n, "Eigenschaft")) },
  ],
  stats: [
    { name: "Feuerrate", value: 140, numeric: true },
    { name: "Schlagkraft", value: 84, numeric: false },
    { name: "Reichweite", value: 46, numeric: false },
    { name: "Stabilität", value: 57, numeric: false },
    { name: "Handhabung", value: 55, numeric: false },
    { name: "Nachladetempo", value: 46, numeric: false },
    { name: "Magazin", value: 10, numeric: true },
    { name: "Zielhilfe", value: 84, numeric: false },
  ],
  versions: [
    { hash: 4184168210, watermark: null },
    { hash: 2171478765, watermark: null },
  ],
  rolled: [],
  matchedBy: "owned",
  copies: [],
};
// Two owned copies and their perks in the preview.
{
  const pick = (c: number, p: number) => MOCK_WEAPON.columns[c].perks[p].hash;
  MOCK_WEAPON.copies = [
    { id: "1", location: "vault", perks: [pick(0, 3), pick(1, 1), pick(2, 7), pick(3, 0)], selected: [pick(0, 3), pick(1, 1), pick(2, 7), pick(3, 0)] },
    { id: "2", location: "inventory", perks: [pick(0, 0), pick(0, 5), pick(1, 2), pick(2, 0), pick(2, 4), pick(3, 2)], selected: [pick(0, 0), pick(1, 2), pick(2, 0), pick(3, 2)] },
  ];
  MOCK_WEAPON.rolled = [...new Set(MOCK_WEAPON.copies.flatMap((c) => c.perks))];
  // Trait columns with enhanced versions; the vault copy has one enhanced.
  MOCK_WEAPON.enhanceable = true;
  for (const c of MOCK_WEAPON.columns.slice(2)) for (const p of c.perks) p.enhanced = { ...p, hash: p.hash + 1000 };
  MOCK_WEAPON.copies[0].enhanced = [pick(2, 7)];
}

const MOCK = !isTauri && location.search.includes("mock");

/** The weapon found on the inspect screen (null when none is shown). */
export function useDetectedWeapon(): WeaponDetail | null {
  const [weapon, setWeapon] = useState<WeaponDetail | null>(MOCK ? MOCK_WEAPON : null);
  useEffect(() => subscribe<WeaponDetail | null>("weapon-detected", setWeapon), []);
  return weapon;
}

/** Season names by watermark (asked once each). */
const seasonNames = new Map<string, string | null>();

/** The season a weapon version is from ("Season of the Wish"), by its
 *  watermark; null while unknown. */
export function useSeasonName(watermark: string | null): string | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!watermark || !hasBackend || seasonNames.has(watermark)) return;
    let alive = true;
    void call<string | null>("season_name", { watermark })
      .then((name) => {
        seasonNames.set(watermark, name ?? null);
        if (alive) rerender((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [watermark]);
  return watermark ? (seasonNames.get(watermark) ?? null) : null;
}

/** The perk (hash) whose tooltip the game shows at the pointer, among the
 *  inspected weapon's; null when none. */
export function useHoveredPerk(): number | null {
  const [perk, setPerk] = useState<number | null>(null);
  useEffect(() => subscribe<number | null>("perk-hover", (p) => setPerk(p ?? null)), []);
  return perk;
}

export const weapons = {
  search: (query: string) =>
    hasBackend
      ? call<WeaponSummary[]>("weapons_search", { query })
      : Promise.resolve(MOCK && query ? [{ ...MOCK_WEAPON }] : []),
  /** Pull a copy from the vault; resolves to the character class it went to. */
  pull: (copy: WeaponCopy, hash: number) =>
    hasBackend
      ? call<string>("weapon_pull", { instanceId: copy.id, itemHash: hash })
      : new Promise<string>((resolve) => window.setTimeout(() => resolve("Warlock"), 600)),
  detail: (hash: number) =>
    hasBackend ? call<WeaponDetail>("weapon_detail", { hash }) : Promise.resolve(MOCK ? MOCK_WEAPON : undefined),
  config: () => call<DetectConfig>("weapon_detect_config"),
  setAuto: (auto: boolean) => call("weapon_set_auto", { auto }),
  setRegion: (region: Region, icon = false) => call("weapon_set_region", { region, icon }),
  capture: (delaySeconds: number) => call<string>("weapon_capture", { delaySeconds }),
  test: () => call<{ lines: string[]; weapon: WeaponDetail | null }>("weapon_test"),
};

/** The weapon shown in previews (dashboard, layout editing); loaded once per app run. */
const SAMPLE_WEAPON = "Mint Retrograde";
let sample: Promise<WeaponDetail | null> | null = null;
export function sampleWeapon(): Promise<WeaponDetail | null> {
  sample ??= weapons
    .search(SAMPLE_WEAPON)
    .then((found) => {
      const hit = found?.find((w) => w.name === SAMPLE_WEAPON) ?? found?.[0];
      return hit ? weapons.detail(hit.hash) : undefined;
    })
    .then((w) => w ?? null)
    .catch(() => {
      sample = null; // try again next time
      return null;
    });
  return sample;
}
