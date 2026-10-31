import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../lib/i18n";
import { isTauri } from "../lib/tauri";
import { cx, IconButton } from "./glass";
import { IconClose, IconMinus, Logo } from "./icons";

export interface NavItem<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

/** Title bar with page tabs and a sliding active indicator. */
export function Navbar<K extends string>({
  items,
  active,
  onChange,
  right,
}: {
  items: readonly NavItem<K>[];
  active: K;
  onChange: (key: K) => void;
  right?: ReactNode;
}) {
  const t = useT();
  const win = isTauri ? getCurrentWindow() : null;
  const tabs = useRef(new Map<K, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabs.current.get(active);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    // Fonts can change tab widths after first paint.
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Re-measure when the labels change (e.g. a different language).
  }, [active, items.map((i) => i.label).join("|")]);

  return (
    <header
      data-tauri-drag-region
      className="relative z-10 flex h-14 shrink-0 items-center gap-4 bg-black/45 pr-2 pl-4"
    >
      {/* Over everything in the bar (the tabs too), lighting it up. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <span className="nav-sweep" />
      </div>
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <Logo size={20} animated />
        <span data-tauri-drag-region className="neon-title font-display text-[12.5px] font-semibold tracking-[0.42em]">
          RADAR
          {/* The light running through it: moved, never repainted. */}
          <span aria-hidden className="neon-band">
            <span className="neon-band-text">RADAR</span>
          </span>
        </span>
      </div>

      <nav
        // Heading for another page: DIM takes a fresh picture for the swap.
        onPointerEnter={() => window.dispatchEvent(new Event("radar:nav-hover"))}
        className="relative flex items-center gap-1 rounded-2xl border border-white/[0.06] bg-black/40 p-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
        aria-label={t("nav.pages")}
      >
        {indicator && (
          // A pane of glass under the active tab: light from above, a tint of
          // the accent from below, a bright top edge and a soft glow.
          <span
            aria-hidden
            className="absolute top-1 bottom-1 overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgb(255_255_255/0.13),rgb(255_255_255/0.04)_50%,color-mix(in_oklab,var(--accent)_16%,transparent))] shadow-[inset_0_1px_0_rgb(255_255_255/0.32),0_6px_16px_-8px_rgb(0_0_0/0.9)] transition-[left,width] duration-[420ms] ease-[cubic-bezier(0.3,1.06,0.4,1)]"
            style={{ left: indicator.left, width: indicator.width }}
          >
            {/* Specular sheen across the upper half. */}
            <span className="absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(120%_100%_at_50%_0%,rgb(255_255_255/0.16),transparent_70%)]" />
          </span>
        )}
        {items.map((item) => (
          <button
            key={item.key}
            ref={(el) => {
              if (el) tabs.current.set(item.key, el);
              else tabs.current.delete(item.key);
            }}
            onClick={() => onChange(item.key)}
            aria-current={active === item.key ? "page" : undefined}
            className={cx(
              // No colour fade: the tab left would glow on a moment while the
              // new page comes in (it read as a flicker); only hovering fades.
              "relative flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)",
              active === item.key ? "text-white" : "text-white/50 hover:text-white/85",
            )}
          >
            <span className={cx(active === item.key && "text-(--accent-text)")}>
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <div data-tauri-drag-region className="h-full flex-1" />
      {right}
      {/* Window buttons only in the app (not in the website's demo). */}
      {isTauri && (
        <div className="flex items-center">
          <IconButton label={t("window.minimize")} onClick={() => void win?.minimize()}>
            <IconMinus />
          </IconButton>
          <IconButton label={t("window.close")} tipAlign="end" className="hover:bg-red-500/80" onClick={() => void win?.close()}>
            <IconClose />
          </IconButton>
        </div>
      )}
    </header>
  );
}
