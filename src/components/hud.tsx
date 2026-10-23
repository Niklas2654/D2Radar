import type { ReactNode } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { ArmorDetail } from "../lib/armor";
import type { ItemInfo } from "../lib/fireteam";
import { useClarity, useClarityItems, type ClarityText } from "../lib/clarity";
import { useT } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { useSeasonName, type Perk, type WeaponDetail } from "../lib/weapons";
import { ClarityLines } from "./Clarity";
import { MATCHED } from "./WeaponView";
import { cx } from "./glass";

/*
 * The in-game overlay, drawn like Destiny's own UI so it sits next to the
 * game instead of on top of it: flat dark panels, hairlines, small
 * upper-case headers with a rule, a colored bar on top by rarity. It only
 * shows what the game doesn't (exact numbers, every rollable perk).
 */

/** Bungie's tier type of exotic items. */
const EXOTIC = 6;

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
  const [{ hud: show }] = useSettings();
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
        {show.hoverDetails && hovered && (
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
        {show.exoticPerks && (perks.length > 0 || byItem.length > 0) && (
          <HudSection title={t("hud.exoticPerk")}>
            {perks.map((p) => (
              <HudPerk key={p.hash} name={p.name} clarity={clarity.get(p.hash)} exact={p.exact} description={p.description} gold />
            ))}
            {byItem.map((p) => (
              <HudPerk key={p.name} name={p.name} clarity={p.text} gold />
            ))}
          </HudSection>
        )}
        {show.setBonuses && sets.map((s) => (
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

/**
 * The inspected weapon. Exotic: what its intrinsic perk and catalyst do,
 * exact (its perks are on screen anyway). Legendary: every perk each column
 * can roll, the inspected copy's own marked.
 */
export function HudWeapon({ weapon, hovered = null }: { weapon: WeaponDetail; hovered?: number | null }) {
  const t = useT();
  const [{ hud: show }] = useSettings();
  const exotic = weapon.tier === EXOTIC;
  // The perk whose tooltip the game shows right now (see "perk-hover").
  const all = [
    ...(weapon.frame ? [weapon.frame] : []),
    ...weapon.origins,
    ...(weapon.catalyst ? [weapon.catalyst] : []),
    ...weapon.columns.flatMap((c) => c.perks.flatMap((p) => (p.enhanced ? [p, p.enhanced] : [p]))),
  ];
  const hoveredPerk = hovered === null ? null : (all.find((p) => p.hash === hovered) ?? null);
  // The base perk a hovered enhanced one belongs to (its row in a column).
  const hoveredRow = hoveredPerk ? (all.find((p) => p.enhanced?.hash === hoveredPerk.hash)?.hash ?? hoveredPerk.hash) : null;
  // Shown as the base perk with its enhanced version below (whichever of
  // the two the tooltip is for).
  const hoveredBase = hoveredRow === null ? null : (all.find((p) => p.hash === hoveredRow) ?? hoveredPerk);
  const hoveredEnhanced = hoveredBase?.enhanced ?? null;
  const hoverClarity = useClarity(
    hoveredBase ? [hoveredBase.hash, ...(hoveredEnhanced ? [hoveredEnhanced.hash] : [])] : [],
  );
  const season = useSeasonName(weapon.watermark);
  const blocks = exotic
    ? [
        weapon.frame && { label: t("weapons.intrinsic"), perk: weapon.frame },
        weapon.catalyst && { label: t("weapons.catalyst"), perk: weapon.catalyst },
      ].filter((b): b is { label: string; perk: Perk } => !!b)
    : [];
  const clarity = useClarity(blocks.map((b) => b.perk.hash));
  const rolled = new Set(weapon.rolled);
  const owned = new Set(weapon.copies.flatMap((c) => c.enhanced ?? []));

  return (
    <HudPanel tone={exotic ? "exotic" : "legendary"} className={exotic ? "w-[420px]" : "w-[560px]"}>
      <div className="flex flex-col gap-3 px-3.5 pt-2.5 pb-3">
        {/* Which season's version it is: its watermark (the game shows the
            same in the icon's corner), and of how many. */}
        {show.season && (season || weapon.versions.length > 1) && (
          <div className="-mb-1 flex items-center gap-2 text-[0.875em] text-white/55">
            <span>
              {season && <span className="font-semibold text-white/80">{season}</span>}
              {season && weapon.versions.length > 1 && " · "}
              {weapon.versions.length > 1
                ? t("weapons.version", {
                    i: Math.max(1, weapon.versions.findIndex((v) => v.hash === weapon.hash) + 1),
                    n: weapon.versions.length,
                  })
                : null}
              {weapon.versions.length > 1 && <span className="text-white/35"> · {t(MATCHED[weapon.matchedBy])}</span>}
            </span>
          </div>
        )}
        {weapon.seasonNeedsSetup && <p className="text-[0.958em] text-amber-200/90">{t("weapons.seasonSetup")}</p>}
        {/* Hovered in game: that perk's exact numbers on top (not for an
            exotic's intrinsic / catalyst, shown below anyway). */}
        {show.hoverDetails && hoveredBase && !(exotic && blocks.some((b) => b.perk.hash === hoveredBase.hash)) && (
          <HudSection title={hoveredBase.typeName || t("hud.hovered")}>
            <HudPerk
              name={hoveredBase.name}
              clarity={hoverClarity.get(hoveredBase.hash)}
              description={hoveredBase.description}
            />
            {/* Its enhanced version: what it adds (Clarity lists that on its own). */}
            {hoveredEnhanced && (
              <div
                className={cx(
                  "mt-1 border-l-2 pl-2.5",
                  hoveredPerk?.hash === hoveredEnhanced.hash ? "border-[#e8cf6a]" : "border-[#e8cf6a]/35",
                )}
              >
                <div className="text-[0.833em] font-semibold tracking-[0.08em] text-[#e8cf6a] uppercase">
                  {t("hud.enhanced")}
                  {hoveredPerk?.hash === hoveredEnhanced.hash && <span className="ml-1.5 text-white/45 normal-case">· {t("hud.hoveredThis")}</span>}
                </div>
                <HudPerk
                  name={hoveredEnhanced.name}
                  clarity={hoverClarity.get(hoveredEnhanced.hash)}
                  description={hoveredEnhanced.description}
                />
              </div>
            )}
          </HudSection>
        )}
        {exotic ? (
          show.exoticPerks && (
          <>
            {blocks.map(({ label, perk }) => (
              <HudSection key={label} title={hoveredPerk?.hash === perk.hash ? `▸ ${label}` : label}>
                <HudPerk name={perk.name} clarity={clarity.get(perk.hash)} description={perk.description} gold />
              </HudSection>
            ))}
            <HudCredit sources={clarity.size > 0 ? ["Clarity"] : []} />
          </>
          )
        ) : (
          show.possiblePerks && (
          <HudSection title={t("hud.possibleRolls")} right={rolled.size > 0 ? t("hud.rolledMarked") : undefined}>
            <div
              className="grid gap-x-3"
              style={{ gridTemplateColumns: `repeat(${weapon.columns.length}, minmax(0, 1fr))` }}
            >
              {weapon.columns.map((column, i) => (
                <div key={i} className="min-w-0">
                  <div className="mb-1 truncate text-[0.833em] tracking-[0.08em] text-white/40 uppercase">{column.label}</div>
                  {column.perks.map((p, j) => {
                    const on = rolled.has(p.hash);
                    const hover = hoveredRow === p.hash;
                    return (
                      <div
                        key={`${p.hash}-${j}`}
                        className={cx(
                          "flex min-w-0 items-center gap-1.5 py-[3px] pl-1.5 text-[0.958em]",
                          on ? "border-l-2 border-white bg-white/[0.07] font-semibold text-white" : "border-l-2 border-transparent text-white/60",
                          hover && "outline outline-1 -outline-offset-1 outline-(--accent-text) text-white",
                        )}
                      >
                        {p.icon && <img src={BUNGIE_ORIGIN + p.icon} alt="" className="size-4 shrink-0" />}
                        <span className={cx("min-w-0 leading-tight break-words", owned.has(p.hash) && "text-[#e8cf6a]")}>{p.name}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </HudSection>
          )
        )}
        {!exotic && hoverClarity.size > 0 && <HudCredit sources={["Clarity"]} />}
      </div>
    </HudPanel>
  );
}
