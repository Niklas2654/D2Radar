import { useCallback, useEffect, useRef, useState } from "react";
import { call, isTauri, subscribe } from "./tauri";

/** Press and let go, only press (held until an "up" or the end), only let go. */
export type Press = "tap" | "down" | "up";
export type MouseButton = "left" | "right" | "middle" | "x1" | "x2" | "wheelup" | "wheeldown";

/** after: the wait before the next block when the standard delay is off
 *  (ms); unset = LINK_DELAY. */
export type Step =
  /** A keyboard key by its KeyboardEvent.code ("KeyQ", "Space"); "" = not picked yet. */
  | { kind: "key"; code: string; press: Press; after?: number }
  | { kind: "mouse"; button: MouseButton; press: Press; after?: number }
  /** One of the game's actions: the key bound to it in Destiny's cvars.xml. */
  | { kind: "game"; action: string; press: Press; after?: number }
  | { kind: "wait"; ms: number };

/** The wait between two blocks when the standard delay is off and none was set. */
export const LINK_DELAY = 50;

export type MacroMode = "once" | "hold" | "toggle" | "sequence";
/** The parts of a sequence macro: on pressing, while held, on letting go. */
export type Phase = "press" | "hold" | "release";

export interface Macro {
  id: string;
  name: string;
  enabled: boolean;
  /** Hotkey string as in lib/hotkeys ("F5"); "" = none. */
  hotkey: string;
  mode: MacroMode;
  /** The steps; in a sequence those repeated while held. */
  steps: Step[];
  /** Sequence only: played once on pressing the hotkey. */
  pressSteps?: Step[];
  /** Sequence only: played once on letting the hotkey go. */
  releaseSteps?: Step[];
  /** Wait after every key step (ms) unless one of its own follows; 0 = none. */
  delay: number;
  /** Only while Destiny has the focus (its hotkey too); off: anywhere. */
  focused: boolean;
}

export const MOUSE_BUTTONS: readonly MouseButton[] = ["left", "right", "middle", "x1", "x2", "wheelup", "wheeldown"];

/** The game's actions in the bar, by group (names as in cvars.xml). */
export const GAME_GROUPS = {
  abilities: [
    "super",
    "grenade",
    "melee",
    "melee_charged",
    "melee_uncharged",
    "class_ability",
    "utility_ability",
    "equipment_ability",
  ],
  weapons: [
    "fire",
    "toggle_zoom",
    "hold_zoom",
    "reload",
    "switch_weapons",
    "primary_weapon",
    "special_weapon",
    "heavy_weapon",
    "next_weapon",
    "previous_weapon",
  ],
  movement: [
    "jump",
    "air_move",
    "hold_crouch",
    "toggle_crouch",
    "toggle_sprint",
    "hold_sprint",
    "move_forward",
    "move_backward",
    "move_left",
    "move_right",
  ],
  vehicle: [
    "vehicle_boost",
    "vehicle_brake",
    "vehicle_zoom",
    "vehicle_dodge_left",
    "vehicle_dodge_right",
    "vehicle_biped_dodge",
    "vehicle_fire_primary",
    "vehicle_fire_secondary",
    "vehicle_exit",
    "vehicle_jump",
    "vehicle_honk",
  ],
  menus: [
    "ui_open_director",
    "ui_open_director_map_tab",
    "ui_open_director_destinations_tab",
    "ui_open_director_pursuits_tab",
    "ui_open_director_world_tab",
    "ui_open_director_roster_tab",
    "ui_open_director_seasons_tab",
    "ui_open_director_curator_tab",
    "ui_open_director_mtx_tab",
    "ui_open_start_menu_alternative",
    "ui_open_start_menu_inventory_tab",
    "ui_open_start_menu_records_tab",
    "ui_open_start_menu_collections_tab",
    "ui_open_start_menu_clan_tab",
    "ui_open_start_menu_settings_tab",
    "ui_gamepad_button_back",
    "ui_text_chat_toggle_state",
    "ui_abort_activity",
    "ui_open_exit_dialog_confirm",
  ],
  other: [
    "interact",
    "highlight_player",
    "emote_1",
    "emote_2",
    "emote_3",
    "emote_4",
    "light_attack",
    "heavy_attack",
    "block",
    "stasis_breakout",
    "push_to_talk",
    "death_cam_zoom_in",
    "death_cam_zoom_out",
    "screenshot",
  ],
} as const;

