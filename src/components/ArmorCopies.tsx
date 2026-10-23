import { useCallback, useEffect, useState, type ReactNode } from "react";
import { armorApi, type ArmorCompare, type ArmorCopy, type ArmorMods as ModsOf, type ModPlug } from "../lib/armor";

type ModSlots = ModsOf["slots"];
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { ActionToast } from "./ActionToast";
import { ArmorMods } from "./ArmorMods";
import { cx } from "./glass";

const src = (icon: string | null | undefined) => (icon ? (icon.startsWith("http") ? icon : BUNGIE_ORIGIN + icon) : null);
/** An armor piece's icon with its tier as the game draws it: a column of
 *  small gold diamonds down the left edge, one per tier. */
function ArmorIcon({ icon, tier, size }: { icon: string | null | undefined; tier: number | null; size: number }) {
  const url = src(icon);
  const pip = Math.max(3, Math.round(size / 11));
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-[3px] border border-white/20" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" className="size-full" /> : <span className="block size-full bg-white/[0.05]" />}
      {!!tier && (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 left-0 flex flex-col items-center justify-start bg-black/45"
          style={{ width: pip * 2 + 2, gap: Math.max(1, pip / 2), paddingTop: pip * 0.8 }}
        >
          {Array.from({ length: tier }, (_, i) => (
            <span
              key={i}
              className="rotate-45 bg-[#f5dc56] shadow-[0_0_0_0.5px_rgb(0_0_0/0.6)]"
              style={{ width: pip, height: pip }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** A stat's bar is full at this (a piece's stat rarely goes past it). */
const STAT_MAX = 45;

/**
 * The player's copies of an armor piece, the vault's too: where each is,
 * its tier, power and stats (the equipped one on top, then the best
 * total). A click opens one as DIM inspects it: its stats as bars, its
 * energy, archetype and mods (to change).
 */
export function ArmorCopies({ versions, children }: { versions: number[]; children?: ReactNode }) {
  const t = useT();
  const [copies, setCopies] = useState<ArmorCopy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // A copy being brought over (double click), and how it went.
  const [moving, setMoving] = useState<string | null>(null);
  const [moved, setMoved] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (keep: string | null) =>
    armorApi
      .copies(versions)
      .then((c) => {
        setCopies(c ?? []);
        setPicked(keep && c?.some((x) => x.instanceId === keep) ? keep : (c?.[0]?.instanceId ?? null));
      })
      .catch((e) => {
        setCopies([]);
        setError(String(e));
      });
  useEffect(() => {
    setCopies(null);
    setPicked(null);
    setMoved(null);
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.join(",")]);

  // Double click: to a character of its class (from the vault, or from
  // another character through it).
  const pull = (c: ArmorCopy) => {
    if (c.location === "equipped") {
      setMoved({ ok: false, text: t("copies.isEquipped") });
      return;
    }
    setMoving(c.instanceId);
    setMoved(null);
    armorApi
      .pull(c.instanceId, c.itemHash, c.characterId)
      .then(async (to) => {
        setMoved({ ok: true, text: t("copies.pulled", { name: c.item?.name ?? "", to: to ?? "" }) });
        await load(c.instanceId);
      })
      .catch((e) => setMoved({ ok: false, text: String(e) }))
      .finally(() => setMoving(null));
  };
  // The outcome stays a moment, then goes.
  useEffect(() => {
    if (!moved) return;
    const id = window.setTimeout(() => setMoved(null), moved.ok ? 3000 : 6000);
    return () => window.clearTimeout(id);
  }, [moved]);

  if (copies === null || copies.length === 0)
    return (
      <>
        {children}
        <p className="mt-4 px-1 text-[12px] text-white/40">
          {copies === null ? t("copies.loading") : (error ?? t("copies.none"))}
        </p>
      </>
    );

  const where = (c: ArmorCopy) =>
    c.location === "vault"
      ? t("copies.vault")
      : `${c.location === "equipped" ? t("copies.equipped") : t("copies.inventory")}${c.className ? ` · ${c.className}` : ""}`;
  const copy = copies.find((c) => c.instanceId === picked) ?? null;

  return (
    // The set bonus (`children`) with the picked copy's card under it; all
    // the copies beside, scrolled on their own.
    <div className="grid grid-cols-[minmax(0,1fr)_21rem] items-start gap-4">
      {/* How a pull goes: while it runs, then its outcome for a moment. */}
      <ActionToast
        state={
          moving
            ? { kind: "busy", text: t("copies.pulling", { name: copies.find((c) => c.instanceId === moving)?.item?.name ?? "" }) }
            : moved
              ? { kind: moved.ok ? "ok" : "error", text: moved.text }
              : null
        }
      />
      <div className="min-w-0">
        {children}
        {copy && <CopyCard key={copy.instanceId} copy={copy} versions={versions} where={where(copy)} />}
      </div>
      <div className="sticky top-0 flex max-h-[calc(100vh-9vh-2.5rem)] flex-col rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <span className="text-[12.5px] font-semibold text-white/85">{t("copies.title")}</span>
          <span className="text-[11px] text-white/45">{t("copies.hint", { n: copies.length })}</span>
        </div>
        <div className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
          {copies.map((c) => (
            <button
              key={c.instanceId}
              type="button"
              onClick={() => setPicked(c.instanceId)}
              onDoubleClick={() => pull(c)}
              title={t("copies.pullHint")}
              className={cx(
                moving === c.instanceId && "animate-pulse",
                "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                picked === c.instanceId ? "bg-(--accent-soft)" : "hover:bg-white/[0.05]",
              )}
            >
              <ArmorIcon icon={c.item?.icon} tier={c.tier} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cx("truncate", c.location === "equipped" ? "text-(--accent-text)" : "text-white/75")}>
                    {where(c)}
                  </span>
                  <span className="shrink-0 text-white/50 tabular-nums">
                    {c.power ? `◆ ${c.power}` : ""} <span className="ml-1 font-semibold text-white">{c.total}</span>
                  </span>
                </span>
                {(c.general || c.tuning) && (
                  <span className="mt-0.5 block truncate text-[10.5px] text-white/50">
                    {[bonusText(c.general, c.stats), c.tuning ? `${t("copies.tuning")}: ${bonusText(c.tuning, c.stats)}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
                <span className="mt-0.5 flex items-center justify-between gap-1">
                  {c.stats.map((s) => (
                    <span key={s.name} title={s.name} className="inline-flex items-center gap-0.5 tabular-nums">
                      {src(s.icon) && <img src={src(s.icon)!} alt="" className="size-3 opacity-60" />}
                      <span className={s.value >= 20 ? "text-white" : "text-white/50"}>{s.value}</span>
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One copy as DIM inspects it. */
function CopyCard({ copy, versions, where }: { copy: ArmorCopy; versions: number[]; where: string }) {
  const t = useT();
  // The energy its mods take (from the mods below).
  const [used, setUsed] = useState<number | null>(null);
  // The character it goes on, and the piece it would replace there.
  const [compare, setCompare] = useState<ArmorCompare | null>(null);
  useEffect(() => {
    void armorApi.compare(copy.itemHash).then((c) => setCompare(c ?? null)).catch(() => setCompare(null));
  }, [copy.itemHash]);
  const energy = copy.energy ?? 0;
  // The mods as loaded, and as they are now (changed here): the stats
  // follow a mod changed (a stat mod's +10, a tuning's +5 / -5).
  const [slotsAt, setSlotsAt] = useState<ModSlots | null>(null);
  const [slotsNow, setSlotsNow] = useState<ModSlots | null>(null);
  const onSlots = useCallback((slots: ModSlots) => {
    setSlotsAt((first) => first ?? slots);
    setSlotsNow(slots);
  }, []);
  const bonus = (slots: ModSlots | null) => {
    const by = new Map<number, number>();
    for (const s of slots ?? []) for (const [hash, value] of s.plug?.stats ?? []) by.set(hash, (by.get(hash) ?? 0) + value);
    return by;
  };
  const before = bonus(slotsAt);
  const after = bonus(slotsNow);
  const stats = copy.stats.map((s) => ({ ...s, value: s.value - (before.get(s.hash) ?? 0) + (after.get(s.hash) ?? 0) }));
  const total = stats.reduce((sum, s) => sum + s.value, 0);
  const shownCopy = { ...copy, stats, total };
  return (
    <div className="zoom-in-deeper mt-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
      {/* Head: the piece, where it is, its power and tier. */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[linear-gradient(90deg,rgb(80_50_120/0.35),transparent)] p-3">
        <ArmorIcon icon={copy.item?.icon} tier={copy.tier} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[16px] font-semibold tracking-wide uppercase">{copy.item?.name}</div>
          <div className="text-[12px] text-white/55">
            {copy.item?.typeName} · {where}
          </div>
        </div>
        <div className="text-right">
          {copy.power && <div className="font-display text-[20px] leading-none font-semibold tabular-nums">{copy.power}</div>}
        </div>
      </div>

      <div className="grid gap-4 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Stats as bars, and the total. */}
        <div>
          <div className="space-y-1.5">
            {stats.map((s) => (
              <div key={s.name} className="grid grid-cols-[4.5rem_2.5rem_1rem_minmax(0,1fr)] items-center gap-2 text-[12px]">
                <span className="truncate text-right text-white/60">{s.name}</span>
                <span className={cx("text-right tabular-nums", s.value > 0 ? "font-semibold text-white" : "text-white/45")}>
                  {s.value > 0 ? `+${s.value}` : s.value}
                </span>
                {src(s.icon) ? <img src={src(s.icon)!} alt="" className="size-3.5 opacity-70" /> : <span />}
                <span className="h-2.5 overflow-hidden bg-white/[0.08]">
                  <span
                    className="bar-grow block h-full bg-white/80"
                    style={{ width: `${Math.max(0, Math.min(100, (s.value / STAT_MAX) * 100))}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[4.5rem_2.5rem] gap-2 border-t border-white/[0.08] pt-1.5 text-[12px]">
            <span className="text-right text-white/60">{t("copies.total")}</span>
            <span className="text-right font-semibold tabular-nums">{total}</span>
          </div>
          {compare && <WithIt copy={shownCopy} compare={compare} original={copy.stats.map((s) => s.value)} />}
        </div>

        <div className="space-y-3">
          {/* Energy: one box per point, filled as its mods use it. */}
          {energy > 0 && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold text-white/70">{t("copies.energy", { n: energy })}</div>
              <div className="flex gap-1">
                {Array.from({ length: energy }, (_, i) => (
                  <span
                    key={i}
                    className={cx("h-3 flex-1 border", used !== null && i < used ? "border-white/80 bg-white/80" : "border-white/40")}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Its general mod and tuning: what they add. */}
          <BonusRow label={t("copies.general")} plug={copy.general} stats={copy.stats} />
          <BonusRow label={t("copies.tuning")} plug={copy.tuning} stats={copy.stats} />
          {/* Its archetype: which stats it favors. */}
          {copy.archetype && (
            <div className="flex items-start gap-2.5 rounded-xl bg-white/[0.04] p-2.5">
              {src(copy.archetype.icon) && <img src={src(copy.archetype.icon)!} alt="" className="size-8" />}
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold">{copy.archetype.name}</div>
                {copy.archetype.description && (
                  <div className="text-[11.5px] leading-snug whitespace-pre-line text-white/55">{copy.archetype.description}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Its mods: see them, change them. */}
      <div className="border-t border-white/[0.06] px-3 pb-3">
        <ArmorMods versions={versions} instanceId={copy.instanceId} onUsed={setUsed} onSlots={onSlots} />
      </div>
    </div>
  );
}

/**
 * The character's stats with the copy on: theirs now, less the piece worn
 * in that slot, plus this one (its mods included, as Bungie counts them).
 */
function WithIt({ copy, compare, original = [] }: { copy: ArmorCopy; compare: ArmorCompare; original?: number[] }) {
  const t = useT();
  const worn = compare.equippedId === copy.instanceId;
  return (
    <div className="mt-3 rounded-xl bg-white/[0.04] p-2.5">
      <div className="mb-1.5 text-[11.5px] font-semibold text-white/70">
        {worn
          ? t("copies.wornBy", { class: compare.className })
          : t("copies.withIt", { class: compare.className, name: compare.equippedName ?? t("copies.nothing") })}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1">
        {copy.stats.map((s, i) => {
          const now = compare.character[i] ?? 0;
          // (A stat goes from 0 to 200.)
          const next = Math.max(0, Math.min(200, now - (worn ? (original[i] ?? s.value) : (compare.equipped[i] ?? 0)) + s.value));
          const delta = next - now;
          return (
            <div key={s.name} className="flex items-center gap-1.5 text-[12px] tabular-nums">
              {src(s.icon) && <img src={src(s.icon)!} alt="" title={s.name} className="size-3.5 opacity-70" />}
              <span className="font-semibold">{next}</span>
              {delta !== 0 && (
                <span className={delta > 0 ? "text-[#7fd49a]" : "text-[#f08a8f]"}>
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A mod's stat bonus as words: "+5 Weapons", "+5 Weapons / -5 Health". */
function bonusText(plug: ModPlug | null, stats: ArmorCopy["stats"]) {
  if (!plug?.stats?.length) return "";
  const name = (hash: number) => stats.find((s) => s.hash === hash)?.name ?? "";
  return [...plug.stats]
    .sort((a, b) => b[1] - a[1])
    .map(([hash, value]) => `${value > 0 ? "+" : ""}${value} ${name(hash)}`)
    .join(" / ");
}

/** A general mod or tuning: its icon, name and what it adds. */
function BonusRow({ label, plug, stats }: { label: string; plug: ModPlug | null; stats: ArmorCopy["stats"] }) {
  if (!plug) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] p-2.5">
      {src(plug.item.icon) && <img src={src(plug.item.icon)!} alt="" className="size-8 rounded" />}
      <div className="min-w-0">
        <div className="text-[11px] text-white/45">{label}</div>
        <div className="text-[12.5px] font-semibold">{bonusText(plug, stats)}</div>
      </div>
    </div>
  );
}
