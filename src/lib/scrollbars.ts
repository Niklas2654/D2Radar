/**
 * Scrollbars only show while scrolling: whatever scrolls gets the
 * `is-scrolling` class (styles.css shows its thumb), dropped again shortly
 * after the last scroll. dim.rs does the same inside DIM.
 */

/** How long a scrollbar stays visible after the last scroll. */
const VISIBLE_MS = 900;

export function autoHideScrollbars() {
  const timers = new WeakMap<Element, number>();
  addEventListener(
    "scroll",
    (e) => {
      const el = e.target instanceof Element ? e.target : document.documentElement;
      el.classList.add("is-scrolling");
      window.clearTimeout(timers.get(el));
      timers.set(
        el,
        window.setTimeout(() => el.classList.remove("is-scrolling"), VISIBLE_MS),
      );
    },
    // Scroll events don't bubble; capture sees every scrolling element.
    { capture: true, passive: true },
  );
}
