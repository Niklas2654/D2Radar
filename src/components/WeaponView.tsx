import { useEffect, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { weapons, type Perk, type WeaponCopy, type WeaponDetail } from "../lib/weapons";
import { useClarity, type ClarityText } from "../lib/clarity";
import { ClarityCredit, ClarityLines, PerkHover } from "./Clarity";
import { EnhancedArrow } from "./EnhancedArrow";
import { CountUp } from "./CountUp";
import { cx, GlassButton } from "./glass";

/** Perks to pick before a copy can be pulled from the vault. */
const PICKS_TO_PULL = 2;

type PullStatus =
  | { kind: "none" }
  | { kind: "pulling" }
  | { kind: "pulled"; to: string }
  | { kind: "error"; message: string };

const EXOTIC = 6;

/** Text for how the version was found. */
export const MATCHED = {
  owned: "weapons.byOwned",
  watermark: "weapons.byWatermark",
  perks: "weapons.byPerks",
  newest: "weapons.newest",
} as const;

function PerkIcon({ perk, size, enhanced = false }: { perk: Perk; size: number; enhanced?: boolean }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className={cx(
          "relative grid size-full place-items-center overflow-hidden rounded-full border bg-[#1d4a6b]/70",
          enhanced ? "border-[#e8c547]/80" : "border-white/15",
        )}
      >
        {perk.icon && <img src={BUNGIE_ORIGIN + perk.icon} alt="" className="size-full object-cover" />}
        {/* Enhanced, as in game: gold rising from the bottom of the circle. */}
        {enhanced && (
          <span className="absolute inset-0 rounded-full bg-[linear-gradient(to_top,rgb(232_197_71/0.55),rgb(232_197_71/0.12)_45%,transparent_65%)]" />
        )}
      </span>
      {enhanced && <EnhancedArrow size={Math.max(7, Math.round(size * 0.32))} className="absolute -top-0.5 -right-1" />}
    </span>
  );
}

function PerkRow({
  perk,
  compact,
  rolled,
  selected,
  picked,
  onPick,
  clarity,
  enhancedClarity,
  showEnhanced = false,
  ownedEnhanced = false,
}: {
  perk: Perk;
  compact: boolean;
  rolled: boolean;
  selected: boolean;
  picked: boolean;
  onPick?: () => void;
  clarity?: ClarityText;
  enhancedClarity?: ClarityText;
  /** Show the enhanced version (where there is one). */
  showEnhanced?: boolean;
  /** One of the player's copies has this perk enhanced. */
  ownedEnhanced?: boolean;
}) {
  const Tag = onPick ? "button" : "div";
  const shown = showEnhanced && perk.enhanced ? perk.enhanced : perk;
  const row = (
    <Tag
      onClick={onPick}
      className={cx(
        "flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left",
        rolled && "bg-(--accent-soft) shadow-[inset_0_0_0_1px_var(--accent-halo)]",
        picked && "bg-(--accent-soft) shadow-[inset_0_0_0_2px_var(--accent-halo)]",
        onPick && !picked && "hover:bg-white/[0.06]",
      )}
    >
      <PerkIcon perk={shown} size={compact ? 20 : 26} enhanced={ownedEnhanced} />
      <span className={cx("min-w-0 flex-1 truncate", compact ? "text-[11px]" : "text-[12.5px]", rolled && "font-semibold text-white")}>
        {shown.name}
      </span>
      {/* Has an enhanced version (shown: gold). */}
      {perk.enhanced && !compact && !ownedEnhanced && (
        <EnhancedArrow size={8} dim={!showEnhanced} />
      )}
      {/* Currently selected on the player's copy. */}
      {selected && <span className="size-1.5 shrink-0 rounded-full bg-(--accent) shadow-[0_0_3px_var(--accent)]" />}
    </Tag>
  );
  return compact ? (
    row
  ) : (
    <PerkHover perk={perk} clarity={clarity} enhancedClarity={enhancedClarity}>
      {row}
    </PerkHover>
  );
}

