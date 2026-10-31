import type { ItemInfo } from "./fireteam";
import { call, isTauri } from "./tauri";

/** A loadout saved in DIM (read through DIM Sync). */
export interface DimLoadout {
  id: string;
  name: string;
  notes: string | null;
  classType: number;
  className: string;
  subclass: ItemInfo | null;
  /** Super, abilities, aspects and fragments set on the subclass. */
  subclassPlugs: ItemInfo[];
  /** Weapons and armor. */
  items: ItemInfo[];
  mods: ItemInfo[];
  /** In-game loadout icon / color it uses, if any. */
  icon: string | null;
  color: string | null;
  /** What wouldn't work putting it on the character (empty = all fine). */
  issues: string[];
  /** Artifact perks saved with it (only settable in game). */
  artifact: ItemInfo[];
  /** Hashes of its items the player doesn't own (anymore). */
  missing?: number[];
  /** Only the list entry so far; details load when it's on screen. */
  pending?: boolean;
}

/** A loadout in the list (details come per page). */
/** A socket of a loadout item that can be changed. */
export interface EditSocket {
  index: number;
  label: string;
  current: ItemInfo | null;
  options: ItemInfo[];
  /** Can be left empty (armor mods). */
  removable: boolean;
}

export interface DimSummary {
  id: string;
  name: string;
  classType: number;
  className: string;
  subclass: ItemInfo | null;
}

/** A list entry standing in for a loadout until its details are loaded. */
export function fromSummary(s: DimSummary): DimLoadout {
  return {
    ...s,
    notes: null,
    subclassPlugs: [],
    items: [],
    mods: [],
    icon: null,
    color: null,
    issues: [],
    artifact: [],
    pending: true,
  };
}

/** One of the game's loadout slots on the current character. */
export interface GameLoadout {
  index: number;
  name: string;
  icon: string | null;
  color: string | null;
  empty: boolean;
  nameHash: number;
  colorHash: number;
  iconHash: number;
  /** Subclass, weapons and armor saved in it (those still owned). */
  items: ItemInfo[];
}

/** What an in-game loadout slot can be called / look like. */
export interface Identifiers {
  names: { hash: number; value: string }[];
  /** value = image path */
  colors: { hash: number; value: string }[];
  icons: { hash: number; value: string }[];
}

/** One of the player's characters. */
export interface OwnCharacter {
  id: string;
  classType: number;
  className: string;
  light: number;
  emblemPath: string | null;
  emblemBackgroundPath: string | null;
}

const MOCK = !isTauri && location.search.includes("mock");

const MOCK_CHARACTERS: OwnCharacter[] = [
  { id: "1", classType: 1, className: "Jäger", light: 2010, emblemPath: null, emblemBackgroundPath: null },
  { id: "2", classType: 2, className: "Warlock", light: 1998, emblemPath: null, emblemBackgroundPath: null },
  { id: "3", classType: 0, className: "Titan", light: 1990, emblemPath: null, emblemBackgroundPath: null },
];

const mockItem = (name: string, typeName: string, exotic = false, bucket?: number, damageType?: number): ItemInfo => ({
  hash: name.length * 7919 + typeName.length,
  name,
  icon: null,
  typeName,
  exotic,
  bucket,
  damageType,
});

