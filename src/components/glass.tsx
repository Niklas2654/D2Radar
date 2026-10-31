import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";
import { CountUp } from "./CountUp";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Panel ---------- */

type PanelVariant = "app" | "hud" | "subtle";

export function GlassPanel({
  variant = "app",
  radius = 20,
  className,
  style,
  children,
}: {
  variant?: PanelVariant;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "glass",
        variant === "hud" && "glass-hud",
        variant === "subtle" && "glass-subtle",
        className,
      )}
      style={{ "--glass-radius": `${radius}px`, ...style } as CSSProperties}
    >
      {/* The pointer's light (lib/glassLight.ts moves the spot). */}
      {variant !== "hud" && (
        <span className="glass-light" aria-hidden>
          <span className="glass-light-spot" />
        </span>
      )}
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  right,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {icon && (
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-(--accent-glow) bg-[radial-gradient(circle_at_50%_30%,var(--accent-soft),rgb(0_0_0/0.35))] text-(--accent-text) shadow-[0_0_9px_-2px_var(--accent-halo),inset_0_1px_0_rgb(255_255_255/0.12)]">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-white/50">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = "primary" | "ghost" | "danger";

export function GlassButton({
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}) {
  return (
    <button
      {...rest}
      className={cx(
        "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-medium",
        "border transition-[background-color,border-color,filter,scale] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)",
        size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-[13.5px]",
        variant === "primary" &&
          "border-(--accent-glow) bg-[color-mix(in_oklab,var(--accent)_26%,transparent)] text-white shadow-[0_0_11px_-3px_var(--accent-halo)] hover:border-(--accent-text) hover:shadow-[0_0_14px_-2px_var(--accent-halo)] hover:brightness-110",
        variant === "ghost" &&
          "border-white/10 bg-white/[0.05] text-white/90 shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] hover:border-(--accent-glow) hover:bg-white/[0.08] hover:shadow-[0_0_9px_-3px_var(--accent-halo),inset_0_1px_0_rgb(255_255_255/0.08)]",
        variant === "danger" &&
          "border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20",
        className,
      )}
    >
      {/* Specular sweep on hover */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 transition-[translate,opacity] duration-500 group-hover:translate-x-[350%] group-hover:opacity-100" />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  tipAlign = "center",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tipAlign?: "center" | "end" }) {
  return (
    <Tooltip label={label} align={tipAlign}>
      <button
        {...rest}
        aria-label={label}
        className={cx(
          "grid size-8 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/* ---------- Tooltip ---------- */

/** A small glass label under its child on hover (instead of the native one). */
export function Tooltip({
  label,
  align = "center",
  children,
}: {
  label: ReactNode;
  /** Which edge it lines up with; "end" near the right window edge. */
  align?: "center" | "end";
  children: ReactNode;
}) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none absolute top-full z-50 mt-2 rounded-lg border border-white/10 bg-[#0d1220]/95 px-2.5 py-1.5",
          "text-[11.5px] font-medium whitespace-nowrap text-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md",
          "translate-y-[-3px] opacity-0 transition-[opacity,translate] delay-0 duration-150",
          "group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-300",
          align === "center" ? "left-1/2 -translate-x-1/2" : "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ---------- Switch ---------- */

export function GlassSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-[13.5px] text-white/90">{label}</span>
        {description && <span className="block text-[12px] text-white/45">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-[22px] w-10 shrink-0 cursor-pointer rounded-full border transition-all duration-300",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)",
          checked
            ? "border-(--accent-glow) bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent)_18%,transparent),color-mix(in_oklab,var(--accent)_55%,transparent))]"
            : "border-white/10 bg-white/[0.04]",
        )}
      >
        <span
          className={cx(
            "absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-all duration-300",
            checked
              ? "left-[20px] bg-white shadow-[0_0_5px_var(--accent),0_0_3px_white]"
              : "left-[2px] bg-white/45 shadow-[0_1px_3px_rgb(0_0_0/0.6)]",
          )}
        />
      </button>
    </label>
  );
}

/* ---------- Slider ---------- */

export function GlassSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-2">
      <div className="mb-2 flex items-center justify-between text-[13.5px]">
        <span className="text-white/90">{label}</span>
        <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[12px] text-white/70 tabular-nums">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        className="glass-range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ---------- Input ---------- */

export function GlassInput({
  className,
  onClear,
  clearLabel = "Clear",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  /** Shows an × while there is text; clicking it calls this. */
  onClear?: () => void;
  clearLabel?: string;
}) {
  const input = (
    <input
      {...rest}
      spellCheck={false}
      className={cx(
        "h-10 w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-3.5 text-[13.5px] text-white select-text",
        "shadow-[inset_0_1px_3px_rgb(0_0_0/0.45)] transition-colors placeholder:text-white/30",
        "hover:border-white/20 focus:border-(--accent) focus:outline-none focus:ring-4 focus:ring-(--accent-soft)",
        onClear && "pr-9",
        className,
      )}
    />
  );
  if (!onClear) return input;
  const filled = String(rest.value ?? "").length > 0;
  return (
    <div className="relative w-full min-w-0">
      {input}
      {filled && (
        <button
          type="button"
          aria-label={clearLabel}
          // Keeps the focus in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          className="animate-fade-in absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* ---------- Small bits ---------- */

export function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-7 min-w-7 place-items-center rounded-md border border-white/15 border-b-white/5 bg-[linear-gradient(180deg,rgb(255_255_255/0.14),rgb(255_255_255/0.04))] px-2 font-mono text-[12px] font-semibold text-white shadow-[0_2px_0_rgb(0_0_0/0.4),inset_0_1px_0_rgb(255_255_255/0.2)]">
      {children}
    </kbd>
  );
}

export function Badge({
  tone = "muted",
  dot = true,
  children,
}: {
  tone?: "live" | "muted" | "error";
  /** The status dot in front. */
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase",
        tone === "live" && "border-(--accent-glow) bg-(--accent-soft) text-(--accent-text) shadow-[0_0_7px_-3px_var(--accent-halo)]",
        tone === "muted" && "border-white/10 bg-white/[0.05] text-white/50",
        tone === "error" && "border-red-400/30 bg-red-500/15 text-red-300",
      )}
    >
      {dot && <span
        className={cx(
          "size-1.5 rounded-full",
          tone === "live" && "animate-pulse-dot bg-(--accent-text) shadow-[0_0_3px_var(--accent-halo)]",
          tone === "muted" && "bg-white/40",
          tone === "error" && "bg-red-400",
        )}
      />}
      {children}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="spotlight rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
      <div className="text-[10.5px] font-semibold tracking-[0.12em] text-white/45 uppercase">
        {label}
      </div>
      <div
        className={cx(
          "mt-1 font-display text-[22px] leading-none font-semibold tabular-nums",
          emphasis ? "text-(--accent-text)" : "text-white",
        )}
      >
        {typeof value === "string" || typeof value === "number" ? <CountUp text={String(value)} /> : value}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-white/40">{hint}</div>}
    </div>
  );
}

export function Divider() {
  return <div className="my-2 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />;
}
