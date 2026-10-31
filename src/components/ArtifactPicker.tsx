import { useEffect, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { call, isTauri } from "../lib/tauri";
import { PerkHover } from "./Clarity";
import { cx } from "./glass";

/** An artifact a loadout picks perks from (artifact_options). */
export interface ArtifactOption {
  name: string;
  season: string;
  icon: string | null;
  /** Per tier (one, two, three diamonds): its perks. */
  tiers: { hash: number; name: string; icon: string | null; text: string; description: string }[][];
}

/** Loaded once (the same all run): picking is all here. */
let loaded: Promise<ArtifactOption[] | undefined> | null = null;

/** The artifacts and their perks (loaded once). */
export function loadArtifacts(): Promise<ArtifactOption[] | undefined> {
  loaded ??= call<ArtifactOption[]>("artifact_options");
  loaded.catch(() => (loaded = null));
  return loaded;
}

/** The artifact last clicked (this PC): shown again after a restart, also
 *  with none of its perks picked yet. */
const SHOWN_KEY = "radar.artifact.shown";
const readShown = () => {
  try {
    return localStorage.getItem(SHOWN_KEY);
  } catch {
    return null;
  }
};

/** The artifact's seven slots: tier 1 perks fit any, tier 2 only the last
 *  five, tier 3 only two. */
const SLOTS = 7;
const UPPER = 5;
const TOP = 2;

/** Whether `picked` (tier per perk) fits the slots. */
function fits(tiers: number[]): boolean {
  const upper = tiers.filter((t) => t >= 1).length;
  return tiers.length <= SLOTS && upper <= UPPER && tiers.filter((t) => t >= 2).length <= TOP;
}

/**
 * The artifact perks a loadout saves: one of the artifacts (Monument of
 * Triumph), and up to seven of its perks by the game's slot rules, all
 * picked here. `value` null: none picked (the loadout keeps the
 * character's own).
 */
export function ArtifactPicker({ value, onChange }: { character?: string | null; value: number[] | null; onChange: (perks: number[]) => void }) {
  const t = useT();
  const [all, setAll] = useState<ArtifactOption[] | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    void loadArtifacts().then((list) => alive && setAll(list ?? [])).catch(() => alive && setAll([]));
    return () => {
      alive = false;
    };
  }, []);
  // The artifact shown: the one the picks are from, else the one clicked.
  const [shown, setShown] = useState<string | null>(readShown);
  if (!all || all.length === 0) return null;
  const tierOf = (a: ArtifactOption, hash: number) => a.tiers.findIndex((tier) => tier.some((p) => p.hash === hash));
  // (Some perks are on more than one artifact: the one clicked first.)
  const has = (a: ArtifactOption) => !!value && value.some((h) => h && tierOf(a, h) >= 0);
  // The artifact with the most of the picks (a perk can be on several:
  // the first with any one showed the wrong artifact).
  const count = (a: ArtifactOption) => (value ?? []).filter((h) => h && tierOf(a, h) >= 0).length;
  const most = all.filter(has).sort((x, y) => count(y) - count(x))[0];
  const owner = value && value.length > 0 ? (all.find((a) => a.name === shown && count(a) === count(most)) ?? most) : undefined;
  const artifact = owner ?? all.find((a) => a.name === shown) ?? all[0];
  // Only its own perks count (an older loadout may have another's).
  const picked = (value ?? []).filter((h) => h && tierOf(artifact, h) >= 0);
  const pickedTiers = picked.map((h) => tierOf(artifact, h));
  const toggle = (hash: number) => onChange(picked.includes(hash) ? picked.filter((h) => h !== hash) : [...picked, hash]);
  const pickArtifact = (name: string) => {
    if (name === artifact.name) return;
    setShown(name);
    try {
      localStorage.setItem(SHOWN_KEY, name);
    } catch {
      // Not kept; fine.
    }
    // One artifact at a time: another one starts empty.
    if (picked.length > 0) onChange([]);
  };
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("loadouts.artifact")}</span>
        <span className="flex items-center gap-2 text-[11px] text-white/45 tabular-nums">
          {t("opt.artifactPoints", { n: picked.length, of: SLOTS })}
          {picked.length > 0 && (
            <button onClick={() => onChange([])} className="rounded-md px-1.5 py-0.5 text-white/55 hover:bg-white/[0.08] hover:text-white">
              {t("opt.artifactClear")}
            </button>
          )}
        </span>
      </div>
      {/* The artifacts: one active at a time. */}
      <div className="mb-3 flex flex-wrap gap-1.5 px-1">
        {all.map((a) => (
          <button
            key={a.name}
            onClick={() => pickArtifact(a.name)}
            aria-pressed={a.name === artifact.name}
            title={a.season}
            className={cx(
              "flex items-center gap-2 rounded-xl border py-1 pr-2.5 pl-1 text-[11.5px] transition-colors",
              a.name === artifact.name ? "border-(--accent-glow) bg-(--accent-soft) text-white" : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white",
            )}
          >
            <span className="grid size-6 place-items-center overflow-hidden rounded-md bg-black/30">
              {a.icon && <img src={BUNGIE_ORIGIN + a.icon} alt="" className="size-full" draggable={false} />}
            </span>
            {a.name}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 px-1">
        {artifact.tiers.map((tier, ti) => (
          <div key={ti} className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-[10px] tracking-widest text-white/35" title={t(`opt.artifactTier${Math.min(ti, 2)}` as "opt.artifactTier0")}>
              {"◆".repeat(ti + 1)}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tier.map((perk) => {
                const on = picked.includes(perk.hash);
                const can = !!perk.hash && (on || fits([...pickedTiers, ti]));
                return (
                  <PerkHover
                    key={perk.name}
                    perk={{ hash: perk.hash, name: perk.name, icon: perk.icon, typeName: `${artifact.name} · ${"◆".repeat(ti + 1)}`, description: perk.description }}
                    exact={perk.text}
                  >
                    {/* (Not `disabled`: it would get no hover.) */}
                    <button
                      onClick={() => can && toggle(perk.hash)}
                      aria-pressed={on}
                      aria-disabled={!can}
                      className={cx(
                        "block size-[38px] overflow-hidden rounded-lg border transition-[opacity,box-shadow,filter,transform] duration-150",
                        on ? "border-(--accent) shadow-[0_0_8px_-1px_var(--accent)]" : "border-white/10 opacity-40 grayscale",
                        can && !on && "hover:opacity-80 hover:grayscale-0 active:scale-95",
                        !can && "cursor-not-allowed",
                      )}
                    >
                      {perk.icon && <img src={BUNGIE_ORIGIN + perk.icon} alt={perk.name} className="size-full" draggable={false} />}
                    </button>
                  </PerkHover>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[11px] text-white/40">{t("opt.artifactRules")}</p>
    </div>
  );
}
