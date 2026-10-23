import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { applyAccent } from "../fx";
import type { CarouselControl, FrontCard } from "./PrismCarousel";

/** The app's own size in the frame (CSS px); it's scaled to the card. */
const APP_W = 1280;
const APP_H = 800;
/** How long growing to the big view and back takes (ms). */
const GROW_MS = 650;

interface Props {
  /** The demo app (the app's web build with ?demo). */
  src: string;
  /** The autopilot's scene for each carousel item. */
  scenes: string[];
  front: MutableRefObject<FrontCard | null>;
  control: MutableRefObject<CarouselControl | null>;
  /** Set to open the app big (a click on the front card before it shows). */
  opener?: MutableRefObject<(() => void) | null>;
  /** The app is up (the carousel shows its pictures from then on). */
  onReady?: () => void;
}

type Rect = { x: number; y: number; w: number; h: number };

/** The real app (its demo, src/web/demo.ts in the app) over the carousel's
 *  front card, playing that item's scene with its autopilot like a clip.
 *  A click in takes it over: it grows to a big view and the visitor uses
 *  the app themselves; "Back to the tour" shrinks it back and the scenes go
 *  on. Shown in a frame on top of the page (a portal): placed over the card
 *  in the document, so it scrolls with the page by itself (placed by script
 *  on each scroll it would trail a frame behind); fixed in the window only
 *  while big. */
