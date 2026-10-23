import { isDemo } from "../lib/tauri";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./glass";
import { IconMove } from "./icons";

export interface Point {
  x: number;
  y: number;
}

/** A widget's own size (CSS pixels before scaling); unset: its natural size. */
export interface Size {
  w: number;
  h: number;
}

const LAYOUT_KEY = "radar.layout";
export const SIZES_KEY = "radar.widgetSizes";
export const FONTS_KEY = "radar.widgetFonts";
const MIN_SIZE: Size = { w: 180, h: 48 };
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Where a widget can be resized in edit mode: every edge and corner (the
 *  bottom-right corner drawn as the visible grip). */
const HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: "n", className: "-top-1.5 left-2 right-2 h-3 cursor-ns-resize" },
  { dir: "s", className: "-bottom-1.5 left-2 right-2 h-3 cursor-ns-resize" },
  { dir: "w", className: "-left-1.5 top-2 bottom-2 w-3 cursor-ew-resize" },
  { dir: "e", className: "-right-1.5 top-2 bottom-2 w-3 cursor-ew-resize" },
  { dir: "nw", className: "-top-1.5 -left-1.5 size-4 cursor-nwse-resize" },
  { dir: "ne", className: "-top-1.5 -right-1.5 size-4 cursor-nesw-resize" },
  { dir: "sw", className: "-bottom-1.5 -left-1.5 size-4 cursor-nesw-resize" },
  {
    dir: "se",
    className: "-right-1.5 -bottom-1.5 size-4 cursor-nwse-resize border-r-2 border-b-2 border-(--accent-text) bg-black/40",
  },
];

/** Text size of a widget's panel (px; the HUD's sizes are in em of it). */
const FONT_DEFAULT = 12;
const FONT_MIN = 9;
const FONT_MAX = 22;
export const LAYOUT_RESET_EVENT = "radar:layout-reset";

/** Where widgets start on a screen of the given size (CSS pixels). Defaults
 *  sit on the right edge, clear of the radar (top-left) and the ability /
 *  super HUD (bottom-left); the weapon lower left, next to where the game
 *  shows a weapon's stats when inspecting. */
export const DEFAULT_POSITIONS: Record<string, (w: number, h: number) => Point> = {
  session: (w) => ({ x: w - 260 - 32, y: 32 }),
  stats: (w) => ({ x: w - 300 - 32, y: 120 }),
  // The "… recognized" notice: top middle.
  notice: (w) => ({ x: Math.round(w / 2 - 190), y: 24 }),
  weapon: (_w, h) => ({ x: 32, y: Math.round(h * 0.42) }),
  // Beside the weapon's, so both can be told apart while placing them.
  armor: (_w, h) => ({ x: 32 + 560 + 24, y: Math.round(h * 0.42) }),
};

/** The size the overlay's page is laid out at: the whole screen (CSS px),
 *  whatever part of it the window shows (see Overlay: only the part with
 *  the widgets). */
export const stage = () =>
  // (The website's demo: its frame is the "screen".)
  isDemo ? { w: window.innerWidth, h: window.innerHeight } : { w: window.screen.width, h: window.screen.height };

export function readLayout(): Record<string, Point> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function readSizes(): Record<string, Size> {
  try {
    return JSON.parse(localStorage.getItem(SIZES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveSize(id: string, size: Size | null) {
  try {
    const sizes = readSizes();
    if (size) sizes[id] = size;
    else delete sizes[id];
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage unavailable; size just won't persist.
  }
}

export function readFonts(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FONTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveFont(id: string, font: number) {
  try {
    const fonts = readFonts();
    if (font === FONT_DEFAULT) delete fonts[id];
    else fonts[id] = font;
    localStorage.setItem(FONTS_KEY, JSON.stringify(fonts));
  } catch {
    // Storage unavailable; text size just won't persist.
  }
}

function savePosition(id: string, pos: Point) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), [id]: pos }));
  } catch {
    // Storage unavailable; position just won't persist.
  }
}

