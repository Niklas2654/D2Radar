/** The demo's autopilot: plays short scenes in the app (a drawn cursor
 *  that moves, clicks, types and scrolls), like a video of it, until the
 *  visitor takes over.
 *
 *  The website (the page around the demo's frame) talks to it by messages:
 *  in  { radarDemo: "scene", scene, hold? }  set a scene up and play it
 *                                     (hold: stay at its start, for pictures)
 *      { radarDemo: "pause" }         stop (the carousel moves)
 *  out { radarDemo: "ready" }         loaded
 *      { radarDemo: "started", scene } a scene is set up, at its start
 *      { radarDemo: "ended", scene }  a scene played to its end
 *      { radarDemo: "takeover" }      the visitor clicked in: the app is theirs
 *      { radarDemo: "wheel", deltaY } the wheel before that (the website turns its carousel)
 */

type Target = string | { sel: string } | { x: number; y: number };

const post = (msg: Record<string, unknown>) => window.parent?.postMessage({ radarDemo: msg.type, ...msg }, location.origin);

let run = 0;
let takenOver = false;
let cursor: HTMLDivElement | null = null;
let mouse = { x: 760, y: 440 };
let hovered: Element | null = null;
/** How fast scenes play: 1 as seen, less while setting one up unseen. */
let pace = 1;

class Stopped extends Error {}

/** Waits, unless a newer scene (or the visitor) took over meanwhile. */
function waiter(id: number) {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      window.setTimeout(() => (id === run && !takenOver ? resolve() : reject(new Stopped())), ms * pace);
    });
}

function drawCursor() {
  if (cursor) return cursor;
  cursor = document.createElement("div");
  cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:opacity .25s;";
  cursor.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 2px rgb(0 0 0/.6));transition:transform .12s"><path d="M4 2.5 L4 19 L8.6 14.9 L11.7 21.5 L14.6 20.2 L11.6 13.7 L17.8 13.7 Z" fill="white" stroke="black" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);
  place();
  return cursor;
}

function place() {
  if (cursor) cursor.style.transform = `translate(${mouse.x - 3}px, ${mouse.y - 2}px)`;
}

/** Mouse events as a real mouse there would cause: over/out when the
 *  element under it changes (React's enter/leave, the app's tooltips), move. */
function hoverAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  if (el !== hovered) {
    if (hovered) {
      hovered.dispatchEvent(new PointerEvent("pointerout", { ...init, relatedTarget: el }));
      hovered.dispatchEvent(new MouseEvent("mouseout", { ...init, relatedTarget: el }));
    }
    if (el) {
      el.dispatchEvent(new PointerEvent("pointerover", { ...init, relatedTarget: hovered }));
      el.dispatchEvent(new MouseEvent("mouseover", { ...init, relatedTarget: hovered }));
    }
    hovered = el;
  }
  el?.dispatchEvent(new PointerEvent("pointermove", init));
  el?.dispatchEvent(new MouseEvent("mousemove", init));
}

function find(target: Target): { x: number; y: number } | null {
  if (typeof target === "object" && "x" in target) return target;
  let el: Element | undefined;
  if (typeof target === "object" && "sel" in target) {
    el = [...document.querySelectorAll(target.sel)].find((e) => e.getBoundingClientRect().width > 0);
  } else {
    const all = [...document.querySelectorAll("button,a,[role=button],[role=tab],input")];
    el = all.find((e) => e.textContent?.trim() === target) ?? all.find((e) => e.textContent?.trim().startsWith(target as string));
    if (!el) {
      const leaf = [...document.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent?.trim() === target);
      el = leaf?.closest("button,a,[role=button]") ?? leaf;
    }
  }
  if (!el) return null;
  reveal(el);
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Scroll the app's own list so the element is in view: only scrollable
 *  boxes inside the app (scrollIntoView would also scroll the website
 *  around this frame). */
function reveal(el: Element) {
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top + 12;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 12;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The steps a scene is made of, all stopping when the scene is stopped. */
function steps(id: number) {
  const wait = waiter(id);
  const s = {
    wait,
    async moveTo(target: Target, ms = 650) {
      const to = find(target);
      if (!to) return;
      const from = { ...mouse };
      const start = performance.now();
      for (;;) {
        await wait(16);
        const k = Math.min(1, (performance.now() - start) / (ms * pace));
        mouse = { x: from.x + (to.x - from.x) * ease(k), y: from.y + (to.y - from.y) * ease(k) };
        place();
        hoverAt(mouse.x, mouse.y);
        if (k >= 1) break;
      }
    },
    async click(target: Target, after = 600) {
      await s.moveTo(target);
      await wait(120);
      const el = document.elementFromPoint(mouse.x, mouse.y);
      const init = { bubbles: true, cancelable: true, clientX: mouse.x, clientY: mouse.y, view: window, button: 0 };
      const svg = cursor?.firstElementChild as HTMLElement | null;
      if (svg) svg.style.transform = "scale(.82)";
      el?.dispatchEvent(new PointerEvent("pointerdown", init));
      el?.dispatchEvent(new MouseEvent("mousedown", init));
      if (el instanceof HTMLElement && el.matches("input,textarea")) el.focus({ preventScroll: true });
      await wait(90);
      if (svg) svg.style.transform = "";
      el?.dispatchEvent(new PointerEvent("pointerup", init));
      el?.dispatchEvent(new MouseEvent("mouseup", init));
      el?.dispatchEvent(new MouseEvent("click", init));
      await wait(after);
    },
    /** Type into the focused field (clearing it first when asked). */
    async type(text: string, clear = true, perChar = 75) {
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement)) return;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      if (clear) {
        set.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const ch of text) {
        set.call(input, input.value + ch);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(perChar + Math.random() * 40);
      }
    },
    /** Scroll what's under the cursor, smoothly. */
    async wheel(dy: number, ms = 900) {
      let el: Element | null = document.elementFromPoint(mouse.x, mouse.y);
      while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      if (!el) return;
      const from = el.scrollTop;
      const start = performance.now();
      for (;;) {
        await wait(16);
        const k = Math.min(1, (performance.now() - start) / (ms * pace));
        el.scrollTop = from + dy * ease(k);
        if (k >= 1) break;
      }
    },
  };
  return s;
}