/**
 * Picking perks: copies having all picked perks match. With enough picks the
 * first matching copy in the vault can be pulled (button, not automatic).
 */
function usePerkPicks(weapon: WeaponDetail, onChanged?: () => void) {
  const [picked, setPicked] = useState<number[]>([]);
  const [status, setStatus] = useState<PullStatus>({ kind: "none" });

  useEffect(() => {
    setPicked([]);
    setStatus({ kind: "none" });
  }, [weapon.hash]);

  const matches =
    picked.length > 0 ? weapon.copies.filter((c) => picked.every((p) => c.perks.includes(p))) : weapon.copies;
  // Every copy of a fixed roll (exotics) is the same: no perks to pick.
  const fixed = !weapon.columns.some((c) => c.random);
  const enough = fixed || picked.length >= PICKS_TO_PULL;
  const inVault: WeaponCopy | undefined = enough ? matches.find((c) => c.location === "vault") : undefined;
  const onCharacter: WeaponCopy | undefined = enough ? matches.find((c) => c.location !== "vault") : undefined;

  const pull = () => {
    if (!inVault || status.kind === "pulling") return;
    setStatus({ kind: "pulling" });
    weapons
      .pull(inVault, weapon.hash)
      .then((to) => {
        setStatus({ kind: "pulled", to: to ?? "" });
        onChanged?.();
      })
      .catch((e) => setStatus({ kind: "error", message: String(e) }));
  };
  const toggle = (hash: number) => {
    setStatus({ kind: "none" });
    setPicked((p) => (p.includes(hash) ? p.filter((h) => h !== hash) : [...p, hash]));
  };
  const clear = () => {
    setPicked([]);
    setStatus({ kind: "none" });
  };
  return { picked, matches, enough, fixed, inVault, onCharacter, status, pull, toggle, clear };
}

/** Weapon icon with its season watermark on top, as in the game. */
export function WeaponIcon({ icon, watermark, exotic, className }: { icon: string | null; watermark: string | null; exotic: boolean; className: string }) {
  return (
    <div
      className={cx(
        "relative shrink-0 overflow-hidden rounded-lg border bg-black/30",
        exotic ? "border-[#e8c547]/70 shadow-[0_0_7px_-1px_rgb(232_197_71/0.5)]" : "border-white/15",
        className,
      )}
    >
      {icon && <img src={BUNGIE_ORIGIN + icon} alt="" className="size-full object-cover" />}
      {watermark && <img src={BUNGIE_ORIGIN + watermark} alt="" className="absolute inset-0 size-full object-cover" />}
    </div>
  );
}