export function resetLayout() {
  try {
    localStorage.removeItem(LAYOUT_KEY);
    localStorage.removeItem(SIZES_KEY);
    localStorage.removeItem(FONTS_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(LAYOUT_RESET_EVENT));
}

/**
 * Absolutely positioned HUD widget. In edit mode it can be dragged around
 * and resized at any edge or corner (double-click one: natural size again); the
 * position and size are clamped to the screen and persisted per widget id.
 * A sized widget's width is a maximum: it is as wide as its text needs up
 * to there, then the text wraps; its height is a minimum (longer content
 * still grows it). Its text
 * size is set with A−/A+ in edit mode, also per widget.
 */
export function Widget({
  id,
  label,
  defaultPosition,
  edit,
  scale,
  opacity,
  delay = 0,
  reveal = false,
  children,
}: {
  id: string;
  label: string;
  defaultPosition: () => Point;
  edit: boolean;
  scale: number;
  opacity: number;
  delay?: number;
  /** Open like a Destiny panel (line, then unfolding) instead of settling in. */
  reveal?: boolean;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<Point>(() => readLayout()[id] ?? defaultPosition());
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [size, setSize] = useState<Size | null>(() => readSizes()[id] ?? null);
  const resize = useRef<{
    dir: ResizeDir;
    x: number;
    y: number;
    w: number;
    h: number;
    left: number;
    top: number;
  } | null>(null);
  const [font, setFont] = useState<number>(() => readFonts()[id] ?? FONT_DEFAULT);
  const changeFont = (by: number) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, font + by));
    setFont(next);
    saveFont(id, next);
  };
  // Its current height on screen: longer content (a long exotic perk) moves
  // it up so it stays on screen, without changing the saved position.
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight * scale));
    observer.observe(el);
    return () => observer.disconnect();
  }, [scale]);
  const shownY = dragging ? pos.y : Math.max(0, Math.min(pos.y, stage().h - height));

  useEffect(() => {
    const onReset = () => {
      setPos(defaultPosition());
      setSize(null);
      setFont(FONT_DEFAULT);
    };
    window.addEventListener(LAYOUT_RESET_EVENT, onReset);
    return () => window.removeEventListener(LAYOUT_RESET_EVENT, onReset);
  }, [defaultPosition]);

  const clamp = (p: Point): Point => {
    const el = ref.current;
    const w = el ? el.offsetWidth * scale : 0;
    const h = el ? el.offsetHeight * scale : 0;
    return {
      x: Math.round(Math.min(Math.max(0, p.x), stage().w - w)),
      y: Math.round(Math.min(Math.max(0, p.y), stage().h - h)),
    };
  };

  return (
    <div
      ref={ref}
      data-overlay-widget={id}
      className={cx(
        "absolute top-0 left-0 origin-top-left",
        edit && "cursor-grab touch-none",
        dragging && "cursor-grabbing",
      )}
      style={{
        transform: `translate(${pos.x}px, ${shownY}px) scale(${scale})`,
        // Still findable while moving widgets, even when set (nearly) invisible.
        opacity: edit ? Math.max(opacity, 0.4) : opacity,
        transition: dragging ? "none" : "opacity 0.2s",
      }}
      onPointerDown={(e) => {
        if (!edit || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        // From where it is shown (maybe moved up to fit), not where it was saved.
        drag.current = { dx: e.clientX - pos.x, dy: e.clientY - shownY };
        setPos({ x: pos.x, y: shownY });
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        savePosition(id, pos);
      }}
    >
      <div
        className={cx(reveal ? "hud-reveal" : "animate-widget-in", "relative", size && "widget-sized")}
        style={
          {
            animationDelay: `${delay}ms`,
            "--hud-font": `${font}px`,
            // Editing: as wide as it may get, so the box and handle follow the
            // pointer; in game only as wide as its text needs, up to that.
            ...(size ? { width: edit ? size.w : "max-content", maxWidth: size.w, minHeight: size.h } : {}),
          } as CSSProperties
        }
      >
        {edit && (
          <>
            <div className="pointer-events-none absolute -inset-1.5 border border-dashed border-(--accent) bg-(--accent-soft)/30" />
            <div className="pointer-events-none absolute -top-9 left-0 inline-flex items-center gap-1.5 bg-(--accent-text) px-2 py-1 text-[11px] font-semibold text-black shadow-lg">
              <IconMove />
              {label}
              <span className="font-mono opacity-60">
                {pos.x},{pos.y}
                {size && ` · max ${size.w} · ${size.h}`}
              </span>
            </div>
            {/* Text size: its own buttons, not a drag of the widget. */}
            <div
              className="absolute -top-9 right-0 inline-flex items-center bg-black/80 text-[11px] font-semibold text-white shadow-lg"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="px-2 py-1 hover:bg-white/15 disabled:opacity-30"
                disabled={font <= FONT_MIN}
                onClick={() => changeFont(-1)}
              >
                A−
              </button>
              <span className="w-9 text-center font-mono text-white/70 tabular-nums">{font}px</span>
              <button
                type="button"
                className="px-2 py-1 hover:bg-white/15 disabled:opacity-30"
                disabled={font >= FONT_MAX}
                onClick={() => changeFont(1)}
              >
                A+
              </button>
            </div>
          </>
        )}
        {children}
        {edit &&
          HANDLES.map((h) => (
            <div
              key={h.dir}
              className={cx("absolute z-10", h.className)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                // Not a drag of the whole widget.
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                const box = ref.current?.firstElementChild as HTMLElement | null;
                resize.current = {
                  dir: h.dir,
                  x: e.clientX,
                  y: e.clientY,
                  // From the box as shown (content may be taller than its minimum).
                  w: box?.offsetWidth ?? size?.w ?? 300,
                  h: box?.offsetHeight ?? size?.h ?? 100,
                  left: pos.x,
                  top: shownY,
                };
              }}
              onPointerMove={(e) => {
                const r = resize.current;
                if (!r) return;
                e.stopPropagation();
                // Pointer moves are in screen pixels; the widget is scaled.
                const dx = (e.clientX - r.x) / scale;
                const dy = (e.clientY - r.y) / scale;
                const right = r.left + r.w * scale;
                const bottom = r.top + r.h * scale;
                let { w, h: height } = r;
                let { left, top } = r;
                if (r.dir.includes("e")) w = Math.min((stage().w - left) / scale, r.w + dx);
                if (r.dir.includes("s")) height = Math.min((stage().h - top) / scale, r.h + dy);
                // West / north edges: that edge moves, the opposite one stays.
                if (r.dir.includes("w")) w = Math.min(right / scale, r.w - dx);
                if (r.dir.includes("n")) height = Math.min(bottom / scale, r.h - dy);
                w = Math.round(Math.max(MIN_SIZE.w, w));
                height = Math.round(Math.max(MIN_SIZE.h, height));
                if (r.dir.includes("w")) left = Math.round(right - w * scale);
                if (r.dir.includes("n")) top = Math.round(bottom - height * scale);
                setSize({ w, h: height });
                if (left !== pos.x || top !== pos.y) setPos({ x: left, y: top });
              }}
              onPointerUp={(e) => {
                if (!resize.current) return;
                e.stopPropagation();
                resize.current = null;
                saveSize(id, size);
                savePosition(id, pos);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setSize(null);
                saveSize(id, null);
              }}
            />
          ))}
      </div>
    </div>
  );
}
