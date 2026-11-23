// Windows over the whole app (feedback, what's new, the language restart):
// Discord and DIM are native webviews that lie above all of Radar's HTML,
// so while one of these is open their pages hide them and show their
// last picture instead.

import { useEffect, useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();

function change(by: number) {
  count += by;
  for (const listener of listeners) listener();
}

/** While `on`: the app is covered (the webviews step aside). */
export function useCover(on: boolean) {
  useEffect(() => {
    if (!on) return;
    change(1);
    return () => change(-1);
  }, [on]);
}

/** Whether something covers the app. */
export function useCovered(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => count > 0,
  );
}
