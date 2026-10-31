import { useEffect, useMemo, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { ClarityText } from "../lib/clarity";
import { useT } from "../lib/i18n";
import { cx } from "./glass";

/** Something in the build that may resist damage: its exact text. */
export interface ResistSource {
  key: string;
  name: string;
  icon: string | null;
  /** Where it's from ("Aspect", "Set bonus", …). */
  kind: string;
  text: string;
}

/** Clarity's description as plain lines. */
export function clarityPlain(text: ClarityText | undefined): string {
  return (text ?? []).map((b) => (b.linesContent ?? []).map((p) => p.text ?? "").join("")).join("\n");
}

/** The "Resist xN" tiers (PvE): they don't stack with each other, only the highest counts. */
const RESIST_TIERS: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.4, 4: 0.5 };

/** Guardians' own resist against combatants, on their 70 health (not
 *  shields): ~237 effective HP (Destiny Data Compendium). */
const BASE_HEALTH = 70;
const BASE_SHIELDS = 130;
const BASE_HEALTH_RESIST = 0.345;

/** One resist a text gives (PvE: the first number, [ ] is PvP). */
interface ResistLevel {
  value: number;
  /** A "Resist xN" tier, if it is one. */
  tier: number | null;
  /** What it's for ("Power of the Son x2"), from its line. */
  label: string;
}

interface Resist {
  source: ResistSource;
  /** Every resist it names (stacks, steps), lowest first. */
  levels: ResistLevel[];
  /** Only while / after something (else always on). */
  conditional: boolean;
  /** The line that says when. */
  when: string;
}

/** A buff's own resist (counted as that buff, not as the text's). */
const BUFF_WORDS = /Woven Mail|Amplified|Frost Armor|Transcenden/i;
const lineAt = (text: string, at: number) => {
  const end = text.indexOf("\n", at);
  return text.slice(text.lastIndexOf("\n", at) + 1, end < 0 ? undefined : end);
};

/** The damage resist a text gives, if any. */
function resistOf(source: ResistSource): Resist | null {
  const text = source.text.replace(/\r/g, "");
  // A super's own resist counts as "In super" (switched by hand).
  if (/General Super Information/i.test(text)) return null;
  // Not a buff's own (counted as the buff), nor resist only for an
  // animation (a dodge's: too short to count).
  const skip = (line: string) => BUFF_WORDS.test(line) || /animation|while dodging|during (the |a )?dodge/i.test(line);
  // The sentence a number is in names something else that resists (a
  // decoy, clone, turret, barricade …: "Decoy has … 70% Damage Resist"):
  // not the player's.
  // (Its sentence saying it's the player's, "the user gains …", wins.)
  const someoneElse = (at: number) => {
    const sentence = text.slice(Math.max(text.lastIndexOf(".", at), text.lastIndexOf("\n", at)) + 1, at);
    if (/\b(user|you|your|caster|grants?|gains?|allies)\b/i.test(sentence)) return false;
    // (Its paragraph: "Barricades have 90% …" a line above "80% … Splash".)
    return /\b(decoys?|clones?|specters?|threadlings?|turrets?|sentry|sentries|barricades?|constructs?|totems?|servitors?|minions?|summons?|tangles?|crystals?)\b/i.test(
      text.slice(text.lastIndexOf("\n\n", at) + 1, at),
    );
  };
  // What the line says it's for: up to its first ":" or "|", else its start.
  const labelOf = (line: string, at: number) => {
    const head = line.split(/[:|]/)[0].trim();
    return (head.length > 0 && head.length < 60 ? head : line.slice(0, Math.min(at, 60)).trim()).replace(/[,;]$/, "");
  };
  const found: ResistLevel[] = [];
  const add = (value: number, tier: number | null, line: string, at: number) => {
    if (value > 0 && value < 1 && !found.some((l) => l.value === value)) found.push({ value, tier, label: labelOf(line, at) });
  };
  // "Resist x2 (25% DR)", "(Resist x1)".
  const tiers = /Resist x(\d)/gi;
  const tierAt = new Set<number>();
  for (let m = tiers.exec(text); m; m = tiers.exec(text)) {
    const line = lineAt(text, m.index);
    if (!RESIST_TIERS[+m[1]] || skip(line) || someoneElse(m.index)) continue;
    tierAt.add(text.lastIndexOf("\n", m.index));
    add(RESIST_TIERS[+m[1]], +m[1], line, m.index);
  }
  // "45% Damage Resist", "20?% [10%] Damage Resistance", "25% DR"; not
  // flinch or self-damage resist, nor the number a tier on the same line
  // already gave.
  const re = /(\d+(?:\.\d+)?)\??\s*%\s*(?:\[[^\]]*\]\s*)?(?:\([^)]*\)\s*)?(Area-of-Effect\s+)?(Damage Resist(?:ance)?|Damage Reduction|DR)\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    const line = lineAt(text, m.index);
    if (/self-?\s*$/i.test(before) || skip(line) || someoneElse(m.index) || tierAt.has(text.lastIndexOf("\n", m.index))) continue;
    add(+m[1] / 100, null, line, m.index);
  }
  // A stack table ("x2 = 13% [?%] | x3 = 21% …", Exodus Down): its steps,
  // all of them (the other numbers are examples of them).
  for (const line of text.split("\n")) {
    const steps = [...line.matchAll(/x(\d+)\s*=\s*(\d+(?:\.\d+)?)\s*%/gi)];
    if (steps.length < 2 || !/resist|DR/i.test(text)) continue;
    found.length = 0;
    for (const s of steps) {
      const value = +s[2] / 100;
      if (value >= 0 && value < 1) found.push({ value, tier: null, label: `x${s[1]}` });
    }
    break;
  }
  if (found.length === 0 || found.every((l) => l.value === 0)) return null;
  const levels = found.sort((a, b) => a.value - b.value);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const conditional =
    /^(upon|on |on$|while|when|after|during|if |each |killing|scoring|picking|casting|being|standing|for the)/i.test(first) || /for \d+(\.\d+)?\s*(\+\d+\s*)?seconds/i.test(text);
  return { source, levels, conditional, when: conditional ? first.replace(/:$/, "") : "" };
}

