import type { ReactNode } from "react";
import type { ArmorDetail } from "../lib/armor";
import type { ItemInfo } from "../lib/fireteam";
import { useClarity, useClarityItems, type ClarityText } from "../lib/clarity";
import { useT } from "../lib/i18n";
import { ClarityLines } from "./Clarity";
import { cx } from "./glass";

/*
 * The in-game overlay, drawn like Destiny's own UI so it sits next to the
 * game instead of on top of it: flat dark panels, hairlines, small
 * upper-case headers with a rule, a colored bar on top by rarity. It only
 * shows what the game doesn't (exact numbers, every rollable perk).
 */

export type HudTone = "exotic" | "legendary" | "plain";

const BAR: Record<HudTone, string> = {
  exotic: "bg-[#ceae33]",
  legendary: "bg-[#6b3fa0]",
  plain: "bg-white/25",
};

/** A flat panel like Destiny's tooltips. */
export function HudPanel({
  tone = "plain",
  className,
  children,
}: {
  tone?: HudTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "hud-panel relative overflow-hidden border border-white/[0.13] bg-[rgb(13_15_19/0.9)] text-white shadow-[0_10px_30px_-12px_rgb(0_0_0/0.9)]",
        className,
      )}
    >
      <div className={cx("h-[3px] w-full", BAR[tone])} />
      {children}
    </div>
  );
}

/** "ORYX'S MEMORY ————": a section header as in the inspect screen. */
export function HudSection({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 text-[0.917em] font-semibold tracking-[0.08em] text-white/60 uppercase">{title}</span>
        <span className="h-px flex-1 bg-white/15" />
        {right && <span className="shrink-0 text-[0.833em] tracking-[0.08em] text-white/40 uppercase">{right}</span>}
      </div>
      {children}
    </section>
  );
}

/** One perk: its name, then the exact numbers (or, without any, Bungie's text). */
export function HudPerk({
  name,
  badge,
  exact,
  clarity,
  description,
  gold,
}: {
  name: string;
  /** e.g. "2×" for a set bonus. */
  badge?: string;
  exact?: string;
  clarity?: ClarityText;
  description?: string;
  gold?: boolean;
}) {
  return (
    <div className="flex gap-2.5 py-1">
      {badge && (
        <span className="mt-px grid h-[18px] min-w-[22px] shrink-0 place-items-center border border-white/25 px-1 text-[0.875em] font-semibold tabular-nums text-white/80">
          {badge}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={cx("text-[1.083em] font-semibold", gold ? "text-[#e8cf6a]" : "text-white")}>{name}</div>
        {clarity ? (
          <ClarityLines text={clarity} className="mt-0.5 text-[1em]! text-white/80" />
        ) : exact ? (
          <p className="mt-0.5 text-[1em] leading-relaxed whitespace-pre-line text-white/80">{exact}</p>
        ) : (
          description && <p className="mt-0.5 text-[1em] leading-relaxed whitespace-pre-line text-white/55">{description}</p>
        )}
      </div>
    </div>
  );
}

/** Where the numbers come from (the overlay can't be clicked: names only). */
export function HudCredit({ sources }: { sources: string[] }) {
  const t = useT();
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 border-t border-white/10 pt-1.5 text-[0.833em] text-white/35">
      {t("hud.numbersFrom", { sources: sources.join(" · ") })}
    </div>
  );
}

/** The inspected armor piece: its exotic perks and set bonuses, exact. */
/** `wide`: across the page (the inspect page), set bonuses side by side
 *  (2 pieces left, 4 right) instead of one under the other. */
export function HudArmor({
  armor,
  hovered = null,
  wide = false,
}: {
  armor: ArmorDetail;
  hovered?: ItemInfo | null;
  wide?: boolean;
}) {
  const t = useT();
  const { item, sets } = armor;
  const perks = item.exotic ? (item.perks ?? []) : [];
  const clarity = useClarity([...perks.map((p) => p.hash), ...(hovered ? [hovered.hash] : [])]);
  // No perks read (e.g. not from the player's copy): Clarity's entry for the item.
  const byItem = useClarityItems(item.exotic && perks.length === 0 ? [item.hash] : []).get(item.hash) ?? [];
  // A plain piece (no exotic perks, no set): nothing to show, no empty panel.
  if (!item.exotic && sets.length === 0 && !hovered) return null;
  const sources = [
    ...(perks.some((p) => clarity.has(p.hash)) || byItem.length > 0 || (hovered && clarity.has(hovered.hash)) ? ["Clarity"] : []),
    ...(perks.some((p) => !clarity.has(p.hash) && p.exact) || sets.some((s) => s.perks.some((p) => p.exact))
      ? ["Destiny Data Compendium"]
      : []),
  ];
  return (
    <HudPanel tone={item.exotic ? "exotic" : "legendary"} className={wide ? "w-full" : "w-[420px]"}>
      <div className="flex flex-col gap-3 px-3.5 pt-2.5 pb-3">
        {/* Hovered in game (a mod, an exotic perk): its exact numbers on top. */}
        {hovered && (
          <HudSection title={hovered.typeName || t("hud.hovered")}>
            <HudPerk
              name={hovered.name}
              clarity={clarity.get(hovered.hash)}
              exact={hovered.exact}
              description={hovered.description}
              gold={hovered.exotic}
            />
          </HudSection>
        )}
        {(perks.length > 0 || byItem.length > 0) && (
          <HudSection title={t("hud.exoticPerk")}>
            {perks.map((p) => (
              <HudPerk key={p.hash} name={p.name} clarity={clarity.get(p.hash)} exact={p.exact} description={p.description} gold />
            ))}
            {byItem.map((p) => (
              <HudPerk key={p.name} name={p.name} clarity={p.text} gold />
            ))}
          </HudSection>
        )}
        {sets.map((s) => (
          <HudSection key={s.name} title={s.name} right={t("hud.setBonus")}>
            <div className={wide ? "grid grid-cols-2 items-start gap-x-6" : "contents"}>
              {s.perks.map((p) => (
                <HudPerk key={p.required} badge={`${p.required}×`} name={p.name} exact={p.exact} description={p.description} />
              ))}
            </div>
          </HudSection>
        ))}
        <HudCredit sources={sources} />
      </div>
    </HudPanel>
  );
}
