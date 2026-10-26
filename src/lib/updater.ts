import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { getSettings } from "./settings";
import { call, isTauri } from "./tauri";

/** Where Radar's updates stand. The newest release of the public D2Radar
 *  repo (its latest.json, see tauri.conf.json) is looked up at start, every
 *  hour, and when Radar comes to the front again a while after the last look; installing downloads it, runs the installer (passive:
 *  just a progress bar) and starts Radar again. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; progress: number | null }
  | { kind: "error"; message: string };

const CHECK_EVERY_MS = 3_600_000;
/** Back in front (or the PC awake again): looked up if the last look is this old. */
const CHECK_AGAIN_AFTER_MS = 15 * 60_000;
/** How often the clock is looked at: by the time of day, so a sleeping PC
 *  (its timers stand still meanwhile) doesn't put the next look off. */
const TICK_MS = 60_000;
/** After the start, so the first check doesn't compete with loading. */
const FIRST_CHECK_MS = 8_000;

let state: UpdateState = { kind: "idle" };
let pending: Update | null = null;
const listeners = new Set<(s: UpdateState) => void>();

function set(next: UpdateState) {
  state = next;
  listeners.forEach((l) => l(next));
}

/** Look for a newer version. Quiet: a failed background check leaves the
 *  state as it was (offline …); one asked for shows its error. */
let lastCheck = 0;

export async function checkForUpdate(quiet = false) {
  if (!isTauri || state.kind === "installing") return;
  lastCheck = Date.now();
  if (!quiet) set({ kind: "checking" });
  try {
    pending = await check();
    set(pending ? { kind: "available", version: pending.version } : { kind: "current" });
  } catch (e) {
    if (!quiet) set({ kind: "error", message: String(e) });
  }
}

/** Download and install the update found, then restart Radar. */
export async function installUpdate() {
  if (!pending || state.kind === "installing") return;
  const version = pending.version;
  let total = 0;
  let done = 0;
  set({ kind: "installing", version, progress: null });
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        done += event.data.chunkLength;
        set({ kind: "installing", version, progress: total ? Math.min(1, done / total) : null });
      }
    });
    // (On Windows the installer usually closes Radar itself first.)
    await relaunch();
  } catch (e) {
    set({ kind: "error", message: String(e) });
  }
}

/** With automatic updates on: how often to look again whether Destiny
 *  has closed (an update never restarts Radar mid-game). */
const GAME_CHECK_MS = 60_000;
let waitingForGame = 0;

/** Automatic updates on and one found: installed now, or once Destiny
 *  isn't running. */
export async function autoInstall() {
  window.clearTimeout(waitingForGame);
  if (!getSettings().autoUpdate || !getSettings().updateChecks || state.kind !== "available") return;
  const overlay = await call<{ gameRunning: boolean }>("get_overlay_state").catch(() => null);
  if (overlay?.gameRunning) {
    waitingForGame = window.setTimeout(() => void autoInstall(), GAME_CHECK_MS);
    return;
  }
  await installUpdate();
}

let started = false;

/** The background checks; once, from the app's start. */
export function startUpdateChecks() {
  if (!isTauri || started) return;
  started = true;
  // (Not at all when turned off: Settings → Privacy.)
  const look = () => {
    if (getSettings().updateChecks) void checkForUpdate(true).then(autoInstall);
  };
  const lookIfOlder = (ms: number) => {
    if (Date.now() - lastCheck >= ms) look();
  };
  window.setTimeout(look, FIRST_CHECK_MS);
  window.setInterval(() => lookIfOlder(CHECK_EVERY_MS), TICK_MS);
  window.addEventListener("focus", () => lookIfOlder(CHECK_AGAIN_AFTER_MS));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") lookIfOlder(CHECK_AGAIN_AFTER_MS);
  });
}

export function useUpdate(): UpdateState {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    return () => void listeners.delete(setCurrent);
  }, []);
  return current;
}