type Steps = ReturnType<typeof steps>;

/** Back to a calm start at once (no cursor): no dialog, a page, scrolled up. */
function reset(page: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  window.dispatchEvent(new CustomEvent("radar:navigate", { detail: page }));
  document.querySelectorAll("*").forEach((el) => {
    if (el.scrollTop) el.scrollTop = 0;
  });
}

async function search(s: Steps, q: string) {
  await s.click({ sel: 'input[placeholder*="source" i], input[placeholder*="Quelle" i]' }, 250);
  await s.type(q);
}

/** The scenes, by the website's names. Each starts from a reset page. */
/** Back on the Database's own page (most used weapons): no search, no item. */
async function databaseHome(s: Steps) {
  await search(s, "");
  await s.wait(300);
  const back = [...document.querySelectorAll("button, a, [role=button]")].find((e) => /^←.?Overview$/.test(e.textContent?.trim() ?? ""));
  if (back instanceof HTMLElement) back.click();
}

/** The scenes, by the website's names. Each opens on its page, sets up
 *  unseen (fast, no cursor) what it starts from (the carousel's picture of
 *  it shows that start), then plays as seen. */
const SCENES: Record<string, { page: string; setup?: (s: Steps) => Promise<void>; play: (s: Steps) => Promise<void> }> = {
  fireteam: {
    page: "fireteam",
    play: async (s) => {
      await s.click("PvP", 1500);
      await s.click("PvE", 900);
      await s.moveTo({ x: 520, y: 600 }, 500);
      await s.wheel(360, 1100);
      await s.wait(900);
    },
  },
  lowman: {
    page: "fireteam",
    setup: async (s) => {
      await s.moveTo({ x: 520, y: 600 }, 100);
      await s.wheel(300, 300);
    },
    play: async (s) => {
      await s.moveTo("Root of Nightmares", 700);
      await s.wait(400);
      await s.moveTo("Day One Contest", 600);
      await s.wait(900);
      await s.moveTo("Solo Flawless", 600);
      await s.wait(1100);
      await s.moveTo("Vault of Glass", 700);
      await s.wait(1200);
    },
  },
  runs: {
    page: "fireteam",
    setup: async (s) => {
      await s.moveTo({ x: 520, y: 600 }, 100);
      await s.wheel(300, 300);
      await s.click("Solo Flawless", 2500);
    },
    play: async (s) => {
      await s.moveTo({ x: 640, y: 520 }, 600);
      await s.wheel(320, 1300);
      await s.wait(1500);
      await s.wheel(-320, 1000);
      await s.wait(800);
    },
  },
  weapon: {
    page: "weapons",
    setup: async (s) => {
      await search(s, "Mint Retrograde");
      await s.wait(1500);
      await s.click({ sel: "button:has(img)" }, 2500);
    },
    play: async (s) => {
      await s.moveTo("Rewind Rounds", 700);
      await s.wait(1400);
      await s.click("Rewind Rounds", 500);
      await s.click("Implosion Rounds", 1800);
    },
  },
  source: {
    page: "weapons",
    setup: async (s) => {
      await search(s, "source:vaultofglass");
      await s.wait(1500);
    },
    play: async (s) => {
      await s.moveTo({ x: 180, y: 420 }, 600);
      await s.wait(400);
      await s.wheel(700, 1800);
      await s.wait(600);
      await s.click("Fatebringer", 2200);
    },
  },
  meta: {
    page: "weapons",
    setup: async (s) => {
      await databaseHome(s);
      await s.wait(1500);
    },
    play: async (s) => {
      await s.moveTo({ x: 600, y: 300 }, 600);
      await s.wait(500);
      await s.click("Dungeons", 2200);
      await s.click("Raids", 1500);
      await s.moveTo({ x: 600, y: 560 }, 500);
      await s.wheel(300, 1000);
      await s.wait(900);
    },
  },
  armor: {
    page: "weapons",
    setup: async (s) => {
      await search(s, "atheon");
      await s.wait(1500);
      await s.click("Prime Zealot Cuirass", 2500);
    },
    play: async (s) => {
      await s.moveTo({ x: 820, y: 560 }, 600);
      await s.wheel(260, 1000);
      await s.wait(1600);
    },
  },
  armor2: {
    page: "weapons",
    setup: async (s) => {
      await search(s, "atheon");
      await s.wait(1500);
      await s.click("Prime Zealot Cuirass", 2500);
      await s.moveTo({ x: 820, y: 560 }, 100);
      await s.wheel(520, 300);
    },
    play: async (s) => {
      const mods = [...document.querySelectorAll("button img, [role=button] img")]
        .map((i) => i.getBoundingClientRect())
        .filter((r) => r.width > 20 && r.width < 60 && r.top > 380 && r.left > 300)
        .slice(0, 3);
      for (const r of mods) {
        await s.moveTo({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 600);
        await s.wait(1100);
      }
      await s.wait(400);
    },
  },
  loadouts: {
    page: "loadouts",
    play: async (s) => {
      await s.moveTo({ x: 640, y: 420 }, 600);
      await s.wait(800);
      await s.moveTo({ x: 640, y: 560 }, 500);
      await s.wheel(380, 1300);
      await s.wait(1200);
    },
  },
  build: {
    page: "fireteam",
    setup: async (s) => {
      const chip = [...document.querySelectorAll("button")].find((b) => /^Hunter/.test(b.textContent?.trim() ?? ""));
      const r = chip?.getBoundingClientRect();
      if (r) await s.click({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 2500);
    },
    play: async (s) => {
      await s.moveTo({ x: 900, y: 360 }, 700);
      await s.wait(1000);
      await s.moveTo({ x: 900, y: 520 }, 600);
      await s.wait(1300);
    },
  },
};

/** Where the cursor comes in when a scene starts. */
const START = { x: 1040, y: 660 };

/** Play a scene: set up unseen, tell the website it's at its start
 *  ("started"), then play it as seen (unless `hold`: stay at the start). */
async function play(name: string, hold = false) {
  const scene = SCENES[name];
  if (!scene || takenOver) return;
  const id = ++run;
  const c = drawCursor();
  c.style.opacity = "0";
  reset(scene.page);
  try {
    // (Its page shows at once; the setup at a tenth of the pace.)
    pace = 0.1;
    await waiter(id)(2500);
    if (scene.setup) await scene.setup(steps(id));
    // What the setup opened has loaded and settled.
    pace = 1;
    await waiter(id)(400);
    post({ type: "started", scene: name });
    if (hold) return;
    mouse = { ...START };
    place();
    c.style.opacity = "1";
    await scene.play(steps(id));
    post({ type: "ended", scene: name });
  } catch (e) {
    if (!(e instanceof Stopped)) console.warn("[demo]", e);
  }
}

export function startAutopilot() {
  // Inside the website's frame only; opened on its own, the demo is just the app.
  if (window.parent === window) return;
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data?.radarDemo) return;
    if (e.data.radarDemo === "scene") void play(String(e.data.scene), !!e.data.hold);
    if (e.data.radarDemo === "pause") run++;
    // The website opened it before its scene was up (a click on the card).
    if (e.data.radarDemo === "takeover") {
      takenOver = true;
      run++;
      document.body.dataset.demoOwned = "1";
      if (cursor) cursor.style.opacity = "0";
    }
  });

  // Before the visitor takes over, the frame is like a video: a click takes
  // it over (and does nothing else), the wheel goes to the website.
  const takeover = (e: Event) => {
    if (!e.isTrusted || takenOver) return;
    e.preventDefault();
    e.stopPropagation();
    takenOver = true;
    run++;
    if (cursor) cursor.style.opacity = "0";
    post({ type: "takeover" });
  };
  window.addEventListener("pointerdown", takeover, true);
  window.addEventListener("mousedown", takeover, true);
  window.addEventListener(
    "click",
    (e) => {
      if (e.isTrusted && !document.body.dataset.demoOwned) {
        e.preventDefault();
        e.stopPropagation();
        document.body.dataset.demoOwned = "1";
      }
    },
    true,
  );
  window.addEventListener(
    "wheel",
    (e) => {
      if (!e.isTrusted || takenOver) return;
      e.preventDefault();
      post({ type: "wheel", deltaX: e.deltaX, deltaY: e.deltaY, shift: e.shiftKey });
    },
    { capture: true, passive: false },
  );
  // The website gives it back (the visitor closed it): the autopilot again.
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data?.radarDemo === "giveback") {
      takenOver = false;
      delete document.body.dataset.demoOwned;
    }
  });

  // Ready once the app itself is up (past its loading screen, its tabs
  // there), not just the page.
  const waitForApp = () => {
    const up = [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Fireteam");
    if (up) window.setTimeout(() => post({ type: "ready" }), 300);
    else window.setTimeout(waitForApp, 150);
  };
  waitForApp();
}
