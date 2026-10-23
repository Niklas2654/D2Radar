import { useEffect, useState } from "react";
import { call, isTauri, subscribe } from "./tauri";

export type FixedHotkeyAction = "overlay" | "edit" | "weapon" | "dim" | "discord";
/** "loadout0" … equip that in-game loadout slot. */
export type HotkeyAction = FixedHotkeyAction | `loadout${number}`;
export const HOTKEY_ACTIONS: readonly FixedHotkeyAction[] = ["overlay", "edit", "weapon", "dim", "discord"];

export interface HotkeyConfig {
  overlay: string;
  edit: string;
  weapon: string;
  dim: string;
  discord: string;
  /** Per loadout slot; "" = none. */
  loadouts: string[];
  /** Opacity of DIM and Discord over the game (0.2–1). */
  dimOpacity: number;
  /** Opacity of Discord over the game (0.2–1). */
  discordOpacity: number;
}

const DEFAULTS: HotkeyConfig = { overlay: "F8", edit: "F9", weapon: "F10", dim: "F7", discord: "F6", loadouts: [], dimOpacity: 0.5, discordOpacity: 0.85 };

const loadoutSlot = (action: HotkeyAction) => (action.startsWith("loadout") ? Number(action.slice(7)) : null);

/** Hotkeys as configured on the Rust side (hotkeys.json). */
export function useHotkeys(): [HotkeyConfig, (next: HotkeyConfig) => void] {
  const [config, setConfig] = useState<HotkeyConfig>(DEFAULTS);
  useEffect(() => {
    void call<HotkeyConfig>("hotkeys_get").then((c) => c && setConfig(c));
    return subscribe<HotkeyConfig>("hotkeys-changed", setConfig);
  }, []);
  return [config, setConfig];
}

export const hotkeys = {
  keysOf: (config: HotkeyConfig, action: HotkeyAction): string => {
    const slot = loadoutSlot(action);
    return slot === null ? config[action as FixedHotkeyAction] : (config.loadouts[slot] ?? "");
  },
  /** Bind keys ("" = none); rejects with a message if they can't be used. */
  set: async (config: HotkeyConfig, action: HotkeyAction, keys: string): Promise<HotkeyConfig> => {
    if (isTauri) return (await call<HotkeyConfig>("hotkey_set", { action, keys })) ?? config;
    const slot = loadoutSlot(action);
    if (slot === null) return { ...config, [action]: keys };
    const loadouts = [...config.loadouts];
    loadouts[slot] = keys;
    return { ...config, loadouts: Array.from(loadouts, (k) => k ?? "") };
  },
  setDimOpacity: async (config: HotkeyConfig, opacity: number) =>
    isTauri
      ? ((await call<HotkeyConfig>("dim_game_set_opacity", { opacity })) ?? config)
      : { ...config, dimOpacity: opacity },
  setDiscordOpacity: async (config: HotkeyConfig, opacity: number) =>
    isTauri
      ? ((await call<HotkeyConfig>("discord_game_set_opacity", { opacity })) ?? config)
      : { ...config, discordOpacity: opacity },
};

const MODIFIERS = ["Control", "Shift", "Alt", "Meta", "AltGraph"];

/** Hotkey string for a pressed key ("Ctrl+Shift+D"); null for a lone modifier. */
export function keysFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIERS.includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(/^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : e.code);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
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
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** The keys of a hotkey string as shown on key caps (Ctrl -> Strg in German). */
export function keyLabels(keys: string, german: boolean): string[] {
  if (!keys) return [];
  return keys.split("+").map((k) => {
    if (k === "Ctrl") return german ? "Strg" : "Ctrl";
    if (/^Digit\d$/.test(k)) return k.slice(5);
    if (/^Numpad\d$/.test(k)) return `Num ${k.slice(6)}`;
    return KEY_LABELS[k] ?? k;
  });
}

/** Combinations other programs rely on (undo, copy, …): binding them globally blocks them everywhere. */
export function blocksCommonShortcut(keys: string): boolean {
  return /^Ctrl\+(Z|Y|C|V|X|A|S|F|T|W)$/.test(keys);
}

/** A key you type with (a letter, digit, space; Shift doesn't help): it
 *  would go off while typing in the game chat. */
export function typingKey(keys: string): boolean {
  return /^(Shift\+)?([A-Z0-9]|Space|Enter|Backspace|Tab)$/i.test(keys);
}