const MOCK_DIM: DimLoadout[] = [
  {
    id: "1",
    name: "Raid – Salvation's Edge",
    notes: "Boss DPS",
    classType: 1,
    className: "Jäger",
    subclass: mockItem("Leerenläufer", "Leere-Subklasse", false, 3284755031, 4),
    subclassPlugs: ["Fluchtroute", "Geschärfte Klinge", "Schatten-Schritt", "Gefangen im Netz", "Echo des Hungers"].map((n) => mockItem(n, "Leere-Aspekt")),
    items: [
      mockItem("Zitterknochen", "Impulsgewehr", false, 1498876634, 1),
      mockItem("Apex-Raubtier", "Raketenwerfer", true, 953998645, 3),
      mockItem("Heze-Rache", "Raketenwerfer", false, 2465295065, 7),
      { ...mockItem("Finstergruben-Maske", "Helm", false, 3448274439), mods: [mockItem("Ladestrom", "Helm-Mod"), mockItem("Heavy Ammo Finder", "Helm-Mod")] },
      { ...mockItem("Relativismus", "Jäger-Umhang", true, 1585787867), mods: [mockItem("Reaper", "Klassen-Mod")] },
    ],
    mods: [],
    icon: null,
    color: null,
    issues: [],
    artifact: [mockItem("Overflow-Ladung", "Artefakt-Perk"), mockItem("Leeren-Siphon", "Artefakt-Perk")],
    // Apex-Raubtier, no longer owned.
    missing: [mockItem("Apex-Raubtier", "Raketenwerfer").hash],
  },
  {
    id: "2",
    name: "Trials",
    notes: null,
    classType: 1,
    className: "Jäger",
    subclass: mockItem("Revolverheld", "Solar-Subklasse", false, 3284755031, 3),
    subclassPlugs: [],
    items: [mockItem("Gesetz des Verlusts", "Handfeuerwaffe", false, 1498876634, 1), mockItem("Sterngeboren", "Brustschutz", true, 14239492)],
    mods: [],
    icon: null,
    color: null,
    issues: ["Gesetz des Verlusts: nicht mehr vorhanden", "Harmonischer Lader: zu wenig Rüstungsenergie"],
    artifact: [],
  },
];

const MOCK_GAME: GameLoadout[] = Array.from({ length: 10 }, (_, i) => ({
  index: i,
  name: i < 3 ? ["Raid", "PvP", "Solo"][i] : `Loadout ${i + 1}`,
  icon: null,
  color: null,
  empty: i >= 3,
  nameHash: i < 3 ? 100 + i : 0,
  colorHash: i < 3 ? 200 + i : 0,
  iconHash: i < 3 ? 300 + i : 0,
  items: i < 3 ? MOCK_DIM[0].items : [],
}));

const MOCK_IDS: Identifiers = {
  names: ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Raid", "PvP", "Solo"].map((value, i) => ({ hash: 100 + i, value })),
  colors: Array.from({ length: 12 }, (_, i) => ({ hash: 200 + i, value: "" })),
  icons: Array.from({ length: 12 }, (_, i) => ({ hash: 300 + i, value: "" })),
};

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** The characters as last loaded (see `loadouts.knownCharacters`). */
let lastCharacters: OwnCharacter[] | null = null;

