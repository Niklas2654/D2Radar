import type { ArmorSet, ItemInfo } from "./fireteam";
import type { DimLoadout } from "./loadouts";
import { call, isTauri } from "./tauri";

/** An owned item that can go into a slot. */
export interface Choice {
  /** Item instance id. */
  id: string;
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  exotic: boolean;
  watermark: string | null;
  /** Where it is: vault, a character, equipped … */
  location: string;
  /** Where it comes from (English, lower case: "source: vault of glass raid"). */
  source?: string;
  /** Its gear tier (1–5; 0: none). */
  tier?: number;
  /** Its armor set (0: none). */
  set?: number;
  /** A weapon's slot, ammo and element as words in the app's language
   *  (searched and suggested), and in the other one (only searched). */
  tags?: string[];
  aliases?: string[];
  /** An exotic class item's two spirits (plug hashes, column order). */
  perkHashes?: number[];
  /** A weapon's perks (all it can switch to), frame, origin trait and mod;
   *  an exotic class item's two spirits (names, for the searches). */
  perks?: string[];
}

/** Letters and digits only ("King's Fall" -> "kingsfall"). */
const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Whether every word is in `hay`: as typed, or without spaces and
 *  punctuation ("kingsfall" finds "king's fall", "kings fall" too). */
export function hasWords(hay: string, words: string[]): boolean {
  const lower = hay.toLowerCase().replace(/[’']/g, "");
  const tight = compact(hay);
  return words.every((w) => lower.includes(w.replace(/[’']/g, "")) || (compact(w) !== "" && tight.includes(compact(w))));
}

/** Whether `c` fits a search: every word in its name, type, place, source
 *  or perks (a weapon's, an exotic class item's spirits): "vault of glass
 *  auto" finds the raid's auto rifles, "sniper rapid hit" snipers with Rapid
 *  Hit, "relativism stag" those class items with The Stag. */
export function choiceMatches(c: Choice, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // (Its rarity too: "exotic auto" finds every exotic auto rifle.)
  const rarity = c.exotic ? "exotic exotisch" : "legendary legendär";
  const hay = `${c.name} ${c.typeName} ${c.location} ${rarity} ${(c.tags ?? []).join(" ")} ${(c.aliases ?? []).join(" ")} ${c.source ?? ""} ${(c.perks ?? []).join(" ")}`;
  return hasWords(hay, words);
}

export interface PresetSlot {
  bucket: number;
  item: Choice | null;
}

/** Everything a loadout of the chosen items would save. */
export interface PresetPreview {
  loadout: DimLoadout;
  /** Weapons with their perks and mods right now. */
  weapons: ItemInfo[];
  armorSets: ArmorSet[];
}

export interface Draft {
  classType: number;
  className: string;
  slots: PresetSlot[];
}

/** A saved loadout opened again (preset_edit). */
export interface Edit {
  name: string;
  slots: PresetSlot[];
  statMods: Record<number, number[]> | null;
  subclassPlugs: Record<number, number> | null;
  /** For the optimizer: its exotic (-1 none), an exotic class item's perks,
   *  the stats it reaches (optimizer order). */
  exotic: number;
  perks: [number, number];
  stats: number[];
  /** The set bonuses its armor has: [set, pieces]. */
  sets: [number, number][];
  /** Its artifact perks (null: none saved). */
  artifact: number[] | null;
  /** Its weapons' perks and mods as saved (instance id -> socket index -> plug). */
  weaponPlugs: Record<string, Record<number, number>>;
}

/** Weapons' picked perks and mods: instance id -> socket index -> plug. */
export type WeaponPlugs = Record<string, Record<number, number>>;

/** Loadout slots in the game's order. */
export const SUBCLASS_BUCKET = 3284755031;
export const WEAPON_BUCKETS = [1498876634, 2465295065, 953998645];
export const ARMOR_BUCKETS = [3448274439, 3551918588, 14239492, 20886954, 1585787867];

const MOCK = !isTauri && location.search.includes("mock");

let mockId = 0;
const mockChoice = (name: string, typeName: string, exotic = false, where = "Tresor"): Choice => ({
  id: String(++mockId),
  hash: mockId,
  name,
  icon: null,
  typeName,
  exotic,
  watermark: null,
  location: where,
});

const MOCK_CANDIDATES: Record<number, Choice[]> = {
  [SUBCLASS_BUCKET]: [mockChoice("Prismatisch", "Subklasse", false, "Jäger"), mockChoice("Leerenläufer", "Subklasse", false, "Jäger")],
  1498876634: [mockChoice("Zitterknochen", "Impulsgewehr", false, "Jäger · ausgerüstet"), mockChoice("Gesetz des Verlusts", "Handfeuerwaffe")],
  2465295065: [mockChoice("Apex-Raubtier", "Raketenwerfer", true), mockChoice("Qua Nilus II", "Maschinenpistole")],
  953998645: [mockChoice("Heze-Rache", "Raketenwerfer", false, "Jäger · ausgerüstet"), mockChoice("Lotophage", "Granatenwerfer")],
  3448274439: [mockChoice("Finstergruben-Maske", "Helm", false, "Jäger · ausgerüstet"), mockChoice("Sternenaugen", "Helm", true)],
  3551918588: [mockChoice("Krystokren-Greifer", "Panzerhandschuhe", false, "Jäger · ausgerüstet")],
  14239492: [mockChoice("Finstergruben-Chiton", "Brustschutz", false, "Jäger · ausgerüstet")],
  20886954: [mockChoice("Krystokren-Hose", "Beinschutz", false, "Jäger · ausgerüstet")],
  1585787867: [mockChoice("Relativismus", "Jäger-Umhang", true, "Jäger · ausgerüstet")],
};

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export const presets = {
  /** A new preset from what the character has equipped. */
  draft: async (characterId: string | null): Promise<Draft | undefined> => {
    if (MOCK) {
      const slots = [SUBCLASS_BUCKET, ...WEAPON_BUCKETS, ...ARMOR_BUCKETS].map((bucket) => ({
        bucket,
        item: MOCK_CANDIDATES[bucket]?.[0] ?? null,
      }));
      return { classType: 1, className: "Jäger", slots };
    }
    return call<Draft>("preset_draft", { characterId });
  },
  candidates: async (characterId: string | null, bucket: number) =>
    MOCK ? (MOCK_CANDIDATES[bucket] ?? []) : ((await call<Choice[]>("preset_candidates", { characterId, bucket })) ?? []),
  /** Save to DIM (item instance ids, one per filled slot); resolves to the new loadout's id. */
  /** `statMods`: stat mod items in place of the armor's own (the optimizer's). */
  /** `subclassPlugs`: the subclass set up so (socket index -> plug) in place of how it is now. */
  /** `artifact`: the artifact perks picked (null: the character's active ones). */
  preview: async (
    characterId: string | null,
    items: string[],
    statMods: Record<number, number[]> | null = null,
    subclassPlugs: Record<number, number> | null = null,
    artifact: number[] | null = null,
    weaponPlugs: WeaponPlugs | null = null,
  ) => (MOCK ? null : call<PresetPreview>("preset_preview", { characterId, items, statMods, subclassPlugs, artifact, weaponPlugs })),
  save: async (
    characterId: string | null,
    name: string,
    items: string[],
    /** Armor bucket -> its stat mods. */
    statMods: Record<number, number[]> | null = null,
    subclassPlugs: Record<number, number> | null = null,
    /** An edit: the loadout saved over (null: a new one). */
    id: string | null = null,
    artifact: number[] | null = null,
    weaponPlugs: WeaponPlugs | null = null,
  ) => (MOCK ? (await wait(600), "1") : call<string>("preset_save", { characterId, name, items, statMods, subclassPlugs, id, artifact, weaponPlugs })),
  /** A saved loadout as the builder and the optimizer start from it. */
  edit: (characterId: string | null, id: string) => call<Edit>("preset_edit", { characterId, id }),
};

/** A preset: DIM loadouts, each assigned to an in-game loadout slot. */
export interface LoadoutSet {
  /** Empty for a new one. */
  id: string;
  name: string;
  classType: number;
  entries: SetEntry[];
}

export interface SetEntry {
  slot: number;
  loadoutId: string;
  /** In-game name / color / icon for the slot; 0 = keep. */
  nameHash?: number;
  colorHash?: number;
  iconHash?: number;
}

let mockSets: LoadoutSet[] = [
  { id: "s1", name: "Salvation's Edge", classType: 1, entries: [{ slot: 0, loadoutId: "1" }, { slot: 1, loadoutId: "2" }] },
];

export const loadoutSets = {
  list: async () => (MOCK ? mockSets : ((await call<LoadoutSet[]>("loadout_sets")) ?? [])),
  /** Resolves to all presets and the saved one's id. */
  save: async (set: LoadoutSet): Promise<[LoadoutSet[], string]> => {
    if (MOCK) {
      const id = set.id || `s${Date.now()}`;
      mockSets = [...mockSets.filter((s) => s.id !== id), { ...set, id }];
      return [mockSets, id];
    }
    return (await call<[LoadoutSet[], string]>("loadout_set_save", { set })) ?? [[], ""];
  },
  remove: async (id: string) => {
    if (MOCK) return (mockSets = mockSets.filter((s) => s.id !== id));
    return (await call<LoadoutSet[]>("loadout_set_delete", { id })) ?? [];
  },
};
