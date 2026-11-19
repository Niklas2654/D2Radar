import { useEffect, useRef, useState } from "react";
import { applyAccent } from "../fx";

/** The app's own size in the frame (CSS px); it's scaled to the stage. */
const APP_W = 1280;
const APP_H = 800;
/** How long growing to the big view and back takes (ms). */
const GROW_MS = 650;
const EASE = "cubic-bezier(.2,.8,.2,1)";

interface Props {
  /** Its texts in the site's language. */
  labels: { demo: string; clickToTry: string; backToTour: string };
  /** The demo app (the app's web build with ?demo). */
  src: string;
  /** The step's scene (the autopilot's name); null: none to play. */
  scene: string | null;
  /** The step's picture: seen until its scene is set up in the app. */
  still: string | null;
  /** The picture to show if that one is missing. */
  fallback?: string;
  alt: string;
  /** The tour is on screen (else the app pauses). */
  playing: boolean;
  /** Load the app (it's near the screen). */
  load: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };

/** The tour's stage: the real app (its demo, src/web/demo.ts in the app)
 *  playing the current step's scene with its autopilot, like a clip, over
 *  that step's picture (which shows while the scene is set up). The page
 *  scrolls over it as over a picture; a click takes the app over: it grows
 *  to a big view and the visitor uses it themselves; "Back to the tour"
 *  shrinks it back, and the next step's scene plays again. */
