/**
 * A new accent color, revealed left to right behind a band of light (a
 * view transition: the page before, the page after, the after uncovered).
 * Only in the control window; in the overlay over the game, at once.
 */

let running = false;

function animated(): boolean {
  return (
    "startViewTransition" in document &&
    !location.pathname.includes("overlay") &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Apply `change` (the new accent) with the wipe, or at once. */
export function accentWipe(change: () => void) {
  if (running || !animated()) {
    change();
    return;
  }
  running = true;
  // Only in the page after: its own layer moves along the edge (styles.css).
  const band = document.createElement("div");
  band.className = "accent-shimmer";
  // The stripe at the angle of the wipe's edge (25% of the width over the
  // height of the window, see styles.css).
  const slant = Math.atan((0.25 * innerWidth) / Math.max(1, innerHeight));
  band.style.setProperty("--wipe-angle", `${90 + (slant * 180) / Math.PI}deg`);
  const transition = document.startViewTransition(() => {
    change();
    document.body.append(band);
  });
  void transition.finished.finally(() => {
    band.remove();
    running = false;
  });
}
