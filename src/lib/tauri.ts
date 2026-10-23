import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

/** False when the UI runs in a plain browser (vite dev without Tauri). */
export const isTauri = "__TAURI_INTERNALS__" in window;

/** The website's demo (?demo): the app with data recorded from a real
 *  account, driven by an autopilot until the visitor takes over (src/web/demo). */
export const isDemo = !isTauri && new URLSearchParams(location.search).has("demo");

// In the website's frame, focusing a field (autoFocus, a click) would also
// scroll the website to it: the demo focuses without scrolling.
if (isDemo) {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options?: FocusOptions) {
    focus.call(this, { ...options, preventScroll: true });
  };
}

/** Something answers the app's commands: the app or the demo. */
export const hasBackend = isTauri || isDemo;

/** The demo's backend, loaded on first use (not in the app). */
const web = isDemo ? import("../web/demo") : null;

let seqCount = 0;
/** A rising number for the DIM and Discord tabs' show and hide calls: they
 *  run side by side, an older one coming in late is dropped. From the clock,
 *  so it keeps rising across a page reload. */
export const nextSeq = () => Date.now() * 1000 + (++seqCount % 1000);

export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (isTauri) return invoke<T>(cmd, args);
  return web ? web.then((b) => b.call<T>(cmd, args)) : Promise.resolve(undefined);
}

export function broadcast<T>(event: string, payload: T) {
  if (isTauri) void emit(event, payload);
}

/** Ask the control window to switch to a page (e.g. "settings"). */
/** Fired to show a player in the fireteam tab (a click on them in a run's
 *  report): `detail` their membership id and Bungie name. */
export const OPEN_PLAYER_EVENT = "radar:open-player";

export function openPlayer(membershipId: string, name: string) {
  navigate("fireteam");
  window.dispatchEvent(new CustomEvent(OPEN_PLAYER_EVENT, { detail: { membershipId, name } }));
}

export function navigate(page: string) {
  window.dispatchEvent(new CustomEvent("radar:navigate", { detail: page }));
}

/** Subscribe to an app-wide event; returns a synchronous unsubscribe. */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri) {
    if (!web) return () => {};
    let off: (() => void) | null = null;
    let gone = false;
    void web.then((b) => {
      if (!gone) off = b.subscribe(event, (payload) => handler(payload as T));
    });
    return () => {
      gone = true;
      off?.();
    };
  }
  const pending = listen<T>(event, (e) => handler(e.payload));
  return () => void pending.then((unlisten) => unlisten());
}
