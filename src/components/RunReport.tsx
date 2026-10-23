import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LOCALES, useLanguage, useT } from "../lib/i18n";
import { call, isTauri, openPlayer } from "../lib/tauri";
import { useZoomFrom } from "../lib/zoomFrom";
import { ClassIcon, type ClassKind } from "./ClassIcon";
import { cx, IconButton } from "./glass";
import { IconClose, IconExternal } from "./icons";

interface RunWeapon {
  name: string;
  icon: string | null;
  kills: number;
}

interface RunPlayer {
  membershipId: string;
  name: string;
  className: string;
  emblem: string | null;
  completed: boolean;
  kills: number;
  deaths: number;
  assists: number;
  precisionKills: number;
  superKills: number;
  grenadeKills: number;
  meleeKills: number;
  seconds: number;
  weapons: RunWeapon[];
}

interface RunReportData {
  instanceId: string;
  activity: string;
  started: string;
  durationSeconds: number;
  fresh: boolean | null;
  flawless: boolean;
  /** Its difficulty ("Expert"; the portal's versions). */
  tier?: string | null;
  /** The feats and modifiers it had on. */
  feats?: {
    name: string;
    icon: string | null;
    description: string;
    /** "feat", "challenge" (harder), "boon" (helps), "neutral". */
    kind?: string;
    /** Its category as the game's menu has it ("Gameplay Stakes"). */
    category?: string;
    categoryOrder?: number;
    /** The portal's triangles for it (a challenge up, a boon down). */
    triangles?: number;
  }[];
  players: RunPlayer[];
}

const MOCK_RUN: RunReportData = {
  instanceId: "0",
  activity: "Wurzel der Albträume",
  started: "2024-01-26T19:12:00Z",
  durationSeconds: 1_642,
  fresh: true,
  flawless: true,
  players: [
    {
      membershipId: "1",
      name: "Guardian#0420",
      className: "Jäger",
      emblem: null,
      completed: true,
      kills: 412,
      deaths: 0,
      assists: 96,
      precisionKills: 188,
      superKills: 21,
      grenadeKills: 37,
      meleeKills: 14,
      seconds: 1_642,
      weapons: [
        { name: "Zitterknochen", icon: null, kills: 168 },
        { name: "Klagelied der Wildnis", icon: null, kills: 121 },
        { name: "Wolfsbann", icon: null, kills: 54 },
      ],
    },
  ],
};

type Mod = NonNullable<RunReportData["feats"]>[number];

/** A run's modifiers by their category, in the game's menu order (one
 *  without a category: last, as "Other"). */
const groupMods = (mods: Mod[]): [string, Mod[]][] => {
  const groups = new Map<string, { order: number; mods: Mod[] }>();
  for (const m of mods) {
    const name = m.category || "Other";
    const g = groups.get(name) ?? { order: m.categoryOrder ?? 9, mods: [] };
    g.mods.push(m);
    groups.set(name, g);
  }
  return [...groups].sort((a, b) => a[1].order - b[1].order).map(([name, g]) => [name, g.mods]);
};

const clock = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

/** One run's report (a click on a raid or dungeon tag): who played, their
 *  kills, deaths and weapons; a lowman made on several classes: one run per
 *  class, the newest first, one under the other. Esc, the backdrop or ✕
 *  close it. */