export type GameAction = (typeof GAME_GROUPS)[keyof typeof GAME_GROUPS][number];

/** The game's key bindings: action → its keys as Destiny names them ("f",
 *  "left mouse button"); found: cvars.xml is there. */
export interface GameBindings {
  found: boolean;
  /** From a cvars.xml uploaded here (the game's isn't on this PC). */
  uploaded: boolean;
  keys: Record<string, string[]>;
  /** action → its two places in the game (primary, secondary); "" free. */
  slots: Record<string, [string, string]>;
  /** The game's cvars.xml is read-only (Destiny can't reset keys in it). */
  locked: boolean;
}

// Outside the app (vite dev in a browser): Destiny's default keys, and the
// macros kept in memory, so the page can be tried.
const DEFAULT_KEYS: Record<string, string[]> = {
  super: ["f"],
  grenade: ["q"],
  melee: ["c"],
  melee_charged: [],
  melee_uncharged: [],
  class_ability: ["v"],
  fire: ["left mouse button"],
  hold_zoom: ["right mouse button"],
  reload: ["r"],
  switch_weapons: ["mouse wheel up"],
  primary_weapon: ["1"],
  special_weapon: ["2"],
  heavy_weapon: ["3"],
  jump: ["space"],
  hold_crouch: ["control"],
  toggle_sprint: ["shift"],
  move_forward: ["w"],
  move_backward: ["s"],
  move_left: ["a"],
  move_right: ["d"],
  interact: ["e"],
  highlight_player: ["g"],
  emote_1: ["up"],
  emote_2: ["right"],
  emote_3: ["down"],
  emote_4: ["left"],
  ui_open_director: ["m"],
};
let local: Macro[] = [];

export function useMacros(): [Macro[], (next: Macro[]) => void] {
  const [macros, setMacros] = useState<Macro[]>(local);
  useEffect(() => {
    if (!isTauri) return;
    void call<Macro[]>("macros_get").then((m) => m && setMacros(m));
    return subscribe<Macro[]>("macros-changed", setMacros);
  }, []);
  return [macros, setMacros];
}

interface RawBindings {
  found: boolean;
  uploaded: boolean;
  actions: [string, string[]][];
  slots: [string, [string, string]][];
  locked: boolean;
}
const fromRaw = (b: RawBindings): GameBindings => ({
  found: b.found,
  uploaded: b.uploaded,
  keys: Object.fromEntries(b.actions),
  slots: Object.fromEntries(b.slots),
  locked: b.locked,
});

