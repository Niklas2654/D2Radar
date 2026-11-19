import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDemo, isTauri } from "./tauri";

/**
 * The window's animations paused while it isn't the one in front (styles.css,
 * `.app-idle`). Behind the game it still counts as visible to the webview,
 * which then drew its looping animations (the wordmark's light, the pulsing
 * dots) at the monitor's full rate, taking the GPU from the game.
 *
 * Only the looping ones and those still to come: one running with an end
 * (the delete button's fuse, a page sliding in) burns on to it, it stood
 * still half-way before (and what waits for its end with it).
 */
export function pauseWhenIdle() {
  // The website's demo plays in a frame that rarely has the focus: it
  // would stand still (its page changes stop halfway).
  if (isDemo) return;
  const set = (focused: boolean) => {
    // Played by hand, a CSS animation no longer goes by animation-play-state
    // (so `.app-idle` leaves it be) and still ends where it would have.
    if (!focused) {
      for (const a of document.getAnimations()) {
        if (a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity) a.play();
      }
    }
    document.documentElement.classList.toggle("app-idle", !focused);
    // SVG's own animations (the logo's sweep, <animate…>) aren't CSS ones:
    // paused on each SVG that has them.
    for (const svg of document.querySelectorAll("svg")) {
      if (!svg.querySelector("animate, animateTransform, animateMotion")) continue;
      if (focused) svg.unpauseAnimations();
      else svg.pauseAnimations();
    }
  };
  set(document.hasFocus());
  if (isTauri) {
    void getCurrentWindow().onFocusChanged(({ payload }) => set(payload));
  } else {
    window.addEventListener("focus", () => set(true));
    window.addEventListener("blur", () => set(false));
  }
}
