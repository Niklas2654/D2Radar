/*
 * What the six armor stats do, with numbers: from the Destiny Data
 * Compendium's "Game Mechanics" sheet (community research). Up to 100 a
 * stat gives its base benefit; from 101 to 200 its enhanced one. Values in
 * [brackets] there are PvP; here `pvp`.
 */

import type { TranslationKey } from "./i18n";

export const STAT = {
  weapons: 2996146975,
  health: 392767087,
  class: 1943323491,
  grenade: 1735777505,
  super: 144602215,
  melee: 4244567218,
} as const;

export type StatId = keyof typeof STAT;
export const STAT_ORDER: StatId[] = ["weapons", "health", "class", "grenade", "super", "melee"];

export interface StatEffect {
  /** What it affects. */
  label: TranslationKey;
  /** "base": 0–100, "enhanced": 101–200. */
  range: "base" | "enhanced";
  /** At the end of the range (100 or 200). */
  max: number;
  /** PvP value at the end of the range, where it differs. */
  pvp?: number;
  unit: "%" | "HP";
  /** The value at a stat (default: linear over the range); undefined when
   * only the end value is known. */
  at?: (stat: number) => number;
  linear?: boolean;
  /** Only the end value is measured; the rest is taken as linear ("≈"). */
  approx?: boolean;
  /** Bungie's stated value (Edge of Fate), not measured by the community ("*"). */
  bungie?: boolean;
  /** Lowers something (cooldown): shown as "−". */
  less?: boolean;
  /** The one shown in the overlay (what the stat is mostly taken for). */
  headline?: boolean;
}

/** Shield HP against combatants per 10 Health above 100 (measured). */
const SHIELD_HP = [130, 133, 136, 139, 142, 145, 146, 147, 148, 149, 150];

export const STAT_EFFECTS: Record<StatId, StatEffect[]> = {
  weapons: [
    { label: "statfx.handlingReload", range: "base", max: 10, unit: "%", linear: true },
    { label: "statfx.damageMinors", range: "base", max: 15, unit: "%", linear: true },
    { label: "statfx.damageBossPrimary", range: "enhanced", max: 15, pvp: 5, unit: "%", linear: true, headline: true },
    { label: "statfx.damageBossHeavy", range: "enhanced", max: 10, pvp: 5, unit: "%", linear: true },
    { label: "statfx.ammoBrick", range: "enhanced", max: 100, unit: "%", linear: true },
  ],
  health: [
    { label: "statfx.orbHealing", range: "base", max: 70, unit: "HP", linear: true },
    { label: "statfx.flinch", range: "base", max: 10, unit: "%", linear: true },
    {
      label: "statfx.shieldHp",
      range: "enhanced",
      headline: true,
      max: 20,
      unit: "HP",
      at: (v) => {
        const x = (Math.min(200, Math.max(100, v)) - 100) / 10;
        const i = Math.floor(x);
        const lo = SHIELD_HP[i];
        const hi = SHIELD_HP[Math.min(10, i + 1)];
        return lo + (hi - lo) * (x - i) - 130;
      },
    },
    { label: "statfx.shieldStart", range: "enhanced", max: 25, unit: "%", linear: true },
    { label: "statfx.shieldRate", range: "enhanced", max: 50, unit: "%", linear: true },
  ],
  class: [
    { label: "statfx.classCooldown", range: "base", max: 65, unit: "%", linear: true, approx: true, bungie: true, less: true },
    { label: "statfx.classGains", range: "base", max: 90, unit: "%", linear: true, approx: true },
    { label: "statfx.classOvershield", range: "enhanced", max: 40, pvp: 10, unit: "HP", linear: true, headline: true },
    { label: "statfx.classDamage", range: "enhanced", max: 65, pvp: 10, unit: "%", linear: true },
  ],
  grenade: [
    { label: "statfx.grenadeCooldown", range: "base", max: 65, unit: "%", linear: true, approx: true, bungie: true, less: true },
    { label: "statfx.grenadeGains", range: "base", max: 211.5, unit: "%", linear: true, approx: true },
    { label: "statfx.grenadeDamage", range: "enhanced", max: 65, pvp: 20, unit: "%", linear: true, headline: true },
  ],
  super: [
    { label: "statfx.superGains", range: "base", max: 190, unit: "%", linear: true, approx: true, bungie: true },
    { label: "statfx.superDamage", range: "enhanced", max: 45, unit: "%", linear: true, headline: true },
  ],
  melee: [
    { label: "statfx.meleeCooldown", range: "base", max: 65, unit: "%", linear: true, approx: true, bungie: true, less: true },
    { label: "statfx.meleeGains", range: "base", max: 190, unit: "%", linear: true, approx: true, bungie: true },
    { label: "statfx.meleeDamage", range: "enhanced", max: 30, pvp: 20, unit: "%", linear: true, headline: true },
  ],
};

/** Points of `stat` that count for the effect's range (0–100). */
function inRange(effect: StatEffect, stat: number): number {
  const from = effect.range === "base" ? 0 : 100;
  return Math.min(100, Math.max(0, stat - from));
}

/** The effect at `stat` (undefined when only the end value is known). */
export function effectNow(effect: StatEffect, stat: number): number | undefined {
  if (effect.at) return effect.at(stat);
  if (effect.linear) return (effect.max * inRange(effect, stat)) / 100;
  return inRange(effect, stat) >= 100 ? effect.max : undefined;
}

/** The PvP value at `stat`, where it differs. */
export function effectNowPvp(effect: StatEffect, stat: number): number | undefined {
  if (effect.pvp === undefined || !effect.linear) return undefined;
  return (effect.pvp * inRange(effect, stat)) / 100;
}

export function formatEffect(value: number, unit: StatEffect["unit"], locale: string, less = false): string {
  const n = value.toLocaleString(locale, { maximumFractionDigits: value < 10 && value % 1 ? 1 : 0 });
  const sign = less ? "−" : "+";
  return unit === "%" ? `${sign}${n} %` : `${sign}${n} HP`;
}

export function statIdOf(hash: number): StatId | undefined {
  return STAT_ORDER.find((id) => STAT[id] === hash);
}