/** Chest armor resist mods: copies of the same one give 15 / 25 / 30 %;
 *  different ones multiply. Each only against its kind of damage. */
const CHEST_MODS = ["arc", "solar", "void", "stasis", "strand", "harmonic", "concussive", "melee", "sniper"] as const;
type ChestMod = (typeof CHEST_MODS)[number];
const CHEST_COPIES = [0, 0.15, 0.25, 0.3];

/** Buffs from abilities, supers and allies, switched on by hand (PvE). */
const BUFFS: { key: string; value: number; group: "subclass" | "team" }[] = [
  { key: "wovenMail", value: 0.45, group: "subclass" },
  { key: "amplified", value: 0.15, group: "subclass" },
  { key: "transcendence", value: 0.2, group: "subclass" },
  { key: "super", value: 0.9, group: "subclass" },
  { key: "well", value: 0.2, group: "team" },
  { key: "ward", value: 0.6, group: "team" },
  { key: "banner", value: 0.4, group: "team" },
];
/** What in the build gives a buff: a text that grants it ("grants Woven
 *  Mail", "become Amplified", …), or (Transcendence) a Prismatic setup. */
const GRANTS: Record<string, RegExp> = {
  wovenMail: /(grant|gain|creat|provid|receiv|give)[^.\n]{0,60}Woven Mail/i,
  amplified: /(grant|gain|become|becoming|receiv|give)[^.\n]{0,40}Amplified/i,
  frost: /(grant|gain|creat|receiv|give)[^.\n]{0,60}Frost Armor/i,
  transcendence: /Transcend/i,
};
function grantsOf(sources: ResistSource[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [buff, re] of Object.entries(GRANTS)) {
    const from = sources.filter((s) => re.test(s.text) || (buff === "transcendence" && /prismatic/i.test(s.kind)));
    out[buff] = [...new Set(from.map((s) => s.name))];
  }
  return out;
}

/** Frost Armor: 7 % per stack, up to 5 (7 with Whisper of Rime). */
const FROST_PER_STACK = 0.07;
const FROST_MAX = 7;

