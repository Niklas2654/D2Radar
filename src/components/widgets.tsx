import { useEffect, useState } from "react";
import { BUNGIE_ORIGIN, formatAgo, kd, type Snapshot } from "../lib/bungie";
import { LOCALES, useLanguage, useT } from "../lib/i18n";
import { HudPanel } from "./hud";
import { Logo } from "./icons";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Connection state as a small upper-case label (a square when live). */
function StatusBadge({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  let label = snapshot.online ? t("common.online") : t("common.offline");
  let tone = snapshot.online ? "text-[#7fd67f]" : "text-white/45";
  if (snapshot.status === "unconfigured") [label, tone] = [t("common.disconnected"), "text-white/45"];
  else if (snapshot.status === "error" && !snapshot.updatedAt) [label, tone] = [t("common.error"), "text-red-300"];
  else if (snapshot.status === "loading") [label, tone] = [t("common.loading"), "text-white/45"];
  else if (snapshot.cached) [label, tone] = [t("common.refreshing"), "text-white/45"];
  return (
    <span className={"inline-flex shrink-0 items-center gap-1.5 text-[0.833em] font-semibold tracking-[0.1em] uppercase " + tone}>
      {snapshot.online && snapshot.status !== "unconfigured" && <span className="size-1.5 bg-current" />}
      {label}
    </span>
  );
}

/** A number with its label, flat as in Destiny's stat lists. */
function HudStat({ label, value, emphasis }: { label: string; value: string | number; emphasis?: boolean }) {
  return (
    <div className="border-l border-white/15 pl-2.5">
      <div className="text-[0.833em] tracking-[0.1em] text-white/50 uppercase">{label}</div>
      <div className={"mt-0.5 text-[1.667em] leading-none font-semibold tabular-nums " + (emphasis ? "text-(--accent-text)" : "text-white")}>
        {value}
      </div>
    </div>
  );
}

/** Clock + session timer pill. */
export function SessionWidget({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const language = useLanguage();
  const now = useNow();
  const time = new Date(now).toLocaleTimeString(LOCALES[language], { hour: "2-digit", minute: "2-digit" });
  // The activity running now (not orbit), and how long the player has been in it.
  const activity = snapshot.activity;
  const activityStart =
    snapshot.online && activity && activity.name !== "Orbit" && activity.startedAt ? Date.parse(activity.startedAt) : null;

  return (
    <HudPanel className="w-[260px]">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Logo size={20} />
      <div className="min-w-0 flex-1">
        <div className="text-[1.667em] leading-none font-semibold tabular-nums">{time}</div>
        <div className="mt-1 text-[0.917em] text-white/50">
          {/* No session yet: just "Orbit" while sitting there (it starts with an activity). */}
          {snapshot.sessionStart === null && snapshot.online && snapshot.activity?.name === "Orbit" ? (
            "Orbit"
          ) : (
            <>
              {t("stats.session")}{" "}
              <span className="text-white/80 tabular-nums">
                {snapshot.sessionStart === null ? "—" : formatDuration(now - snapshot.sessionStart)}
              </span>
            </>
          )}
        </div>
        {activityStart !== null && activity && (
          <div className="mt-0.5 flex min-w-0 gap-1 text-[0.917em] text-white/50">
            <span className="min-w-0 truncate">{activity.name}</span>
            <span className="shrink-0 text-white/80 tabular-nums">{formatDuration(now - activityStart)}</span>
          </div>
        )}
      </div>
      <StatusBadge snapshot={snapshot} />
      </div>
    </HudPanel>
  );
}

/** Character banner + session stats from the Bungie API. */
export function StatsWidget({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const now = useNow();
  const { character, activity, session, player } = snapshot;
  const hasData = snapshot.updatedAt !== null;
  const value = (v: string | number) => (hasData ? v : "—");

  let activityLine = t("stats.connectHint");
  if (snapshot.status === "loading") activityLine = t("stats.connecting");
  else if (hasData && !snapshot.online) activityLine = t("common.notInGame");
  else if (activity?.name === "Orbit") activityLine = t("stats.inOrbit");
  else if (activity) activityLine = [activity.mode, activity.name].filter(Boolean).join(" · ");
  else if (snapshot.online) activityLine = t("stats.inGame");

  // Bungie only records an activity once it has ended, so say so while one runs.
  const runningSince =
    snapshot.online && activity?.startedAt ? Date.parse(activity.startedAt) : null;

  let footer: string;
  if (snapshot.status === "error") footer = snapshot.error ?? t("common.error");
  else if (runningSince) footer = t("stats.running", { time: formatDuration(now - runningSince) });
  else if (snapshot.updatedAt)
    footer = t("stats.activities", { n: session.activities, ago: formatAgo(snapshot.updatedAt, now, t) });
  else footer = t("stats.fromStart");

  return (
    <HudPanel className="w-[300px]">
      {/* Banner: emblem background, or a plain wash as fallback */}
      <div className="relative h-[64px] overflow-hidden">
        {character?.emblemBackgroundPath ? (
          <img
            src={BUNGIE_ORIGIN + character.emblemBackgroundPath}
            alt=""
            className="absolute inset-0 size-full object-cover object-left"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgb(255_255_255/0.08),transparent)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-black/30 to-black/70" />
        <div
          className={
            "relative flex h-full items-center justify-between gap-2 pr-3 " +
            (character?.emblemBackgroundPath ? "pl-[72px]" : "pl-3.5")
          }
        >
          <div className="min-w-0">
            <div className="truncate text-[1.333em] leading-tight font-semibold">
              {character?.className ?? t("stats.guardian")}
            </div>
            <div className="truncate text-[0.917em] text-white/60">{player?.displayName ?? "—"}</div>
          </div>
          {character && (
            <div className="shrink-0 text-[1.667em] font-semibold text-[#e8cf6a] tabular-nums">
              <span className="mr-0.5 align-top text-[0.917em]">◆</span>
              {character.light}
            </div>
          )}
        </div>
      </div>

      <div className="px-3.5 pt-2.5 pb-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[0.875em] font-semibold tracking-[0.08em] text-white/50 uppercase">
              {t("stats.currentSession")}
            </div>
            <div className="text-[1.083em] leading-snug text-white/85">{activityLine}</div>
          </div>
          <StatusBadge snapshot={snapshot} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <HudStat label="K/D" value={value(kd(session))} emphasis />
          <HudStat label={t("stats.kills")} value={value(session.kills)} />
          <HudStat label={t("stats.deaths")} value={value(session.deaths)} />
          <HudStat label={t("stats.completions")} value={value(session.completions)} />
        </div>
        <p
          className={
            snapshot.status === "error"
              ? "mt-3 border-t border-white/10 pt-1.5 text-[0.875em] text-red-300/90"
              : "mt-3 border-t border-white/10 pt-1.5 text-[0.875em] text-white/40"
          }
        >
          {footer}
        </p>
      </div>
    </HudPanel>
  );
}

