import { openUrl } from "@tauri-apps/plugin-opener";
import { placeCard } from "../lib/placeCard";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { CLARITY_DISCORD, CLARITY_SITE, useClarity, useClarityItems, type ClarityItemPerk, type ClarityPiece, type ClarityText } from "../lib/clarity";
import type { ItemInfo } from "../lib/fireteam";
import type { Perk } from "../lib/weapons";
import { useT } from "../lib/i18n";
import { isTauri } from "../lib/tauri";
import { EnhancedArrow } from "./EnhancedArrow";
import { cx } from "./glass";

const open = (url: string) => (isTauri ? void openUrl(url) : window.open(url));

/** Colors of Clarity's element / ammo markers. */
const TONES: Record<string, string> = {
  solar: "#ff8a3d",
  arc: "#7dd3fc",
  void: "#b388ff",
  stasis: "#6c9cff",
  strand: "#5eead4",
  kinetic: "#e5e7eb",
  primary: "#e5e7eb",
  special: "#7ee08a",
  heavy: "#c4a5ff",
  barrier: "#e5e7eb",
  overload: "#e5e7eb",
  unstoppable: "#e5e7eb",
};

function Piece({ piece }: { piece: ClarityPiece }) {
  const cls = piece.classNames ?? [];
  const tone = cls.map((c) => TONES[c]).find(Boolean);
  let text = piece.text ?? "";
  // A marker without text (an element / ammo icon in game): its name.
  if (!text && tone) text = cls[0].charAt(0).toUpperCase() + cls[0].slice(1);
  if (cls.includes("enhancedArrow")) return <EnhancedArrow size={8} className="mr-1 inline-block align-[-1px]" />;
  if (!text) return null;
  const pvp = /^\[PVP:.*\]$/i.test(text.trim());
  if (piece.link) {
    return (
      <button onClick={() => open(piece.link!)} className="text-(--accent-text) underline decoration-dotted underline-offset-2">
        {text}
      </button>
    );
  }
  return (
    <span
      className={cx(
        cls.includes("bold") && "font-semibold text-white",
        pvp && "rounded bg-white/[0.07] px-1 text-[0.92em] text-white/55",
        cls.includes("enhancedArrow") && "text-[#f0d66b]",
      )}
      style={tone ? { color: tone, fontWeight: 600 } : undefined}
    >
      {text}
    </span>
  );
}

/** Clarity's description: lines, with gaps between its paragraphs. */
export function ClarityLines({ text, className }: { text: ClarityText; className?: string }) {
  return (
    <div className={cx("flex flex-col text-[12px] leading-relaxed text-white/80", className)}>
      {text.map((block, i) =>
        block.classNames?.includes("spacer") ? (
          <span key={i} className="h-1.5" />
        ) : (
          <p key={i} className={cx(block.classNames?.includes("bold") && "font-semibold text-white")}>
            {(block.linesContent ?? []).map((piece, j) => (
              <Piece key={j} piece={piece} />
            ))}
          </p>
        ),
      )}
    </div>
  );
}

/** "Numbers: Clarity" with the links Clarity asks for. */
export function ClarityCredit({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 text-[10.5px] text-white/35", className)}>
      <span>{t("clarity.credit")}</span>
      <button onClick={() => open(CLARITY_SITE)} className="text-(--accent-text) hover:underline">
        Clarity · Community Research
      </button>
      <span>·</span>
      <button onClick={() => open(CLARITY_DISCORD)} className="hover:text-white/70 hover:underline">
        {t("clarity.feedback")}
      </button>
    </div>
  );
}

/**
 * A perk with a card on hover: Bungie's description and, where Clarity
 * knows it, the exact numbers.
 */