export function RunReport({
  instanceId,
  instanceIds,
  classOf,
  title,
  raid = true,
  onClose,
}: {
  instanceId?: string;
  /** Several runs, shown one under the other (in this order). */
  instanceIds?: string[];
  /** The class each run was made on (a lowman's runs per class). */
  classOf?: Record<string, ClassKind>;
  title: string;
  /** A raid's run (or the Pantheon's): RaidHub has it. Dungeons and
   *  missions it doesn't: no link then. */
  raid?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  // Grows out of the tag or run clicked to open it.
  const panel = useRef<HTMLDivElement>(null);
  useZoomFrom(panel);
  const ids = instanceIds?.length ? instanceIds : instanceId ? [instanceId] : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      data-dialog
      className="animate-fade-in fixed inset-0 z-[90] grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panel}
        className="glass flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#07090f]/95 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.95)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <div className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">
            {title}
          </div>
          <IconButton label={t("common.close")} onClick={onClose}>
            <IconClose />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 divide-y divide-white/[0.06] overflow-y-auto">
          {ids.map((id) => (
            <RunSection key={id} instanceId={id} raid={raid} classKind={ids.length > 1 ? classOf?.[id] : undefined} />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One run in the report: what it was, when, its feats, its players. */
function RunSection({ instanceId, raid, classKind }: { instanceId: string; raid: boolean; classKind?: ClassKind }) {
  const t = useT();
  const language = useLanguage();
  const [data, setData] = useState<RunReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The website's demo (no backend): a sample run.
    if (!isTauri && location.search.includes("mock")) {
      setData(MOCK_RUN);
      return;
    }
    call<RunReportData>("run_report", { instanceId })
      .then((r) => live && r && setData(r))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [instanceId]);

  const raidhub = `https://raidhub.io/pgcr/${instanceId}`;
  const started = data ? new Date(data.started) : null;

  return (
    <section>
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {/* Several runs: the class each was made on. */}
          {classKind && (
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-white/70">
              <ClassIcon kind={classKind} title={t(`class.${classKind}`)} className="size-3.5" />
              {t(`class.${classKind}`)}
            </div>
          )}
          <h2 className="truncate font-display text-[20px] font-semibold">{data?.activity || "…"}</h2>
            {data && started && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/50">
                <span>
                  {started.toLocaleString(LOCALES[language], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                <span>⏱ {clock(data.durationSeconds)}</span>
                <span>{t("run.players", { n: data.players.length })}</span>
                {data.tier && (
                  <span className="rounded border border-white/[0.12] bg-white/[0.05] px-1.5 text-[10.5px] font-semibold text-white/75">
                    {data.tier}
                  </span>
                )}
                {data.flawless && (
                  <span className="rounded border border-(--accent-glow) bg-(--accent-soft) px-1.5 text-[10.5px] font-semibold text-(--accent-text)">
                    Flawless
                  </span>
                )}
                {data.fresh === false && (
                  <span className="rounded border border-white/[0.1] px-1.5 text-[10.5px] text-white/55">
                    {t("fireteam.checkpointClear")}
                  </span>
                )}
                {data.fresh === null && (
                  <span
                    className="rounded border border-white/[0.1] px-1.5 text-[10.5px] text-white/55"
                    title={t("run.unknownStartHint")}
                  >
                    {t("run.unknownStart")}
                  </span>
                )}
              </div>
            )}
        </div>
        {raid && (
          <button
            onClick={() => (isTauri ? void openUrl(raidhub) : window.open(raidhub))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[12px] text-white/70 transition-colors hover:border-(--accent-glow) hover:text-white"
          >
            <IconExternal /> RaidHub
          </button>
        )}
      </div>

        {/* The feats and modifiers it had on, by category as the game's
            customize menu has them. */}
        {!!data?.feats?.length && (
          <div className="space-y-2.5 border-b border-white/[0.06] px-5 py-3">
            {groupMods(data.feats).map(([category, mods]) => (
              <div key={category}>
                <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">{category}</div>
                <div className="flex flex-wrap gap-1.5">
                  {mods.map((f) => (
                    <span
                      key={f.name}
                      title={f.description}
                      className={cx(
                        "inline-flex items-center gap-1.5 rounded-lg border py-0.5 pr-2 pl-1 text-[11.5px]",
                        f.kind === "challenge"
                          ? "border-[#e2626b]/35 bg-[#e2626b]/[0.08] text-[#f2a7ab]"
                          : f.kind === "boon"
                            ? "border-[#5fbf7a]/35 bg-[#5fbf7a]/[0.08] text-[#9fdcb0]"
                            : f.kind === "feat"
                              ? "border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)"
                              : "border-white/[0.07] bg-white/[0.03] text-white/55",
                      )}
                    >
                      {f.icon && <img src={f.icon} alt="" className="size-5 rounded-sm" />}
                      {f.kind === "challenge" && <span aria-hidden>▼</span>}
                      {f.kind === "boon" && <span aria-hidden>▲</span>}
                      {f.name}
                      {!!f.triangles && f.kind !== "feat" && (
                        <span className="ml-0.5 font-semibold tabular-nums opacity-70">
                          {f.triangles < 0 ? `−${-f.triangles}` : f.triangles}▲
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      <div className="px-5 pt-1 pb-5">
          {error && (
            <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">
              {error}
            </p>
          )}
          {!data && !error && (
            <p className="text-[12.5px] text-white/45">{t("common.loading")}</p>
          )}
          {data && (
            <ul className="space-y-2.5">
              {data.players.map((p) => (
                <li
                  key={p.membershipId}
                  className={cx(
                    "rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3",
                    !p.completed && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3">
                    {p.emblem ? (
                      <img
                        src={p.emblem}
                        alt=""
                        className="size-10 shrink-0 rounded-lg"
                      />
                    ) : (
                      <span className="size-10 shrink-0 rounded-lg bg-white/[0.06]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <button
                          type="button"
                          onClick={() => openPlayer(p.membershipId, p.name)}
                          title={t("run.openProfile")}
                          className="block max-w-full cursor-pointer truncate text-left text-[13.5px] font-semibold transition-colors hover:text-(--accent-text) hover:underline"
                        >
                          {p.name}
                        </button>
                      <div className="text-[11px] text-white/45">
                        {p.className}
                        {!p.completed && ` · ${t("run.leftEarly")}`}
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-4 text-right tabular-nums">
                      {(
                        [
                          ["run.kills", p.kills],
                          ["run.deaths", p.deaths],
                          ["run.assists", p.assists],
                          [
                            "run.kd",
                            p.deaths
                              ? (p.kills / p.deaths).toFixed(2)
                              : p.kills.toFixed(0),
                          ],
                          ["run.time", clock(p.seconds)],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <div className="text-[13px] font-semibold">
                            {value}
                          </div>
                          <div className="text-[10px] text-white/40">
                            {t(label)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.05] pt-2.5 text-[11.5px] text-white/55">
                    {p.weapons.map((w) => (
                      <span
                        key={w.name}
                        className="inline-flex items-center gap-1.5"
                      >
                        {w.icon && (
                          <img src={w.icon} alt="" className="size-6 rounded" />
                        )}
                        <span className="text-white/75">{w.name}</span>
                        <b className="text-white tabular-nums">{w.kills}</b>
                      </span>
                    ))}
                    <span className="ml-auto text-white/45 tabular-nums">
                      {t("run.abilities", {
                        s: p.superKills,
                        g: p.grenadeKills,
                        m: p.meleeKills,
                        p: p.precisionKills,
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
