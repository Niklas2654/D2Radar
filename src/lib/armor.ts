import { useEffect, useRef, useState } from "react";
import type { ArmorSet, ItemInfo } from "./fireteam";
import { call, hasBackend, isTauri, subscribe } from "./tauri";
import { MOCK_WEAPON, type WeaponDetail } from "./weapons";

/** An armor piece inspected in game: its exotic perks and set bonuses. */
export interface ArmorDetail {
  item: ItemInfo;
  sets: ArmorSet[];
  /** Perks read from the player's own copy. */
  fromCopy: boolean;
  /** Every version of it (by name): finds the player's copy. */
  versions?: number[];
}

/** A mod: what it is (with exact numbers where known) and its energy. */
export interface ModPlug {
  item: ItemInfo;
  cost: number;
  /** What it adds to the armor stats: [stat hash, value]. */
  stats?: [number, number][];
}

/** What equipping a copy would change: the character it goes on, its stats
 *  now, the stats of the piece worn in that slot (all in the copy's stat
 *  order). */
export interface ArmorCompare {
  className: string;
  character: number[];
  equippedId: string | null;
  equippedName: string | null;
  equipped: number[];
}

/** One of the player's copies of an armor piece (the vault's too). */
export interface ArmorCopy {
  instanceId: string;
  itemHash: number;
  location: "equipped" | "inventory" | "vault";
  className: string | null;
  characterId: string | null;
  power: number | null;
  /** 1–5 stars (null on older armor). */
  tier: number | null;
  energy: number | null;
  stats: { hash: number; name: string; icon: string | null; value: number }[];
  total: number;
  /** The piece as this copy's version (icon, name, type). */
  item: ItemInfo | null;
  /** Its archetype ("Gunner": the stats it favors). */
  archetype: ItemInfo | null;
  /** Its general mod ("+5 Weapons") and tuning ("+5 Weapons / -5 Health"). */
  general: ModPlug | null;
  tuning: ModPlug | null;
}

/** The mods in the player's copy of an armor piece. */
export interface ArmorMods {
  itemHash: number;
  instanceId: string;
  /** The character holding it (null: in the vault). */
  characterId: string | null;
  energy: number | null;
  slots: { socket: number; plug: ModPlug | null }[];
  /** Held by the character played last (locked while in an activity). */
  onActive: boolean;
}

/** An armor piece found by name: the first version, and all of the name. */
export interface ArmorHit {
  item: ItemInfo;
  hashes: number[];
}

/** Armor by name (the inspect page's search). */
export const armorApi = {
  search: (query: string) => (hasBackend ? call<ArmorHit[]>("armor_search", { query }) : Promise.resolve([] as ArmorHit[])),
  detail: (hashes: number[]) =>
    hasBackend ? call<ArmorDetail | null>("armor_detail", { hashes }) : Promise.resolve(null as ArmorDetail | null),
  mods: (hashes: number[], instanceId?: string) =>
    hasBackend ? call<ArmorMods | null>("armor_mods", { hashes, instanceId: instanceId ?? null }) : Promise.resolve(null),
  copies: (hashes: number[]) => (hasBackend ? call<ArmorCopy[]>("armor_copies", { hashes }) : Promise.resolve([] as ArmorCopy[])),
  /** To a character of its class; resolves to that class. `from`: the
   *  character holding it (it goes through the vault). */
  pull: (instanceId: string, itemHash: number, from: string | null) =>
    call<string>("armor_pull", { instanceId, itemHash, from }),
  compare: (itemHash: number) => (hasBackend ? call<ArmorCompare | null>("armor_compare", { itemHash }) : Promise.resolve(null)),
  modOptions: (itemHash: number, socket: number, instanceId: string) =>
    hasBackend ? call<ModPlug[]>("armor_mod_options", { itemHash, socket, instanceId }) : Promise.resolve([] as ModPlug[]),
  setMod: (instanceId: string, characterId: string | null, socket: number, plug: number) =>
    call("armor_set_mod", { instanceId, characterId, socket, plug }),
};

const MOCK = !isTauri && location.search.includes("mock") && location.search.includes("armor");
const MOCK_WEAPONS = !isTauri && location.search.includes("mock") && !MOCK;

/** An example piece: the mock, and the placeholder to place in edit mode. */
export const SAMPLE_ARMOR: ArmorDetail = {
  item: {
    hash: 1,
    name: "Smoke Jumper Mask",
    icon: null,
    typeName: "Helmet",
    exotic: false,
  },
  sets: [
    {
      name: "Smoke Jumper",
      pieces: 1,
      perks: [
        {
          required: 2,
          name: "Ride Together, Die Together",
          description: "Picking up an Orb of Power grants damage resistance.",
          icon: null,
          active: false,
          exact: "On Orb of Power Pickup: 40% [5%] Damage Resist.",
        },
        {
          required: 4,
          name: "Smoke and Mirrors",
          description: "Become invisible on a powered melee kill.",
          icon: null,
          active: false,
        },
      ],
    },
  ],
  fromCopy: true,
};

/** The mod / exotic perk whose tooltip the game shows at the pointer on
 *  the inspected armor piece; null when none. */
export function useHoveredArmorPlug(): ItemInfo | null {
  const [plug, setPlug] = useState<ItemInfo | null>(null);
  useEffect(() => subscribe<ItemInfo | null>("armor-hover", (p) => setPlug(p ?? null)), []);
  return plug;
}

/** The armor piece Radar currently sees inspected in game. */
export function useDetectedArmor(): ArmorDetail | null {
  const [armor, setArmor] = useState<ArmorDetail | null>(MOCK ? SAMPLE_ARMOR : null);
  useEffect(() => subscribe<ArmorDetail | null>("armor-detected", setArmor), []);
  return armor;
}

/** What the overlay shows: the inspected weapon or armor piece. */
export type DetectedGear = { weapon: WeaponDetail; armor?: undefined } | { armor: ArmorDetail; weapon?: undefined } | null;

/** How long "nothing inspected" must last before the overlay hides it: a
 * single unclear check (a tooltip, a frame mid-fade) doesn't blink it away. */
const HIDE_AFTER_MS = 150;

/** The inspected weapon or armor, held through short gaps in detection. */
export function useDetectedGear(): DetectedGear {
  const [gear, setGear] = useState<DetectedGear>(
    MOCK ? { armor: SAMPLE_ARMOR } : MOCK_WEAPONS ? { weapon: MOCK_WEAPON } : null,
  );
  const current = useRef(gear);
  useEffect(() => {
    let hide = 0;
    const set = (next: DetectedGear) => {
      current.current = next;
      setGear(next);
    };
    const found = (next: DetectedGear) => {
      window.clearTimeout(hide);
      const g = current.current;
      // The same item again: keep the old object, so nothing re-renders.
      if (g && JSON.stringify(g) === JSON.stringify(next)) return;
      set(next);
    };
    const gone = (kind: "weapon" | "armor") => {
      if (!current.current?.[kind]) return;
      window.clearTimeout(hide);
      hide = window.setTimeout(() => set(null), HIDE_AFTER_MS);
    };
    const offWeapon = subscribe<WeaponDetail | null>("weapon-detected", (weapon) =>
      weapon ? found({ weapon }) : gone("weapon"),
    );
    const offArmor = subscribe<ArmorDetail | null>("armor-detected", (armor) => (armor ? found({ armor }) : gone("armor")));
    return () => {
      window.clearTimeout(hide);
      offWeapon();
      offArmor();
    };
  }, []);
  return gear;
}
