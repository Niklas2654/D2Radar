import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";

/** The perspective each turned card is seen through (px). */
const PERSPECTIVE = 1400;
/** How far the card before the front one in a queue sinks while it goes
 *  back into the background: down (px) and smaller (share). */
const SINK_DROP = 70;
const SINK_SHRINK = 0.16;

/** Where the front card is in the document (px, so it doesn't change while
 *  the page scrolls) and whether the row stands still. */
export interface FrontCard {
  x: number;
  y: number;
  w: number;
  h: number;
  settled: boolean;
  index: number;
  /** The item it's turning to (index once settled). */
  target: number;
}

export interface CarouselControl {
  next: () => void;
  prev: () => void;
  /** Hold the autoplay (something over the front card is looked at). */
  hold: (on: boolean) => void;
}

export interface PrismItem {
  /** A picture; with a video, its still (shown while it isn't in front). */
  src: string;
  /** A short clip, played while the item is in front. */
  video?: string;
  /** A picture to show instead when `src` can't be loaded. */
  fallback?: string;
  title?: string;
  subtitle?: string;
  alt?: string;
}

interface Props {
  items: PrismItem[];
  /** Width / height of the picture in front. */
  aspect?: number;
  /** Its height, as a share of the room above the caption. */
  size?: number;
  /** The neighbours' height against the front one. */
  neighborScale?: number;
  /** Width / height of a neighbour (a narrower crop of its picture). */
  neighborAspect?: number;
  gap?: number;
  radius?: number;
  /** Darkening per step away from the front. */
  dim?: number;
  /** Seconds per picture when nobody touches it (a clip: until it ends);
   *  0: still. */
  autoplay?: number;
  /** The mouse wheel turns it (one picture per notch). */
  wheel?: boolean;
  /** The neighbours turned towards the middle (degrees; 0: flat). */
  tilt?: number;
  /** Tint the background with the front picture's strongest colour. */
  tint?: boolean;
  /** Something live is shown over the front card instead of its clip (see
   *  LiveDemo): no clips, no autoplay of its own; it's told where the front
   *  card is (front) and moves the carousel on (control). */
  live?: boolean;
  /** The pictures kept dark (the live thing in front still loads): they
   *  all come up together with it. */
  veiled?: boolean;
  front?: MutableRefObject<FrontCard | null>;
  control?: MutableRefObject<CarouselControl | null>;
  /** Something shown in a card over its picture (a live app), for the cards
   *  near the front (`near`: it or one step beside it). It's sized by the
   *  card: --card-scale is the card's width over 1280. */
  slot?: (index: number, near: boolean) => ReactNode;
  /** A click on the front card (the live thing over it opens). */
  onFrontClick?: () => void;
  /** A queue instead of a coverflow: the front card at the left (`inset`
   *  from the edge), the next ones beside it on the right; one moving on
   *  comes in from the right over the one before, which sinks back into
   *  the background where it was (and back the other way). */
  queue?: boolean;
  inset?: number;
  /** The title, subtitle and arrows under the cards (off: shown elsewhere,
   *  moved with `control`). */
  captions?: boolean;
  onChange?: (index: number) => void;
  className?: string;
}

/** A quiet coverflow: the picture in front large, its neighbours smaller,
 *  cropped narrower and darker further out (no sweep, no shimmer). Placed
 *  on whole pixels, so the pictures' text stays sharp.
 *  Drag (with momentum), wheel, arrow keys or the buttons move it; it
 *  settles with a picture in front. */
