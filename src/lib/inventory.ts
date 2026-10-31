import { useEffect, useState, useSyncExternalStore } from "react";
import { call, isTauri, subscribe } from "./tauri";

/**
 * The player's items as Radar keeps them (fetched once, kept on disk,
 * fetched anew when read and two minutes old (the app working with items),
 * every 30 minutes otherwise, when Radar comes back to the front after a while,
 * and on the reload button). Views that list items reload theirs when the
 * items were fetched anew (`useInventoryVersion`).
 */

/** When the items were last fetched (unix seconds; 0: not known). */
let fetchedAt = 0;
let loading = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function set(at: number) {
  if (at && at !== fetchedAt) {
    fetchedAt = at;
    notify();
  }
}

/** Back to the front this long after the last fetch: fetched anew. */
const ON_FOCUS_AFTER_S = 3 * 60;

let started = false;
function start() {
  if (started || !isTauri) return;
  started = true;
  void call<number>("inventory_fetched_at").then((at) => set(at ?? 0));
  subscribe<number>("inventory-updated", (at) => set(at));
  window.addEventListener("focus", () => {
    void call<number>("inventory_refresh", { olderThan: ON_FOCUS_AFTER_S })
      .then((at) => set(at ?? 0))
      .catch(() => {});
  });
}

/** Fetch the items now (the reload button). */
export async function reloadInventory() {
  loading = true;
  notify();
  try {
    set((await call<number>("inventory_refresh")) ?? 0);
  } finally {
    loading = false;
    notify();
  }
}

const sub = (l: () => void) => {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
};

/** When the items were fetched (changes when they're fetched anew). */
export function useInventoryVersion(): number {
  return useSyncExternalStore(sub, () => fetchedAt);
}

/** Whether a reload is running. */
export function useInventoryLoading(): boolean {
  return useSyncExternalStore(sub, () => loading);
}

/** "2 min ago", ticking along. */
export function useAgo(at: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return at ? Math.max(0, Math.floor((now / 1000 - at) / 60)) : -1;
}
