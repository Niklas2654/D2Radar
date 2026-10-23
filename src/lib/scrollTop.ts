import { useLayoutEffect, useRef } from "react";

/** A scroll container that starts at the top again whenever `key` changes
 *  (another weapon, player or loadout opened in it). */
export function useScrollTopOn<T extends HTMLElement = HTMLDivElement>(key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [key]);
  return ref;
}
