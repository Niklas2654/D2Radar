import { placeCard } from "../lib/placeCard";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LOCALES, useLanguage, useT } from "../lib/i18n";
import {
  effectNow,
  effectNowPvp,
  formatEffect,
  STAT_EFFECTS,
  STAT_ORDER,
  type StatEffect,
  type StatId,
} from "../lib/statEffects";
import { cx } from "./glass";

/** One effect: what it does now, and at the end of its range. */
function EffectLine({ effect, stat, compact }: { effect: StatEffect; stat: number; compact?: boolean }) {
  const t = useT();
  const locale = LOCALES[useLanguage()];
  const now = effectNow(effect, stat);
  const pvp = effectNowPvp(effect, stat);
  const end = effect.range === "base" ? 100 : 200;
  const active = now !== undefined ? now > 0 : stat >= end;
  return (
    <div className={cx("flex items-baseline gap-2 text-[11.5px]", !active && "opacity-45")}>
      <span className="min-w-0 flex-1 truncate text-white/65">{t(effect.label)}</span>
      <span className="shrink-0 font-semibold text-white tabular-nums">
        {now !== undefined ? (effect.approx ? "≈ " : "") + formatEffect(now, effect.unit, locale, effect.less) : "—"}
        {effect.bungie && <span className="text-white/45">*</span>}
        {pvp !== undefined && !compact && <span className="ml-1 font-normal text-white/45">[{formatEffect(pvp, effect.unit, locale)} PvP]</span>}
      </span>
      <span className="w-[86px] shrink-0 text-right text-[10.5px] text-white/40 tabular-nums">
        {t("statfx.at", { stat: end, value: formatEffect(effect.max, effect.unit, locale, effect.less) })}
      </span>
    </div>
  );
}

/** What a stat's value does, base (0–100) and enhanced (101–200). */
export function StatEffectList({ id, stat, compact }: { id: StatId; stat: number; compact?: boolean }) {
  // Compact (overlay): only the effect the stat is mostly taken for.
  const effects = STAT_EFFECTS[id].filter((e) => !compact || e.headline);
  return (
    <div className="flex flex-col gap-0.5">
      {effects.map((e) => (
        <EffectLine key={e.label} effect={e} stat={stat} compact={compact} />
      ))}
    </div>
  );
}

/** Every stat with what it does at the given values. */
export function StatEffectsBlock({
  values,
  names,
  compact,
}: {
  values: Partial<Record<StatId, number>>;
  /** Names to show (the game's); default the translated ones. */
  names?: Partial<Record<StatId, string>>;
  /** Only each stat's main effect (overlay). */
  compact?: boolean;
}) {
  const t = useT();
  const ids = STAT_ORDER.filter((id) => values[id] !== undefined);
  return (
    <div className={cx("flex flex-col", compact ? "gap-1.5" : "gap-2.5")}>
      {ids.map((id) => (
        <div key={id}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">
              {names?.[id] ?? t(`statfx.name.${id}`)}
            </span>
            <span className="text-[13px] font-semibold tabular-nums">{values[id]}</span>
          </div>
          <StatEffectList id={id} stat={values[id]!} compact={compact} />
        </div>
      ))}
    </div>
  );
}

/** A stat (its row): what its value does, in a card on hover. */
export function StatHover({ id, stat, name, children }: { id: StatId; stat: number; name: string; children: ReactNode }) {
  const t = useT();
  const [at, setAt] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useLayoutEffect(() => {
    if (!at || !card.current) return;
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    // Below, else above, else beside it: never over it (and the pointer).
    setPos(placeCard(at, w, h));
  }, [at]);
  return (
    <div
      className="cursor-default"
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAt(rect), 150);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setAt(null);
        setPos(null);
      }}
    >
      {children}
      {at &&
        createPortal(
          <div
            ref={card}
            className="animate-fade-in pointer-events-none fixed z-[120] w-[360px]"
            style={pos ?? { left: -9999, top: -9999 }}
          >
            <div className="rounded-xl border border-white/10 bg-[#05070c]/97 p-3 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95)] backdrop-blur-md">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">{name}</span>
                <span className="text-[13px] font-semibold tabular-nums">{stat}</span>
              </div>
              <StatEffectList id={id} stat={stat} />
              <div className="mt-2 border-t border-white/10 pt-1.5 text-[10px] text-white/35">
                {STAT_EFFECTS[id].some((e) => e.approx) && <div className="mb-0.5">{t("statfx.approx")}</div>}
                {STAT_EFFECTS[id].some((e) => e.bungie) && <div className="mb-0.5">{t("statfx.bungie")}</div>}
                {t("statfx.credit")}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
