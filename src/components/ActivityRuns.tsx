import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LOCALES, useLanguage, useT } from "../lib/i18n";
import { call, isTauri } from "../lib/tauri";
import { useZoomFrom } from "../lib/zoomFrom";
import { CountUp } from "./CountUp";
import { cx, IconButton } from "./glass";
import { IconClose } from "./icons";
import { RunReport } from "./RunReport";

interface ActivityRun {
  instanceId: string;
  started: string;
  seconds: number;
  /** "Master", "Contest" … (empty: the plain version). */
  version: string;
  players: number | null;
  deaths: number | null;
  fresh: boolean | null;
  /** The feats and modifiers it had on (runs since The Edge of Fate). */
  feats?: RunFeat[];
  /** Its difficulty ("Expert"; the portal's versions). */
  tier?: string | null;
  /** The class it was played on (empty: a deleted character). */
  className?: string;
}

interface RunFeat {
  name: string;
  icon: string | null;
  description: string;
  /** "feat", "challenge" (harder), "boon" (helps), "neutral". */
  kind?: string;
}

// The website's demo (no backend): a few sample runs.
const MOCK_RUNS: ActivityRun[] = [
  {
    instanceId: "1",
    started: "2026-01-11T19:20:00Z",
    seconds: 2_410,
    version: "Master",
    players: 2,
    deaths: 0,
    fresh: true,
  },
  {
    instanceId: "2",
    started: "2025-11-02T18:05:00Z",
    seconds: 1_302,
    version: "",
    players: 6,
    deaths: 4,
    fresh: true,
  },
  {
    instanceId: "3",
    started: "2024-01-26T19:12:00Z",
    seconds: 1_642,
    version: "",
    players: 1,
    deaths: 0,
    fresh: true,
  },
  {
    instanceId: "4",
    started: "2023-03-11T02:40:00Z",
    seconds: 9_870,
    version: "Contest",
    players: 6,
    deaths: 31,
    fresh: true,
  },
  {
    instanceId: "5",
    started: "2023-03-04T20:00:00Z",
    seconds: 640,
    version: "",
    players: 6,
    deaths: 2,
    fresh: false,
  },
];

/** Names of the plain version: no badge for those. */
const PLAIN = new Set(["Standard", "Normal"]);

/** A run's version as shown: its name ("Master"), with the portal's
 *  difficulty ("Customize · Expert"); empty for the plain one. */
const versionOf = (r: ActivityRun) => {
  // Bungie's "Customize" (the portal's own setup) reads better as what it is.
  const name = r.version === "Customize" ? "Customized" : r.version;
  const version = name && !PLAIN.has(name) ? name : "";
  // A tier that only says the version again ("Customize · Custom"): no.
  const tier = r.tier && !version.toLowerCase().startsWith(r.tier.toLowerCase()) ? r.tier : "";
  return [version, tier].filter(Boolean).join(" · ");
};

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

/** Every run of one raid or dungeon (a click on it in the clears list),
 *  newest first; a click on a run shows its report. Esc, the backdrop or ✕
 *  close it. */
