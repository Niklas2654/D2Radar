import { useEffect, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { call, hasBackend } from "../lib/tauri";
import { cx } from "./glass";

interface ArtifactPerk {
  name: string;
  /** What it does, with the numbers (Destiny Data Compendium, English). */
  text: string;
  icon: string | null;
}
interface Artifact {
  name: string;
  season: string;
  elements: string[];
  weapons: string[];
  icon: string | null;
  /** Per tier (one, two, three diamonds): its perks. */
  tiers: ArtifactPerk[][];
  /** Every artifact's name. */
  all: string[];
}

/**
 * An artifact's perks, every one with what it does in exact numbers, in
 * the game's three tiers (◆, ◆◆, ◆◆◆). The one recognized on screen
 * first; any other artifact a click away.
 */
export function ArtifactView({ initial }: { initial: string | null }) {
  const t = useT();
  const [name, setName] = useState<string | null>(initial);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasBackend) return;
    void call<Artifact | null>("artifact_detail", { name })
      .then((a) => setArtifact(a ?? null))
      .catch((e) => setError(String(e)));
  }, [name]);

  if (error) return <p className="p-6 text-[12.5px] text-red-300">{error}</p>;
  if (!artifact) return <p className="p-6 text-[13px] text-white/40">{t("common.loading")}</p>;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {/* Which artifact: the recognized one, or another. */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {artifact.all.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setName(n)}
            className={cx(
              "cursor-pointer rounded-lg px-2.5 py-1 text-[12px] transition-colors",
              n === artifact.name ? "bg-white/[0.12] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
            )}
          >
            {n}
          </button>
        ))}
      </div>

      <div key={artifact.name} className="animate-fade-in">
        <div className="flex items-center gap-4">
          {artifact.icon ? (
            <img src={`${BUNGIE_ORIGIN}${artifact.icon}`} alt="" className="h-14 w-14 rounded-md" />
          ) : (
            <span className="h-14 w-14 rounded-md bg-white/[0.06]" />
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-semibold">{artifact.name}</h1>
            <div className="text-[12.5px] text-white/45">{t("artifact.season", { season: artifact.season })}</div>
          </div>
        </div>
        {(artifact.elements.length > 0 || artifact.weapons.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
            <span className="text-white/45">{t("artifact.worksWith")}</span>
            {[...artifact.elements, ...artifact.weapons].map((w) => (
              <span key={w} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-white/75">
                {w}
              </span>
            ))}
          </div>
        )}

        {/* The tiers side by side, as in game. */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          {artifact.tiers.map((tier, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-2">
              <div className="mb-1 text-center text-[11px] tracking-[0.3em] text-white/45">{"◆".repeat(i + 1)}</div>
              {tier.map((perk) => (
                <div key={perk.name} className="spotlight rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="flex items-center gap-2.5">
                    {perk.icon ? (
                      <img src={`${BUNGIE_ORIGIN}${perk.icon}`} alt="" className="h-8 w-8 shrink-0 rounded" />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded bg-white/[0.06]" />
                    )}
                    <span className="text-[13px] font-semibold">{perk.name}</span>
                  </div>
                  <p className="mt-2 text-[11.5px] leading-snug whitespace-pre-line text-white/65">{perk.text}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-5 text-[11px] text-white/30">{t("artifact.source")}</p>
      </div>
    </div>
  );
}
