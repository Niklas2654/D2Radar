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
  preview: async (characterId: string | null, items: string[]) =>
    MOCK ? null : call<PresetPreview>("preset_preview", { characterId, items }),
  save: async (characterId: string | null, name: string, items: string[]) =>
    MOCK ? (await wait(600), "1") : call<string>("preset_save", { characterId, name, items }),
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