const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} %`;

/**
 * The build's damage resist: every source in it with what it gives (PvE),
 * the ones always on counted, the others to switch on; "Resist xN" tiers
 * don't stack with each other (the highest counts), the rest multiply. With
 * the effective HP against combatants (Health above 100 adds shields).
 */
/** What the damage resist counts now (for showing it elsewhere). */
export interface DrCounted {
  items: { key: string; name: string; from: string; value: number }[];
  total: number;
  ehp: number;
  baseEhp: number;
}

/** "Counted now": each source counted (item / perk, then how much), with
 *  the total and the effective HP. */
export function DrCountedList({ counted }: { counted: DrCounted }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("dr.title")}</span>
        <span className="text-[15px] font-semibold text-white tabular-nums">{pct(counted.total)}</span>
      </div>
      <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px] text-white/45" title={t("dr.ehpHint", { base: Math.round(counted.baseEhp) })}>
        <span>{t("dr.ehp")}</span>
        <span className="tabular-nums text-white/75">
          {Math.round(counted.ehp)} <span className="text-white/35">/ {Math.round(counted.baseEhp)}</span>
        </span>
      </div>
      {counted.items.length === 0 ? (
        <p className="text-[11.5px] text-white/40">{t("dr.none")}</p>
      ) : (
        <>
          <div className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-white/35 uppercase">{t("dr.counted")}</div>
          {counted.items.map((b) => (
            <div key={b.key} className="flex items-baseline justify-between gap-2 py-0.5 text-[12px]" title={b.from}>
              <span className="min-w-0">
                <span className="block truncate text-white/90">{b.name}</span>
                {b.from && <span className="block truncate text-[10.5px] text-white/40">{b.from}</span>}
              </span>
              <span className="shrink-0 font-semibold text-white/85 tabular-nums">{pct(b.value)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function DamageResist({
  sources,
  health,
  onCounted,
}: {
  sources: ResistSource[];
  health: number;
  /** What counts now, shown elsewhere (then not here). */
  onCounted?: (counted: DrCounted) => void;
}) {
  const t = useT();
  const resists = useMemo(() => sources.map(resistOf).filter((r): r is Resist => !!r), [sources]);
  // Switched by hand (key -> on); else every source in the build counts
  // (what it can reach: the conditional ones too).
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  // The chest's three resist mods; buffs and Frost Armor stacks set by hand,
  // else as the build can get them.
  const [chest, setChest] = useState<(ChestMod | "")[]>(["", "", ""]);
  const [buffs, setBuffs] = useState<Record<string, boolean>>({});
  const [frostSet, setFrost] = useState<number | null>(null);
  const grants = useMemo(() => grantsOf(sources), [sources]);
  const rime = sources.some((s) => /whisper of rime/i.test(s.name));
  const frost = frostSet ?? (grants.frost.length > 0 ? (rime ? FROST_MAX : 5) : 0);
  const buffOn = (key: string) => buffs[key] ?? (grants[key]?.length ?? 0) > 0;
  const fromText = (key: string) => (grants[key]?.length ? t("dr.from", { list: grants[key].join(", ") }) : "");
  const on = (r: Resist) => switched[r.source.key] ?? true;
  // The level picked of a source with several (stacks, steps); else its highest.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const level = (r: Resist) => r.levels[Math.min(picked[r.source.key] ?? r.levels.length - 1, r.levels.length - 1)];
  const active = resists.filter(on);
  const topTier = active.reduce<Resist | null>((best, r) => {
    const tier = level(r).tier;
    return tier !== null && (!best || tier > (level(best).tier ?? 0)) ? r : best;
  }, null);
  const counted = active.filter((r) => level(r).tier === null || r === topTier);
  // Everything counted, by what gives it: the item / perk, then how much.
  const breakdown: { key: string; name: string; from: string; value: number }[] = [
    ...counted.map((r) => {
      const lv = level(r);
      return { key: r.source.key, name: r.source.name, from: [r.source.kind, r.levels.length > 1 ? lv.label : ""].filter(Boolean).join(" · "), value: lv.value };
    }),
    ...CHEST_MODS.flatMap((m) => {
      const n = Math.min(3, chest.filter((c) => c === m).length);
      return n > 0 ? [{ key: `chest-${m}`, name: t(`dr.mod.${m}` as "dr.mod.arc"), from: `${t("dr.chestShort")} · ${n}×`, value: CHEST_COPIES[n] }] : [];
    }),
    ...BUFFS.filter((b) => buffOn(b.key)).map((b) => ({
      key: `buff-${b.key}`,
      name: t(`dr.buff.${b.key}` as "dr.buff.wovenMail"),
      from: grants[b.key]?.length ? grants[b.key].join(", ") : t("dr.byHand"),
      value: b.value,
    })),
    ...(frost > 0
      ? [{ key: "frost", name: t("dr.buff.frost"), from: [`${frost}×`, ...grants.frost].join(" · "), value: Math.min(frost, FROST_MAX) * FROST_PER_STACK }]
      : []),
  ].filter((b) => b.value > 0);
  const taken = breakdown.reduce((m, b) => m * (1 - b.value), 1);
  const total = 1 - taken;
  const shields = BASE_SHIELDS + Math.max(0, Math.min(health, 200) - 100) * 0.2;
  const ehp = (BASE_HEALTH / (1 - BASE_HEALTH_RESIST) + shields) / taken;
  const baseEhp = BASE_HEALTH / (1 - BASE_HEALTH_RESIST) + BASE_SHIELDS;
  const countedKey = JSON.stringify([breakdown, total, ehp]);
  useEffect(() => {
    onCounted?.({ items: breakdown, total, ehp, baseEhp });
    // (On what it shows, not on a new callback.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countedKey]);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("dr.title")}</span>
        <span className="text-[11px] text-white/45">{t("dr.pve")}</span>
      </div>
      {/* The totals (shown elsewhere with `onCounted`). */}
      {!onCounted && (
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg bg-black/25 px-2.5 py-1.5">
          <div className="text-[10px] text-white/40">{t("dr.total")}</div>
          <div className="text-[17px] font-semibold text-white tabular-nums">{pct(total)}</div>
        </div>
        <div className="rounded-lg bg-black/25 px-2.5 py-1.5" title={t("dr.ehpHint", { base: Math.round(baseEhp) })}>
          <div className="text-[10px] text-white/40">{t("dr.ehp")}</div>
          <div className="text-[17px] font-semibold text-white tabular-nums">
            {Math.round(ehp)} <span className="text-[11px] font-normal text-white/40">/ {Math.round(baseEhp)}</span>
          </div>
        </div>
      </div>
      )}
      {/* What counts, at a glance: item / perk and how much. */}
      {!onCounted && breakdown.length > 0 && (
        <div className="mb-3 rounded-lg bg-black/20 px-2.5 py-1.5">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.14em] text-white/35 uppercase">{t("dr.counted")}</div>
          {breakdown.map((b) => (
            <div key={b.key} className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]">
              <span className="min-w-0 truncate">
                <span className="text-white/90">{b.name}</span>
                {b.from && <span className="ml-1.5 text-[10.5px] text-white/40">{b.from}</span>}
              </span>
              <span className="shrink-0 font-semibold text-white/85 tabular-nums">{pct(b.value)}</span>
            </div>
          ))}
        </div>
      )}
      {resists.length === 0 ? (
        <p className="px-1 text-[12px] text-white/45">{t("dr.none")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {resists.map((r) => {
            const isOn = on(r);
            const lv = level(r);
            const ignored = isOn && lv.tier !== null && r !== topTier;
            return (
              <div
                key={r.source.key}
                className={cx(
                  "rounded-lg border transition-colors",
                  isOn ? "border-(--accent-glow) bg-(--accent-soft)" : "border-white/[0.06] bg-black/15 opacity-60 hover:opacity-90",
                )}
              >
              <button
                onClick={() => setSwitched((s) => ({ ...s, [r.source.key]: !isOn }))}
                aria-pressed={isOn}
                title={r.source.text}
                className="flex w-full items-center gap-2.5 px-2 py-1.5 text-left"
              >
                <span className={cx("grid size-4 shrink-0 place-items-center rounded border", isOn ? "border-(--accent) bg-(--accent)" : "border-white/25")}>
                  {isOn && (
                    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
                <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-black/30">
                  {r.source.icon && <img src={BUNGIE_ORIGIN + r.source.icon} alt="" className="size-full" draggable={false} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-white/90">{r.source.name}</span>
                  <span className="block truncate text-[10.5px] text-white/45">
                    {r.source.kind}
                    {r.when ? ` · ${r.when}` : ` · ${t("dr.always")}`}
                  </span>
                </span>
                <span className={cx("shrink-0 text-right text-[12px] font-semibold tabular-nums", ignored ? "text-white/35 line-through" : "text-white/85")}>
                  {pct(lv.value)}
                  {lv.tier !== null && <span className="block text-[9.5px] font-normal text-white/40">Resist x{lv.tier}</span>}
                </span>
              </button>
              {/* Several resists named (stacks, steps): which one counts. */}
              {r.levels.length > 1 && (
                <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-[3.25rem]">
                  {r.levels.map((l, i) => (
                    <button
                      key={i}
                      onClick={() => setPicked((p) => ({ ...p, [r.source.key]: i }))}
                      aria-pressed={l === lv}
                      title={l.label}
                      className={cx(
                        "max-w-full truncate rounded-md border px-1.5 py-0.5 text-[10.5px] tabular-nums transition-colors",
                        l === lv ? "border-(--accent) bg-(--accent)/25 text-white" : "border-white/10 bg-black/20 text-white/55 hover:text-white",
                      )}
                    >
                      {pct(l.value)}
                      {l.label && <span className="ml-1 text-white/45">{l.label.length > 28 ? `${l.label.slice(0, 27)}…` : l.label}</span>}
                    </button>
                  ))}
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
      {/* The chest's resist mods. */}
      <div className="mt-3 px-1">
        <div className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/35 uppercase">{t("dr.chest")}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {chest.map((c, i) => (
            <select
              key={i}
              value={c}
              onChange={(e) => setChest((all) => all.map((x, k) => (k === i ? (e.target.value as ChestMod | "") : x)))}
              className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11.5px] text-white/85 outline-none focus:border-(--accent-glow)"
            >
              <option value="">{t("dr.mod.none")}</option>
              {CHEST_MODS.map((m) => (
                <option key={m} value={m}>
                  {t(`dr.mod.${m}` as "dr.mod.arc")}
                </option>
              ))}
            </select>
          ))}
        </div>
      </div>
      {/* Buffs from abilities, supers and allies. */}
      <div className="mt-3 px-1">
        <div className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/35 uppercase">{t("dr.buffs")}</div>
        <div className="flex flex-wrap gap-1.5">
          {BUFFS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBuffs((s) => ({ ...s, [b.key]: !buffOn(b.key) }))}
              aria-pressed={buffOn(b.key)}
              title={[t(`dr.buff.${b.key}Hint` as "dr.buff.wovenMailHint"), fromText(b.key)].filter(Boolean).join("\n")}
              className={cx(
                "rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors",
                buffOn(b.key) ? "border-(--accent-glow) bg-(--accent-soft) text-white" : "border-white/10 bg-black/15 text-white/55 hover:text-white",
              )}
            >
              {t(`dr.buff.${b.key}` as "dr.buff.wovenMail")} <span className="tabular-nums text-white/45">{pct(b.value)}</span>
              {buffs[b.key] === undefined && grants[b.key]?.length ? <span className="ml-1 text-[10px] text-(--accent-text)">{t("dr.auto")}</span> : null}
            </button>
          ))}
          <span
            className={cx(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px]",
              frost > 0 ? "border-(--accent-glow) bg-(--accent-soft) text-white" : "border-white/10 bg-black/15 text-white/65",
            )}
            title={[t("dr.buff.frostHint"), fromText("frost")].filter(Boolean).join("\n")}
          >
            {t("dr.buff.frost")}
            {frostSet === null && grants.frost.length > 0 && <span className="text-[10px] text-(--accent-text)">{t("dr.auto")}</span>}
            <button onClick={() => setFrost(Math.max(0, frost - 1))} className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white">
              −
            </button>
            <span className="w-4 text-center tabular-nums">{frost}</span>
            <button onClick={() => setFrost(Math.min(FROST_MAX, frost + 1))} className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white">
              +
            </button>
            <span className="tabular-nums text-white/45">{pct(frost * FROST_PER_STACK)}</span>
          </span>
        </div>
      </div>
      <p className="mt-2 px-1 text-[10.5px] leading-snug text-white/35">{t("dr.hint")}</p>
    </div>
  );
}
