import { useEffect, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { ItemInfo } from "../lib/fireteam";
import { LOCALES, useLanguage, useT, type TranslationKey } from "../lib/i18n";
import { call, hasBackend, subscribe } from "../lib/tauri";
import { cx, GlassPanel, PanelHeader } from "./glass";
import { CountUp } from "./CountUp";
import { IconCrosshair } from "./icons";

interface WeaponUse {
  item: ItemInfo;
  /** Share of player-runs that got kills with it. */
  rate: number;
  kills: number;
  /** Traits most often on equipped copies, and how many copies. */
  traits: { item: ItemInfo; share: number }[];
  rolls: number;
}

interface UsageCategory {
  key: "raid" | "dungeon" | "all";
  activities: number;
  /** Completions the statistic is meant to cover (collected up to it). */
  target: number;
  /** Different players in the sample. */
  players: number;
  /** Players who completed a run, counted per run. */
  playerRuns: number;
  weapons: WeaponUse[];
  /** Share of all weapon kills per weapon type. */
  types: { typeName: string; share: number }[];
  /** When the numbers were last brought up to date (unix ms). */
  updatedAt?: number | null;
}

/** The Rust side answers with what it has at once and collects more in the
 *  background; asked again this often for the newer numbers. */
const POLL_MS = 5 * 60_000;
/** The last numbers, shown right away on the next start. */
const STORE_KEY = "radar.weaponUsage";
/** The category picked last (raids, dungeons, all). */
const TAB_KEY = "radar.weaponUsageTab";

function loadUsage(): Promise<UsageCategory[]> {
  if (!hasBackend) return Promise.resolve(MOCK_USAGE);
  return call<UsageCategory[]>("weapon_usage").then((u) => u ?? []);
}

/** The last answer, kept per language (its names are in it). */
const storeKey = (language: string) => `${STORE_KEY}.${language}`;

function stored(language: string): UsageCategory[] | null {
  try {
    const raw = localStorage.getItem(storeKey(language));
    return raw ? (JSON.parse(raw) as UsageCategory[]) : null;
  } catch {
    return null;
  }
}

const LABELS: Record<UsageCategory["key"], TranslationKey> = {
  raid: "usage.raid",
  dungeon: "usage.dungeon",
  all: "usage.all",
};

/** Element colors (damage type -> color), as in the loadout views. */
const ELEMENT: Record<number, string> = { 2: "#79c8ff", 3: "#ff9447", 4: "#b58cff", 6: "#5d8fff", 7: "#3fdc9a" };

/**
 * The weapons tab before anything is picked: what the player base uses in
 * raids, dungeons and PvE overall (a sample of real reports, see
 * usage.rs), with a few stats.
 */
export function WeaponUsage({ onOpen }: { onOpen: (hash: number, preview?: { name: string; icon: string | null }) => void }) {
  const t = useT();
  const language = useLanguage();
  const locale = LOCALES[language];
  const [data, setData] = useState<UsageCategory[] | null>(() => (hasBackend ? stored(language) : null));
  const [error, setError] = useState<string | null>(null);
  // The picked category stays (opening a weapon and coming back, restarts).
  const [tab, setTabState] = useState<UsageCategory["key"]>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return saved === "dungeon" || saved === "all" ? saved : "raid";
    } catch {
      return "raid";
    }
  });
  const setTab = (key: UsageCategory["key"]) => {
    setTabState(key);
    try {
      localStorage.setItem(TAB_KEY, key);
    } catch {
      // Storage unavailable: kept until the page closes.
    }
  };

  useEffect(() => {
    let alive = true;
    let timer = 0;
    // Another language: what was kept in it, until the new answer is there.
    setData((old) => (hasBackend ? (stored(language) ?? old) : old));
    const load = () =>
      loadUsage()
        .then((d) => {
          if (!alive) return;
          // An empty answer (nothing collected yet) keeps what is shown.
          if (d.some((c) => c.weapons.length > 0)) {
            setData(d);
            try {
              localStorage.setItem(storeKey(language), JSON.stringify(d));
            } catch {
              // Storage unavailable: just not kept for the next start.
            }
          } else {
            setData((old) => old ?? d);
          }
          setError(null);
        })
        .catch((e) => alive && setError(String(e)))
        .finally(() => {
          if (alive) timer = window.setTimeout(load, POLL_MS);
        });
    void load();
    // A new summary in the background: shown right away.
    const off = subscribe("weapon-usage-updated", () => {
      window.clearTimeout(timer);
      void load();
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      off();
    };
  }, [language]);

  const category = data?.find((c) => c.key === tab);
  const number = (n: number) => n.toLocaleString(locale);

  return (
    <GlassPanel className="animate-widget-in flex flex-col gap-4 p-5">
      <PanelHeader
        icon={<IconCrosshair />}
        title={t("usage.title")}
        subtitle={t("usage.subtitle")}
        right={
          <div className="flex items-center gap-3">
          {category?.updatedAt && <Updated at={category.updatedAt} locale={locale} />}
          <div className="flex rounded-xl border border-white/[0.07] bg-black/20 p-1">
            {(Object.keys(LABELS) as UsageCategory["key"][]).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  tab === key ? "bg-(--accent-soft) text-white shadow-[inset_0_0_0_1px_var(--accent-halo)]" : "text-white/50 hover:text-white/80",
                )}
              >
                {t(LABELS[key])}
              </button>
            ))}
          </div>
          </div>
        }
      />

      {error ? (
        <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>
      ) : !category || (category.weapons.length === 0 && category.activities < category.target) ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-white/45">{t("usage.loading")}</p>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="shimmer flex items-center gap-3 rounded-xl p-1.5">
              <span className="skeleton size-11 shrink-0 rounded-lg" style={{ animationDelay: `${i * 0.1}s` }} />
              <div className="flex-1">
                <div className="skeleton h-3 w-40 rounded-full" style={{ animationDelay: `${i * 0.1}s` }} />
                <div className="skeleton mt-2 h-1.5 w-3/4 rounded-full" style={{ animationDelay: `${i * 0.1 + 0.05}s` }} />
              </div>
            </div>
          ))}
        </div>
      ) : category.weapons.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-white/45">{t("usage.none")}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
          {/* The most used weapons, with their share of the kills. */}
          <div className="flex flex-col gap-1">
            {category.weapons.map((w, i) => {
              const color = ELEMENT[w.item.damageType ?? 0];
              return (
                <button
                  key={w.item.hash}
                  onClick={() => onOpen(w.item.hash, { name: w.item.name, icon: w.item.icon ?? null })}
                  className="group flex items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <span className="w-4 shrink-0 text-right text-[11px] font-semibold tabular-nums text-white/30">{i + 1}</span>
                  <span
                    className={cx(
                      "relative size-10 shrink-0 overflow-hidden rounded-lg border bg-black/30",
                      w.item.exotic ? "border-[#e8c547]/70" : "border-white/10",
                    )}
                  >
                    {w.item.icon && <img src={BUNGIE_ORIGIN + w.item.icon} alt="" className="size-full object-cover" draggable={false} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cx("truncate text-[13px] font-medium", w.item.exotic && "text-[#f0d66b]")}>{w.item.name}</span>
                      {color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className="bar-grow h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-text))] shadow-[0_0_4px_var(--accent-halo)] transition-[width] duration-700"
                          style={{ width: `${Math.max(2, w.rate * 100)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-white/50">
                        {/* "{p} % of players": the number counts up. */}
                        {t("usage.rate", { p: " " })
                          .split(" ")
                          .flatMap((part, k) => (k ? [<CountUp key={k} text={String(Math.round(w.rate * 100))} />, part] : [part]))}
                      </span>
                    </div>
                    {/* The usual traits on it (from equipped copies). */}
                    {w.traits.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" title={t("usage.traitsHint", { n: w.rolls })}>
                        {w.traits.map((tr) => (
                          <span key={tr.item.hash} className="flex items-center gap-1" title={tr.item.name}>
                            <span className="grid size-5 place-items-center overflow-hidden rounded-full border border-white/15 bg-[#1d4a6b]/70">
                              {tr.item.icon && (
                                <img src={BUNGIE_ORIGIN + tr.item.icon} alt="" className="size-full object-cover" draggable={false} />
                              )}
                            </span>
                            <span className="max-w-24 truncate text-[11px] text-white/65">{tr.item.name}</span>
                            <span className="text-[10.5px] tabular-nums text-white/35">
                              <CountUp text={String(Math.round(tr.share * 100))} /> %
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* A few numbers: what this is based on, kills by weapon type. */}
          <div className="flex flex-col gap-3">
            {category.activities < category.target && (
              <div className="rounded-xl border border-(--accent-glow) bg-(--accent-soft) px-3 py-2.5">
                <div className="flex items-center gap-2 text-[11.5px] text-white/80">
                  <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-(--accent)" />
                  {t("usage.collecting", { n: number(category.activities), m: number(category.target) })}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="bar-grow h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-text))] shadow-[0_0_4px_var(--accent-halo)] transition-[width] duration-700"
                    style={{ width: `${(category.activities / category.target) * 100}%` }}
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t("usage.activities")} value={number(category.activities)} />
              <Stat label={t("usage.totalPlayers")} value={number(category.playerRuns)} />
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("usage.byType")}</div>
              <div className="flex flex-col gap-2">
                {category.types.map((type) => (
                  <div key={type.typeName}>
                    <div className="flex justify-between text-[12px]">
                      <span className="truncate text-white/75">{type.typeName}</span>
                      <span className="shrink-0 tabular-nums text-white/45">
                        <CountUp text={String(Math.round(type.share * 100))} /> %
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="bar-grow h-full rounded-full bg-white/50" style={{ width: `${type.share * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-white/35">
              {t("usage.hint", { n: number(category.activities), r: number(category.playerRuns), p: number(category.players) })}
            </p>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <div className="text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">{label}</div>
      <div className="mt-0.5 font-display text-[18px] font-semibold tabular-nums">
        <CountUp text={value} />
      </div>
    </div>
  );
}

// Browser-only sample data (?mock).
const mockWeapon = (name: string, typeName: string, damageType: number, exotic = false): ItemInfo => ({
  hash: name.length * 7919 + typeName.length,
  name,
  icon: null,
  typeName,
  exotic,
  damageType,
});
const MOCK_USAGE: UsageCategory[] = (["raid", "dungeon", "all"] as const).map((key) => ({
  key,
  activities: 640,
  target: 1000,
  players: 212,
  playerRuns: 3100,
  weapons: [
    {
      item: mockWeapon("Apex Predator", "Rocket Launcher", 3, true),
      kills: 12100,
      rate: 0.41,
      traits: [],
      rolls: 0,
    },
    {
      item: mockWeapon("Mint Retrograde", "Pulse Rifle", 4),
      kills: 9800,
      rate: 0.27,
      traits: [
        { item: mockWeapon("Rewind Rounds", "Trait", 0), share: 0.62 },
        { item: mockWeapon("Kill Clip", "Trait", 0), share: 0.48 },
        { item: mockWeapon("Repulsor Brace", "Trait", 0), share: 0.21 },
      ],
      rolls: 54,
    },
    { item: mockWeapon("Lotus-Eater", "Fusion Rifle", 7), kills: 6400, rate: 0.19, traits: [], rolls: 0 },
    { item: mockWeapon("The Navigator", "Trace Rifle", 7, true), kills: 5100, rate: 0.12, traits: [], rolls: 0 },
    { item: mockWeapon("Qua Nilus II", "Submachine Gun", 2), kills: 3300, rate: 0.08, traits: [], rolls: 0 },
  ],
  types: [
    { typeName: "Rocket Launcher", share: 0.29 },
    { typeName: "Pulse Rifle", share: 0.23 },
    { typeName: "Fusion Rifle", share: 0.15 },
  ],
}));

/** "Updated 4 min ago" (exact time on hover), kept current. */
function Updated({ at, locale }: { at: number; locale: string }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const ago =
    minutes < 1
      ? t("usage.justNow")
      : minutes < 60
        ? rtf.format(-minutes, "minute")
        : minutes < 48 * 60
          ? rtf.format(-Math.round(minutes / 60), "hour")
          : rtf.format(-Math.round(minutes / 1440), "day");
  const exact = new Date(at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <span className="hidden text-right text-[11px] leading-tight text-white/45 sm:block" title={exact}>
      {t("usage.updated")}
      <br />
      <span className="text-white/70">{ago}</span>
    </span>
  );
}