export function LiveDemo({ src, scenes, front, control, opener, onReady }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [open, setOpen] = useState(false);
  // playing: the item whose scene was asked for; started: the one whose
  // scene is set up (the app shows only then: it looks like the picture).
  const state = useRef({ ready: false, playing: -1, started: -1, open: false, moving: false, hover: false, wheelAt: 0, shown: false });

  const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, location.origin);

  /** Place the box (only when it changed: each write makes the browser redo
   *  the app in it). */
  const placed = useRef("");
  const scaled = useRef("");
  const place = (r: Rect) => {
    const b = box.current;
    if (!b) return;
    const key = `${r.x} ${r.y} ${r.w} ${r.h}`;
    if (key === placed.current) return;
    placed.current = key;
    b.style.left = `${r.x}px`;
    b.style.top = `${r.y}px`;
    b.style.width = `${r.w}px`;
    b.style.height = `${r.h}px`;
  };

  // Each frame: over the front card (unless open), the app scaled to the
  // box, shown while the carousel stands; the scene of the item in front.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = state.current;
      const b = box.current;
      const f = front.current;
      if (b && f) {
        if (!s.open && !s.moving) {
          place(f);
          // Only in the tour's cinema mode (the carousel in the middle, the
          // page dark around it, Tour): elsewhere it stands still on the
          // card's picture. The scene of the card it turns to is set up
          // while it turns.
          const inView = document.documentElement.classList.contains("cine");
          const asked = s.ready && inView;
          const show = asked && f.settled && f.index === f.target && s.started === f.target;
          if (show !== s.shown) {
            s.shown = show;
            // Gone at once when the carousel moves on (the old scene mustn't
            // linger over the next card); back with a short fade.
            b.style.transition = show ? "opacity 300ms" : "none";
            b.style.opacity = show ? "1" : "0";
            b.style.pointerEvents = show ? "auto" : "none";
          }
          if (asked && s.playing !== f.target) {
            s.playing = f.target;
            s.started = -1;
            post({ radarDemo: "scene", scene: scenes[f.target] });
          } else if (!asked && s.playing !== -1) {
            s.playing = -1;
            s.started = -1;
            post({ radarDemo: "pause" });
          }
        }
        // (The card's known width while over it: reading the box's would make
        // the browser lay out the page each frame.)
        const scale = `scale(${(s.open || s.moving ? b.clientWidth : f.w) / APP_W})`;
        // (Compared with what was set: the browser hands it back rounded.)
        if (frame.current && scaled.current !== scale) {
          scaled.current = scale;
          frame.current.style.transform = scale;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [front, scenes]);

  /** The big view: most of the window, the app's shape, room for the button. */
  const bigRect = (): Rect => {
    const w = Math.min(innerWidth * 0.94, (innerHeight - 110) * (APP_W / APP_H));
    const h = w * (APP_H / APP_W);
    return { x: Math.round((innerWidth - w) / 2), y: Math.round(64 + (innerHeight - 64 - h) / 2), w: Math.round(w), h: Math.round(h) };
  };

  /** Grow to (or shrink back from) the big view, in window coordinates:
   *  fixed in the window for it, from where the box is now. */
  const grow = (to: Rect, done: () => void) => {
    const b = box.current;
    if (!b) return;
    state.current.moving = true;
    const now = b.getBoundingClientRect();
    b.style.transition = "none";
    b.style.position = "fixed";
    placed.current = "";
    place({ x: now.left, y: now.top, w: now.width, h: now.height });
    void b.offsetWidth;
    b.style.transition = `left ${GROW_MS}ms cubic-bezier(.2,.8,.2,1), top ${GROW_MS}ms cubic-bezier(.2,.8,.2,1), width ${GROW_MS}ms cubic-bezier(.2,.8,.2,1), height ${GROW_MS}ms cubic-bezier(.2,.8,.2,1), border-radius ${GROW_MS}ms`;
    place(to);
    window.setTimeout(() => {
      b.style.transition = "opacity 300ms";
      state.current.moving = false;
      done();
    }, GROW_MS);
  };

  const takeOver = () => {
    const s = state.current;
    if (s.open) return;
    s.open = true;
    s.playing = -1;
    // Seen and usable whatever it was doing (it may have been about to show).
    const b = box.current;
    if (b) {
      b.style.transition = "none";
      b.style.opacity = "1";
      b.style.pointerEvents = "auto";
      s.shown = true;
    }
    setOpen(true);
    control.current?.hold(true);
    document.documentElement.style.overflow = "hidden";
    grow(bigRect(), () => {});
  };

  const close = () => {
    const s = state.current;
    if (!s.open || s.moving) return;
    setOpen(false);
    const f = front.current;
    grow(f ? { ...f, x: f.x - scrollX, y: f.y - scrollY } : bigRect(), () => {
      // Back in the document, over the card.
      const b = box.current;
      if (b && f) {
        b.style.transition = "none";
        b.style.position = "absolute";
        placed.current = "";
        place(f);
        void b.offsetWidth;
        b.style.transition = "opacity 300ms";
      }
      // The app stays as the visitor left it (no new scene for this card,
      // shown on): the autopilot only takes it up again with the next card.
      if (f) {
        s.playing = f.target;
        s.started = f.target;
        s.shown = true;
      }
      s.open = false;
      document.documentElement.style.overflow = "";
      control.current?.hold(false);
      post({ radarDemo: "giveback" });
    });
  };

  // A click on the front card before the app shows on it: open it now (the
  // autopilot stops wherever it was).
  if (opener) {
    opener.current = () => {
      if (state.current.open) return;
      post({ radarDemo: "takeover" });
      takeOver();
    };
  }

  // The demo's messages: loaded, a scene ended, taken over, the wheel.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || !e.data?.radarDemo) return;
      const s = state.current;
      switch (e.data.radarDemo) {
        case "ready":
          s.ready = true;
          onReady?.();
          break;
        case "accent":
          // A colour picked in the demo's settings: the site's from now on.
          if (typeof e.data.color === "string" && /^#[0-9a-f]{6}$/i.test(e.data.color)) {
            applyAccent({ accent: String(e.data.accent), color: e.data.color });
          }
          break;
        case "started":
          if (scenes[s.playing] === e.data.scene) s.started = s.playing;
          break;
        // (A scene that ended stays as it is: the visitor moves on.)
        case "takeover":
          takeOver();
          break;
        case "wheel": {
          // The app is over the front card: the wheel turns the carousel
          // (one picture per notch; beside it the page scrolls).
          if (s.open) break;
          const dx = Number(e.data.deltaX) || 0;
          const dy = Number(e.data.deltaY) || 0;
          const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
          const now = performance.now();
          if (Math.abs(d) < 2 || now - s.wheelAt < 260) break;
          s.wheelAt = now;
          if (d > 0) control.current?.next();
          else control.current?.prev();
          break;
        }
      }
    };
    window.addEventListener("message", on);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("message", on);
      window.removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <>
      <div
        aria-hidden
        onClick={close}
        className={`fixed inset-0 z-[55] bg-[#05060a]/80 backdrop-blur-sm transition-opacity duration-500 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <button
        onClick={close}
        className={`btn-ghost fixed top-4 left-1/2 z-[61] inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-xl px-4 text-[13.5px] font-medium transition-opacity duration-500 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to the tour
      </button>
      <div
        ref={box}
        onPointerEnter={() => {
          state.current.hover = true;
          if (!state.current.open) control.current?.hold(true);
        }}
        onPointerLeave={() => {
          const s = state.current;
          s.hover = false;
          if (s.open) return;
          control.current?.hold(false);
        }}
        className={`overflow-hidden bg-[#05060a] opacity-0 ${open ? "z-[60] rounded-[14px]" : "z-40 rounded-[18px]"}`}
        style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transition: "opacity 300ms", cursor: open ? "auto" : "pointer" }}
        title={open ? undefined : "Click to try it yourself"}
      >
        <iframe
          ref={frame}
          src={src}
          title="Radar demo"
          className="absolute top-0 left-0 block border-0"
          style={{ width: APP_W, height: APP_H, transformOrigin: "0 0" }}
        />
      </div>
    </>,
    document.body,
  );
}