/** The game's key bindings; the setter for those of an uploaded cvars.xml. */
export function useGameBindings(): [GameBindings | null, (b: GameBindings) => void] {
  const [bindings, setBindings] = useState<GameBindings | null>(null);
  // Counts the changes: a read that was overtaken by one is dropped.
  const changes = useRef(0);
  const set = useCallback((b: GameBindings) => {
    changes.current += 1;
    setBindings(b);
  }, []);
  useEffect(() => {
    const read = () => {
      const at = changes.current;
      void readGameBindings().then((b) => changes.current === at && set(b), () => {});
    };
    // Read anew whenever the page opens and when the app is back in front
    // (keys changed in the game since).
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [set]);
  return [bindings, set];
}

/** The game's key bindings, read from its cvars.xml right now (Destiny's
 *  defaults outside the app). */
export async function readGameBindings(): Promise<GameBindings> {
  if (!isTauri) {
    const slots = Object.fromEntries(
      Object.entries(DEFAULT_KEYS).map(([a, k]): [string, [string, string]] => [a, [k[0] ?? "", k[1] ?? ""]]),
    );
    return { found: true, uploaded: false, keys: DEFAULT_KEYS, slots, locked: false };
  }
  const b = await call<RawBindings>("macro_game_bindings");
  if (!b) throw new Error("no answer");
  return fromRaw(b);
}

/** Keeps a cvars.xml picked by hand (the game's isn't found); rejects one
 *  without key bindings in it. Its bindings. */
export async function importCvars(xml: string): Promise<GameBindings> {
  if (!isTauri) throw new Error("app only");
  const b = await call<RawBindings>("macro_import_cvars", { xml });
  if (!b) throw new Error("no answer");
  return fromRaw(b);
}

/** Binds a key to a game action in Destiny's own cvars.xml (`slot` 0 the
 *  primary, 1 the secondary place; "" frees it). Destiny must be closed. */
export async function setGameKey(action: string, slot: number, key: string): Promise<GameBindings> {
  if (!isTauri) throw new Error("app only");
  const b = await call<RawBindings>("macro_set_game_key", { action, slot, key });
  if (!b) throw new Error("no answer");
  return fromRaw(b);
}

/** Makes Destiny's cvars.xml read-only, or writable again. */
export async function lockCvars(locked: boolean): Promise<GameBindings> {
  if (!isTauri) throw new Error("app only");
  const b = await call<RawBindings>("macro_lock_cvars", { locked });
  if (!b) throw new Error("no answer");
  return fromRaw(b);
}

/** A pressed key as Destiny names it in cvars.xml, for those Radar may
 *  write there; null for others. Letters by the layout in use. */
export function gameKeyFromKey(e: KeyboardEvent): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return e.code.toLowerCase();
  const named: Record<string, string> = {
    Space: "space",
    Tab: "tab",
    Backspace: "backspace",
    ShiftLeft: "shift",
    ShiftRight: "shift",
    ControlLeft: "control",
    ControlRight: "control",
    AltLeft: "alt",
    AltRight: "alt",
  };
  return named[e.code] ?? CVARS_NAMES[e.code] ?? null;
}

/** Destiny's names in cvars.xml of the keys it names by their place on a US
 *  keyboard ("-" is the key with ß on a German one) and of a few more, by
 *  KeyboardEvent.code. */
const CVARS_NAMES: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Insert: "insert",
  Delete: "delete",
  Home: "home",
  End: "end",
  PageUp: "page up",
  PageDown: "page down",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const CVARS_CODES = Object.fromEntries(Object.entries(CVARS_NAMES).map(([code, name]) => [name, code]));

/** A pressed mouse button as Destiny names it. */
export function gameKeyFromMouse(button: number): string | null {
  return (
    ["left mouse button", "middle mouse button", "right mouse button", "extra mouse button 1", "extra mouse button 2"][
      button
    ] ?? null
  );
}

/** The ids of the macros playing now. */
export function usePlaying(): Set<string> {
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  useEffect(
    () =>
      subscribe<[string, boolean]>("macro-playing", ([id, on]) =>
        setPlaying((now) => {
          const next = new Set(now);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        }),
      ),
    [],
  );
  return playing;
}

export const macros = {
  /** Saves it (new without an id); rejects with a message (hotkey taken …). */
  save: async (item: Macro): Promise<Macro[]> => {
    if (isTauri) return (await call<Macro[]>("macro_save", { item })) ?? [];
    const saved = { ...item, id: item.id || `m${Date.now()}` };
    local = local.some((m) => m.id === saved.id) ? local.map((m) => (m.id === saved.id ? saved : m)) : [...local, saved];
    return local;
  },
  remove: async (id: string): Promise<Macro[]> => {
    if (isTauri) return (await call<Macro[]>("macro_delete", { id })) ?? [];
    local = local.filter((m) => m.id !== id);
    return local;
  },
};

export const newMacro = (name: string): Macro => ({
  id: "",
  name,
  enabled: true,
  hotkey: "",
  mode: "once",
  steps: [],
  pressSteps: [],
  releaseSteps: [],
  delay: 50,
  focused: true,
});

