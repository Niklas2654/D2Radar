import { useEffect, useRef, useState } from "react";
import { cx } from "./glass";

/**
 * A destructive action with a grace period: pressed, the pill turns into
 * "Undo" and a lit fuse burns once around its rim; only when it has burnt
 * down does `onCommit` run. Undo (or Escape) puts it back.
 */
export function FuseButton({
  label,
  undoLabel,
  busyLabel,
  busy = false,
  disabled = false,
  window: windowMs = 4500,
  onCommit,
}: {
  label: string;
  undoLabel: string;
  /** Shown while the commit is running. */
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  /** How long the fuse burns, in ms. */
  window?: number;
  onCommit: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Escape takes it back while armed.
  useEffect(() => {
    if (!armed) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [armed]);

  // Its size before arming, kept while the fuse burns: "Undo" is narrower
  // than the label, and the rim changing size mid-way jumped.
  useEffect(() => {
    const el = button.current;
    if (!el || armed) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [armed]);

  const r = Math.min(12, size.h / 2);
  return (
    <button
      ref={button}
      type="button"
      disabled={(disabled && !armed) || busy}
      aria-live="polite"
      onClick={() => setArmed((a) => !a)}
      style={armed && size.w > 0 ? { width: size.w } : undefined}
      className={cx(
        "fuse group/fuse relative inline-flex h-10 items-center justify-center rounded-xl border px-4 text-[13.5px] font-medium transition-[background-color,border-color,color] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        armed
          ? "border-white/10 bg-white/[0.06] text-white/90 hover:bg-white/[0.1]"
          : "border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20",
      )}
    >
      <span key={armed ? "undo" : busy ? "busy" : "idle"} className="copy-in whitespace-nowrap">
        {busy ? (busyLabel ?? label) : armed ? undoLabel : label}
      </span>
      {armed && size.w > 0 && (
        <svg aria-hidden className="pointer-events-none absolute -inset-px overflow-visible" width={size.w} height={size.h}>
          {/* The burnt-out track, then the lit fuse burning down clockwise. */}
          <rect x="0.75" y="0.75" width={size.w - 1.5} height={size.h - 1.5} rx={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1.5" />
          <rect
            className="fuse-burn"
            x="0.75"
            y="0.75"
            width={size.w - 1.5}
            height={size.h - 1.5}
            rx={r}
            fill="none"
            stroke="#ff7a59"
            strokeWidth="1.5"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100"
            style={{ animationDuration: `${windowMs}ms` }}
            onAnimationEnd={() => {
              setArmed(false);
              onCommit();
            }}
          />
        </svg>
      )}
    </button>
  );
}
