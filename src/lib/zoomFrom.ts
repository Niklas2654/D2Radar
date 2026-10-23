import { useLayoutEffect, type RefObject } from "react";

/** What was clicked last (a tile, a tag): a dialog opening grows out of it. */
let last: { rect: DOMRect; at: number } | null = null;

window.addEventListener(
  "pointerdown",
  (e) => {
    const el = (e.target as Element | null)?.closest("button, [role=button], li, a");
    last = el ? { rect: el.getBoundingClientRect(), at: performance.now() } : null;
  },
  true,
);

/**
 * A dialog's panel grows out of what was clicked to open it (when that was
 * just now), instead of showing up in the middle.
 */
export function useZoomFrom(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const from = last;
    last = null;
    if (!el || !from || performance.now() - from.at > 800) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const dx = from.rect.left + from.rect.width / 2 - (to.left + to.width / 2);
    const dy = from.rect.top + from.rect.height / 2 - (to.top + to.height / 2);
    const sx = Math.max(0.05, from.rect.width / to.width);
    const sy = Math.max(0.05, from.rect.height / to.height);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 380, easing: "cubic-bezier(0.22, 0.8, 0.2, 1)" },
    );
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
