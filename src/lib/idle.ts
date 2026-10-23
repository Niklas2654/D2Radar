import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDemo, isTauri } from "./tauri";

/**
 * The window's animations paused while it isn't the one in front (styles.css,
 * `.app-idle`). Behind the game it still counts as visible to the webview,
 * which then drew its looping animations (the wordmark's light, the pulsing
 * dots) at the monitor's full rate, taking the GPU from the game.
 */
export function pauseWhenIdle() {
  // The website's demo plays in a frame that rarely has the focus: it
  // would stand still (its page changes stop halfway).
  if (isDemo) return;
  const set = (focused: boolean) => {
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
