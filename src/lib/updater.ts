import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { isTauri } from "./tauri";

/** Where Radar's updates stand. The newest release of the public D2Radar
 *  repo (its latest.json, see tauri.conf.json) is looked up at start and
 *  every few hours; installing downloads it, runs the installer (passive:
 *  just a progress bar) and starts Radar again. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing"; version: string; progress: number | null }
  | { kind: "error"; message: string };

const CHECK_EVERY_MS = 6 * 3_600_000;
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
export async function checkForUpdate(quiet = false) {
  if (!isTauri || state.kind === "installing") return;
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

let started = false;

/** The background checks; once, from the app's start. */
export function startUpdateChecks() {
  if (!isTauri || started) return;
  started = true;
  window.setTimeout(() => void checkForUpdate(true), FIRST_CHECK_MS);
  window.setInterval(() => void checkForUpdate(true), CHECK_EVERY_MS);
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
