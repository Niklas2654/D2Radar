/**
 * Light over the glass panels: every panel gets the light's position in its
 * own coordinates (--mx / --my) and --glow, 1 on the panel under the
 * pointer, else 0 (eased by a CSS transition, see styles.css). The light
 * glides after the pointer instead of sticking to it.
 */
export function followPointerLight() {
  /** How much of the way to the pointer the light moves per frame. */
  const FOLLOW = 0.16;
  const target = { x: -9999, y: -9999 };
  const light = { x: -9999, y: -9999 };
  const glowing = new WeakMap<HTMLElement, boolean>();
  const lit = new WeakMap<HTMLElement, boolean>();
  /** How far the light reaches outside a panel (its sheen's radius). */
  const REACH = 650;
  let frame = 0;

  const draw = () => {
    frame = 0;
    // Far away (start, pointer gone): jump; else glide.
    const far = Math.abs(target.x - light.x) > 2000 || Math.abs(target.y - light.y) > 2000;
    light.x = far ? target.x : light.x + (target.x - light.x) * FOLLOW;
    light.y = far ? target.y : light.y + (target.y - light.y) * FOLLOW;
    // The tiles too (.spotlight): the light passing over a grid of them.
    for (const el of document.querySelectorAll<HTMLElement>(".glass, .spotlight")) {
      const r = el.getBoundingClientRect();
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
    }
    // Keep gliding until the light has caught up.
    if (Math.abs(target.x - light.x) > 0.5 || Math.abs(target.y - light.y) > 0.5) queue();
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
