/**
 * Now and then, at random, a light runs through the app: the loading
 * screen's comet once around one of the panels on screen, or a band of
 * light through the whole navbar (styles.css: .beam, .nav-sweep.run).
 * Returns a function that stops it.
 */
export function startLights(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  let timer = 0;

  // Restart a one-shot CSS animation by toggling its class.
  const play = (el: Element, cls: string, ms: number) => {
    el.classList.remove(cls);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  };

  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };

  const tick = () => {
    if (!document.hidden) {
      // A dialog open (a raid's runs, a run's report): only the topmost
      // one, never what's dimmed behind it, and not the navbar's sweep.
      const dialogs = document.querySelectorAll("[data-dialog]");
      const top = dialogs[dialogs.length - 1];
      const panels = [...(top ?? document).querySelectorAll(".glass:not(.glass-hud)")].filter(
        // Outer panels only, and only what can be seen.
        (el) => !el.parentElement?.closest(".glass") && onScreen(el),
      );
      const sweep = top ? null : document.querySelector(".nav-sweep");
      if (sweep && (panels.length === 0 || Math.random() < 0.3)) play(sweep, "run", 3600);
      else if (panels.length > 0) play(panels[Math.floor(Math.random() * panels.length)], "beam", 2000);
    }
    timer = window.setTimeout(tick, 4000 + Math.random() * 8000);
  };
  timer = window.setTimeout(tick, 2500);
  return () => window.clearTimeout(timer);
}