export function PerkHover({
  perk,
  clarity,
  enhancedClarity,
  exact,
  disabled = false,
  children,
}: {
  perk: Perk;
  clarity?: ClarityText;
  /** No card (only the children). */
  disabled?: boolean;
  /** Exact numbers as text (Destiny Data Compendium), where Clarity has none. */
  exact?: string;
  /** Clarity for the perk's enhanced version. */
  enhancedClarity?: ClarityText;
  children: ReactNode;
}) {
  const t = useT();
  const anchor = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef(0);

  useLayoutEffect(() => {
    if (!at || !card.current) return;
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    // Below, else above, else beside it: never over it (and the pointer).
    setPos(placeCard(at, w, h));
  }, [at]);

  return (
    <span
      ref={anchor}
      className="contents"
      onMouseEnter={(e) => {
        if (disabled) return;
        const target = e.currentTarget.firstElementChild ?? e.currentTarget;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAt((target as Element).getBoundingClientRect()), 180);
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
            className="animate-fade-in pointer-events-none fixed z-[120] w-80 rounded-2xl border border-white/10 bg-[#05070c]/97 p-3.5 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95),0_0_24px_-12px_var(--accent-halo)] backdrop-blur-md"
            style={pos ?? { left: -9999, top: -9999 }}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[#1d4a6b]/70">
                {perk.icon && <img src={BUNGIE_ORIGIN + perk.icon} alt="" className="size-full object-cover" />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{perk.name}</div>
                {perk.typeName && <div className="text-[10.5px] text-white/45">{perk.typeName}</div>}
              </div>
            </div>
            {perk.description && <p className="mt-2 text-[12px] leading-relaxed whitespace-pre-line text-white/60">{perk.description}</p>}
            {clarity && (
              <div className="mt-2.5 rounded-xl border border-(--accent-glow) bg-(--accent-soft) p-2.5">
                <div className="mb-1 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</div>
                <ClarityLines text={clarity} />
              </div>
            )}
            {!clarity && exact && (
              <div className="mt-2.5 rounded-xl border border-(--accent-glow) bg-(--accent-soft) p-2.5">
                <div className="mb-1 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</div>
                <p className="text-[12px] leading-relaxed whitespace-pre-line text-white/80">{exact}</p>
                <CompendiumCredit className="mt-1.5" />
              </div>
            )}
            {perk.enhanced && (
              <div className="mt-2.5 rounded-xl border border-[#e8c547]/30 bg-[linear-gradient(135deg,rgb(232_197_71/0.1),rgb(255_255_255/0.02))] p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.14em] text-[#f0d66b] uppercase">
                  <EnhancedArrow size={8} /> {t("weapons.enhancedVersion")}
                </div>
                {enhancedClarity ? (
                  <ClarityLines text={enhancedClarity} />
                ) : (
                  <p className="text-[12px] leading-relaxed whitespace-pre-line text-white/65">{perk.enhanced.description}</p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** An exotic's own perk with Clarity's exact numbers, in the exotic gold. */
export function ExoticPerkBlock({ perks, compact = false }: { perks: ClarityItemPerk[]; compact?: boolean }) {
  const t = useT();
  return (
    <div className={cx("rounded-xl border border-[#e8c547]/25 bg-[linear-gradient(135deg,rgb(232_197_71/0.08),rgb(255_255_255/0.02))]", compact ? "p-2.5" : "p-3")}>
      {perks.map((p, i) => (
        <div key={i} className={cx(i > 0 && "mt-2.5 border-t border-white/[0.06] pt-2.5")}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-[#f0d66b]">{p.name}</span>
            {i === 0 && <span className="shrink-0 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</span>}
          </div>
          <ClarityLines text={p.text} className="mt-1" />
        </div>
      ))}
    </div>
  );
}

/** An item with a card on hover: its exotic perk with Clarity's numbers. */
export function ExoticHover({ perks, children }: { perks?: ClarityItemPerk[]; children: ReactNode }) {
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
  if (!perks?.length) return <>{children}</>;
  return (
    <span
      className="contents"
      onMouseEnter={(e) => {
        const target = e.currentTarget.firstElementChild ?? e.currentTarget;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAt((target as Element).getBoundingClientRect()), 180);
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
            className="animate-fade-in pointer-events-none fixed z-[120] w-80 rounded-2xl border border-white/10 bg-[#05070c]/97 p-2 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95)] backdrop-blur-md"
            style={pos ?? { left: -9999, top: -9999 }}
          >
            <ExoticPerkBlock perks={perks} compact />
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * An exotic armor piece's exotic perks as plugged (an exotic class item's
 * two spirits too): Clarity's exact numbers where it has them, else
 * Bungie's description. Nothing when there is nothing to tell.
 */
export function ExoticArmorPerks({ item, compact = false }: { item: ItemInfo; compact?: boolean }) {
  const t = useT();
  const perks = item.perks ?? [];
  const clarity = useClarity(perks.map((p) => p.hash));
  const byItem = useClarityItems(perks.length === 0 ? [item.hash] : []);
  const entries: { name: string; text?: ClarityText; exact?: string; description?: string }[] =
    perks.length > 0
      ? perks.map((p) => ({ name: p.name, text: clarity.get(p.hash), exact: p.exact, description: p.description }))
      : (byItem.get(item.hash) ?? []).map((p) => ({ name: p.name, text: p.text }));
  // Neither Clarity nor the perks have numbers: the Compendium's for the piece.
  if (item.exact && !entries.some((e) => e.text || e.exact)) entries.splice(0, entries.length, { name: item.name, exact: item.exact });
  if (entries.length === 0) return null;
  const exact = entries.some((e) => e.text || e.exact);
  const fromCompendium = entries.some((e) => !e.text && e.exact);
  return (
    <div className={cx("rounded-xl border border-[#e8c547]/25 bg-[linear-gradient(135deg,rgb(232_197_71/0.08),rgb(255_255_255/0.02))]", compact ? "p-2.5" : "p-3")}>
      {entries.map((e, i) => (
        <div key={i} className={cx(i > 0 && "mt-2.5 border-t border-white/[0.06] pt-2.5")}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-[#f0d66b]">{e.name}</span>
            {(e.text || e.exact) && <span className="shrink-0 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</span>}
          </div>
          {e.text ? (
            <ClarityLines text={e.text} className="mt-1" />
          ) : e.exact ? (
            <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-line text-white/80">{e.exact}</p>
          ) : (
            e.description && <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-line text-white/65">{e.description}</p>
          )}
        </div>
      ))}
      {!exact && <p className="mt-2 text-[10.5px] text-white/35">{t("clarity.noNumbers")}</p>}
      {fromCompendium && <CompendiumCredit className="mt-2" />}
    </div>
  );
}

/** An exotic armor piece with its exotic perks on hover. */
export function ExoticArmorHover({ item, children }: { item: ItemInfo; children: ReactNode }) {
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
  if (!item.exotic) return <>{children}</>;
  return (
    <span
      className="contents"
      onMouseEnter={(e) => {
        const target = e.currentTarget.firstElementChild ?? e.currentTarget;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAt((target as Element).getBoundingClientRect()), 180);
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
            className="animate-fade-in pointer-events-none fixed z-[120] w-80 empty:hidden"
            style={pos ?? { left: -9999, top: -9999 }}
          >
            <div className="rounded-2xl bg-[#05070c]/97 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95)] backdrop-blur-md">
              <ExoticArmorPerks item={item} compact />
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

export const COMPENDIUM_URL = "https://docs.google.com/spreadsheets/d/1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4";

/** "Exact numbers: Destiny Data Compendium" (set bonuses, class item spirits). */
export function CompendiumCredit({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 text-[10.5px] text-white/35", className)}>
      <span>{t("clarity.credit")}</span>
      <button onClick={() => open(COMPENDIUM_URL)} className="text-(--accent-text) hover:underline">
        Destiny Data Compendium
      </button>
    </div>
  );
}
