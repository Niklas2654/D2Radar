import { useSyncExternalStore } from "react";
import { accentWipe } from "./accentWipe";
import { broadcast, call, isDemo, isTauri, subscribe } from "./tauri";

export const ACCENTS = {
  solar: { label: "Solar", color: "#ff9f2e" },
  arc: { label: "Arc", color: "#5cc8ff" },
  void: { label: "Void", color: "#b47dff" },
  stasis: { label: "Stasis", color: "#5b8cff" },
  strand: { label: "Strand", color: "#3ee08f" },
  prismatic: { label: "Prismatic", color: "#ff6fd8" },
} as const;

/** An element color, or "custom" for the player's own (`customAccent`). */
export type AccentId = keyof typeof ACCENTS | "custom";
export type Language = "de" | "en" | "fr" | "es" | "it" | "pt" | "pl" | "ru";

const LANGUAGE_IDS: Language[] = ["de", "en", "fr", "es", "it", "pt", "pl", "ru"];

/** The system language, if Radar has it; else English. */
function systemLanguage(): Language {
  const code = navigator.language.toLowerCase().slice(0, 2) as Language;
  return LANGUAGE_IDS.includes(code) ? code : "en";
}

export interface Settings {
  opacity: number;
  scale: number;
  accent: AccentId;
  /** The own accent color ("#rrggbb"), used when `accent` is "custom". */
  customAccent: string;
  language: Language;
  /** Overlay visible in screen captures (streams, recordings). */
  showInCapture: boolean;
  widgets: { session: boolean; stats: boolean; weapon: boolean };
  /** Install updates by itself (never while Destiny runs). */
  autoUpdate: boolean;
  /** Look for updates on GitHub by itself (off: only when asked). */
  updateChecks: boolean;
}


/** The website's demo: the colour the website passes (?accent=void or a
 *  "#rrggbb"), the one the visitor picked there last; else Void. */
function demoAccent(): Pick<Settings, "accent" | "customAccent"> {
  const asked = new URLSearchParams(location.search).get("accent") ?? "";
  if (asked in ACCENTS) return { accent: asked as AccentId, customAccent: "#e64980" };
  if (/^#[0-9a-f]{6}$/i.test(asked)) return { accent: "custom", customAccent: asked };
  return { accent: "void", customAccent: "#e64980" };
}

export const DEFAULT_SETTINGS: Settings = {
  opacity: 0.95,
  scale: 1,
  accent: "solar",
  customAccent: "#e64980",
  // The website's demo: the website's colour (see demoAccent).
  ...(isDemo ? demoAccent() : {}),
  // Follow the system language on first start (the website's demo: English,
  // its autopilot finds buttons by their English text).
  language: isDemo ? "en" : systemLanguage(),
  showInCapture: true,
  widgets: { session: true, stats: true, weapon: true },
  autoUpdate: false,
  updateChecks: true,
};

const KEY = "radar.settings";
const EVENT = "settings-changed";

function load(): Settings {
  // The website's demo starts as recorded every visit (its colour matches
  // the carousel's pictures of it), whatever this browser saved before.
  if (isDemo) return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        widgets: { ...DEFAULT_SETTINGS.widgets, ...parsed.widgets },
        language: parsed.language && LANGUAGE_IDS.includes(parsed.language) ? parsed.language : DEFAULT_SETTINGS.language,
      };
    }
  } catch {
    // Corrupt or blocked storage: fall back to defaults.
  }
  return DEFAULT_SETTINGS;
}

/** The accent color the settings pick. */
export function accentColor(s: Pick<Settings, "accent" | "customAccent">): string {
  return s.accent === "custom" ? s.customAccent : (ACCENTS[s.accent]?.color ?? ACCENTS.solar.color);
}

/** The accent in use; `wipe`: with the animation (lib/accentWipe.ts). */
function applyAccent(s: Settings, wipe = false) {
  const color = accentColor(s);
  const root = document.documentElement;
  if (root.style.getPropertyValue("--accent") === color) return;
  const change = () => root.style.setProperty("--accent", color);
  if (wipe) accentWipe(change);
  else change();
}

/*
 * One settings store per window, shared by every component in it. Changes
 * are persisted and broadcast so the other window (control / overlay)
 * follows along.
 */
let current = load();
const listeners = new Set<() => void>();
applyAccent(current);

function setCurrent(next: Settings, animate = true) {
  // Picking another color wipes it in; dragging the custom one doesn't (nor
  // in the website's demo: the colour changes there at once, like the site).
  const wipe = animate && !isDemo && next.accent !== current.accent;
  current = next;
  applyAccent(next, wipe);
  listeners.forEach((l) => l());
}

subscribe<Settings>(EVENT, (next) => setCurrent(next));

// First start: the language picked in the setup window (once).
if (isTauri && !isDemo) {
  let saved = true;
  try {
    saved = !!localStorage.getItem(KEY);
  } catch {
    // Storage blocked: as saved.
  }
  void call<string | null>("install_language").then((code) => {
    if (!saved && code && LANGUAGE_IDS.includes(code as Language)) updateSettings({ language: code as Language });
  });
}

/** `fromSite`: the website's demo setting what the website says (no wipe,
 *  not told back to it). */
export function updateSettings(patch: Partial<Settings>, fromSite = false) {
  const next = { ...current, ...patch };
  try {
    if (!isDemo) localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; the change still applies for this session.
  }
  setCurrent(next, !fromSite);
  broadcast(EVENT, next);
  // The website's demo: the website takes the colour picked here.
  if (isDemo && !fromSite && (patch.accent !== undefined || patch.customAccent !== undefined) && window.parent !== window) {
    const accent = next.accent === "custom" ? next.customAccent : next.accent;
    window.parent.postMessage({ radarDemo: "accent", accent, color: accentColor(next) }, location.origin);
  }
}

function subscribeStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings as they are now (outside React). */
export function getSettings(): Settings {
  return current;
}

/** Settings shared between the control window and the overlay. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribeStore, () => current);
  return [settings, updateSettings];
}