export function Stage({ labels, src, scene, still, fallback, alt, playing, load }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // The scene that's set up in the app (it shows only then).
  const [shown, setShown] = useState<string | null>(null);
  // open: the big view is asked for (its backdrop and button); held: the
  // app is the visitor's, until it's back in its place.
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const want = useRef(scene);
  want.current = scene;
  const state = useRef({ asked: null as string | null, started: null as string | null, open: false, moving: false });

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, location.origin);

  // The app scaled to its box (as it grows and shrinks too).
  useEffect(() => {
    const b = box.current;
    if (!b || !load) return;
    const fit = () => {
      if (frame.current) frame.current.style.transform = `scale(${b.clientWidth / APP_W})`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    fit();
    return () => ro.disconnect();
  }, [load]);

  // The step's scene, once the page has stopped on it for a moment.
  useEffect(() => {
    const s = state.current;
    if (!ready || s.open) return;
    if (!playing || !scene) {
      if (s.asked) {
        s.asked = null;
        s.started = null;
        post({ radarDemo: "pause" });
      }
      setShown(null);
      return;
    }
    if (s.asked === scene) {
      setShown(s.started === scene ? scene : null);
      return;
    }
    setShown(null);
    const timer = window.setTimeout(() => {
      s.asked = scene;
      s.started = null;
      post({ radarDemo: "scene", scene });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, playing, scene]);

  /** The big view: most of the window, the app's shape, room for the button. */
  const bigRect = (): Rect => {
    const w = Math.min(innerWidth * 0.94, (innerHeight - 110) * (APP_W / APP_H));
    const h = w * (APP_H / APP_W);
    return { x: Math.round((innerWidth - w) / 2), y: Math.round(64 + (innerHeight - 64 - h) / 2), w: Math.round(w), h: Math.round(h) };
  };
  const place = (r: Rect) => {
    const b = box.current;
    if (!b) return;
    b.style.left = `${r.x}px`;
    b.style.top = `${r.y}px`;
    b.style.width = `${r.w}px`;
    b.style.height = `${r.h}px`;
  };

  /** Grow to (or shrink back from) the big view: fixed in the window for
   *  it, from where the box is now. */
  const grow = (to: Rect, done?: () => void) => {
    const b = box.current;
    if (!b) return;
    state.current.moving = true;
    const now = b.getBoundingClientRect();
    b.style.transition = "none";
    b.style.position = "fixed";
    b.style.inset = "auto";
    place({ x: now.left, y: now.top, w: now.width, h: now.height });
    void b.offsetWidth;
    b.style.transition = ["left", "top", "width", "height"].map((p) => `${p} ${GROW_MS}ms ${EASE}`).join(", ");
    place(to);
    window.setTimeout(() => {
      b.style.transition = "none";
      state.current.moving = false;
      done?.();
    }, GROW_MS);
  };

  const takeOver = () => {
    const s = state.current;
    if (s.open || !ready) return;
    s.open = true;
    // The autopilot stops wherever it was: the app is the visitor's.
    post({ radarDemo: "takeover" });
    setOpen(true);
    setHeld(true);
    const root = document.documentElement;
    root.classList.add("demo-open");
    root.style.overflow = "hidden";
    grow(bigRect());
  };

  const close = () => {
    const s = state.current;
    if (!s.open || s.moving) return;
    setOpen(false);
    const r = stage.current?.getBoundingClientRect();
    grow(r ? { x: r.left, y: r.top, w: r.width, h: r.height } : bigRect(), () => {
      // Back in its place on the stage.
      if (box.current) box.current.style.cssText = "";
      // The app stays as the visitor left it (no new scene for this step):
      // the autopilot takes it up again with the next step.
      s.open = false;
      s.asked = want.current;
      s.started = want.current;
      setShown(want.current);
      setHeld(false);
      const root = document.documentElement;
      root.classList.remove("demo-open");
      root.style.overflow = "";
      post({ radarDemo: "giveback" });
    });
  };

  // The demo's messages (loaded, a scene set up, a colour picked); Escape
  // and the window's size while it's big.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || !e.data?.radarDemo) return;
      const s = state.current;
      switch (e.data.radarDemo) {
        case "ready":
          setReady(true);
          break;
        case "accent":
          // A colour picked in the demo's settings: the site's from now on.
          if (typeof e.data.color === "string" && /^#[0-9a-f]{6}$/i.test(e.data.color)) {
            applyAccent({ accent: String(e.data.accent), color: e.data.color });
          }
          break;
        case "started":
          if (s.asked === e.data.scene) {
            s.started = s.asked;
            if (want.current === s.asked) setShown(s.asked);
          }
          break;
        case "takeover":
          takeOver();
          break;
      }
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    const resize = () => {
      const s = state.current;
      if (s.open && !s.moving) place(bigRect());
    };
    window.addEventListener("message", on);
    window.addEventListener("keydown", esc);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("message", on);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("resize", resize);
      document.documentElement.classList.remove("demo-open");
      document.documentElement.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = held || (shown !== null && shown === scene);

  return (
    <div ref={stage} className="relative aspect-[16/10] w-full">
      {/* The step's picture (or, with none yet, what's to come). */}
      <div className="absolute inset-0 overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#0b0c12]">
        {still ? (
          <img
            src={still}
            alt={alt}
            draggable={false}
            className="block size-full object-cover"
            onError={(e) => {
              if (fallback && !e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
            }}
          />
        ) : (
          <div className="grid size-full place-items-center text-[13px] text-white/30">{alt}</div>
        )}
      </div>

      <div
        aria-hidden
        onClick={close}
        className={`fixed inset-0 z-[55] bg-[#05060a]/80 backdrop-blur-sm transition-opacity duration-500 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <button
        onClick={close}
        tabIndex={open ? 0 : -1}
        className={`btn-ghost fixed top-4 left-1/2 z-[61] inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-xl px-4 text-[13.5px] font-medium transition-opacity duration-500 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {labels.backToTour}
      </button>

      {/* The app: gone at once when the step changes (the old scene mustn't
          linger over the next picture), back with a short fade. */}
      <div
        ref={box}
        className={`absolute inset-0 overflow-hidden rounded-[14px] bg-[#05060a] ${held ? "z-[60]" : "pointer-events-none"} ${visible ? "opacity-100 transition-opacity duration-300" : "opacity-0"}`}
      >
        {load && (
          <iframe
            ref={frame}
            src={src}
            title={labels.demo}
            tabIndex={held ? 0 : -1}
            className="absolute top-0 left-0 block border-0"
            style={{ width: APP_W, height: APP_H, transformOrigin: "0 0" }}
          />
        )}
      </div>

      {/* Like a picture until clicked: the page scrolls over it. */}
      {!held && scene && (
        <button onClick={takeOver} aria-label={labels.clickToTry} title={labels.clickToTry} className="absolute inset-0 z-10 cursor-pointer rounded-[14px]" />
      )}
    </div>
  );
}
