import type { TranslationKey } from "./i18n";

/**
 * Rank tiers by number of clears, in the spirit of raid.report's colors.
 * raid.report ranks by percentile against all players; without that data
 * (RaidHub) these are fixed thresholds instead.
 */
export interface Tier {
  id: string;
  min: number;
  color: string;
  label: TranslationKey;
}

export const TIERS: readonly Tier[] = [
  { id: "new", min: 0, color: "#4a5160", label: "tier.new" },
  { id: "bronze", min: 1, color: "#9a5b2e", label: "tier.bronze" },
  { id: "silver", min: 25, color: "#7d8796", label: "tier.silver" },
  { id: "gold", min: 75, color: "#c8920a", label: "tier.gold" },
  { id: "platinum", min: 200, color: "#13a089", label: "tier.platinum" },
  { id: "diamond", min: 500, color: "#1e88d6", label: "tier.diamond" },
  { id: "master", min: 1000, color: "#8b5cf6", label: "tier.master" },
];

export function tierFor(clears: number | null): Tier {
  const n = clears ?? 0;
  return [...TIERS].reverse().find((t) => n >= t.min) ?? TIERS[0];
}

/** The better of two tiers (used to color a whole account). */
export function bestTier(a: Tier, b: Tier): Tier {
  return TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b;
}