/** Hint / result line and the pull button for picked perks. */
function PickBar({ picks }: { picks: ReturnType<typeof usePerkPicks> }) {
  const t = useT();
  const { picked, matches, enough, fixed, inVault, onCharacter, status } = picks;
  let text: string;
  let tone = "text-(--accent-text)";
  if (status.kind === "pulling") text = t("weapons.pulling");
  else if (status.kind === "pulled") text = t("weapons.pulled", { to: status.to });
  else if (status.kind === "error") {
    text = status.message;
    tone = "text-red-300";
  } else if (fixed && inVault) text = t("weapons.pickReady", { n: matches.filter((c) => c.location === "vault").length });
  else if (fixed && onCharacter) text = t("weapons.pickHere", { loc: t(`weapons.loc.${onCharacter.location}`) });
  else if (picked.length === 0) text = t("weapons.pickHint");
  else if (matches.length === 0) {
    text = t("weapons.pickNone");
    tone = "text-amber-200";
  } else if (!enough) text = t("weapons.pickMore", { n: matches.length });
  else if (inVault) text = t("weapons.pickReady", { n: matches.filter((c) => c.location === "vault").length });
  else if (onCharacter) text = t("weapons.pickHere", { loc: t(`weapons.loc.${onCharacter.location}`) });
  else text = t("weapons.pickHint");

  return (
    <div className="-mb-1 flex min-h-8 items-center gap-2 text-[11px]">
      <span className={cx("min-w-0 flex-1", tone)}>
        {status.kind === "pulling" && <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-(--accent)" />}
        {text}
      </span>
      {picked.length > 0 && (
        <button onClick={picks.clear} className="shrink-0 text-white/45 hover:text-white/80">
          {t("weapons.pickClear")}
        </button>
      )}
      <GlassButton
        size="sm"
        variant="primary"
        disabled={!inVault || status.kind === "pulling"}
        onClick={picks.pull}
        title={inVault ? undefined : t("weapons.pullDisabled")}
      >
        {t("weapons.pull")}
      </GlassButton>
    </div>
  );
}

/** What makes an exotic: its intrinsic perk spelled out, the catalyst and
 *  what it adds, and its lore line. */
function ExoticInfo({ weapon, clarity }: { weapon: WeaponDetail; clarity: Map<number, ClarityText> }) {
  const t = useT();
  const blocks = [
    weapon.frame && { label: t("weapons.intrinsic"), perk: weapon.frame },
    weapon.catalyst && { label: t("weapons.catalyst"), perk: weapon.catalyst },
  ].filter((b): b is { label: string; perk: Perk } => !!b);
  return (
    <div className="flex flex-col gap-2">
      <div className={cx("grid gap-2", blocks.length > 1 && "sm:grid-cols-2")}>
        {blocks.map(({ label, perk }) => (
          <div
            key={label}
            className="flex gap-3 rounded-xl border border-[#e8c547]/25 bg-[linear-gradient(135deg,rgb(232_197_71/0.08),rgb(255_255_255/0.02))] p-3"
          >
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[#e8c547]/40 bg-black/40 shadow-[0_0_7px_-2px_rgb(232_197_71/0.6)]">
              {perk.icon && <img src={BUNGIE_ORIGIN + perk.icon} alt="" className="size-full object-cover" />}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-[#f0d66b]/80 uppercase">{label}</div>
              <div className="text-[13px] font-semibold text-white">{perk.name}</div>
              <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-line text-white/65">{perk.description}</p>
              {clarity.get(perk.hash) && (
                <div className="mt-2 rounded-lg border border-(--accent-glow) bg-(--accent-soft) p-2">
                  <div className="mb-0.5 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</div>
                  <ClarityLines text={clarity.get(perk.hash)!} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {weapon.flavor && <p className="px-1 text-[12px] leading-relaxed text-white/40 italic">{weapon.flavor}</p>}
    </div>
  );
}

/**
 * All rolls of a weapon: every perk column, frame, origin trait and base
 * stats. `compact` is the in-game overlay version.
 */
export function WeaponView({
  weapon,
  compact = false,
  onVersion,
  onCopiesChanged,
}: {
  weapon: WeaponDetail;
  compact?: boolean;
  /** Switch to another version (app view only). */
  onVersion?: (hash: number) => void;
  /** A copy was moved; reload the copies (app view only). */
  onCopiesChanged?: () => void;
}) {
  const t = useT();
  const canPick = !compact && weapon.copies.length > 0;
  const [showEnhanced, setShowEnhanced] = useState(false);
  const picks = usePerkPicks(weapon, onCopiesChanged);
  const matching = new Set(picks.matches.map((c) => c.id));
  const rolled = new Set(weapon.rolled);
  const selected = new Set(weapon.copies.flatMap((c) => c.selected));
  // Perks the player has enhanced on (the matching) copies.
  const ownedEnhanced = new Set(
    (picks.picked.length > 0 ? weapon.copies.filter((c) => matching.has(c.id)) : weapon.copies).flatMap((c) => c.enhanced ?? []),
  );
  const versionIndex = weapon.versions.findIndex((v) => v.hash === weapon.hash);
  const ammo = { 1: t("weapons.ammoPrimary"), 2: t("weapons.ammoSpecial"), 3: t("weapons.ammoHeavy") }[weapon.ammo];
  const exotic = weapon.tier === EXOTIC;
  // Exact numbers from Clarity for everything shown (app view only).
  const clarity = useClarity(
    compact
      ? []
      : [
          ...weapon.columns.flatMap((c) => c.perks.flatMap((p) => (p.enhanced ? [p.hash, p.enhanced.hash] : [p.hash]))),
          ...weapon.origins.map((p) => p.hash),
          ...(weapon.frame ? [weapon.frame.hash] : []),
          ...(weapon.catalyst ? [weapon.catalyst.hash] : []),
        ],
  );
  const bars = weapon.stats.filter((s) => !s.numeric);
  const numbers = weapon.stats.filter((s) => s.numeric);

  return (
    <div className={cx("flex flex-col", compact ? "gap-2.5" : "gap-4")}>
      <div className="flex items-center gap-3">
        <WeaponIcon icon={weapon.icon} watermark={weapon.watermark} exotic={exotic} className={compact ? "size-11" : "size-14"} />
        <div className="min-w-0">
          <div
            className={cx(
              "truncate font-display leading-tight font-semibold",
              compact ? "text-[16px]" : "text-[20px]",
              exotic && "text-[#f0d66b]",
            )}
          >
            {weapon.name}
          </div>
          <div className="truncate text-[11.5px] text-white/55">
            {[weapon.typeName, ammo].filter(Boolean).join(" · ")}
          </div>
          {!compact && (weapon.craftable || weapon.enhanceable) && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {weapon.craftable && (
                <span className="rounded-md border border-[#e8c547]/35 bg-[#e8c547]/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-[#f0d66b]">
                  {t("weapons.craftable")}
                </span>
              )}
              {weapon.enhanceable && !weapon.craftable && (
                <span className="rounded-md border border-[#e8c547]/35 bg-[#e8c547]/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-[#f0d66b]">
                  {t("weapons.enhanceable")}
                </span>
              )}
            </div>
          )}
          {weapon.versions.length > 1 && (
            <div className="truncate text-[11px] text-white/40">
              {t("weapons.version", { i: versionIndex + 1, n: weapon.versions.length })} ·{" "}
              {t(MATCHED[weapon.matchedBy])}
            </div>
          )}
        </div>
      </div>

      {exotic && !compact && <ExoticInfo weapon={weapon} clarity={clarity} />}

      {weapon.seasonNeedsSetup && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] text-amber-200">
          {t("weapons.seasonSetup")}
        </p>
      )}

      {/* Other versions (reissues) to switch to, by their season watermark. */}
      {onVersion && weapon.versions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("weapons.versions")}
          </span>
          {weapon.versions.map((v, i) => (
            <button
              key={v.hash}
              onClick={() => onVersion(v.hash)}
              title={t("weapons.version", { i: i + 1, n: weapon.versions.length })}
              className={cx(
                "rounded-lg p-0.5 transition-[box-shadow,opacity] duration-200",
                v.hash === weapon.hash ? "shadow-[0_0_0_2px_var(--accent-halo)]" : "opacity-60 hover:opacity-100",
              )}
            >
              <WeaponIcon icon={weapon.icon} watermark={v.watermark} exotic={exotic} className="size-9" />
            </button>
          ))}
        </div>
      )}

      {((weapon.frame && !(exotic && !compact)) || weapon.origins.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {[exotic && !compact ? null : weapon.frame, ...weapon.origins].filter((p): p is Perk => !!p).map((p, j) => (
            <PerkHover key={`${p.hash}-${j}`} perk={p} clarity={clarity.get(p.hash)}>
              <span className="inline-flex cursor-default items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] py-0.5 pr-2 pl-0.5 text-[11px]">
                <PerkIcon perk={p} size={18} />
                <span className="text-white/45">{p.typeName}:</span> {p.name}
              </span>
            </PerkHover>
          ))}
        </div>
      )}

      {/* The player's own copies (Bungie login): their perks are highlighted below. */}
      {weapon.copies.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("weapons.copies")} ({weapon.copies.length})
          </div>
          {weapon.copies.map((copy, i) => {
            const perks = weapon.columns.flatMap((c) => c.perks).filter((p) => copy.perks.includes(p.hash));
            const match = picks.picked.length > 0 && matching.has(copy.id);
            return (
              <div
                key={copy.id || i}
                className={cx(
                  "flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-[opacity,background-color] duration-200",
                  match ? "bg-(--accent-soft) shadow-[inset_0_0_0_1px_var(--accent-halo)]" : "bg-white/[0.04]",
                  picks.picked.length > 0 && !match && "opacity-40",
                )}
              >
                <span className="w-20 shrink-0 truncate text-[11px] text-white/50">{t(`weapons.loc.${copy.location}`)}</span>
                {perks.map((p) => (
                  <span
                    key={p.hash}
                    className={cx("flex min-w-0 items-center gap-1", !copy.selected.includes(p.hash) && "opacity-45")}
                    title={p.name}
                  >
                    <PerkIcon perk={p} size={compact ? 18 : 22} enhanced={copy.enhanced?.includes(p.hash)} />
                    {!compact && (
                      <span className={cx("truncate text-[11.5px]", copy.enhanced?.includes(p.hash) ? "text-[#f0d66b]" : "text-white/80")}>
                        {p.name}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {canPick ? (
        <PickBar picks={picks} />
      ) : (
        rolled.size > 0 && <div className="-mb-1 text-[11px] text-(--accent-text)">{t("weapons.rolled")}</div>
      )}
      {!compact && weapon.enhanceable && (
        <button
          onClick={() => setShowEnhanced((v) => !v)}
          className={cx(
            "-mb-1 inline-flex items-center gap-2 self-start rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            showEnhanced
              ? "border-[#e8c547]/50 bg-[#e8c547]/15 text-[#f0d66b] shadow-[0_0_7px_-3px_rgb(232_197_71/0.8)]"
              : "border-white/10 bg-white/[0.04] text-white/60 hover:text-white/85",
          )}
        >
          <EnhancedArrow size={9} dim={!showEnhanced} />
          {t(showEnhanced ? "weapons.enhancedOn" : "weapons.enhancedOff")}
        </button>
      )}
      {weapon.columns.length > 0 && (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${weapon.columns.length}, minmax(0, 1fr))` }}
        >
          {weapon.columns.map((column, i) => (
            <div key={i} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-1.5">
              <div className="mb-1 truncate px-1 text-[10px] font-semibold tracking-[0.12em] text-white/40 uppercase">
                {column.label}
              </div>
              <div className="flex flex-col">
                {column.perks.map((p, j) => (
                  <PerkRow
                    key={`${p.hash}-${j}`}
                    perk={p}
                    compact={compact}
                    rolled={rolled.has(p.hash)}
                    selected={selected.has(p.hash)}
                    picked={picks.picked.includes(p.hash)}
                    onPick={canPick ? () => picks.toggle(p.hash) : undefined}
                    clarity={clarity.get(p.hash)}
                    enhancedClarity={p.enhanced ? clarity.get(p.enhanced.hash) : undefined}
                    showEnhanced={showEnhanced}
                    ownedEnhanced={ownedEnhanced.has(p.hash)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {weapon.stats.length > 0 && (
        <div className={cx("grid gap-x-5 gap-y-1", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
          {bars.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-white/55">{s.name}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="bar-grow h-full rounded-full bg-white/70" style={{ width: `${Math.min(100, s.value)}%` }} />
              </div>
              <span className="w-7 text-right text-[11px] font-semibold tabular-nums">
                <CountUp text={String(s.value)} />
              </span>
            </div>
          ))}
          {numbers.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-white/55">{s.name}</span>
              <span className="text-[11px] font-semibold tabular-nums">
                <CountUp text={String(s.value)} />
              </span>
            </div>
          ))}
        </div>
      )}
      {clarity.size > 0 && <ClarityCredit />}
    </div>
  );
}
