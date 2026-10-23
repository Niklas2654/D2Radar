import { useEffect, useState } from "react";
import { useBungie } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { call, hasBackend } from "../lib/tauri";
import { PlayerView, type StatsTab } from "../pages/FireteamPage";
import { cx } from "./glass";

/** A player named as on the character screen, and how alike their emblem
 *  is to the one there (1 the same; null: not compared). */
interface Candidate {
  name: string;
  membershipId: string;
  membershipType: number;
  score: number | null;
  /** Why: in your activity now, played with you lately, or the emblem. */
  reason?: "activity" | "recent" | "emblem";
}

/** An emblem this alike, and this much more alike than the next player's,
 *  is the one on screen. */
const SURE = 0.75;
const AHEAD = 0.1;

/** The name without its "#1234". */
const base = (name: string) => name.replace(/#\d*$/, "").trim().toLowerCase();

/**
 * The guardian of a character screen (yours, or a player's you inspect),
 * as Fireteam shows a player: their characters and builds, and the
 * overview. The screen shows only the name (no "#1234"): it is you, one
 * of your fireteam, or the player of that name whose emblem is the one on
 * screen; several alike: a choice, the most alike first.
 */
export function GuardianView({ name }: { name: string }) {
  const t = useT();
  const snapshot = useBungie();
  const [tab, setTab] = useState<StatsTab>("pve");
  const [chosen, setChosen] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const wanted = base(name);
  // You, or one of your fireteam: no search needed (once the snapshot is in).
  const known =
    snapshot.player && base(snapshot.player.displayName) === wanted
      ? snapshot.player.membershipId
      : (snapshot.party.find((m) => m.displayName && base(m.displayName) === wanted)?.membershipId ?? null);
  const ready = snapshot.status !== "loading" && snapshot.status !== "unconfigured";

  useEffect(() => {
    setChosen(null);
    setCandidates(null);
    if (!hasBackend || !ready || known) return;
    let cancelled = false;
    void call<Candidate[]>("guardian_candidates", { name })
      .then((list) => {
        if (cancelled) return;
        const all = list ?? [];
        setCandidates(all);
        const [first, second] = all;
        const sure =
          first &&
          (all.length === 1 ||
            (first.score !== null && first.score >= SURE && (second?.score == null || first.score - second.score >= AHEAD)));
        if (sure) setChosen(first.membershipId);
      })
      .catch(() => !cancelled && setCandidates([]));
    return () => {
      cancelled = true;
    };
  }, [name, ready, known]);

  const id = known ?? chosen;
  if (id) {
    return (
      <div className="h-full overflow-y-auto p-5">
        {/* Picked by emblem among several: the others are a click away. */}
        {!known && candidates && candidates.length > 1 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-white/45">{t("guardian.others")}</span>
            {candidates
              .filter((c) => c.membershipId !== id)
              .slice(0, 6)
              .map((c) => (
                <button
                  key={c.membershipId}
                  type="button"
                  onClick={() => setChosen(c.membershipId)}
                  className="cursor-pointer rounded-lg bg-white/[0.05] px-2 py-0.5 text-white/65 transition-colors hover:bg-white/[0.09] hover:text-white"
                >
                  {c.name}
                </button>
              ))}
          </div>
        )}
        <PlayerView id={id} tab={tab} onTab={setTab} />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto p-5">
      <h2 className="font-display text-[18px] font-semibold">{name}</h2>
      {candidates === null ? (
        <p className="mt-2 text-[13px] text-white/50">{t("guardian.finding")}</p>
      ) : candidates.length === 0 ? (
        <p className="mt-2 text-[13px] text-white/50">{t("guardian.notFound")}</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-white/50">{t("guardian.several")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((c, i) => (
              <button
                key={c.membershipId}
                type="button"
                onClick={() => setChosen(c.membershipId)}
                className={cx(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors",
                  i === 0 && c.score !== null
                    ? "border-(--accent-glow) bg-(--accent-soft) hover:brightness-110"
                    : "border-white/[0.08] bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]",
                )}
              >
                {c.name}
                {c.score !== null && (
                  <span className="text-[11px] font-normal text-white/50 tabular-nums">
                    {c.reason === "activity"
                      ? t("guardian.inActivity")
                      : c.reason === "recent"
                        ? t("guardian.playedWith")
                        : t("guardian.emblemMatch", { p: Math.max(0, Math.round(c.score * 100)) })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