export function PrismCarousel({
  items,
  aspect = 16 / 10,
  size = 0.9,
  neighborScale = 0.66,
  neighborAspect = 0.8,
  gap = 14,
  radius = 18,
  dim = 0.2,
  autoplay = 4.5,
  wheel = true,
  tilt = 0,
  tint = false,
  live = false,
  veiled = false,
  front,
  control,
  slot,
  onFrontClick,
  queue = false,
  inset = 0,
  captions = true,
  onChange,
  className = "",
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const shades = useRef<(HTMLDivElement | null)[]>([]);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  activeRef.current = active;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const n = items.length;
  // Where the row is (a float index), where it's going, and the pointer.
  const m = useRef({
    pos: 0,
    target: 0,
    vel: 0,
    drag: null as null | { x: number; pos: number; lastX: number; lastT: number; moved: boolean },
    hover: false,
    draggedAt: 0,
  });
  const change = useRef(onChange);
  change.current = onChange;

  const go = (by: number) => {
    m.current.target = Math.round(m.current.target) + by;
  };
  if (control) control.current = { next: () => go(1), prev: () => go(-1), hold: (on) => (m.current.hover = on) };

  useEffect(() => {
    const el = root.current;
    if (!el || !n) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let shown = -1;
    // Front card and neighbour sizes (px), and the room's width.
    // wi / wo: how far a turned neighbour reaches on screen from its centre
    // towards the middle (its far edge) and outwards (its near edge).
    let geo = { W: 0, H: 0, w: 0, h: 0, room: 0, roomH: 0, wi: 0, wo: 0 };

    const measure = () => {
      const room = el.clientWidth;
      const roomH = el.clientHeight;
      let H = roomH * size;
      let W = H * aspect;
      // (In a queue, room is left on the right for the next ones.)
      const widest = queue ? (room - inset) * 0.77 : room * 0.74;
      if (W > widest) {
        W = widest;
        H = W / aspect;
      }
      const h = H * neighborScale;
      const w = h * neighborAspect;
      // A card turned by the tilt, seen through its own perspective: its
      // far half foreshortened and smaller, its near half larger.
      const a = (tilt * Math.PI) / 180;
      const half = (w / 2) * Math.cos(a);
      const depth = (w / 2) * Math.sin(a);
      const wi = tilt ? (half * PERSPECTIVE) / (PERSPECTIVE + depth) : w / 2;
      const wo = tilt ? (half * PERSPECTIVE) / (PERSPECTIVE - depth) : w / 2;
      geo = { W, H, w, h, room, roomH, wi, wo };
      // Where the tint is centred (behind the front card) and how wide.
      const box = el.parentElement;
      box?.style.setProperty("--front-cx", `${queue ? inset + W / 2 : room / 2}px`);
      box?.style.setProperty("--front-w", `${W}px`);
    };

    /** Centre of the card k whole steps from the front (px), from the front
     *  card's centre. */
    const slotX = (k: number) => {
      if (k === 0) return 0;
      const { W, wi, wo } = geo;
      // The one before the front one in a queue stays where it was (it
      // sinks back there, see render).
      if (queue && k < 0) return 0;
      // By what each card really takes on screen once turned.
      return Math.sign(k) * (W / 2 + gap + wi + (Math.abs(k) - 1) * (wo + gap + wi));
    };

    /** The front card's centre in the room (px). */
    const frontX = () => (queue ? inset + geo.W / 2 : geo.room / 2);

    /** Tell where the front card is (document px) and whether it stands. */
    const reportFront = (index: number) => {
      if (!front) return;
      const { W, H, roomH } = geo;
      const r = el.getBoundingClientRect();
      front.current = {
        x: Math.round(r.left + scrollX + frontX() - W / 2),
        y: Math.round(r.top + scrollY + (roomH - H) / 2),
        w: Math.round(W),
        h: Math.round(H),
        settled: !m.current.drag && Math.abs(m.current.target - m.current.pos) < 0.002,
        index,
        target: ((Math.round(m.current.target) % n) + n) % n,
      };
    };

    const render = () => {
      const { W, H, w, h, room, roomH } = geo;
      const { pos } = m.current;
      const fx = frontX();
      cards.current.forEach((card, i) => {
        if (!card) return;
        // Where this picture is from the front one: the shorter way round;
        // in a queue all ahead on the right, but the one just passed.
        const ahead = (((i - pos) % n) + n) % n;
        const rel = queue ? (ahead > n - 1 ? ahead - n : ahead) : ((((i - pos) % n) + n + n / 2) % n) - n / 2;
        const lo = Math.floor(rel);
        const x = slotX(lo) + (slotX(lo + 1) - slotX(lo)) * (rel - lo);
        // A passed one keeps its shape and sinks back into the background:
        // smaller, a little lower, darker, gone (sunk: 0 → 1).
        const passed = queue && rel < 0;
        const sunk = passed ? -rel : 0;
        const t = passed ? 0 : Math.min(1, Math.abs(rel));
        const cw = Math.round(W + (w - W) * t);
        const ch = Math.round(H + (h - H) * t);
        const left = fx + x - cw / 2;
        if (left > room + 40 || left + cw < -40 || (passed && rel <= -1)) {
          card.style.visibility = "hidden";
          return;
        }
        card.style.visibility = "visible";

        card.style.width = `${cw}px`;
        card.style.setProperty("--card-scale", String(cw / 1280));
        card.style.height = `${ch}px`;
        card.style.borderRadius = `${radius - (radius * 0.35) * t}px`;
        // Whole pixels: half ones blur the pictures' text (and the front one
        // flat, not turned by 0°, for the same reason).
        // Turned to face the middle (a coverflow), each with its own
        // perspective around its centre, so it tilts evenly wherever it is.
        const turn = tilt && t > 0.001 ? ` perspective(${PERSPECTIVE}px) rotateY(${(-Math.sign(rel) * t * tilt).toFixed(2)}deg)` : "";
        const back = passed ? ` translateY(${Math.round(sunk * SINK_DROP)}px) scale(${(1 - sunk * SINK_SHRINK).toFixed(3)})` : "";
        card.style.transform = `translate(${Math.round(left)}px, ${Math.round((roomH - ch) / 2)}px)${turn}${back}`;
        card.style.opacity = passed ? String(1 - sunk) : "";
        const shade = shades.current[i];
        if (shade) shade.style.opacity = String(passed ? sunk * 0.6 : dim * Math.min(3, Math.abs(rel)));
        // (One sinking back stays under the one coming in.)
        card.style.zIndex = String(passed ? 40 : 100 - Math.round(Math.abs(rel) * 10));
      });
      const index = ((Math.round(pos) % n) + n) % n;
      reportFront(index);
      const frontIndex = index;
      if (frontIndex !== shown) {
        shown = frontIndex;
        setActive(frontIndex);
        change.current?.(frontIndex);
      }
    };

    // Drawn only when something moved: rewriting the cards each frame made
    // the browser redo the live apps in them every frame.
    let drawn = NaN;
    let idle = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = m.current;
      if (!s.drag) {
        // Ease towards the target (a whole picture).
        const k = still ? 1 : 1 - Math.exp(-dt / 0.15);
        s.pos += (s.target - s.pos) * k;
        if (Math.abs(s.target - s.pos) < 0.0005) s.pos = s.target;
      }
      if (s.drag || s.pos !== drawn) {
        render();
        drawn = s.pos;
        idle = 0;
      } else if (++idle % 15 === 0) {
        // The page around may still move it (its fade-in, a resize).
        reportFront(((Math.round(s.pos) % n) + n) % n);
      }
      raf = requestAnimationFrame(frame);
    };

    measure();
    render();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      measure();
      render();
    });
    ro.observe(el);

    // Dragging: a neighbour's width per picture; a flick goes on.
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const s = m.current;
      s.drag = { x: e.clientX, pos: s.pos, lastX: e.clientX, lastT: performance.now(), moved: false };
      s.vel = 0;
    };
    const move = (e: PointerEvent) => {
      const s = m.current;
      if (!s.drag) return;
      const now = performance.now();
      const perPicture = (geo.W + geo.w) / 2 + gap;
      const dx = e.clientX - s.drag.x;
      if (Math.abs(dx) > 4 && !s.drag.moved) {
        s.drag.moved = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // A pointer that's already gone: the window's listeners follow it.
        }
      }
      s.pos = s.drag.pos - dx / perPicture;
      s.vel = (-(e.clientX - s.drag.lastX) / perPicture / Math.max(1, now - s.drag.lastT)) * 1000;
      s.drag.lastX = e.clientX;
      s.drag.lastT = now;
    };
    const up = () => {
      const s = m.current;
      if (!s.drag) return;
      const moved = s.drag.moved;
      s.drag = null;
      if (moved) {
        s.target = Math.round(s.pos + Math.max(-3, Math.min(3, s.vel * 0.25)));
        s.draggedAt = performance.now();
      }
    };
    // One picture per notch, not faster than the row moves.
    let wheelAt = 0;
    // Over the front card the wheel turns it; beside it the page scrolls on
    // (sideways or with Shift it turns anywhere).
    const onWheel = (e: WheelEvent) => {
      if (!wheel || e.ctrlKey) return;
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const r = el.getBoundingClientRect();
      const { W, H, roomH } = geo;
      const x = e.clientX - r.left - (frontX() - W / 2);
      const y = e.clientY - r.top - (roomH - H) / 2;
      const overFront = x >= 0 && x <= W && y >= 0 && y <= H;
      if (!sideways && !e.shiftKey && !overFront) return;
      const d = sideways ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 2) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 260) return;
      wheelAt = now;
      go(d > 0 ? 1 : -1);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
    };
    const enter = () => (m.current.hover = true);
    const leave = () => (m.current.hover = false);

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", key);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);

    // Autoplay: one on now and then, not while looked at or touched.
    const auto =
      autoplay > 0 && !still && !live
        ? window.setInterval(() => {
            const s = m.current;
            // A clip in front moves on when it ends (see below).
            if (!s.hover && !s.drag && !document.hidden && !itemsRef.current[activeRef.current]?.video) go(1);
          }, autoplay * 1000)
        : 0;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.clearInterval(auto);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", key);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, aspect, size, neighborScale, neighborAspect, gap, radius, dim, autoplay, wheel, tilt, live, queue, inset]);

  // Each picture's strongest colour, for the background (tint).
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    if (!tint) return;
    let alive = true;
    void Promise.all(items.map((item) => strongestColor(item.src))).then((c) => alive && setColors(c));
    return () => {
      alive = false;
    };
  }, [tint, items]);

  // The clip in front plays from its start; the others stand still.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === active) {
        v.currentTime = 0;
        void v.play().catch(() => {});
      } else v.pause();
    });
  }, [active]);

  /** A clip ended: the next one (autoplay), or again while it's looked at. */
  const ended = (v: HTMLVideoElement) => {
    const s = m.current;
    if (autoplay > 0 && !s.hover && !s.drag && !document.hidden) go(1);
    else {
      v.currentTime = 0;
      void v.play().catch(() => {});
    }
  };

  const shown = items[active];

  return (
    <div className={`relative isolate flex h-full flex-col ${className}`}>
      {tint && (
        <div
          aria-hidden
          // (In a queue it reaches far out to the left, under the text
          // beside it, so it fades out there instead of ending at an edge.)
          className={`pointer-events-none absolute right-0 -top-[18%] -bottom-[8%] -z-10 ${queue ? "-left-[60vw]" : "left-0"}`}
          style={{
            ["--gc-tint" as string]: colors[active] ?? "transparent",
            // (Behind the front card: in a queue it's on the left.)
            background: queue
              ? "radial-gradient(calc(var(--front-w, 800px) * 1.05) 64% at calc(60vw + var(--front-cx, 400px)) 50%, color-mix(in oklab, var(--gc-tint) 42%, transparent), transparent 74%)"
              : "radial-gradient(62% 64% at 50% 42%, color-mix(in oklab, var(--gc-tint) 42%, transparent), transparent 74%)",
            // (No easing: a colour picked in the app shows everywhere at once.)
            // Soft at the top and bottom, no edge where the layer ends.
            maskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 75%, transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 75%, transparent)",
          }}
        />
      )}
      <div
        ref={root}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Pictures of the app"
        className="relative min-h-0 flex-1 cursor-grab touch-pan-y overflow-hidden outline-none select-none active:cursor-grabbing"
      >
        {items.map((item, i) => (
          <div
            // By place, not picture: a picture changing (another colour) is
            // swapped in the same element, at once, not a new one decoded.
            key={i}
            ref={(el) => {
              cards.current[i] = el;
            }}
            className="absolute top-0 left-0 overflow-hidden bg-white/[0.03]"
            style={{ visibility: "hidden" }}
            onClick={() => {
              // A neighbour: move it to the front; the front one: open it.
              const s = m.current;
              if (performance.now() - s.draggedAt < 80) return;
              // (In a queue: forwards to a card on the right.)
              const ahead = (((i - s.target) % n) + n) % n;
              const rel = queue ? (ahead > n - 1 ? ahead - n : ahead) : ((((i - s.target) % n) + n + n / 2) % n) - n / 2;
              if (Math.abs(rel) >= 0.5) s.target = Math.round(s.target + rel);
              else onFrontClick?.();
            }}
          >
            <img
              src={item.src}
              alt={item.alt ?? item.title ?? ""}
              draggable={false}
              decoding="async"
              onError={(e) => {
                if (item.fallback && !e.currentTarget.src.endsWith(item.fallback)) e.currentTarget.src = item.fallback;
              }}
              className={`block size-full object-cover transition-opacity duration-700 ${veiled ? "opacity-0" : "opacity-100"}`}
            />
            {slot?.(i, Math.abs(((((i - active) % n) + n + n / 2) % n) - n / 2) <= 1)}
            {item.video && !live && (
              <video
                ref={(el) => {
                  videos.current[i] = el;
                }}
                src={item.video}
                muted
                playsInline
                // Only the front one and its neighbours load ahead.
                preload={Math.abs(((((i - active) % n) + n + n / 2) % n) - n / 2) <= 1 ? "auto" : "none"}
                onEnded={(e) => ended(e.currentTarget)}
                className={`absolute inset-0 block size-full object-cover transition-opacity duration-300 ${i === active ? "opacity-100" : "opacity-0"}`}
              />
            )}
            <div
              ref={(el) => {
                shades.current[i] = el;
              }}
              className="pointer-events-none absolute inset-0 bg-black"
              style={{ opacity: 0 }}
            />
          </div>
        ))}
      </div>

      {captions && (
      <div className="flex flex-col items-center gap-3 pt-3 text-center">
        <div className="min-h-[46px]">
          {shown?.title && <div className="font-display text-[17px] font-semibold text-white">{shown.title}</div>}
          {shown?.subtitle && <div className="mt-0.5 text-[14px] text-white/55">{shown.subtitle}</div>}
        </div>
        <div className="flex items-center gap-4">
          <Arrow side="left" onClick={() => go(-1)} />
          <span className="min-w-[56px] text-[12.5px] text-white/45 tabular-nums">
            {String(active + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
          </span>
          <Arrow side="right" onClick={() => go(1)} />
        </div>
      </div>
      )}
    </div>
  );
}