export function ActivityRuns({
  membershipId,
  name,
  raid,
  exotic = false,
  title,
  onClose,
}: {
  membershipId: string;
  name: string;
  raid: boolean;
  /** An exotic mission (raid false). */
  exotic?: boolean;
  /** Its name as shown (when not the activity's own). */
  title?: string;
  onClose: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  // Grows out of the raid clicked to open it.
  const panel = useRef<HTMLDivElement>(null);
  useZoomFrom(panel);
  const [runs, setRuns] = useState<ActivityRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ActivityRun | null>(null);

  useEffect(() => {
    let live = true;
    if (!isTauri && location.search.includes("mock")) {
      setRuns(MOCK_RUNS);
      return;
    }
    call<ActivityRun[]>("activity_runs", { membershipId, name, raid, exotic })
      .then((r) => live && setRuns(r ?? []))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [membershipId, name, raid, exotic]);

  // Esc closes the report first, then this.
  useEffect(() => {
    if (open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const crew = (n: number) =>
    n === 1
      ? "Solo"
      : n === 2
        ? "Duo"
        : n === 3
          ? "Trio"
          : t("run.players", { n });

  return createPortal(
    <>
      <div
        data-dialog
        className="animate-fade-in fixed inset-0 z-[80] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          ref={panel}
          className="glass flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#07090f]/95 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.95)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3 border-b border-white/[0.06] p-5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">
                {raid ? t("fireteam.raids") : exotic ? t("fireteam.exotics") : t("fireteam.dungeons")}
              </div>
              <h2 className="mt-1 truncate font-display text-[20px] font-semibold">
                {title ?? name}
              </h2>
              {runs && (
                <div className="mt-1 text-[12px] text-white/50">
                  {t("runs.count", { n: runs.length })}
                </div>
              )}
            </div>
            <IconButton label={t("common.close")} onClick={onClose}>
              <IconClose />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {error && (
              <p className="m-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">
                {error}
              </p>
            )}
            {!runs && !error && (
              <p className="p-2 text-[12.5px] text-white/45">
                {t("common.loading")}
              </p>
            )}
            {runs?.length === 0 && (
              <p className="p-2 text-[12.5px] text-white/45">
                {t("runs.empty")}
              </p>
            )}
            {!!runs?.length && <RunStats runs={runs} crew={crew} onOpen={setOpen} />}
            {!!runs?.length && (
              <ul className="mt-3 space-y-1">
                {runs.map((r) => {
                  const flawless = r.deaths === 0 && r.fresh === true;
                  return (
                    <li key={r.instanceId}>
                      <button
                        type="button"
                        onClick={() => setOpen(r)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left text-[12.5px] transition-colors hover:border-white/[0.08] hover:bg-white/[0.04]"
                      >
                        <span className="w-36 shrink-0 text-white/75 tabular-nums">
                          {r.started &&
                            new Date(r.started).toLocaleString(
                              LOCALES[language],
                              { dateStyle: "medium", timeStyle: "short" },
                            )}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                          {versionOf(r) && (
                            <span className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 text-[10.5px] font-semibold text-white/70">
                              {versionOf(r)}
                            </span>
                          )}
                          {r.players !== null && (
                            <span
                              className={cx(
                                "px-0.5 text-[11.5px]",
                                r.players <= 3
                                  ? "font-semibold text-white/85"
                                  : "text-white/50",
                              )}
                            >
                              {crew(r.players)}
                            </span>
                          )}
                          {flawless && (
                            <span className="rounded border border-(--accent-glow) bg-(--accent-soft) px-1.5 text-[10.5px] font-semibold text-(--accent-text)">
                              Flawless
                            </span>
                          )}
                          {r.fresh === false && (
                            <span className="rounded border border-white/[0.1] px-1.5 text-[10.5px] text-white/50">
                              {t("fireteam.checkpointClear")}
                            </span>
                          )}
                          {r.feats?.map((f) =>
                            f.icon ? (
                              <img
                                key={f.name}
                                src={f.icon}
                                alt={f.name}
                                title={`${f.name} — ${f.description}`}
                                className="size-[18px] rounded-sm opacity-80"
                              />
                            ) : null,
                          )}
                        </span>
                        <span className="shrink-0 text-white/45 tabular-nums">
                          ⏱ {clock(r.seconds)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      {/* Beside the backdrop, not in it: a click on the report's own
          backdrop closes only the report. */}
      {open && (
        <RunReport
          instanceId={open.instanceId}
          title={[title ?? name, open.version].filter(Boolean).join(" · ")}
          raid={raid}
          onClose={() => setOpen(null)}
        />
      )}
    </>,
    document.body,
  );
}

/** A bar row: label, count, and an icon (feats). */
type Row = [string, number, (string | null)?];

/** A raid's / dungeon's numbers over all its runs: totals, its fastest
 *  full clears and what the runs were (lowmans, feats, versions). */
function RunStats({
  runs,
  crew,
  onOpen,
}: {
  runs: ActivityRun[];
  crew: (n: number) => string;
  onOpen: (run: ActivityRun) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const full = runs.filter((r) => r.fresh === true && r.seconds > 0);
  const flawless = runs.filter((r) => r.fresh === true && r.deaths === 0).length;
  const fastest = full.length ? full.reduce((a, b) => (b.seconds < a.seconds ? b : a)) : null;
  const average = full.length ? full.reduce((sum, r) => sum + r.seconds, 0) / full.length : null;
  const date = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[language], { dateStyle: "medium" });
  // A lowman row opened: all its runs below it.
  const [open, setOpen] = useState<string | null>(null);

  // Lowmans, each kind a row (a solo flawless isn't a solo as well; trios
  // only flawless): how many, and its fastest run with what it had on.
  // Checkpoint lowmans after the full ones.
  type Lowman = { label: string; checkpoint: boolean; runs: ActivityRun[] };
  const lowmans: Lowman[] = [];
  for (const checkpoint of [false, true]) {
    for (const n of [1, 2, 3]) {
      const of = runs.filter((r) => r.players === n && r.seconds > 0 && (checkpoint ? r.fresh === false : r.fresh === true));
      const clean = of.filter((r) => r.deaths === 0);
      const kinds: [string, ActivityRun[]][] = [[`${crew(n)} Flawless`, clean]];
      if (n < 3) kinds.push([crew(n), of.filter((r) => r.deaths !== 0)]);
      for (const [label, list] of kinds) if (list.length) lowmans.push({ label, checkpoint, runs: list });
    }
  }

  // What the runs were, most first.
  const count = (keys: string[]) =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const versions = count(runs.map((r) => versionOf(r) || t("runs.normal")));
  // How often each feat was on (with its icon).
  const featIcons = new Map(runs.flatMap((r) => r.feats ?? []).map((f) => [f.name, f.icon]));
  const feats: Row[] = count(runs.flatMap((r) => (r.feats ?? []).map((f) => f.name))).map(([name, n]) => [
    name,
    n,
    featIcons.get(name) ?? null,
  ]);
  const panels: [string, Row[]][] = [
    ...(feats.length ? [[t("runs.feats"), feats] as [string, Row[]]] : []),
    ...(versions.length > 1 ? [[t("runs.versions"), versions] as [string, Row[]]] : []),
  ];

  const tiles: { title: string; value: string; run?: ActivityRun }[] = [
    { title: t("runs.total"), value: String(runs.length) },
    { title: t("runs.fullClears"), value: String(full.length) },
    { title: "Flawless", value: String(flawless) },
    // A click shows the run.
    { title: t("runs.best"), value: fastest ? clock(fastest.seconds) : "—", run: fastest ?? undefined },
    { title: t("runs.average"), value: average === null ? "—" : clock(average) },
  ];

  return (
    <div className="space-y-3 px-1 pt-1">
      <div className="grid grid-cols-5 gap-2">
        {tiles.map((tile) => {
          const body = (
            <>
              <div className="truncate text-[11px] text-white/45">{tile.title}</div>
              <div className="mt-1 font-display text-[20px] leading-none font-semibold tabular-nums">
                <CountUp text={tile.value} />
              </div>
            </>
          );
          return tile.run ? (
            <button
              key={tile.title}
              type="button"
              onClick={() => onOpen(tile.run!)}
              title={date(tile.run.started)}
              className="spotlight cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
            >
              {body}
            </button>
          ) : (
            <div key={tile.title} className="spotlight rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
              {body}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
        <div className="mb-2 text-[11.5px] font-semibold text-white/75">{t("runs.lowmans")}</div>
        {lowmans.length === 0 && <p className="text-[11.5px] text-white/35">{t("runs.noLowmans")}</p>}
        <ul className="space-y-0.5">
          {lowmans.map((l) => {
            const run = l.runs.reduce((a, b) => (b.seconds < a.seconds ? b : a));
            const key = `${l.label}-${l.checkpoint}`;
            const expanded = open === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : key)}
                  aria-expanded={expanded}
                  className="grid w-full cursor-pointer grid-cols-[9.5rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
                >
                  <span className="truncate">
                    <span className="font-semibold text-white/90">{l.label}</span>
                    {l.checkpoint && <span className="ml-1.5 text-[10.5px] text-white/40">{t("fireteam.checkpointClear")}</span>}
                  </span>
                  <span className="text-white/55 tabular-nums">×{l.runs.length}</span>
                  <span className={cx("flex min-w-0 items-center gap-1.5", expanded && "invisible")}>
                    {run.className && <span className="text-[11px] text-white/45">{run.className}</span>}
                    {versionOf(run) && (
                      <span className="truncate rounded border border-white/[0.1] bg-white/[0.04] px-1.5 text-[10.5px] font-semibold text-white/65">
                        {versionOf(run)}
                      </span>
                    )}
                    {run.feats?.map((f) =>
                      f.icon ? <img key={f.name} src={f.icon} alt={f.name} title={f.name} className="size-4 rounded-sm opacity-80" /> : null,
                    )}
                  </span>
                  <span className={cx("text-white/50 tabular-nums", expanded && "invisible")}>
                    {date(run.started)} · {clock(run.seconds)}
                  </span>
                </button>
                {/* Every run of this kind, newest first: a click shows it. */}
                <div className={cx("expand", expanded && "open")} aria-hidden={!expanded} inert={!expanded}>
                  <div>
                  <ul className="mt-0.5 mb-1.5 ml-3 space-y-px border-l border-white/[0.08] pl-2">
                    {[...l.runs]
                      .sort((a, b) => b.started.localeCompare(a.started))
                      .map((r) => (
                        <li key={r.instanceId}>
                          <button
                            type="button"
                            onClick={() => onOpen(r)}
                            className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[11.5px] transition-colors hover:bg-white/[0.04]"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="text-white/70 tabular-nums">{date(r.started)}</span>
                              {r.className && <span className="text-white/45">{r.className}</span>}
                              {versionOf(r) && (
                                <span className="truncate rounded border border-white/[0.1] bg-white/[0.04] px-1.5 text-[10px] font-semibold text-white/60">
                                  {versionOf(r)}
                                </span>
                              )}
                              {r.feats?.map((f) =>
                                f.icon ? (
                                  <img key={f.name} src={f.icon} alt={f.name} title={f.name} className="size-3.5 rounded-sm opacity-80" />
                                ) : null,
                              )}
                            </span>
                            <span className="text-white/50 tabular-nums">{clock(r.seconds)}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {panels.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {panels.map(([title, rows]) => {
            const most = Math.max(1, ...rows.map(([, n]) => n));
            return (
              <div key={title} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                <div className="mb-2 text-[11.5px] font-semibold text-white/75">{title}</div>
                <ul className="space-y-1.5">
                  {rows.slice(0, 6).map(([key, n, icon]) => (
                    <li key={key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-[11.5px]">
                      <span className="flex min-w-0 items-center gap-1.5 text-white/60">
                        {icon && <img src={icon} alt="" className="size-4 shrink-0 rounded-sm opacity-80" />}
                        <span className="truncate">{key}</span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        <span className="bar-grow block h-full rounded-full bg-white/35" style={{ width: `${(n / most) * 100}%` }} />
                      </span>
                      <span className="text-right text-white/70 tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
