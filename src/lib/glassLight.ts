/**
 * Light over the glass panels: every panel gets the light's position in its
 * own coordinates (--mx / --my) and --glow, 1 on the panel under the
 * pointer, else 0 (eased by a CSS transition, see styles.css). The light
 * glides after the pointer (briefly) instead of sticking to it.
 */
export function followPointerLight() {
  /** How much of the way to the pointer the light moves in 16 ms (it
   *  glides after it; by time, so a slow frame doesn't make it lag). */
  const FOLLOW = 0.35;
  const target = { x: -9999, y: -9999 };
  const light = { x: -9999, y: -9999 };
  const glowing = new WeakMap<HTMLElement, boolean>();
  const lit = new WeakMap<HTMLElement, boolean>();
  /** How far the light reaches outside a panel (its sheen's radius). */
  const REACH = 650;
  let frame = 0;
  let last = 0;

  const draw = (now: number) => {
    frame = 0;
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now;
    const step = 1 - Math.pow(1 - FOLLOW, dt / 16);
    // Far away (start, pointer gone): jump; else glide.
    const far = Math.abs(target.x - light.x) > 2000 || Math.abs(target.y - light.y) > 2000;
    light.x = far ? target.x : light.x + (target.x - light.x) * step;
    light.y = far ? target.y : light.y + (target.y - light.y) * step;
    // The tiles too (.spotlight): the light passing over a grid of them.
    // Every position read first, then every change written: reading after
    // a write would lay the page out again for each tile.
    const els = [...document.querySelectorAll<HTMLElement>(".glass, .spotlight")];
    const rects = els.map((el) => el.getBoundingClientRect());
    els.forEach((el, i) => {
      const r = rects[i];
      // An app panel: its light spot moved, faded in under the pointer
      // (nothing set on the panel itself: that repainted all of it).
      const own = el.firstElementChild;
      if (own?.classList.contains("glass-light")) {
        const spot = own.firstElementChild as HTMLElement | null;
        if (spot) spot.style.transform = `translate3d(${(light.x - r.left - 650).toFixed(1)}px, ${(light.y - r.top - 650).toFixed(1)}px, 0)`;
        const inside = target.x >= r.left && target.x <= r.right && target.y >= r.top && target.y <= r.bottom;
        if (glowing.get(el) !== inside) {
          glowing.set(el, inside);
          own.classList.toggle("is-lit", inside);
        }
        return;
      }
      // Only panels the light reaches are touched (each update repaints).
      const dx = Math.max(r.left - light.x, 0, light.x - r.right);
      const dy = Math.max(r.top - light.y, 0, light.y - r.bottom);
      if (dx > REACH || dy > REACH) {
        if (lit.get(el)) {
          lit.set(el, false);
          el.style.setProperty("--mx", "-9999px");
          el.style.setProperty("--my", "-9999px");
        }
      } else {
        lit.set(el, true);
        el.style.setProperty("--mx", `${(light.x - r.left).toFixed(1)}px`);
        el.style.setProperty("--my", `${(light.y - r.top).toFixed(1)}px`);
      }
      const inside = target.x >= r.left && target.x <= r.right && target.y >= r.top && target.y <= r.bottom;
      if (glowing.get(el) !== inside) {
        glowing.set(el, inside);
        el.style.setProperty("--glow", inside ? "1" : "0");
      }
    });
    // Keep gliding until the light has caught up.
    if (Math.abs(target.x - light.x) > 0.5 || Math.abs(target.y - light.y) > 0.5) queue();
    else last = 0;
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  window.addEventListener("pointermove", (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
    queue();
  });
  // Scrolling moves panels under a resting pointer.
  window.addEventListener("scroll", queue, true);
  document.addEventListener("pointerleave", () => {
    target.x = target.y = -9999;
    queue();
  });
}