/** A game key name for a key cap ("left mouse button" → "LMB", "f" → "F"). */
export function gameKeyLabel(name: string, german = false, layout: LayoutMap | null = null): string {
  const short: Record<string, string> = {
    "left mouse button": "LMB",
    "right mouse button": "RMB",
    "middle mouse button": "MMB",
    "extra mouse button 1": "M4",
    "extra mouse button 2": "M5",
    "mouse wheel up": "Wheel ↑",
    "mouse wheel down": "Wheel ↓",
    space: "Space",
    shift: "Shift",
    control: "Ctrl",
    alt: "Alt",
    escape: "Esc",
  };
  return name
    .split("+")
    .map((part) =>
      CVARS_CODES[part] ? keyName(CVARS_CODES[part], german, layout) : short[part] ?? (part.length <= 2 ? part.toUpperCase() : part.replace(/\b\w/g, (c) => c.toUpperCase())))
    .join("+");
}

/** The official icons for the ability blocks (the armor stats named like
 *  them): action → icon path on bungie.net; empty outside the app. */
export function useAbilityIcons(): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isTauri) return;
    void call<[string, string][]>("macro_ability_icons").then((list) => list && setIcons(Object.fromEntries(list)));
  }, []);
  return icons;
}

interface LayoutMap {
  get(code: string): string | undefined;
}

/** What the keys of the keyboard in use type (KeyboardEvent.code → "z"), so
 *  a German keyboard shows Z where a US one has Y; null where not known. */
export function useKeyboardLayout(): LayoutMap | null {
  const [layout, setLayout] = useState<LayoutMap | null>(null);
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;
    void keyboard
      ?.getLayoutMap?.()
      .then(setLayout)
      .catch(() => {});
  }, []);
  return layout;
}

const US_CHARS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "<",
};

const NAMES: Record<string, [string, string]> = {
  // [German, English]
  Escape: ["Esc", "Esc"],
  Backspace: ["⟵", "⟵"],
  Tab: ["Tab", "Tab"],
  CapsLock: ["Caps", "Caps"],
  Enter: ["Enter", "Enter"],
  Space: ["Leertaste", "Space"],
  ShiftLeft: ["Shift", "Shift"],
  ShiftRight: ["Shift R", "Shift R"],
  ControlLeft: ["Strg", "Ctrl"],
  ControlRight: ["Strg R", "Ctrl R"],
  AltLeft: ["Alt", "Alt"],
  AltRight: ["Alt Gr", "Alt R"],
  PrintScreen: ["Druck", "PrtSc"],
  ScrollLock: ["Rollen", "ScrLk"],
  Pause: ["Pause", "Pause"],
  Insert: ["Einfg", "Ins"],
  Home: ["Pos1", "Home"],
  PageUp: ["Bild ↑", "PgUp"],
  Delete: ["Entf", "Del"],
  End: ["Ende", "End"],
  PageDown: ["Bild ↓", "PgDn"],
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
  NumLock: ["Num", "Num"],
  NumpadDivide: ["/", "/"],
  NumpadMultiply: ["*", "*"],
  NumpadSubtract: ["-", "-"],
  NumpadAdd: ["+", "+"],
  NumpadDecimal: [",", "."],
  NumpadEnter: ["Enter", "Enter"],
};

/** A key code as on its key cap, in the keyboard layout in use. */
export function keyName(code: string, german: boolean, layout: LayoutMap | null): string {
  const typed = layout?.get(code);
  // Upper case as on the key cap, but not where it grows ("ß" → "SS").
  if (typed && typed.trim() && !code.startsWith("Numpad")) return typed.toUpperCase().length === typed.length ? typed.toUpperCase() : typed;
  const name = NAMES[code];
  if (name) {
    const text = german ? name[0] : name[1];
    return code.startsWith("Numpad") ? `Num ${text}` : text;
  }
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) return `Num ${pad[1]}`;
  return US_CHARS[code] ?? code;
}