export function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Previous" : "Next"}
      className="grid size-10 place-items-center rounded-full bg-white/[0.06] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={side === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
      </svg>
    </button>
  );
}

// The tint's colour is a registered property, so the gradient eases from
// one picture's colour to the next.
try {
  CSS.registerProperty({ name: "--gc-tint", syntax: "<color>", inherits: false, initialValue: "transparent" });
} catch {
  // Registered already (hot reload) or not supported: it just switches.
}

/** The strongest colour of a picture: the hue its vivid pixels have most
 *  (averaging would turn blue and gold into grey), bright enough to tint
 *  with. */
const strongest = new Map<string, Promise<string>>();

function strongestColor(src: string): Promise<string> {
  let known = strongest.get(src);
  if (!known) strongest.set(src, (known = measureColor(src)));
  return known;
}

function measureColor(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 40;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return resolve("transparent");
      g.drawImage(img, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data;
      // Hue in 24 steps of 15°, each pixel counting by how vivid it is.
      const bins = new Array<number>(24).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const max = Math.max(d[i], d[i + 1], d[i + 2]);
        const min = Math.min(d[i], d[i + 1], d[i + 2]);
        if (max - min < 40) continue;
        bins[Math.floor(hue(d[i], d[i + 1], d[i + 2]) / 15) % 24] += ((max - min) / 255) ** 2 * (max / 255);
      }
      // A bin with its neighbours, so a hue on a border isn't split.
      let best = -1;
      let bestScore = 0;
      bins.forEach((_, k) => {
        const score = bins[k] + 0.5 * (bins[(k + 23) % 24] + bins[(k + 1) % 24]);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      });
      resolve(best < 0 ? "transparent" : `hsl(${best * 15 + 7.5} 80% 56%)`);
    };
    img.onerror = () => resolve("transparent");
    img.src = src;
  });
}

function hue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