export const loadouts = {
  /** The perks / mods of a loadout's item that can be changed. */
  itemSockets: async (characterId: string | null, loadoutId: string, hash: number) =>
    MOCK ? [] : ((await call<EditSocket[]>("loadout_item_sockets", { characterId, loadoutId, hash })) ?? []),
  /** Change one (plug 0 = empty); resolves to the loadout as it is now. */
  setPlug: (characterId: string | null, loadoutId: string, hash: number, index: number, plug: number) =>
    call<DimLoadout>("loadout_set_plug", { characterId, loadoutId, hash, index, plug }),
  /** Most recently played first (kept: the tab shows them at once). */
  characters: async () => {
    const list = MOCK ? MOCK_CHARACTERS : ((await call<OwnCharacter[]>("own_characters")) ?? []);
    if (list.length) lastCharacters = list;
    return list;
  },
  /** The characters as last loaded (the loading screen loads them). */
  knownCharacters: () => lastCharacters,
  dimStatus: async () =>
    MOCK ? { connected: true } : ((await call<{ connected: boolean }>("dim_status")) ?? { connected: false }),
  dimConnect: () => (MOCK ? wait(500) : call("dim_connect")),
  /** All DIM loadouts, light. `fresh` skips Radar's short-lived cache (reload button). */
  list: async (characterId: string | null, fresh = false) => {
    if (MOCK) {
      const c = MOCK_CHARACTERS.find((m) => m.id === characterId) ?? MOCK_CHARACTERS[0];
      const loadouts: DimSummary[] = Array.from({ length: 30 }, (_, i) => {
        const l = MOCK_DIM[i % MOCK_DIM.length];
        return { id: `${l.id}-${i}`, name: `${l.name} ${i + 1}`, classType: c.classType, className: c.className, subclass: l.subclass };
      });
      return { classType: c.classType, className: c.className, loadouts };
    }
    return await call<{ classType: number; className: string; loadouts: DimSummary[] }>("dim_loadout_list", {
      characterId,
      fresh,
    });
  },
  /** Full details (items, mods, checks) for the loadouts on screen. */
  details: async (characterId: string | null, ids: string[]): Promise<DimLoadout[]> => {
    if (MOCK) {
      await wait(250);
      return ids.map((id) => {
        const base = MOCK_DIM[Number(id.split("-")[1] ?? 0) % MOCK_DIM.length];
        return { ...base, id, name: `${base.name} ${Number(id.split("-")[1] ?? 0) + 1}` };
      });
    }
    return (await call<DimLoadout[]>("dim_loadout_details", { characterId, ids })) ?? [];
  },
  /** The season's artifact: perks per column (tier). */
  artifactLayout: async (): Promise<ItemInfo[][]> => {
    if (MOCK) {
      return Array.from({ length: 5 }, (_, c) =>
        Array.from({ length: 5 }, (_, r) => mockItem(r === 0 && c === 0 ? "Overflow-Ladung" : r === 1 && c === 1 ? "Leeren-Siphon" : `Perk ${c + 1}.${r + 1}`, "Artefakt-Perk")),
      );
    }
    return (await call<ItemInfo[][]>("artifact_layout")) ?? [];
  },
  /** The artifacts (Monument of Triumph) and their perks per tier. */
  artifactOptions: async (): Promise<{ name: string; tiers: ItemInfo[][] }[]> => {
    if (MOCK) return [];
    type Perk = { hash: number; name: string; icon: string | null; text: string; description: string };
    const list = (await call<{ name: string; tiers: Perk[][] }[]>("artifact_options")) ?? [];
    return list.map((a) => ({
      name: a.name,
      tiers: a.tiers.map((tier) => tier.map((p) => ({ hash: p.hash, name: p.name, icon: p.icon, typeName: a.name, description: p.description, exact: p.text, exotic: false }))),
    }));
  },
  /** Delete a loadout from DIM. */
  remove: async (id: string) => (MOCK ? wait(300) : call("dim_loadout_delete", { id })),
  /** Also save the loadout in DIM (it's kept in Radar either way). */
  push: async (id: string) => (MOCK ? wait(600) : call("dim_push", { id })),
  /** Empty an in-game loadout slot. */
  /** An in-game slot saved to DIM as a loadout (its name); its new id. */
  gameToDim: (characterId: string | null, index: number, name: string) =>
    MOCK ? wait(500).then(() => "1") : call<string>("loadout_to_dim", { characterId, index, name }),
  clearGame: (characterId: string | null, index: number) =>
    MOCK ? wait(400) : call("loadout_clear", { characterId, index }),
  game: async (characterId: string | null) =>
    MOCK
      ? { className: "Jäger", loadouts: MOCK_GAME }
      : await call<{ className: string; loadouts: GameLoadout[] }>("loadouts_list", { characterId }),
  /**
   * Put a DIM loadout on the character (and into its in-game slot `slot`,
   * named / colored as `identifiers` = [name, color, icon] hashes if given);
   * resolves to warnings.
   */
  apply: async (id: string, slot: number | null, characterId: string | null, identifiers?: [number, number, number]) =>
    MOCK
      ? (await wait(1200), [] as string[])
      : ((await call<string[]>("dim_loadout_apply", { id, slot, characterId, identifiers: identifiers ?? null })) ?? []),
  identifiers: async () => (MOCK ? MOCK_IDS : await call<Identifiers>("loadout_identifiers")),
};
