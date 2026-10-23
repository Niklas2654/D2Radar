import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useT } from "../lib/i18n";
import { cx } from "./glass";

/* ---------- Color math (hex <-> hue / saturation / value) ---------- */

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Drag inside an element; reports the pointer as 0..1 fractions. */
function useDrag(onMove: (x: number, y: number) => void) {
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    onMove(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
  };
}

/** Saturation / brightness field, hue strip and hex field, in Radar's glass. */
function ColorPicker({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  // Kept as HSV, so the hue survives dragging through black / grey.
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [text, setText] = useState(color);
  const set = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onChange(hex);
  };
  const field = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => set({ ...hsv, h: x * 360 }));
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  return (
    <div className="flex w-56 flex-col gap-3">
      <div
        {...field}
        className="relative h-32 cursor-crosshair touch-none rounded-lg"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
        />
      </div>
      <div
        {...hue}
        className="relative h-3 cursor-pointer touch-none rounded-full"
        style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-7 shrink-0 rounded-lg border border-white/15" style={{ background: hsvToHex(hsv) }} />
        <input
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (HEX.test(v)) {
              setHsv(hexToHsv(v));
              onChange(v.toLowerCase());
            }
          }}
          className={cx(
            "h-7 min-w-0 flex-1 rounded-lg border bg-black/30 px-2 font-mono text-[12px] text-white uppercase outline-none",
            HEX.test(text) ? "border-white/10 focus:border-(--accent)" : "border-red-400/50",
          )}
        />
      </div>
    </div>
  );
}

/** The "own color" ball next to the element colors; opens the picker. */
export function CustomAccent({ active, color, onPick }: { active: boolean; color: string; onPick: (hex: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => {
          if (!active) onPick(color);
          setOpen(!open);
        }}
        aria-pressed={active}
        aria-expanded={open}
        title={t("appearance.custom")}
        className={cx(
          "group flex w-full flex-col items-center gap-1.5 rounded-xl border py-2 transition-all",
          active ? "border-white/25 bg-white/[0.08]" : "border-transparent hover:bg-white/[0.05]",
        )}
      >
        <span
          className="grid size-5 place-items-center rounded-full transition-transform group-hover:scale-110"
          style={{
            background: "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            boxShadow: active ? `0 0 14px ${color}` : undefined,
          }}
        >
          <span className="size-2.5 rounded-full border border-white/70" style={{ background: color }} />
        </span>
        <span className="text-[10.5px] text-white/55">{t("appearance.custom")}</span>
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 bottom-full z-50 mb-2 rounded-2xl border border-white/10 bg-[#0d1220]/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <ColorPicker color={color} onChange={onPick} />
        </div>
      )}
    </div>
  );
}
