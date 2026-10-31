import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { ArmorSet, ItemInfo } from "../lib/fireteam";
import { useT } from "../lib/i18n";
import {
  ARMOR_BUCKETS,
  choiceMatches,
  hasWords,
  presets,
  SUBCLASS_BUCKET,
  type Choice,
} from "../lib/presets";
import { STAT_ORDER, type StatId } from "../lib/statEffects";
import { useClarity, useClarityItems } from "../lib/clarity";
import { loadArtifacts, type ArtifactOption } from "./ArtifactPicker";
import {
  clarityPlain,
  DamageResist,
  DrCountedList,
  type DrCounted,
  type ResistSource,
} from "./DamageResist";
import { call, isTauri } from "../lib/tauri";
import { useInventoryVersion } from "../lib/inventory";
import { CompendiumCredit, PerkHover } from "./Clarity";
import { TierPips } from "./TierPips";
import { placeCard } from "../lib/placeCard";
import { SearchSuggest } from "./SearchSuggest";
import { ArmorMods } from "./ArmorMods";
import { StatHover } from "./StatEffects";
import { cx, GlassButton, GlassPanel, GlassSwitch } from "./glass";
import { IconClose, IconRefresh, IconSettings } from "./icons";

/** The stats in the backend's order (optimizer.rs STATS). */
const BACKEND: StatId[] = [
  "health",
  "melee",
  "grenade",
  "super",
  "class",
  "weapons",
];

interface StatMod {
  stat: number;
  value: number;
  /** The piece it goes on (0 helmet … 4 class item). */
  slot: number;
  /** The mod item (0: none the account can insert). */
  hash: number;
  /** A general socket's mod, an artifice +3, a tuning (+5 here, -5 from `from`). */
  kind?: "mod" | "artifice" | "tuning";
  from?: number | null;
}

/** A stat plug as read on a build ("+10 Weapons", "+3 Weapons (artifice)",
 *  "+5 Weapons / -5 Melee"); `name` a backend stat index's name. */
function modLabel(
  m: StatMod,
  name: (i: number) => string,
  t: ReturnType<typeof useT>,
): string {
  if (m.kind === "artifice")
    return t("opt.modArtifice", { n: m.value, stat: name(m.stat) });
  if (m.kind === "tuning" && m.from != null)
    return t("opt.modTuning", {
      n: m.value,
      stat: name(m.stat),
      from: name(m.from),
    });
  return `+${m.value} ${name(m.stat)}`;
}

interface Build {
  items: string[];
  hashes: number[];
  stats: number[];
  mods: StatMod[];
  freeMods: number;
  total: number;
  waste: number;
}

interface Result {
  builds: Build[];
  /** The loadout's own armor as a build (`ownShort`: short of the minimums). */
  own: Build | null;
  ownShort: boolean;
  pieces: number;
  millis: number;
}

/** -1 none, 0 any, else the exotic's item hash (as optimize_armor takes it). */
type ExoticPick = number;

/** The armor slots in optimizer.rs SLOTS order. */
const SLOT_LABELS = [
  "builder.slot.helmet",
  "builder.slot.gauntlets",
  "builder.slot.chest",
  "builder.slot.legs",
  // Short here ("Class", not "Class item"): the columns are narrow.
  "opt.slotClass",
] as const;

/** An exotic of the class (optimizer_exotics). */
interface Exotic {
  hash: number;
  name: string;
  icon: string | null;
  watermark: string | null;
  /** 0 helmet … 4 class item. */
  slot: number;
  owned: boolean;
  /** What it does with the numbers (Destiny Data Compendium, English). */
  exact: string | null;
}

/** How long a pick flies into its spot. */
const FLIGHT_MS = 620;

/** A copy of an icon over everything, from its tile to its spot: up in an
 *  arc, growing to the spot's size, spinning in a little. `glow` colors its
 *  rim. The caller finishes it (onfinish / oncancel). */
function flyIcon(
  icon: string,
  from: HTMLElement,
  to: HTMLElement,
  glow: string,
): Animation {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const ghost = document.createElement("img");
  ghost.src = BUNGIE_ORIGIN + icon;
  ghost.alt = "";
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    borderRadius: "8px",
    border: `1px solid ${glow}`,
    boxShadow: `0 0 18px ${glow}`,
    zIndex: "1000",
    pointerEvents: "none",
    transformOrigin: "top left",
  });
  document.body.appendChild(ghost);
  const dx = b.left - a.left;
  const dy = b.top - a.top;
  const scale = b.width / a.width;
  const lift = Math.min(90, 30 + Math.abs(dx) * 0.08);
  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)" },
      {
        transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(${(1 + scale) / 2}) rotate(-8deg)`,
        offset: 0.5,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)` },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(0.45, 0.05, 0.25, 1)" },
  );
  const done = () => ghost.remove();
  anim.addEventListener("finish", done);
  anim.addEventListener("cancel", done);
  return anim;
}

/** The exotic: its spot on the left (where a pick flies in) with its name,
 *  and under it every exotic armor piece of the class as icons, the slots
 *  side by side (the owned ones to pick, the others greyed out; "any" and
 *  "none" first). Once an exotic has landed the icons vanish and the grid
 *  folds away; "change" brings it back. */
function ExoticPicker({
  exotics,
  value,
  onChange,
  badges,
}: {
  exotics: Exotic[] | null;
  value: ExoticPick;
  onChange: (v: ExoticPick) => void;
  /** Shown beside the name (an exotic class item's perks). */
  badges?: React.ReactNode;
}) {
  const t = useT();
  const chosen = exotics?.find((e) => e.hash === value);
  // Where a picked exotic lands, and the pick on its way there: the spot
  // shows it only once it has arrived.
  const target = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(false);
  // Bumped on each landing: restarts the spot's landing glow.
  const [landed, setLanded] = useState(0);
  const flight = useRef<Animation | null>(null);
  useEffect(() => () => flight.current?.cancel(), []);
  // Folded shortly after an exotic has landed; any / none keep it open.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (value <= 0) {
      setOpen(true);
      return;
    }
    if (flying || !open) return;
    const id = window.setTimeout(() => setOpen(false), 380);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, flying, landed]);

  const pick = (e: Exotic, from: HTMLElement) => {
    if (e.hash === value) return;
    const to = target.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    onChange(e.hash);
    if (!to || reduced || !e.icon) {
      setLanded((n) => n + 1);
      return;
    }
    flight.current?.cancel();
    setFlying(true);
    const anim = flyIcon(e.icon, from, to, "rgb(232 197 71 / 0.6)");
    flight.current = anim;
    anim.onfinish = () => {
      if (flight.current === anim) {
        setFlying(false);
        setLanded((n) => n + 1);
      }
    };
  };

  const tile = (selected: boolean) =>
    cx(
      "exotic-tile relative size-11 shrink-0 overflow-hidden rounded-lg border transition-[border-color,box-shadow,transform] duration-150",
      selected
        ? "border-(--accent) shadow-[0_0_0_2px_var(--accent-glow)]"
        : "border-white/10 hover:-translate-y-px hover:border-[#e8c547]/70",
    );
  const shown = flying ? null : chosen;
  // Each tile's place, for the vanishing ripple.
  let order = 0;
  const at = () => ({ "--i": order++ }) as React.CSSProperties;

  return (
    <div className="flex flex-col">
      {/* The spot: the pick lands here, and stays as the folded view. */}
      <div className="flex items-center gap-4">
        <PerkHover
          perk={{
            hash: chosen?.hash ?? 0,
            name: chosen?.name ?? "",
            icon: chosen?.icon ?? null,
            typeName: chosen ? t(SLOT_LABELS[chosen.slot]) : "",
            description: "",
          }}
          exact={chosen?.exact ?? undefined}
          disabled={!chosen?.exact}
        >
          <div
            ref={target}
            key={landed}
            className={cx(
              // (The glow only for a landing, not when the view opens.)
              landed > 0 && "exotic-landing",
              "relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border",
              shown
                ? "border-[#e8c547]/80"
                : value > 0
                  ? "border-dashed border-[#e8c547]/40"
                  : "border-white/10",
              value === 0 && "bg-[#e8c547]/10 text-[#f0d66b]",
              value === -1 && "bg-black/30 text-white/45",
            )}
          >
            {shown?.icon && (
              <img
                src={BUNGIE_ORIGIN + shown.icon}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
            )}
            {shown?.watermark && (
              <img
                src={BUNGIE_ORIGIN + shown.watermark}
                alt=""
                className="absolute inset-0 size-full"
                draggable={false}
              />
            )}
            {value === 0 && <IconAnyExotic />}
            {value === -1 && <IconNoExotic />}
          </div>
        </PerkHover>
        <div
          aria-live="polite"
          className="flex min-w-0 flex-1 flex-col gap-0.5"
        >
          <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("opt.exotic")}
            {chosen && ` · ${t(SLOT_LABELS[chosen.slot])}`}
          </span>
          {chosen?.exact ? (
            // The pick: what it does on hover, with the exact numbers.
            <PerkHover
              perk={{
                hash: chosen.hash,
                name: chosen.name,
                icon: chosen.icon,
                typeName: t(SLOT_LABELS[chosen.slot]),
                description: "",
              }}
              exact={chosen.exact}
            >
              <span className="cursor-help truncate text-[15px] font-semibold text-[#f0d66b] underline decoration-[#f0d66b]/30 decoration-dotted underline-offset-4">
                {chosen.name}
              </span>
            </PerkHover>
          ) : (
            <span
              className={cx(
                "truncate text-[15px] font-semibold",
                chosen ? "text-[#f0d66b]" : "text-white/85",
              )}
            >
              {value === 0
                ? t("opt.exoticAny")
                : value === -1
                  ? t("opt.exoticNone")
                  : (chosen?.name ?? " ")}
            </span>
          )}
          {value <= 0 && (
            <span className="text-[11.5px] text-white/50">
              {value === 0 ? t("opt.exoticAnyHint") : t("opt.exoticNoneHint")}
            </span>
          )}
        </div>
        {badges}
        {!open && (
          <GlassButton
            size="sm"
            onClick={() => setOpen(true)}
            className="exotic-change shrink-0"
          >
            {t("opt.changeExotic")}
          </GlassButton>
        )}
      </div>

      {/* The grid: folds away (its icons vanishing first) once one is picked. */}
      <div
        className={cx("exotic-grid grid", !open && "is-folded")}
        inert={!open}
      >
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden pt-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                onChange(0);
                setLanded((n) => n + 1);
              }}
              title={t("opt.exoticAny")}
              aria-label={t("opt.exoticAny")}
              aria-pressed={value === 0}
              style={at()}
              className={cx(
                tile(value === 0),
                "grid place-items-center bg-[#e8c547]/15 text-[#f0d66b]",
              )}
            >
              <IconAnyExotic />
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(-1);
                setLanded((n) => n + 1);
              }}
              title={t("opt.exoticNone")}
              aria-label={t("opt.exoticNone")}
              aria-pressed={value === -1}
              style={at()}
              className={cx(
                tile(value === -1),
                "grid place-items-center bg-black/30 text-white/45",
              )}
            >
              <IconNoExotic />
            </button>
          </div>
          {!exotics && (
            <p className="text-[12px] text-white/40">{t("builder.loading")}</p>
          )}
          {exotics && (
            // The slots side by side, each as wide as its share of the
            // exotics (its icons wrap within).
            <div className="flex gap-4">
              {SLOT_LABELS.map((label, slot) => {
                // Only the exotics the player has.
                const row = exotics.filter((e) => e.slot === slot && e.owned);
                if (row.length === 0) return null;
                return (
                  // At least as wide as its label (min-content: the label
                  // doesn't wrap), so "Class item" isn't cut off.
                  <div
                    key={slot}
                    className="flex min-w-min flex-col gap-1.5"
                    style={{ flex: `${row.length} 1 0` }}
                  >
                    <span className="text-[10.5px] font-semibold tracking-[0.12em] whitespace-nowrap text-white/40 uppercase">
                      {t(label)}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {row.map((e) => (
                        <PerkHover
                          key={e.hash}
                          perk={{
                            hash: e.hash,
                            name: e.name,
                            icon: e.icon,
                            typeName: e.owned
                              ? t(label)
                              : `${t(label)} · ${t("opt.notOwned")}`,
                            description: "",
                          }}
                          exact={e.exact ?? undefined}
                        >
                          {/* (Not `disabled`: it would get no hover.) */}
                          <button
                            type="button"
                            aria-disabled={!e.owned}
                            onClick={(ev) =>
                              e.owned && pick(e, ev.currentTarget)
                            }
                            aria-label={e.name}
                            aria-pressed={value === e.hash}
                            style={at()}
                            className={cx(
                              tile(value === e.hash),
                              !e.owned &&
                                "cursor-not-allowed opacity-35 grayscale hover:translate-y-0 hover:border-white/10",
                            )}
                          >
                            {e.icon && (
                              <img
                                src={BUNGIE_ORIGIN + e.icon}
                                alt=""
                                className="size-full object-cover"
                                draggable={false}
                              />
                            )}
                            {e.watermark && (
                              <img
                                src={BUNGIE_ORIGIN + e.watermark}
                                alt=""
                                className="absolute inset-0 size-full"
                                draggable={false}
                              />
                            )}
                          </button>
                        </PerkHover>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The subclass the loadout puts on: the character's subclasses as tiles;
 *  the pick flies into the spot on the left and the tiles fold away
 *  ("change" brings them back). None picked: the one equipped now stays. */
function SubclassPicker({
  subclasses,
  value,
  onChange,
  badges,
  folded,
  onUnfold,
}: {
  subclasses: Choice[] | null;
  /** The subclass's instance id; null: keep the equipped one. */
  value: string | null;
  onChange: (v: string | null) => void;
  /** Beside the name: the setup's picks (after "done"). */
  badges?: React.ReactNode;
  /** The tiles folded away ("done" in the setup). */
  folded: boolean;
  onUnfold: () => void;
}) {
  const t = useT();
  const chosen = subclasses?.find((c) => c.id === value) ?? null;
  const target = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState(false);
  const [landed, setLanded] = useState(0);
  const flight = useRef<Animation | null>(null);
  useEffect(() => () => flight.current?.cancel(), []);
  // The tiles stay while the subclass is set up; "done" folds them.
  const open = !folded;

  const pick = (c: Choice, from: HTMLElement) => {
    if (c.id === value) return;
    const to = target.current;
    onChange(c.id);
    if (
      !to ||
      !c.icon ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setLanded((n) => n + 1);
      return;
    }
    flight.current?.cancel();
    setFlying(true);
    const anim = flyIcon(c.icon, from, to, "var(--accent-glow)");
    flight.current = anim;
    anim.onfinish = () => {
      if (flight.current === anim) {
        setFlying(false);
        setLanded((n) => n + 1);
      }
    };
  };

  const shown = flying ? null : chosen;
  let order = 0;
  const at = () => ({ "--i": order++ }) as React.CSSProperties;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-4">
        <div
          ref={target}
          key={landed}
          className={cx(
            landed > 0 && "subclass-landing",
            "relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border",
            shown ? "border-(--accent)" : "border-dashed border-white/15",
          )}
        >
          {shown?.icon && (
            <img
              src={BUNGIE_ORIGIN + shown.icon}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          )}
        </div>
        <div
          aria-live="polite"
          className="flex min-w-0 flex-1 flex-col gap-0.5"
        >
          <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("builder.slot.subclass")}
          </span>
          <span className="truncate text-[15px] font-semibold text-white/90">
            {chosen ? chosen.name : t("opt.subclassKeep")}
          </span>
          {!chosen && (
            <span className="text-[11.5px] text-white/50">
              {t("opt.subclassKeepHint")}
            </span>
          )}
        </div>
        {badges}
        {!open && (
          <GlassButton
            size="sm"
            onClick={onUnfold}
            className="exotic-change shrink-0"
          >
            {t("opt.changeExotic")}
          </GlassButton>
        )}
      </div>
      <div
        className={cx("exotic-grid grid", !open && "is-folded")}
        inert={!open}
      >
        <div className="flex min-h-0 flex-wrap gap-2 overflow-hidden pt-3">
          {!subclasses && (
            <p className="text-[12px] text-white/40">{t("builder.loading")}</p>
          )}
          {subclasses?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={(ev) => pick(c, ev.currentTarget)}
              title={c.name}
              aria-label={c.name}
              aria-pressed={value === c.id}
              style={at()}
              className={cx(
                "exotic-tile relative size-14 shrink-0 overflow-hidden rounded-xl border",
                value === c.id
                  ? "border-(--accent) shadow-[0_0_0_2px_var(--accent-glow)]"
                  : "border-white/10 hover:-translate-y-px hover:border-white/30",
              )}
            >
              {c.icon && (
                <img
                  src={BUNGIE_ORIGIN + c.icon}
                  alt=""
                  className="size-full object-cover"
                  draggable={false}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Something a subclass socket takes (optimizer_subclass). */
interface SubclassPlug {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  description: string;
  /** What it adds to the armor stats, in the backend's order (fragments). */
  stats: number[];
  /** An aspect's fragment slots. */
  capacity: number;
  /** An ability: the stat that speeds it up, its base cooldown (seconds). */
  ability: "" | "grenade" | "melee" | "class" | "super";
  cooldown: number | null;
  /** What it does with the numbers (Destiny Data Compendium, English). */
  exact: string | null;
}

/** An ability's cooldown at `stat` (seconds): Grenade, Melee and Class
 *  shorten theirs by up to 65 % at 100, Super charges up to 190 % faster
 *  (Bungie's figures, taken as linear like the stat cards; the Compendium's
 *  base cooldown at 0). */
function cooldownAt(plug: SubclassPlug, stat: number): number | null {
  if (plug.cooldown === null || !plug.ability) return null;
  const s = Math.min(100, Math.max(0, stat)) / 100;
  return plug.ability === "super"
    ? plug.cooldown / (1 + 1.9 * s)
    : plug.cooldown * (1 - 0.65 * s);
}

/** The stat an ability's cooldown follows. */
const ABILITY_STAT: Record<Exclude<SubclassPlug["ability"], "">, StatId> = {
  grenade: "grenade",
  melee: "melee",
  class: "class",
  super: "super",
};

/** Seconds as "1:23" (or "45 s"). */
function seconds(n: number): string {
  const r = Math.round(n);
  return r >= 60
    ? `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`
    : `${r} s`;
}

interface SubclassSocket {
  index: number;
  kind: "super" | "abilities" | "aspects" | "fragments";
  /** Its empty plug. */
  empty: number;
  current: number;
  options: SubclassPlug[];
}

/** What's picked for the subclass: one plug per super / ability socket (by
 *  socket index), the aspects and fragments as lists. */
interface SubclassPicks {
  single: Record<number, number>;
  aspects: number[];
  fragments: number[];
}

/** Nothing picked yet. */
const NO_PICKS: SubclassPicks = { single: {}, aspects: [], fragments: [] };

/** The picks as socket overrides (socket index -> plug). Nothing picked
 *  for a socket (or for all aspects / all fragments): it stays as the
 *  subclass has it; aspects or fragments picked: the sockets left over get
 *  their empty plug. */
function overridesOf(
  sockets: SubclassSocket[],
  picks: SubclassPicks,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const s of sockets)
    if (picks.single[s.index]) out[s.index] = picks.single[s.index];
  for (const kind of ["aspects", "fragments"] as const) {
    const list = picks[kind];
    if (list.length === 0) continue;
    sockets
      .filter((s) => s.kind === kind)
      .forEach((s, i) => (out[s.index] = list[i] ?? s.empty));
  }
  return out;
}

/** How many fragments the picked aspects allow (at most the sockets there are). */
function fragmentRoom(sockets: SubclassSocket[], picks: SubclassPicks): number {
  const aspects = sockets.find((s) => s.kind === "aspects")?.options ?? [];
  const room = picks.aspects.reduce(
    (n, h) => n + (aspects.find((a) => a.hash === h)?.capacity ?? 0),
    0,
  );
  return Math.min(room, sockets.filter((s) => s.kind === "fragments").length);
}

/** The stats the picks add to every build (fragments), backend order. */
function bonusOf(sockets: SubclassSocket[], picks: SubclassPicks): number[] {
  const all = new Map(
    sockets.flatMap((s) => s.options.map((o) => [o.hash, o] as const)),
  );
  const out = [0, 0, 0, 0, 0, 0];
  for (const h of [
    ...Object.values(picks.single),
    ...picks.aspects,
    ...picks.fragments,
  ]) {
    all.get(h)?.stats.forEach((v, i) => (out[i] += v));
  }
  return out;
}

/** The subclass's super, abilities, aspects and fragments, as in game: for
 *  each its place(s) on top (what's picked), its options under them. A pick
 *  flies from its option into its place; a picked aspect or fragment is
 *  taken out again with a click on its place. Bungie's text and Clarity's
 *  exact numbers on hover; fragments show what they do to the stats (it
 *  counts in every build). */
function SubclassSetup({
  sockets,
  picks,
  onChange,
  done,
  onDone,
  stats,
}: {
  sockets: SubclassSocket[];
  picks: SubclassPicks;
  onChange: (p: SubclassPicks) => void;
  /** Done: folded away (its picks shown by the subclass). */
  done: boolean;
  /** "Done" clicked: where each pick sits now (plug hash -> its place). */
  onDone: (from: Map<number, DOMRect>) => void;
  /** The stat minimums (cooldowns are shown for them). */
  stats: Record<StatId, number>;
}) {
  const t = useT();
  const clarity = useClarity(
    sockets.flatMap((s) => s.options.map((o) => o.hash)),
  );
  // An ability's cooldown at its stat's minimum, and the line saying so.
  const cooldownText = (o: SubclassPlug) => {
    if (!o.ability || o.cooldown === null) return null;
    const stat = ABILITY_STAT[o.ability];
    const now = cooldownAt(o, stats[stat]);
    return now === null
      ? null
      : t("opt.cooldown", {
          now: seconds(now),
          base: seconds(o.cooldown),
          stat: t(`statfx.name.${stat}`),
          n: stats[stat],
        });
  };
  const room = fragmentRoom(sockets, picks);
  const aspectSockets = sockets.filter((s) => s.kind === "aspects");
  const fragmentSockets = sockets.filter((s) => s.kind === "fragments");
  const aspectOptions = aspectSockets[0]?.options ?? [];
  const fragmentOptions = fragmentSockets[0]?.options ?? [];
  const byHash = new Map(
    sockets.flatMap((s) => s.options.map((o) => [o.hash, o] as const)),
  );

  // The places (by key: a socket index, "a0".., "f0"..), what's flying to
  // which, and each place's landings (restart its glow).
  const places = useRef(new Map<string, HTMLElement>());
  const [flying, setFlying] = useState<Record<string, number>>({});
  const [landed, setLanded] = useState<Record<string, number>>({});
  const flights = useRef(new Map<string, Animation>());
  useEffect(() => () => flights.current.forEach((a) => a.cancel()), []);
  const fly = (key: string, plug: SubclassPlug, from: HTMLElement) => {
    const to = places.current.get(key);
    const land = () => setLanded((l) => ({ ...l, [key]: (l[key] ?? 0) + 1 }));
    if (
      !to ||
      !plug.icon ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      land();
      return;
    }
    flights.current.get(key)?.cancel();
    setFlying((f) => ({ ...f, [key]: plug.hash }));
    const anim = flyIcon(plug.icon, from, to, "var(--accent-glow)");
    flights.current.set(key, anim);
    const done = () => {
      if (flights.current.get(key) !== anim) return;
      flights.current.delete(key);
      setFlying((f) => {
        const next = { ...f };
        delete next[key];
        return next;
      });
    };
    anim.onfinish = () => {
      done();
      land();
    };
    anim.oncancel = done;
  };

  // Dragging an aspect or fragment: from a place (its index) or from the
  // options (null), and the place it's over.
  const drag = useRef<{
    kind: "aspects" | "fragments";
    hash: number;
    from: number | null;
  } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const roomOf = (kind: "aspects" | "fragments", p: SubclassPicks) =>
    kind === "aspects" ? aspectSockets.length : fragmentRoom(sockets, p);
  // A new list for `kind`: fewer fragment places after the aspects changed
  // drop the last fragments.
  const setList = (kind: "aspects" | "fragments", list: number[]) => {
    const next = { ...picks, [kind]: list };
    onChange(
      kind === "aspects"
        ? {
            ...next,
            fragments: next.fragments.slice(0, fragmentRoom(sockets, next)),
          }
        : next,
    );
  };
  // Dropped on place `j`: from another place, the two swap (onto an empty
  // one: it moves to the end); from the options, it takes that place (an
  // empty one: the next free), or swaps with its own if already picked.
  const dropOn = (kind: "aspects" | "fragments", j: number) => {
    const d = drag.current;
    if (!d || d.kind !== kind) return;
    const list = [...picks[kind]];
    const at = d.from ?? list.indexOf(d.hash);
    if (at >= 0) {
      if (j >= list.length) {
        list.splice(at, 1);
        list.push(d.hash);
      } else {
        [list[at], list[j]] = [list[j], list[at]];
      }
    } else if (j < list.length) {
      list[j] = d.hash;
    } else if (list.length < roomOf(kind, picks)) {
      list.push(d.hash);
    } else {
      return;
    }
    setList(kind, list);
  };
  // Dragged from a place back onto the options: taken out.
  const dropOut = (kind: "aspects" | "fragments") => {
    const d = drag.current;
    if (!d || d.kind !== kind || d.from === null) return;
    setList(
      kind,
      picks[kind].filter((_, i) => i !== d.from),
    );
  };
  const endDrag = () => {
    drag.current = null;
    setOver(null);
  };
  const outArea = (kind: "aspects" | "fragments") => ({
    onDragOver: (e: React.DragEvent) => {
      if (drag.current?.kind !== kind || drag.current.from === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropOut(kind);
      endDrag();
    },
  });

  const place = (
    key: string,
    hash: number,
    opts: {
      locked?: boolean;
      onClear?: () => void;
      dnd?: { kind: "aspects" | "fragments"; i: number };
    } = {},
  ) => {
    const plug = flying[key] === hash ? undefined : byHash.get(hash);
    const dnd = opts.dnd;
    const button = (
      <button
        // A new landing remounts it: its glow plays again.
        key={`${key}-${landed[key] ?? 0}`}
        ref={(el) => {
          if (el) places.current.set(key, el);
          else places.current.delete(key);
        }}
        type="button"
        // (Places that take drops stay enabled: a disabled one gets no drag events.)
        disabled={!dnd && (!plug || !opts.onClear)}
        onClick={() => plug && opts.onClear?.()}
        draggable={!!(dnd && plug)}
        onDragStart={(e) => {
          if (!dnd || !plug) return;
          drag.current = { kind: dnd.kind, hash: plug.hash, from: dnd.i };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(plug.hash));
        }}
        onDragOver={(e) => {
          if (!dnd || opts.locked || drag.current?.kind !== dnd.kind) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (over !== key) setOver(key);
        }}
        onDragLeave={() => over === key && setOver(null)}
        onDrop={(e) => {
          if (!dnd || opts.locked) return;
          e.preventDefault();
          dropOn(dnd.kind, dnd.i);
          endDrag();
        }}
        onDragEnd={endDrag}
        aria-label={plug?.name ?? t("opt.emptySlot")}
        title={plug ? undefined : t("opt.emptySlot")}
        className={cx(
          "relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border transition-[border-color,box-shadow,transform] duration-150",
          (landed[key] ?? 0) > 0 && plug && "subclass-landing",
          plug
            ? "border-(--accent-glow) bg-black/30"
            : "border-dashed border-white/15 bg-white/[0.02]",
          opts.locked && "opacity-40",
          plug && opts.onClear && "hover:border-[#ff8a7a]/60",
          dnd && plug && "cursor-grab active:cursor-grabbing",
          over === key &&
            "scale-105 border-(--accent) shadow-[0_0_0_2px_var(--accent-glow)]",
        )}
      >
        {plug?.icon && (
          <img
            src={BUNGIE_ORIGIN + plug.icon}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        )}
        {opts.locked && <IconLock />}
      </button>
    );
    // Filled: what it does on hover, with the exact numbers.
    return plug ? (
      <PerkHover
        key={`${key}-${landed[key] ?? 0}`}
        perk={{
          hash: plug.hash,
          name: plug.name,
          icon: plug.icon,
          typeName: opts.onClear
            ? `${plug.typeName} · ${t(dnd ? "opt.takeOutOrDrag" : "opt.takeOut")}`
            : plug.typeName,
          description: [plug.description, cooldownText(plug)]
            .filter(Boolean)
            .join("\n\n"),
        }}
        clarity={clarity.get(plug.hash)}
        exact={plug.exact ?? undefined}
      >
        {button}
      </PerkHover>
    ) : (
      button
    );
  };

  const tile = (selected: boolean, enabled = true) =>
    cx(
      "relative size-11 shrink-0 overflow-hidden rounded-lg border bg-black/30 transition-[border-color,box-shadow,transform,opacity] duration-150",
      selected
        ? "border-(--accent) shadow-[0_0_0_2px_var(--accent-glow),0_0_14px_-2px_var(--accent)]"
        : "border-white/10 hover:-translate-y-px hover:border-white/30",
      !enabled &&
        "cursor-not-allowed opacity-30 hover:translate-y-0 hover:border-white/10",
    );
  const plugTile = (
    o: SubclassPlug,
    selected: boolean,
    onClick: (from: HTMLElement) => void,
    enabled = true,
    dragKind?: "aspects" | "fragments",
  ) => (
    <PerkHover
      key={o.hash}
      perk={{
        hash: o.hash,
        name: o.name,
        icon: o.icon,
        typeName: o.typeName,
        description: [o.description, cooldownText(o)]
          .filter(Boolean)
          .join("\n\n"),
      }}
      clarity={clarity.get(o.hash)}
      exact={o.exact ?? undefined}
    >
      <button
        draggable={!!dragKind && (enabled || selected)}
        onDragStart={(e) => {
          if (!dragKind) return;
          drag.current = { kind: dragKind, hash: o.hash, from: null };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(o.hash));
        }}
        onDragEnd={endDrag}
        type="button"
        onClick={(ev) => onClick(ev.currentTarget)}
        disabled={!enabled}
        aria-label={o.name}
        aria-pressed={selected}
        className={tile(selected, enabled)}
      >
        {o.icon && (
          <img
            src={BUNGIE_ORIGIN + o.icon}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        )}
        {/* Picked: a tick in the corner (it's in a slot above). */}
        {selected && (
          <span className="animate-fade-in absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-(--accent) text-white shadow-[0_0_6px_var(--accent)]">
            <svg
              viewBox="0 0 24 24"
              width="10"
              height="10"
              fill="none"
              stroke="currentColor"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        )}
      </button>
    </PerkHover>
  );
  const heading = (text: string, extra?: string) => (
    <div className="flex items-baseline gap-2">
      <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
        {text}
      </span>
      {extra && (
        <span className="text-[11px] text-white/45 tabular-nums">{extra}</span>
      )}
    </div>
  );
  const statText = (stats: number[]) =>
    stats
      .map((v, i) =>
        v ? `${v > 0 ? "+" : ""}${v} ${t(`statfx.name.${BACKEND[i]}`)}` : "",
      )
      .filter(Boolean)
      .join(" · ");

  // Aspects: a pick goes to the first free place; fewer fragment places
  // afterwards drop the last fragments.
  const pickAspect = (o: SubclassPlug, from: HTMLElement) => {
    if (picks.aspects.includes(o.hash)) {
      dropAspect(o.hash);
      return;
    }
    if (picks.aspects.length >= aspectSockets.length) return;
    fly(`a${picks.aspects.length}`, o, from);
    onChange({ ...picks, aspects: [...picks.aspects, o.hash] });
  };
  const dropAspect = (hash: number) => {
    const next = { ...picks, aspects: picks.aspects.filter((h) => h !== hash) };
    onChange({
      ...next,
      fragments: picks.fragments.slice(0, fragmentRoom(sockets, next)),
    });
  };
  const pickFragment = (o: SubclassPlug, from: HTMLElement) => {
    if (picks.fragments.includes(o.hash)) {
      onChange({
        ...picks,
        fragments: picks.fragments.filter((h) => h !== o.hash),
      });
      return;
    }
    if (picks.fragments.length >= room) return;
    fly(`f${picks.fragments.length}`, o, from);
    onChange({ ...picks, fragments: [...picks.fragments, o.hash] });
  };

  // "Done": every pick's place, for their flight to the subclass.
  const finish = () => {
    const from = new Map<number, DOMRect>();
    const at = (key: string, hash: number) => {
      const el = places.current.get(key);
      if (el && hash) from.set(hash, el.getBoundingClientRect());
    };
    for (const s of sockets)
      if (s.kind === "super" || s.kind === "abilities")
        at(String(s.index), picks.single[s.index] ?? 0);
    picks.aspects.forEach((h, i) => at(`a${i}`, h));
    picks.fragments.forEach((h, i) => at(`f${i}`, h));
    onDone(from);
  };

  return (
    <div className={cx("exotic-grid grid", done && "is-folded")} inert={done}>
      <div className="flex min-h-0 flex-col overflow-hidden">
        <div className="setup-reveal mt-3 flex flex-col gap-5 border-t border-white/[0.06] pt-3">
          {/* Super and abilities: a place each, its options under it. */}
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            {sockets
              .filter((s) => s.kind === "super" || s.kind === "abilities")
              .map((s) => (
                <div key={s.index} className="flex min-w-0 flex-col gap-2">
                  {heading(
                    s.kind === "super"
                      ? t("opt.super")
                      : (s.options[0]?.typeName ?? ""),
                  )}
                  {place(String(s.index), picks.single[s.index] ?? 0)}
                  {/* Its cooldown at the stat's minimum (changes with it). */}
                  {(() => {
                    const plug = s.options.find(
                      (o) => o.hash === picks.single[s.index],
                    );
                    if (!plug?.ability || plug.cooldown === null) return null;
                    const now = cooldownAt(
                      plug,
                      stats[ABILITY_STAT[plug.ability]],
                    );
                    return now === null ? null : (
                      <span
                        className="flex items-center gap-1 text-[11px] text-white/60 tabular-nums"
                        title={cooldownText(plug) ?? undefined}
                      >
                        <IconClock />
                        {seconds(now)}
                      </span>
                    );
                  })()}
                  <div className="flex flex-wrap gap-1.5">
                    {s.options.map((o) =>
                      plugTile(o, picks.single[s.index] === o.hash, (from) => {
                        if (picks.single[s.index] === o.hash) return;
                        fly(String(s.index), o, from);
                        onChange({
                          ...picks,
                          single: { ...picks.single, [s.index]: o.hash },
                        });
                      }),
                    )}
                  </div>
                </div>
              ))}
          </div>

          {aspectOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              {heading(
                t("opt.aspects"),
                `${picks.aspects.length}/${aspectSockets.length}`,
              )}
              <div className="flex gap-2">
                {aspectSockets.map((_, i) =>
                  place(`a${i}`, picks.aspects[i] ?? 0, {
                    onClear: picks.aspects[i]
                      ? () => dropAspect(picks.aspects[i])
                      : undefined,
                    dnd: { kind: "aspects", i },
                  }),
                )}
              </div>
              <div className="flex flex-wrap gap-1.5" {...outArea("aspects")}>
                {aspectOptions.map((o) => {
                  const on = picks.aspects.includes(o.hash);
                  return plugTile(
                    o,
                    on,
                    (from) => pickAspect(o, from),
                    on || picks.aspects.length < aspectSockets.length,
                    "aspects",
                  );
                })}
              </div>
            </div>
          )}

          {fragmentOptions.length > 0 && (
            <div className="flex flex-col gap-2">
              {heading(t("opt.fragments"), `${picks.fragments.length}/${room}`)}
              {/* As many places as the aspects allow; the rest locked. */}
              <div className="flex flex-wrap gap-2">
                {fragmentSockets.map((_, i) =>
                  place(`f${i}`, picks.fragments[i] ?? 0, {
                    locked: i >= room,
                    onClear: picks.fragments[i]
                      ? () =>
                          onChange({
                            ...picks,
                            fragments: picks.fragments.filter(
                              (_, k) => k !== i,
                            ),
                          })
                      : undefined,
                    dnd: { kind: "fragments", i },
                  }),
                )}
              </div>
              <div className="flex flex-wrap gap-1.5" {...outArea("fragments")}>
                {fragmentOptions.map((o) => {
                  const on = picks.fragments.includes(o.hash);
                  const stats = statText(o.stats);
                  return (
                    // What it does to the stats under it: the value, then which
                    // stat ("+10" / "Melee"), a line each.
                    <div
                      key={o.hash}
                      className="flex w-16 flex-col items-center gap-0.5"
                      title={stats || undefined}
                    >
                      {plugTile(
                        o,
                        on,
                        (from) => pickFragment(o, from),
                        on || picks.fragments.length < room,
                        "fragments",
                      )}
                      {o.stats.map((v, i) =>
                        v ? (
                          <span
                            key={i}
                            className="flex w-full flex-col items-center leading-tight"
                          >
                            <span
                              className={cx(
                                "text-[10.5px] font-semibold tabular-nums",
                                v < 0
                                  ? "text-[#ff8a7a]"
                                  : "text-(--accent-text)",
                              )}
                            >
                              {v > 0 ? "+" : ""}
                              {v}
                            </span>
                            <span className="w-full truncate text-center text-[9.5px] text-white/55">
                              {t(`statfx.name.${BACKEND[i]}`)}
                            </span>
                          </span>
                        ) : null,
                      )}
                    </div>
                  );
                })}
              </div>
              {statText(bonusOf(sockets, picks)) && (
                <p className="text-[11.5px] text-white/55">
                  {t("opt.fragmentBonus")}:{" "}
                  <span className="text-white/80">
                    {statText(bonusOf(sockets, picks))}
                  </span>
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <GlassButton
              variant="primary"
              onClick={finish}
              className="exotic-tile"
            >
              {t("opt.done")}
            </GlassButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The subclass's picks in a row by its name (after "done"): each flies in
 *  from its place in the setup, one after the other; a click opens the
 *  setup again. */
function SubclassBadges({
  plugs,
  from,
  onOpen,
}: {
  plugs: SubclassPlug[];
  from: React.RefObject<Map<number, DOMRect>>;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("opt.changeSetup")}
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl p-1 transition-colors hover:bg-white/[0.05]"
    >
      {plugs.map((p, i) => (
        <SubclassBadge
          key={`${p.hash}-${i}`}
          plug={p}
          from={from}
          delay={i * 35}
        />
      ))}
    </button>
  );
}

function SubclassBadge({
  plug,
  from,
  delay,
}: {
  plug: SubclassPlug;
  from: React.RefObject<Map<number, DOMRect>>;
  delay: number;
}) {
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const start = from.current?.get(plug.hash);
    const node = el.current;
    if (!start || !node) return;
    from.current?.delete(plug.hash);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = node.getBoundingClientRect();
    const dx = start.left - end.left;
    const dy = start.top - end.top;
    const scale = start.width / end.width;
    node.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(${(1 + scale) / 2})`,
          offset: 0.5,
        },
        { transform: "none" },
      ],
      {
        duration: 560,
        delay,
        easing: "cubic-bezier(0.45, 0.05, 0.25, 1)",
        fill: "backwards",
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <PerkHover
      perk={{
        hash: plug.hash,
        name: plug.name,
        icon: plug.icon,
        typeName: plug.typeName,
        description: plug.description,
      }}
      exact={plug.exact ?? undefined}
    >
      <span
        ref={el}
        className="relative z-10 size-8 shrink-0 overflow-hidden rounded-md border border-(--accent-glow) bg-black/40"
        style={{ transformOrigin: "top left" }}
      >
        {plug.icon && (
          <img
            src={BUNGIE_ORIGIN + plug.icon}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        )}
      </span>
    </PerkHover>
  );
}

/** A piece dragged from the piece picker onto a slot. */
const PIECE_DRAG = "application/x-radar-piece";

const IconPin = () => (
  <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden>
    <path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" />
  </svg>
);

/** One piece on hover (optimizer_piece). */
interface PieceInfo {
  /** Backend order (BACKEND): with its masterwork, and without. */
  stats: number[];
  base: number[];
  masterwork: number;
  gearTier: number;
  set: string | null;
  /** An exotic class item's spirits. */
  perks: ItemInfo[];
  /** An exotic's perk with the numbers (Compendium). */
  exact: string | null;
  /** Its archetype ("Specialist": primary and secondary stat). */
  archetype: ItemInfo | null;
}

/** A piece's stats as bars (as DIM shows them): per stat its value, the
 *  roll in white and what the masterwork adds in the accent, then the
 *  total. Backend order: Health, Melee, Grenade, Super, Class, Weapons. */
export function ArmorStatBars({
  stats,
  base,
}: {
  stats: number[];
  base: number[];
}) {
  const t = useT();
  /** A full bar: a piece's single stat rarely goes past this. */
  const FULL = 45;
  const total = stats.reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-1">
      {BACKEND.map((st, i) => {
        const value = stats[i];
        const own = Math.min(base[i], value);
        const top = Math.max(base[i], value) >= 25;
        return (
          <div
            key={st}
            className="grid grid-cols-[72px_34px_minmax(0,1fr)] items-center gap-2 text-[12px]"
          >
            <span
              className={cx(
                "truncate",
                top ? "font-semibold text-white" : "text-white/65",
              )}
            >
              {t(`statfx.name.${st}`)}
            </span>
            <span
              className={cx(
                "text-right tabular-nums",
                top ? "font-semibold text-white" : "text-white/65",
              )}
            >
              +{value}
            </span>
            <span className="relative h-2.5 overflow-hidden rounded-[2px] bg-white/[0.08]">
              <span
                className="absolute inset-y-0 left-0 bg-white/85"
                style={{ width: `${(Math.min(own, FULL) / FULL) * 100}%` }}
              />
              {value > own && (
                <span
                  className="absolute inset-y-0 bg-(--accent)"
                  style={{
                    left: `${(Math.min(own, FULL) / FULL) * 100}%`,
                    width: `${(Math.min(value - own, FULL - own) / FULL) * 100}%`,
                  }}
                />
              )}
            </span>
          </div>
        );
      })}
      <div className="grid grid-cols-[72px_34px_minmax(0,1fr)] items-center gap-2 border-t border-white/[0.08] pt-1 text-[12px]">
        <span className="text-white/65">{t("opt.statTotal")}</span>
        <span className="text-right font-semibold text-white tabular-nums">
          {total}
        </span>
      </div>
    </div>
  );
}

/** Fetched once per piece (and character). */
const pieceInfos = new Map<string, Promise<PieceInfo | undefined>>();

/** A piece with a card on hover: every stat (with what its masterwork adds),
 *  its set and tier, an exotic's numbers, an exotic class item's spirits. */
function PieceHover({
  character,
  piece,
  children,
}: {
  character: string | null;
  piece: Choice;
  children: React.ReactNode;
}) {
  const t = useT();
  const [at, setAt] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [info, setInfo] = useState<PieceInfo | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useLayoutEffect(() => {
    if (!at || !card.current) return;
    const w = card.current.offsetWidth;
    const h = card.current.offsetHeight;
    // Below, else above, else beside it: never over it (and the pointer).
    setPos(placeCard(at, w, h));
  }, [at, info]);
  const load = () => {
    const key = `${character}:${piece.id}`;
    let p = pieceInfos.get(key);
    if (!p) {
      p = call<PieceInfo>("optimizer_piece", {
        characterId: character,
        id: piece.id,
      });
      p.catch(() => pieceInfos.delete(key));
      pieceInfos.set(key, p);
    }
    void p.then((i) => i && setInfo(i)).catch(() => {});
  };
  return (
    <span
      className="contents"
      onMouseEnter={(e) => {
        const target = (e.currentTarget.firstElementChild ??
          e.currentTarget) as Element;
        load();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(
          () => setAt(target.getBoundingClientRect()),
          180,
        );
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setAt(null);
        setPos(null);
      }}
    >
      {children}
      {at &&
        createPortal(
          <div
            ref={card}
            className="animate-fade-in pointer-events-none fixed z-[120] w-80 rounded-2xl border border-white/10 bg-[#05070c]/97 p-3.5 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95)] backdrop-blur-md"
            style={pos ?? { left: -9999, top: -9999 }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cx(
                  "relative size-10 shrink-0 overflow-hidden rounded-lg border",
                  piece.exotic ? "border-[#e8c547]/70" : "border-white/15",
                )}
              >
                {piece.icon && (
                  <img
                    src={BUNGIE_ORIGIN + piece.icon}
                    alt=""
                    className="size-full object-cover"
                  />
                )}
                {piece.watermark && (
                  <img
                    src={BUNGIE_ORIGIN + piece.watermark}
                    alt=""
                    className="absolute inset-0 size-full"
                  />
                )}
                <TierPips tier={piece.tier} size={40} />
              </span>
              <div className="min-w-0">
                <div
                  className={cx(
                    "truncate text-[13px] font-semibold",
                    piece.exotic ? "text-[#f0d66b]" : "text-white",
                  )}
                >
                  {piece.name}
                </div>
                <div className="truncate text-[10.5px] text-white/45">
                  {[
                    piece.typeName,
                    piece.location,
                    info?.set,
                    info && info.gearTier > 0 ? `Tier ${info.gearTier}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
            {!info ? (
              <p className="mt-2 text-[11.5px] text-white/40">
                {t("builder.loading")}
              </p>
            ) : (
              <>
                {/* Every stat as a bar (as DIM shows them). */}
                <div className="mt-3">
                  <ArmorStatBars stats={info.stats} base={info.base} />
                </div>
                <div className="mt-1.5 flex justify-between gap-2 text-[10.5px] text-white/45">
                  <span>
                    {t("opt.pieceMasterwork", { n: info.masterwork })}
                  </span>
                  {/* (The roll alone: mods and tuning in it now don't count.) */}
                  <span>{t("opt.statsNoMods")}</span>
                </div>
                {/* Its archetype: primary and secondary stat. */}
                {info.archetype && (
                  <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2">
                    {info.archetype.icon && (
                      <img
                        src={BUNGIE_ORIGIN + info.archetype.icon}
                        alt=""
                        className="size-8 shrink-0 rounded"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-white">
                        {info.archetype.name}
                      </div>
                      {info.archetype.description && (
                        <div className="text-[11px] leading-snug whitespace-pre-line text-white/55">
                          {info.archetype.description}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {info.exact && (
                  <div className="mt-2.5 rounded-xl border border-[#e8c547]/25 bg-[linear-gradient(135deg,rgb(232_197_71/0.08),rgb(255_255_255/0.02))] p-2.5">
                    <div className="mb-1 text-[9.5px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">
                      {t("clarity.title")}
                    </div>
                    <p className="text-[11.5px] leading-relaxed whitespace-pre-line text-white/80">
                      {info.exact}
                    </p>
                  </div>
                )}
                {/* An exotic class item: its two spirits, with their numbers. */}
                {info.perks.map((perk) => (
                  <div
                    key={perk.hash}
                    className="mt-2.5 rounded-xl border border-[#e8c547]/25 bg-white/[0.02] p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      {perk.icon && (
                        <img
                          src={BUNGIE_ORIGIN + perk.icon}
                          alt=""
                          className="size-6 rounded"
                        />
                      )}
                      <span className="text-[12px] font-semibold text-[#f0d66b]">
                        {perk.name}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed whitespace-pre-line text-white/75">
                      {perk.exact ?? perk.description}
                    </p>
                  </div>
                ))}
                {(info.exact || info.perks.some((p) => p.exact)) && (
                  <CompendiumCredit className="mt-2" />
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * A slot's own pieces to pick one by hand (it's then in every build, the
 * rest worked out around it): search, click or drag onto the slot.
 */
function PiecePicker({
  character,
  slot,
  pinned,
  onPin,
  onClose,
  only,
}: {
  character: string | null;
  slot: number;
  pinned: Choice | null;
  /** The item in this slot (picked, or the exotic picked): only its copies at first. */
  only?: string | null;
  onPin: (piece: Choice | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const inv = useInventoryVersion();
  const [pieces, setPieces] = useState<Choice[] | null>(null);
  const [query, setQuery] = useState("");
  // Its copies first, every time it opens or the item changes; all of the
  // slot's gear only when asked.
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [only, slot]);
  const narrowed = !!only && !all;
  useEffect(() => setPieces(null), [character, slot]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    let alive = true;
    void presets
      .candidates(character, ARMOR_BUCKETS[slot])
      .then((list) => alive && setPieces(list))
      .catch(() => alive && setPieces([]));
    return () => {
      alive = false;
    };
  }, [character, slot, inv]);
  const q = query.trim().toLowerCase();
  const shown = (pieces ?? [])
    .filter((p) => !narrowed || p.name.toLowerCase() === only!.toLowerCase())
    .filter((p) => choiceMatches(p, q))
    .sort(
      (a, b) =>
        Number(b.exotic) - Number(a.exotic) || a.name.localeCompare(b.name),
    )
    .slice(0, 120);
  return (
    <div className="setup-reveal mt-3 rounded-xl border border-(--accent-glow) bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
          {t(SLOT_LABELS[slot])}
        </span>
        <span className="text-[11px] text-white/45">{t("opt.pinHint")}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {only && (
            <GlassButton size="sm" onClick={() => setAll((a) => !a)}>
              {narrowed
                ? t("opt.pinShowAll")
                : t("opt.pinShowExotic", { name: only })}
            </GlassButton>
          )}
          {pinned && (
            <GlassButton size="sm" onClick={() => onPin(null)}>
              {t("opt.unpin")}
            </GlassButton>
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
          >
            <IconClose />
          </button>
        </div>
      </div>
      <SearchSuggest
        value={query}
        onChange={setQuery}
        placeholder={t("opt.pinSearch")}
        items={(pieces ?? []).filter(
          (p) => !narrowed || p.name.toLowerCase() === only!.toLowerCase(),
        )}
        className="mb-2"
      />
      {!pieces ? (
        <p className="text-[12px] text-white/45">{t("builder.loading")}</p>
      ) : (
        <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto pr-1 md:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const on = pinned?.id === p.id;
            return (
              <PieceHover key={p.id} character={character} piece={p}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData(PIECE_DRAG, p.id);
                  }}
                  onClick={() => {
                    onPin(on ? null : p);
                    // Picked: the list goes.
                    onClose();
                  }}
                  className={cx(
                    "flex min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
                    on
                      ? "border-(--accent) bg-(--accent-soft)"
                      : "border-white/[0.06] bg-black/15 hover:border-white/20",
                  )}
                >
                  <span
                    className={cx(
                      "relative size-9 shrink-0 overflow-hidden rounded-md border",
                      p.exotic ? "border-[#e8c547]/70" : "border-white/10",
                    )}
                  >
                    {p.icon && (
                      <img
                        src={BUNGIE_ORIGIN + p.icon}
                        alt=""
                        className="size-full object-cover"
                        draggable={false}
                      />
                    )}
                    {p.watermark && (
                      <img
                        src={BUNGIE_ORIGIN + p.watermark}
                        alt=""
                        className="absolute inset-0 size-full"
                        draggable={false}
                      />
                    )}
                    <TierPips tier={p.tier} size={36} />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "block truncate text-[12px]",
                        p.exotic ? "text-[#f0d66b]" : "text-white/85",
                      )}
                    >
                      {p.name}
                    </span>
                    <span className="block truncate text-[10.5px] text-white/40">
                      {p.location}
                    </span>
                  </span>
                </button>
              </PieceHover>
            );
          })}
        </div>
      )}
    </div>
  );
}

const IconClock = () => (
  <svg
    viewBox="0 0 24 24"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IconLock = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-white/35"
    aria-hidden
  >
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

/** An armor set the character's armor has pieces of (optimizer_sets). */
interface OwnedSet {
  hash: number;
  set: ArmorSet;
  /** Slots there's a piece of it for. */
  slots: number;
  /** Which (0 helmet … 4 class item). */
  inSlots: number[];
  pieces: number;
  /** Where its pieces come from ("source: \"root of nightmares\" raid"). */
  sources?: string[];
}

/** Tints telling the (at most two) picked sets apart: the accent, a lighter accent. */
const SET_TINTS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 55%, white)",
];

/** The armor sets wanted, with all five armor slots on top: the exotic in
 *  its own, the picked sets' pieces in the others (which slots exactly is
 *  the optimizer's choice). A bonus clicked asks for that many pieces of its
 *  set in every build; a bonus out of reach (too few slots owned, no room
 *  left) is greyed out. Once no other set fits, the cards fold away, the
 *  picks stay in the header; "change" brings the cards back. */
function SetPicker({
  character,
  sets,
  value,
  onChange,
  exotic,
  pinned,
  activeSlot,
  onSlot,
  onDropPiece,
  onUnpin,
  onClearExotic,
}: {
  character: string | null;
  /** The exotic picked taken out (any exotic again). */
  onClearExotic: () => void;
  /** A piece picked by hand taken out again (its slot). */
  onUnpin: (slot: number) => void;
  /** Pieces picked by hand per slot. */
  pinned: (Choice | null)[];
  /** The slot whose pieces are open below. */
  activeSlot: number | null;
  onSlot: (slot: number) => void;
  /** A piece dragged onto a slot (its instance id). */
  onDropPiece: (slot: number, id: string) => void;
  sets: OwnedSet[] | null;
  /** [set hash, pieces] */
  value: [number, number][];
  onChange: (v: [number, number][]) => void;
  /** The exotic picked: its slot (0 helmet … 4 class item) and icon. */
  exotic: {
    slot: number;
    icon: string | null;
    name: string;
    hash: number;
    exact: string | null;
  } | null;
}) {
  const t = useT();
  const asked = value.reduce((n, [, c]) => n + c, 0);
  // A slot taken: by the exotic, or a piece picked by hand (that piece
  // counts for its own set, so a slot it's in still has that set).
  const takenFor = (i: number, set?: number) =>
    i === exotic?.slot ||
    (!!pinned[i] && (set === undefined || pinned[i]!.set !== set));
  const free =
    [0, 1, 2, 3, 4].filter((i) => !takenFor(i)).length +
    pinned.filter(
      (p, i) => p && i !== exotic?.slot && value.some(([h]) => h === p.set),
    ).length;
  const wanted = (hash: number) => value.find(([h]) => h === hash)?.[1] ?? 0;
  const pick = (hash: number, count: number) => {
    const rest = value.filter(([h]) => h !== hash);
    onChange(wanted(hash) === count ? rest : [...rest, [hash, count]]);
  };
  // Slots a set's pieces can go in: those it has pieces for, less the
  // exotic's (it takes that one).
  const avail = (s: OwnedSet) =>
    s.inSlots.filter((i) => !takenFor(i, s.hash)).length;
  const usable = (sets ?? [])
    .filter((s) => avail(s) >= 2)
    .sort((a, b) => avail(b) - avail(a) || b.pieces - a.pieces);
  // An exotic picked (or changed) after the sets: what no longer fits goes.
  useEffect(() => {
    if (!sets) return;
    const keep = value.filter(([h, c]) => {
      const s = sets.find((x) => x.hash === h);
      return s && avail(s) >= c;
    });
    if (keep.length !== value.length) onChange(keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exotic?.slot, sets, pinned.map((p) => `${p?.id}:${p?.set}`).join()]);
  const named = value.map(([hash, count], i) => ({
    hash,
    count,
    tint: SET_TINTS[i % 2],
    set: sets?.find((s) => s.hash === hash)?.set,
  }));

  // Full: no set of 2 fits any more (two picked, or a 4 with the exotic).
  const full = value.length >= 2 || asked + 2 > free;
  // The cards start folded ("Add set" opens them); once no other set
  // fits, they fold away again by themselves.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!full || !open) return;
    const id = window.setTimeout(() => setOpen(false), 380);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, asked]);

  // The five slots: the exotic in its own, the sets' pieces in the others
  // (in order, for showing).
  const slots: (
    | { kind: "exotic" }
    | { kind: "set"; tint: string; name: string; icon: string | null }
    | null
  )[] = [null, null, null, null, null];
  if (exotic) slots[exotic.slot] = { kind: "exotic" };
  // Each set: its pieces picked by hand first, then free slots (not the
  // exotic's, none picked by hand), those it has pieces for first.
  const taken = (i: number) =>
    slots[i] !== null || (!!pinned[i] && i !== exotic?.slot);
  for (const n of named) {
    const mark = {
      kind: "set" as const,
      tint: n.tint,
      name: n.set?.name ?? "",
      icon: n.set?.perks[0]?.icon ?? null,
    };
    let left = n.count;
    pinned.forEach((p, i) => {
      if (left > 0 && p && p.set === n.hash && slots[i] === null) {
        slots[i] = mark;
        left--;
      }
    });
    const has = sets?.find((x) => x.hash === n.hash)?.inSlots ?? [];
    const order = [0, 1, 2, 3, 4]
      .filter((i) => !taken(i))
      .sort((a, b) => Number(!has.includes(a)) - Number(!has.includes(b)));
    for (const i of order) {
      if (left === 0) break;
      slots[i] = mark;
      left--;
    }
  }

  // The cards: searched by set name, bonus or where its pieces come from
  // (plain words: "root of nightmares", "raid"); the picked ones first.
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const plain = (src: string) => src.replace(/^source:\s*/i, "").replace(/["“”]/g, "");
  const shown = usable
    .filter((s) => {
      const hay = [
        s.set.name,
        ...s.set.perks.map((p) => `${p.name} ${p.exact ?? p.description}`),
        ...(s.sources ?? []).map(plain),
      ].join(" ");
      return hasWords(hay, words);
    })
    .sort((a, b) => Number(wanted(b.hash) > 0) - Number(wanted(a.hash) > 0));
  // Whether `count` pieces of `s` fit: owned in as many free slots, and room
  // left beside the other set.
  const fitsCount = (s: OwnedSet, count: number) =>
    avail(s) >= count &&
    asked - wanted(s.hash) + count <= free &&
    (wanted(s.hash) > 0 || value.length < 2);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("opt.sets")}
          </span>
          <span className="text-[11.5px] text-white/50">
            {value.length === 0
              ? t("opt.setsNone")
              : t("opt.setsAsked", { n: asked })}
          </span>
        </div>
        {/* All five slots. */}
        <div className="flex gap-2">
          {SLOT_LABELS.map((label, i) => {
            const s = slots[i];
            const own = pinned[i];
            const box = (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  // Its pieces open below: the set cards fold away.
                  setOpen(false);
                  onSlot(i);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setOpen(false);
                    onSlot(i);
                  }
                  if (e.key === "Delete" || e.key === "Backspace") {
                    if (own) onUnpin(i);
                    else if (s?.kind === "exotic") onClearExotic();
                  }
                }}
                // Right click: a piece picked by hand comes out, else the exotic.
                onContextMenu={(e) => {
                  if (!own && s?.kind !== "exotic") return;
                  e.preventDefault();
                  if (own) onUnpin(i);
                  else onClearExotic();
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(PIECE_DRAG)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData(PIECE_DRAG);
                  if (id) {
                    e.preventDefault();
                    onDropPiece(i, id);
                  }
                }}
                title={
                  own
                    ? `${own.name} – ${t("opt.pinnedHint")}`
                    : s?.kind === "set"
                      ? `${s.name} – ${t("opt.setSlotHint")}`
                      : t("opt.pinSlotHint")
                }
                className={cx(
                  "group/pin relative grid size-14 cursor-pointer place-items-center overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-300 hover:border-white/40",
                  !s && !own && "border-dashed border-white/15 bg-white/[0.02]",
                  (s?.kind === "exotic" || own?.exotic) &&
                    "border-[#e8c547]/80",
                  own && !own.exotic && "border-(--accent)",
                  activeSlot === i && "shadow-[0_0_0_2px_var(--accent-glow)]",
                )}
                style={
                  s?.kind === "set" && !own
                    ? {
                        borderColor: s.tint,
                        background: `color-mix(in oklab, ${s.tint} 16%, transparent)`,
                      }
                    : undefined
                }
              >
                {/* Picked by hand: that piece, pinned. */}
                {own && (
                  <>
                    {own.icon && (
                      <img
                        src={BUNGIE_ORIGIN + own.icon}
                        alt=""
                        className="size-full object-cover"
                        draggable={false}
                      />
                    )}
                    {own.watermark && (
                      <img
                        src={BUNGIE_ORIGIN + own.watermark}
                        alt=""
                        className="absolute inset-0 size-full"
                        draggable={false}
                      />
                    )}
                    <TierPips tier={own.tier} size={56} />
                    <span className="absolute right-0.5 bottom-0.5 grid size-4 place-items-center rounded-full bg-(--accent) text-white shadow-[0_0_6px_var(--accent)]">
                      <IconPin />
                    </span>
                    {/* Unpin: the optimizer picks this slot again. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnpin(i);
                      }}
                      title={t("opt.unpin")}
                      aria-label={t("opt.unpin")}
                      className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-md bg-black/75 text-white/80 opacity-0 transition-opacity group-hover/pin:opacity-100 hover:bg-[#ff6b5a] hover:text-white focus-visible:opacity-100"
                    >
                      <IconClose />
                    </button>
                  </>
                )}
                {!own && s?.kind === "exotic" && (
                  <>
                    {exotic?.icon && (
                      <img
                        src={BUNGIE_ORIGIN + exotic.icon}
                        alt=""
                        className="size-full object-cover"
                        draggable={false}
                      />
                    )}
                    {/* Out again: any exotic. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearExotic();
                      }}
                      title={t("opt.unpin")}
                      aria-label={t("opt.unpin")}
                      className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-md bg-black/75 text-white/80 opacity-0 transition-opacity group-hover/pin:opacity-100 hover:bg-[#ff6b5a] hover:text-white focus-visible:opacity-100"
                    >
                      <IconClose />
                    </button>
                  </>
                )}
                {/* A piece of a set goes here: the set's bonus icon. */}
                {!own && s?.kind === "set" && (
                  <span key={`${s.name}-${i}`} className="perk-badge grid place-items-center">
                    {s.icon ? (
                      <img
                        src={BUNGIE_ORIGIN + s.icon}
                        alt=""
                        className="size-8 opacity-90"
                        draggable={false}
                      />
                    ) : (
                      <span
                        className="px-1 text-center text-[9.5px] leading-tight font-semibold"
                        style={{ color: s.tint }}
                      >
                        {s.name}
                      </span>
                    )}
                  </span>
                )}
                {!own && !s && (
                  <span className="text-[18px] leading-none text-white/20">+</span>
                )}
              </div>
            );
            return (
              <div
                key={label}
                className="flex w-14 flex-col items-center gap-1"
              >
                {own ? (
                  // Picked by hand: its stats, archetype, numbers.
                  <PieceHover character={character} piece={own}>
                    {box}
                  </PieceHover>
                ) : s?.kind === "exotic" && exotic ? (
                  // The exotic: what it does, with the exact numbers.
                  <PerkHover
                    perk={{
                      hash: exotic.hash,
                      name: exotic.name,
                      icon: exotic.icon,
                      typeName: t(label),
                      description: "",
                    }}
                    exact={exotic.exact ?? undefined}
                  >
                    {box}
                  </PerkHover>
                ) : (
                  box
                )}
                <span className="w-full truncate text-center text-[9.5px] font-semibold tracking-[0.08em] text-white/40 uppercase">
                  {t(label)}
                </span>
              </div>
            );
          })}
        </div>
        {/* The sets picked: how many pieces (2 / 4), taken out with ×. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {named.map((n, i) => {
            const owned = sets?.find((x) => x.hash === n.hash);
            return (
              <span
                key={n.hash}
                style={{ animationDelay: `${i * 90}ms`, borderColor: n.tint }}
                className="perk-badge flex items-center gap-2 rounded-xl border bg-black/20 py-1 pr-1 pl-2.5 text-[12.5px]"
              >
                <span className="max-w-40 truncate" style={{ color: n.tint }}>
                  {n.set?.name}
                </span>
                <span className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
                  {[2, 4].map((c) => {
                    const ok = !!owned && fitsCount(owned, c);
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={!ok && n.count !== c}
                        aria-pressed={n.count === c}
                        onClick={() => n.count !== c && pick(n.hash, c)}
                        title={!ok && n.count !== c ? t("opt.setNoRoom") : n.set?.perks.find((p) => p.required === c)?.name}
                        className={cx(
                          "rounded-md px-2 py-0.5 text-[11.5px] font-bold tabular-nums transition-colors",
                          n.count === c ? "text-[#05070c]" : "text-white/60 hover:text-white",
                          !ok && n.count !== c && "cursor-not-allowed opacity-35 hover:text-white/60",
                        )}
                        style={n.count === c ? { background: n.tint } : undefined}
                      >
                        {c}×
                      </button>
                    );
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter(([h]) => h !== n.hash))}
                  title={t("opt.setRemove")}
                  aria-label={t("opt.setRemove")}
                  className="grid size-6 place-items-center rounded-md text-white/45 hover:bg-white/[0.08] hover:text-white"
                >
                  <IconClose />
                </button>
              </span>
            );
          })}
          <GlassButton
            size="sm"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="shrink-0"
          >
            {open ? t("opt.setsHide") : value.length === 0 || !full ? t("opt.setsAdd") : t("opt.setsShow")}
          </GlassButton>
        </div>
      </div>

      <div
        className={cx("exotic-grid grid", !open && "is-folded")}
        inert={!open}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          {sets && usable.length > 0 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("opt.setSearch")}
              className="mt-3 w-full max-w-sm rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus:border-(--accent-glow)"
            />
          )}
          {!sets && (
            <p className="pt-3 text-[12px] text-white/40">
              {t("builder.loading")}
            </p>
          )}
          {sets && usable.length === 0 && (
            <p className="pt-3 text-[12px] text-white/45">
              {t("opt.setsEmpty")}
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 pt-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((s, idx) => {
              const on = wanted(s.hash);
              const tint = named.find((n) => n.hash === s.hash)?.tint;
              return (
                <div
                  key={s.hash}
                  style={
                    {
                      "--i": idx,
                      ...(tint ? { borderColor: tint } : {}),
                    } as React.CSSProperties
                  }
                  className={cx(
                    "exotic-tile flex flex-col gap-1.5 rounded-xl border p-2.5",
                    on
                      ? "bg-white/[0.05]"
                      : "border-white/[0.07] bg-white/[0.025]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-[13px] font-semibold"
                      style={tint ? { color: tint } : undefined}
                    >
                      {s.set.name}
                    </span>
                    {/* Which slots it has pieces for: free ones lit, taken
                        ones (exotic, picked by hand) and missing ones dim. */}
                    <span className="flex shrink-0 items-center gap-1" title={t("opt.setSlots", { n: avail(s), of: free })}>
                      {[0, 1, 2, 3, 4].map((i) => {
                        const has = s.inSlots.includes(i);
                        const usableHere = has && !takenFor(i, s.hash);
                        return (
                          <span
                            key={i}
                            title={`${t(SLOT_LABELS[i])}${has ? "" : ` – ${t("opt.setNotOwned")}`}`}
                            className={cx(
                              "h-2 w-3.5 rounded-sm",
                              usableHere ? "" : has ? "bg-white/25" : "border border-white/15",
                            )}
                            style={usableHere ? { background: tint ?? "var(--accent)" } : undefined}
                          />
                        );
                      })}
                    </span>
                  </div>
                  {s.set.perks.map((perk) => {
                    const selected = on === perk.required;
                    const fits = fitsCount(s, perk.required);
                    return (
                      <button
                        key={perk.required}
                        type="button"
                        disabled={!fits && !selected}
                        onClick={() => pick(s.hash, perk.required)}
                        aria-pressed={selected}
                        title={!fits && !selected ? t("opt.setNoRoom") : perk.exact || perk.description}
                        className={cx(
                          "flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-[border-color,background-color,opacity] duration-150",
                          selected
                            ? "bg-black/20"
                            : "border-transparent hover:border-white/15 hover:bg-white/[0.04]",
                          !fits &&
                            !selected &&
                            "cursor-not-allowed opacity-35 hover:border-transparent hover:bg-transparent",
                        )}
                        style={
                          selected && tint ? { borderColor: tint } : undefined
                        }
                      >
                        <span
                          className={cx(
                            "grid size-6 shrink-0 place-items-center rounded-md text-[11.5px] font-bold tabular-nums",
                            !selected && "bg-white/[0.08] text-white/70",
                          )}
                          style={
                            selected && tint
                              ? { background: tint, color: "#05070c" }
                              : undefined
                          }
                        >
                          {perk.required}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[12px] font-medium text-white/90">
                            {perk.name}
                          </span>
                          <span className="line-clamp-2 text-[11px] leading-snug text-white/50">
                            {perk.exact || perk.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A stat's minimum (0–200, steps of 1), as the game's stat bars: ten
 *  points a segment, the minimum in the accent, up to what builds can reach
 *  (`reach`, null while worked out) lighter, past it dark and out of reach
 *  (the minimum can't go there). What the value does in game on hover. */
function StatSlider({
  id,
  label,
  value,
  reach,
  locked,
  onChange,
}: {
  id: StatId;
  label: string;
  value: number;
  reach: number | null;
  /** Its maximum is being worked out anew: no change until it's there. */
  locked: boolean;
  onChange: (v: number) => void;
}) {
  const t = useT();
  const cap = reach ?? 200;
  return (
    <div
      className={cx(
        "py-1.5 transition-opacity duration-150",
        locked && "pointer-events-none opacity-45",
      )}
      aria-busy={locked}
    >
      <StatHover id={id} stat={value} name={label}>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="flex-1 text-[13px] text-white/90">{label}</span>
          <span className="text-[10.5px] text-white/40 tabular-nums">
            {reach === null || locked
              ? t("opt.reachLoading")
              : t("opt.reach", { n: reach })}
          </span>
          <span className="w-8 text-right font-display text-[15px] font-semibold text-white tabular-nums">
            {value}
          </span>
        </div>
      </StatHover>
      <div className="relative h-5">
        {/* The bar: 20 segments of 10. */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 gap-[2px]">
          {Array.from({ length: 20 }, (_, i) => {
            const from = i * 10;
            const filled = Math.min(1, Math.max(0, (value - from) / 10));
            const reachable = from < cap;
            return (
              <span
                key={i}
                className={cx(
                  "relative flex-1 overflow-hidden rounded-[2px] transition-colors",
                  reachable ? "bg-white/[0.14]" : "bg-white/[0.03]",
                  i === 9 && "mr-1",
                )}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-(--accent) shadow-[0_0_6px_var(--accent-glow)]"
                  style={{ width: `${filled * 100}%` }}
                />
              </span>
            );
          })}
        </div>
        <input
          type="range"
          className="stat-slider absolute inset-0 w-full"
          aria-label={label}
          min={0}
          max={200}
          step={1}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(Math.min(Number(e.target.value), cap))}
        />
      </div>
    </div>
  );
}

/** What a build's masterworks cost (optimizer_upgrades). */
interface Cost {
  hash: number;
  name: string;
  icon: string | null;
  count: number;
}
interface Upgrades {
  pieces: {
    id: string;
    level: number;
    max: number;
    legacy: boolean;
    costs: Cost[];
  }[];
  total: Cost[];
}

/** Materials in a row: icon and amount, the name on hover. */
function Costs({ costs, big = false }: { costs: Cost[]; big?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {costs.map((c) => (
        <span
          key={c.hash}
          title={c.name}
          className={cx(
            "flex items-center gap-1 tabular-nums",
            big ? "text-[13px]" : "text-[11.5px] text-white/70",
          )}
        >
          {c.icon && (
            <img
              src={BUNGIE_ORIGIN + c.icon}
              alt=""
              className={cx("rounded-sm", big ? "size-5" : "size-4")}
              draggable={false}
            />
          )}
          {c.count.toLocaleString()}
        </span>
      ))}
    </span>
  );
}

/** A build opened: each piece with where it is, its masterwork level and
 *  what the rest costs, the stat mod it takes; all the costs together. */
function BuildDetail({
  build,
  pieces,
  character,
  onExclude,
}: {
  build: Build;
  pieces: (Choice | undefined)[];
  character: string | null;
  /** Leave this piece out of every build. */
  onExclude: (piece: Choice) => void;
}) {
  const t = useT();
  const [up, setUp] = useState<Upgrades | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUp(null);
    setFailed(false);
    void call<Upgrades>("optimizer_upgrades", {
      characterId: character,
      items: build.items,
    })
      .then((u) => alive && setUp(u ?? null))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [character, build.items.join()]);
  const statName = (i: number) => t(`statfx.name.${BACKEND[i]}`);
  const allDone = up?.pieces.every((p) => p.legacy || p.level >= p.max);
  // The piece whose mods are open (a click on its row).
  const [modsOf, setModsOf] = useState<string | null>(null);
  return (
    <div className="setup-reveal flex flex-col gap-2 border-t border-white/[0.06] pt-3">
      {build.items.map((id, slot) => {
        const p = pieces[slot];
        const u = up?.pieces.find((x) => x.id === id);
        const mod = build.mods.filter((m) => m.slot === slot);
        const open = modsOf === id;
        return (
          <div
            key={id}
            className={cx(
              "flex flex-col rounded-xl border bg-black/20 transition-colors",
              open ? "border-(--accent-glow)" : "border-white/[0.06]",
            )}
          >
            <div
              role="button"
              tabIndex={0}
              aria-expanded={open}
              title={t("opt.pieceModsOpen")}
              onClick={() => setModsOf(open ? null : id)}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                (e.preventDefault(), setModsOf(open ? null : id))
              }
              className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-white/[0.03]"
            >
              <span
                className={cx(
                  "relative size-10 shrink-0 overflow-hidden rounded-lg border bg-black/30",
                  p?.exotic ? "border-[#e8c547]/70" : "border-white/10",
                )}
              >
                {p?.icon && (
                  <img
                    src={BUNGIE_ORIGIN + p.icon}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                )}
                {p?.watermark && (
                  <img
                    src={BUNGIE_ORIGIN + p.watermark}
                    alt=""
                    className="absolute inset-0 size-full"
                    draggable={false}
                  />
                )}
                <TierPips tier={p?.tier} size={40} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cx(
                    "truncate text-[13px] font-medium",
                    p?.exotic && "text-[#f0d66b]",
                  )}
                >
                  {p?.name}
                </span>
                <span className="truncate text-[11px] text-white/45">
                  {t(SLOT_LABELS[slot])} · {p?.location}
                </span>
              </span>
              {p && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExclude(p);
                  }}
                  title={t("opt.exclude")}
                  aria-label={t("opt.exclude")}
                  className="grid size-7 shrink-0 place-items-center rounded-lg text-white/35 hover:bg-white/[0.08] hover:text-[#ff8a7a]"
                >
                  <IconNoExotic />
                </button>
              )}
              {/* Its stat plugs, one a line: the mod, then the tuning or
                  artifice +3 (tagged: the +5 / -5 is the tuning's). */}
              <span className="flex w-48 shrink-0 flex-col gap-0.5 text-[11.5px] text-(--accent-text)">
                {mod.length > 0 ? (
                  [...mod]
                    .sort((a, b) => Number(a.kind === "tuning") - Number(b.kind === "tuning"))
                    .map((m, i) => (
                      <span key={i} className="flex items-center gap-1.5 whitespace-nowrap">
                        {m.kind === "tuning" && (
                          <span className="rounded bg-white/[0.08] px-1 text-[9.5px] font-semibold tracking-wide text-white/55 uppercase">{t("opt.tuningTag")}</span>
                        )}
                        {modLabel(m, statName, t)}
                      </span>
                    ))
                ) : (
                  <span className="text-white/35">{t("opt.noModHere")}</span>
                )}
              </span>
              {/* Masterwork: level, then the rest's cost. */}
              <span className="flex w-56 shrink-0 flex-col items-end gap-1">
                {u ? (
                  u.legacy ? (
                    <span className="text-[11px] text-white/45">
                      {t("opt.legacyPiece")}
                    </span>
                  ) : (
                    u.level < u.max && (
                    // Fully masterworked: nothing shown (nothing left to do).
                    <>
                      <span
                        className="flex items-center gap-1"
                        title={t("opt.mwLevel", { n: u.level, of: u.max })}
                      >
                        {Array.from({ length: u.max }, (_, i) => (
                          <span
                            key={i}
                            className={cx(
                              "h-1.5 w-4 rounded-full",
                              i < u.level ? "bg-[#e8c547]" : "bg-white/10",
                            )}
                          />
                        ))}
                      </span>
                      <Costs costs={u.costs} />
                    </>
                  )
                  )
                ) : (
                  <span className="text-[11px] text-white/35">
                    {failed ? "–" : t("builder.loading")}
                  </span>
                )}
              </span>
            </div>
            {/* Its mods in game: see them, change them (stat mods come from the build when it's saved). */}
            {open && p && (
              <div className="setup-reveal border-t border-white/[0.06] px-3 pb-3">
                <p className="pt-2 text-[11px] text-white/45">
                  {t("opt.pieceModsHint")}
                </p>
                <ArmorMods versions={[p.hash]} instanceId={id} />
              </div>
            )}
          </div>
        );
      })}
      {up && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e8c547]/25 bg-[#e8c547]/[0.06] px-3 py-2">
          <span className="text-[12px] font-medium text-white/80">
            {allDone ? t("opt.mwAllDone") : t("opt.mwTotal")}
          </span>
          {!allDone && <Costs costs={up.total} big />}
        </div>
      )}
    </div>
  );
}

/** What's picked in the optimizer, kept per character on this PC (a tab
 *  switch or a restart goes on from there). */
interface OptimizerDraft {
  /** Pieces picked by hand per slot (null: worked out). */
  pinned?: (Choice | null)[];
  mins: Record<StatId, number>;
  exotic: ExoticPick;
  perks: [number, number];
  subclass: string | null;
  picks: SubclassPicks;
  setupDone: boolean;
  sets: [number, number][];
  /** A saved loadout's subclass setup (socket index -> plug), made into
   *  picks once its sockets are known. */
  overrides?: Record<number, number>;
}

const NO_MINS: Record<StatId, number> = {
  weapons: 0,
  health: 0,
  class: 0,
  grenade: 0,
  super: 0,
  melee: 0,
};
/** `edit`: a saved loadout being edited (its own draft, apart from the new one's). */
const draftKey = (character: string | null, edit?: string | null) =>
  `radar.optimizer.draft.${character ?? ""}${edit ? `.edit.${edit}` : ""}`;

function readDraft(
  character: string | null,
  edit?: string | null,
): OptimizerDraft {
  const empty: OptimizerDraft = {
    mins: NO_MINS,
    exotic: 0,
    perks: [0, 0],
    subclass: null,
    picks: NO_PICKS,
    setupDone: false,
    sets: [],
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(draftKey(character, edit)) ?? "null",
    );
    return saved
      ? { ...empty, ...saved, mins: { ...NO_MINS, ...saved.mins } }
      : empty;
  } catch {
    return empty;
  }
}

/** The armor pieces picked by hand for a saved loadout (this PC): an edit
 *  of it starts with them pinned again. */
const pinnedKey = (character: string | null, loadout: string) =>
  `radar.optimizer.pinned.${character ?? "last"}.${loadout}`;

/** Forget the optimizer's picks for a character (the loadout was saved, as
 *  `savedAs`: its pieces picked by hand are kept for it). */
export function clearOptimizerDraft(
  character: string | null,
  edit?: string | null,
  savedAs?: string | null,
) {
  try {
    const pinned = readDraft(character, edit).pinned;
    if (savedAs) {
      if (pinned?.some(Boolean)) localStorage.setItem(pinnedKey(character, savedAs), JSON.stringify(pinned));
      else localStorage.removeItem(pinnedKey(character, savedAs));
    }
    localStorage.removeItem(draftKey(character, edit));
  } catch {
    // Nothing kept anyway.
  }
}

/** Start editing a saved loadout: the optimizer as it was built (its
 *  exotic, subclass setup, and its stats as the minimums). */
export function seedOptimizerDraft(
  character: string | null,
  edit: string,
  from: {
    exotic: number;
    perks: [number, number];
    stats: number[];
    sets: [number, number][];
    subclass: string | null;
    overrides: Record<number, number> | null;
  },
) {
  const mins = { ...NO_MINS };
  BACKEND.forEach((s, i) => (mins[s] = from.stats[i] ?? 0));
  // Pieces picked by hand: as left in this edit (not saved yet), else as
  // saved with the loadout.
  let pinned: (Choice | null)[] | undefined = readDraft(character, edit).pinned;
  if (!pinned?.some(Boolean)) {
    try {
      pinned = JSON.parse(localStorage.getItem(pinnedKey(character, edit)) ?? "null") ?? undefined;
    } catch {
      pinned = undefined;
    }
  }
  const draft: OptimizerDraft = {
    pinned,
    mins,
    exotic: from.exotic,
    perks: from.perks,
    subclass: from.subclass,
    picks: NO_PICKS,
    setupDone: false,
    sets: from.sets,
    overrides: from.overrides ?? undefined,
  };
  try {
    localStorage.setItem(draftKey(character, edit), JSON.stringify(draft));
  } catch {
    // Not kept; it starts empty.
  }
}

/** The picks the sockets take (each once; aspects and fragments as many
 *  as there are sockets for, fragments as many as the aspects allow). */
function cleanPicks(
  sockets: SubclassSocket[],
  picks: SubclassPicks,
): SubclassPicks {
  const takes = (kind: SubclassSocket["kind"], h: number) =>
    sockets.some((s) => s.kind === kind && s.options.some((o) => o.hash === h));
  const list = (kind: "aspects" | "fragments") =>
    [...new Set(picks[kind])]
      .filter((h) => takes(kind, h))
      .slice(0, sockets.filter((s) => s.kind === kind).length);
  const single: Record<number, number> = {};
  for (const s of sockets) {
    const h = picks.single[s.index];
    if (h && s.options.some((o) => o.hash === h)) single[s.index] = h;
  }
  const next = {
    single,
    aspects: list("aspects"),
    fragments: list("fragments"),
  };
  return {
    ...next,
    fragments: next.fragments.slice(0, fragmentRoom(sockets, next)),
  };
}

/** Socket overrides as picks (the reverse of overridesOf). */
function picksOf(
  sockets: SubclassSocket[],
  overrides: Record<number, number>,
): SubclassPicks {
  const picks: SubclassPicks = { single: {}, aspects: [], fragments: [] };
  for (const s of sockets) {
    const plug = overrides[s.index];
    if (!plug || plug === s.empty || !s.options.some((o) => o.hash === plug))
      continue;
    // (Each once: a saved loadout may have one twice.)
    if (s.kind === "aspects" || s.kind === "fragments") {
      if (!picks[s.kind].includes(plug)) picks[s.kind].push(plug);
    } else picks.single[s.index] = plug;
  }
  return picks;
}

/** A piece left out of every build (kept with the settings). */
interface Excluded {
  id: string;
  name: string;
  icon: string | null;
}

/** What a piece's general mod socket may take. */
type ModCapName = "any" | "minor" | "empty";

/** The optimizer's settings: what's assumed and which armor counts. */
interface OptimizerSettings {
  /** Counted as fully masterworked. */
  mwLegendary: boolean;
  mwExotic: boolean;
  /** Only pieces masterworked already. */
  onlyMwLegendary: boolean;
  onlyMwExotic: boolean;
  /** Stat mods fill what's missing; each piece's socket: any, +5 at most, none. */
  mods: boolean;
  modCaps: ModCapName[];
  /** Older Armor 2.0 pieces, and common to rare ones. */
  legacyLegendary: boolean;
  legacyExotic: boolean;
  lowerTiers: boolean;
  /** Armor 2.0 counted as artifice (+3): legendary class items, every
   *  legendary piece, exotics; tier 5 pieces' tuning counted on. */
  artificeClass: boolean;
  artificeLegendary: boolean;
  artificeExotic: boolean;
  tuning: boolean;
  /** How many builds to show. */
  limit: number;
  /** Pieces left out. */
  excluded: Excluded[];
}

const DEFAULT_SETTINGS: OptimizerSettings = {
  mwLegendary: true,
  mwExotic: true,
  onlyMwLegendary: false,
  onlyMwExotic: false,
  mods: true,
  modCaps: ["any", "any", "any", "any", "any"],
  legacyLegendary: true,
  legacyExotic: true,
  lowerTiers: true,
  artificeClass: false,
  artificeLegendary: false,
  artificeExotic: false,
  tuning: true,
  limit: 30,
  excluded: [],
};

/** Builds shown: the best 30 (more cost time to find and to draw). */
const MAX_BUILDS = 30;

const SETTINGS_KEY = "radar.optimizer.settings";

/** The settings as last used (this PC; the defaults where none). */
function savedSettings(): OptimizerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The settings window: grouped switches, the number of builds shown, and
 *  a reset. Over the app (Esc or a click beside it closes it). */
function SettingsWindow({
  value,
  onChange,
  onClose,
}: {
  value: OptimizerSettings;
  onChange: (v: OptimizerSettings) => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const set = <K extends keyof OptimizerSettings>(
    k: K,
    v: OptimizerSettings[K],
  ) => onChange({ ...value, [k]: v });
  const group = (title: string, children: React.ReactNode) => (
    <section className="flex flex-col">
      <h3 className="mb-0.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[150] grid place-items-center bg-black/55 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("opt.settings")}
        className="w-full max-w-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GlassPanel className="settings-in flex max-h-[calc(100vh-48px)] flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl border border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)">
              <IconSettings />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[15px] font-semibold">
                {t("opt.settings")}
              </h2>
              <p className="text-[12px] text-white/50">
                {t("opt.settingsHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("builder.cancel")}
              className="grid size-8 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
            >
              <IconClose />
            </button>
          </div>
          {group(
            t("opt.groupMasterwork"),
            <>
              <GlassSwitch
                checked={value.mwLegendary}
                onChange={(v) => set("mwLegendary", v)}
                label={t("opt.mwLegendary")}
                description={t("opt.mwLegendaryHint")}
              />
              <GlassSwitch
                checked={value.mwExotic}
                onChange={(v) => set("mwExotic", v)}
                label={t("opt.mwExotic")}
                description={t("opt.mwExoticHint")}
              />
              <GlassSwitch
                checked={value.onlyMwLegendary}
                onChange={(v) => set("onlyMwLegendary", v)}
                label={t("opt.onlyMwLegendary")}
                description={t("opt.onlyMwHint")}
              />
              <GlassSwitch
                checked={value.onlyMwExotic}
                onChange={(v) => set("onlyMwExotic", v)}
                label={t("opt.onlyMwExotic")}
                description={t("opt.onlyMwHint")}
              />
            </>,
          )}
          {group(
            t("opt.groupArmor"),
            <>
              <GlassSwitch
                checked={value.legacyLegendary}
                onChange={(v) => set("legacyLegendary", v)}
                label={t("opt.legacyLegendary")}
                description={t("opt.legacyHint")}
              />
              <GlassSwitch
                checked={value.legacyExotic}
                onChange={(v) => set("legacyExotic", v)}
                label={t("opt.legacyExotic")}
                description={t("opt.legacyHint")}
              />
              <GlassSwitch
                checked={value.lowerTiers}
                onChange={(v) => set("lowerTiers", v)}
                label={t("opt.lowerTiers")}
                description={t("opt.lowerTiersHint")}
              />
            </>,
          )}
          {group(
            t("opt.groupMods"),
            <>
              <GlassSwitch
                checked={value.mods}
                onChange={(v) => set("mods", v)}
                label={t("opt.mods")}
                description={t("opt.modsHint")}
              />
              {/* Per piece: which stat mod its socket may take. */}
              <div
                className={cx(
                  "mt-1 flex flex-col gap-1.5 transition-opacity",
                  !value.mods && "pointer-events-none opacity-40",
                )}
              >
                {SLOT_LABELS.map((label, i) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="flex-1 text-[12.5px] text-white/75">
                      {t(label)}
                    </span>
                    <div className="flex rounded-lg border border-white/10 bg-black/25 p-0.5">
                      {(["any", "minor", "empty"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={value.modCaps[i] === c}
                          onClick={() =>
                            set(
                              "modCaps",
                              value.modCaps.map((x, k) => (k === i ? c : x)),
                            )
                          }
                          className={cx(
                            "rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
                            value.modCaps[i] === c
                              ? "bg-(--accent-soft) text-white"
                              : "text-white/55 hover:text-white",
                          )}
                        >
                          {t(
                            c === "any"
                              ? "opt.capAny"
                              : c === "minor"
                                ? "opt.capMinor"
                                : "opt.capNone",
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>,
          )}
          {group(
            t("opt.groupExtras"),
            <div
              className={cx(
                "flex flex-col transition-opacity",
                !value.mods && "pointer-events-none opacity-40",
              )}
            >
              <GlassSwitch
                checked={value.tuning}
                onChange={(v) => set("tuning", v)}
                label={t("opt.tuning")}
                description={t("opt.tuningHint")}
              />
              <GlassSwitch
                checked={value.artificeClass}
                onChange={(v) => set("artificeClass", v)}
                label={t("opt.artificeClass")}
                description={t("opt.artificeHint")}
              />
              <GlassSwitch
                checked={value.artificeLegendary}
                onChange={(v) => set("artificeLegendary", v)}
                label={t("opt.artificeLegendary")}
                description={t("opt.artificeHint")}
              />
              <GlassSwitch
                checked={value.artificeExotic}
                onChange={(v) => set("artificeExotic", v)}
                label={t("opt.artificeExotic")}
                description={t("opt.artificeHint")}
              />
            </div>,
          )}
          {group(
            t("opt.groupExcluded"),
            value.excluded.length === 0 ? (
              <p className="py-1 text-[12px] text-white/45">
                {t("opt.excludedNone")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 py-1">
                {value.excluded.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() =>
                      set(
                        "excluded",
                        value.excluded.filter((e) => e.id !== x.id),
                      )
                    }
                    title={t("opt.excludedBack")}
                    className="group flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 py-1 pr-2.5 pl-1 text-[12px] text-white/75 hover:border-(--accent-glow) hover:text-white"
                  >
                    <span className="size-6 overflow-hidden rounded-md bg-black/40">
                      {x.icon && (
                        <img
                          src={BUNGIE_ORIGIN + x.icon}
                          alt=""
                          className="size-full object-cover"
                          draggable={false}
                        />
                      )}
                    </span>
                    {x.name}
                    <span className="text-white/35 group-hover:text-white">
                      <IconClose />
                    </span>
                  </button>
                ))}
              </div>
            ),
          )}
          <div className="flex justify-between gap-2 border-t border-white/[0.06] pt-4">
            <GlassButton
              variant="danger"
              size="sm"
              onClick={() => onChange(DEFAULT_SETTINGS)}
            >
              <IconRefresh /> {t("opt.reset")}
            </GlassButton>
            <GlassButton variant="primary" onClick={onClose}>
              {t("opt.done")}
            </GlassButton>
          </div>
        </GlassPanel>
      </div>
    </div>,
    document.body,
  );
}

/** An exotic class item's perks as the player's copies have them. */
interface ClassItemPerkList {
  columns: [ItemInfo[], ItemInfo[]];
  /** The pairs owned (perk hashes). */
  combos: [number, number][];
}

/** The two perks of an exotic class item: one per column ("any" first).
 *  A perk no owned copy pairs with the other column's pick is greyed out.
 *  Folded (its chips vanishing first) once both are picked; `only` shows
 *  just one column again, with the perks that go with the other pick. */
function ClassItemPerks({
  list,
  error,
  value,
  onChange,
  folded,
  only,
}: {
  list: ClassItemPerkList | null;
  error: string | null;
  value: [number, number];
  /** `from`: the chip clicked (a picked perk flies from there). */
  onChange: (v: [number, number], from?: HTMLElement) => void;
  folded: boolean;
  only: 0 | 1 | null;
}) {
  const t = useT();
  // While folding, the lists stay as they were (one column stays one
  // column): only an open view follows `only`.
  const lastOnly = useRef(only);
  if (!folded) lastOnly.current = only;
  only = folded ? lastOnly.current : only;
  // Whether a perk in column `col` goes with the other column's pick.
  const fits = (col: 0 | 1, perk: number) => {
    const other = value[col === 0 ? 1 : 0];
    return (
      !list ||
      list.combos.some(
        (c) =>
          c[col] === perk && (other === 0 || c[col === 0 ? 1 : 0] === other),
      )
    );
  };
  const set = (col: 0 | 1, perk: number, from?: HTMLElement) =>
    onChange(col === 0 ? [perk, value[1]] : [value[0], perk], from);

  const chip = (selected: boolean, enabled: boolean) =>
    cx(
      "exotic-tile flex min-w-0 items-center gap-2 rounded-xl border py-1 pr-3 pl-1 text-left text-[12.5px]",
      selected
        ? "border-(--accent) bg-(--accent-soft) text-white"
        : "border-white/10 bg-white/[0.03] text-white/80 hover:border-[#e8c547]/60 hover:bg-white/[0.06]",
      !enabled &&
        "cursor-not-allowed opacity-35 hover:border-white/10 hover:bg-white/[0.03]",
    );
  // Each chip's place, for the vanishing ripple.
  let order = 0;
  const at = () => ({ "--i": order++ }) as React.CSSProperties;

  return (
    <div
      className={cx("exotic-grid grid", folded && "is-folded")}
      inert={folded}
    >
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          {error && <p className="text-[12px] text-red-200">{error}</p>}
          {!list && !error && (
            <p className="text-[12px] text-white/40">{t("builder.loading")}</p>
          )}
          {list && list.combos.length === 0 && (
            <p className="text-[12px] text-white/45">{t("opt.perksNone")}</p>
          )}
          {list && list.combos.length > 0 && (
            <div className={cx("grid gap-4", only === null && "grid-cols-2")}>
              {(only === null ? ([0, 1] as const) : [only]).map((col) => (
                <div key={col} className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
                    {t(col === 0 ? "opt.perk1" : "opt.perk2")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => set(col, 0)}
                      aria-pressed={value[col] === 0}
                      style={at()}
                      className={chip(value[col] === 0, true)}
                    >
                      <span className="grid size-7 place-items-center rounded-lg bg-black/30 text-white/50">
                        <IconAnyExotic />
                      </span>
                      {t("opt.exoticAny")}
                    </button>
                    {list.columns[col].map((perk) => {
                      const enabled = fits(col, perk.hash);
                      // One column again: only what goes with the other pick.
                      if (only !== null && !enabled) return null;
                      return (
                        <button
                          key={perk.hash}
                          type="button"
                          disabled={!enabled}
                          // (One column again: the same perk keeps it.)
                          onClick={(ev) =>
                            set(
                              col,
                              value[col] === perk.hash && only === null
                                ? 0
                                : perk.hash,
                              ev.currentTarget,
                            )
                          }
                          aria-pressed={value[col] === perk.hash}
                          title={perk.description || perk.name}
                          style={at()}
                          className={chip(value[col] === perk.hash, enabled)}
                        >
                          <span className="size-7 shrink-0 overflow-hidden rounded-lg bg-black/40">
                            {perk.icon && (
                              <img
                                src={BUNGIE_ORIGIN + perk.icon}
                                alt=""
                                className="size-full"
                                draggable={false}
                              />
                            )}
                          </span>
                          <span className="truncate">{perk.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The two perks picked, in the exotic's header, one place each; a click
 *  on one empties it and opens its column again. A perk picked flies into
 *  its place from the chip it was picked on (`from`: perk hash -> where
 *  that chip was). */
function PerkBadges({
  perks,
  from,
  onOpen,
}: {
  perks: (ItemInfo | null)[];
  from: React.RefObject<Map<number, DOMRect>>;
  onOpen: (column: 0 | 1) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {perks.map((perk, i) =>
        perk ? (
          <PerkBadge
            key={perk.hash}
            perk={perk}
            from={from}
            delay={i * 90}
            onOpen={() => onOpen(i === 0 ? 0 : 1)}
          />
        ) : (
          <span
            key={`empty-${i}`}
            aria-hidden
            className="perk-slot-empty h-9 w-36 rounded-xl border border-dashed border-(--accent-glow) bg-white/[0.02]"
          />
        ),
      )}
    </div>
  );
}

function PerkBadge({
  perk,
  from,
  delay,
  onOpen,
}: {
  perk: ItemInfo;
  from: React.RefObject<Map<number, DOMRect>>;
  delay: number;
  onOpen: () => void;
}) {
  const t = useT();
  const el = useRef<HTMLButtonElement>(null);
  // Picked on a chip: from there into this place (it's laid out here
  // already; it starts where the chip was and moves home).
  const [flies] = useState(() => from.current?.has(perk.hash) ?? false);
  useLayoutEffect(() => {
    const start = from.current?.get(perk.hash);
    const node = el.current;
    if (!start || !node) return;
    from.current?.delete(perk.hash);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = node.getBoundingClientRect();
    const dx = start.left - end.left;
    const dy = start.top - end.top;
    const lift = Math.min(70, 24 + Math.abs(dy) * 0.15);
    node.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          boxShadow: "0 0 0 0 transparent",
        },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.06)`,
          boxShadow: "0 0 18px var(--accent-glow)",
          offset: 0.5,
        },
        { transform: "none", boxShadow: "0 0 0 0 transparent" },
      ],
      {
        duration: 560,
        delay,
        easing: "cubic-bezier(0.45, 0.05, 0.25, 1)",
        fill: "backwards",
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button
      ref={el}
      type="button"
      onClick={onOpen}
      title={(perk.description || perk.name) + " – " + t("opt.changePerk")}
      className={cx(
        "relative z-10 flex items-center gap-2 rounded-xl border border-(--accent-glow) bg-(--accent-soft) py-1 pr-3 pl-1 text-[12.5px] text-white transition-colors hover:border-(--accent)",
        !flies && "perk-badge",
      )}
    >
      <span className="size-7 shrink-0 overflow-hidden rounded-lg bg-black/40">
        {perk.icon && (
          <img
            src={BUNGIE_ORIGIN + perk.icon}
            alt=""
            className="size-full"
            draggable={false}
          />
        )}
      </span>
      {perk.name}
    </button>
  );
}

const IconAnyExotic = () => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M12 3 4 7v6c0 4 3.5 7 8 8 4.5-1 8-4 8-8V7l-8-4Z" />
  </svg>
);

const IconNoExotic = () => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="8" />
    <path d="m6.5 17.5 11-11" />
  </svg>
);

/**
 * The armor optimizer (optimizer.rs): minimums per stat, an exotic, and the
 * best builds of the character's armor. A build taken fills the builder's
 * armor slots (`onTake`, in slot order) with its stat mods.
 */
export function ArmorOptimizer({
  character,
  edit = null,
  own,
  artifact,
  artifactPerks = null,
  onTake,
}: {
  character: string | null;
  /** A loadout's own armor (instance ids): its build first, the others folded. */
  own?: string[];
  /** The artifact picker, under the loadout's own build. */
  artifact?: React.ReactNode;
  /** The artifact perks picked (for the damage resist). */
  artifactPerks?: number[] | null;
  /** A saved loadout being edited (its id): its own draft. */
  edit?: string | null;
  /** `subclass`: the one picked (null: keep the slot as it is), with its
   *  super, abilities, aspects and fragments (socket index -> plug). */
  onTake: (
    pieces: Choice[],
    mods: Record<number, number[]>,
    subclass: Choice | null,
    subclassPlugs: Record<number, number> | null,
  ) => void;
}) {
  const t = useT();
  // The items fetched anew (hourly, on focus, reload): lists and builds again.
  const inv = useInventoryVersion();
  // The character's subclasses, and the one the loadout puts on.
  const [subclasses, setSubclasses] = useState<Choice[] | null>(null);
  // What's picked: as kept for the character (see OptimizerDraft).
  const [first] = useState(() => readDraft(character, edit));
  // A saved loadout's subclass setup, made into picks once its sockets are there.
  const pendingOverrides = useRef(first.overrides ?? null);
  const [subclass, setSubclass] = useState<string | null>(first.subclass);
  useEffect(() => setSubclasses(null), [character]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    let alive = true;
    void presets
      .candidates(character, SUBCLASS_BUCKET)
      .then((list) => alive && setSubclasses(list))
      .catch(() => alive && setSubclasses([]));
    return () => {
      alive = false;
    };
  }, [character, inv]);
  const [mins, setMins] = useState<Record<StatId, number>>(first.mins);
  const [exotic, setExotic] = useState<ExoticPick>(first.exotic);
  // An exotic class item's two perks (0: any): a new exotic starts without.
  const [perks, setPerks] = useState<[number, number]>(first.perks);
  const pickExotic = (v: ExoticPick) => {
    setExotic(v);
    setPerks([0, 0]);
  };
  // The picked subclass's sockets, and what's picked for them (as the
  // subclass has it now, to start with).
  const [setup, setSetup] = useState<SubclassSocket[] | null>(null);
  const [setupPicks, setSetupPicks] = useState<SubclassPicks>(first.picks);
  // Every subclass's sockets, loaded as soon as the subclasses are there:
  // picking one shows its options at once.
  const setups = useRef(
    new Map<string, Promise<SubclassSocket[] | undefined>>(),
  );
  const load = (id: string) => {
    let p = setups.current.get(id);
    if (!p) {
      p = call<SubclassSocket[]>("optimizer_subclass", {
        characterId: character,
        instanceId: id,
      });
      p.catch(() => setups.current.delete(id));
      setups.current.set(id, p);
    }
    return p;
  };
  const [ready, setReady] = useState<Record<string, SubclassSocket[]>>({});
  // (Only for other subclasses: the same ones fetched anew keep theirs.)
  const subclassIds = subclasses?.map((c) => c.id).join() ?? "";
  useEffect(() => {
    setups.current = new Map();
    setReady({});
    if (!isTauri || !subclasses) return;
    let alive = true;
    for (const c of subclasses) {
      void load(c.id)
        .then(
          (sockets) =>
            alive && sockets && setReady((r) => ({ ...r, [c.id]: sockets })),
        )
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subclassIds]);
  useEffect(() => {
    if (!subclass || !isTauri) {
      setSetup(null);
      return;
    }
    const known = ready[subclass];
    setSetup(known ?? null);
    if (known) return;
    let alive = true;
    void load(subclass)
      .then((sockets) => alive && sockets && setSetup(sockets))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
    // (Not on `ready`: the picks would start over.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character, subclass]);
  // A saved loadout's setup: its picks, folded into the row by the subclass.
  useEffect(() => {
    const overrides = pendingOverrides.current;
    if (!setup) return;
    if (!overrides) {
      // Only what the sockets take now (a pick kept from before may not be).
      setSetupPicks((p) => {
        const clean = cleanPicks(setup, p);
        return JSON.stringify(clean) === JSON.stringify(p) ? p : clean;
      });
      return;
    }
    pendingOverrides.current = null;
    setSetupPicks(cleanPicks(setup, picksOf(setup, overrides)));
    setSetupDone(true);
  }, [setup]);
  const bonus =
    setup && setupPicks ? bonusOf(setup, setupPicks) : [0, 0, 0, 0, 0, 0];
  // "Done": the setup folds away, its picks in a row by the subclass (each
  // flying there from where it sat: `setupFrom`).
  const [setupDone, setSetupDone] = useState(first.setupDone);
  const setupFrom = useRef(new Map<number, DOMRect>());
  // Another subclass: its setup starts empty and open.
  const pickSubclass = (v: string | null) => {
    pendingOverrides.current = null;
    setSubclass(v);
    setSetupPicks(NO_PICKS);
    setSetupDone(false);
  };
  const setupPlugs = (() => {
    if (!setup || !setupPicks) return [];
    const byHash = new Map(
      setup.flatMap((s) => s.options.map((o) => [o.hash, o] as const)),
    );
    const single = setup
      .filter((s) => s.kind === "super" || s.kind === "abilities")
      .map((s) => setupPicks.single[s.index]);
    return [...single, ...setupPicks.aspects, ...setupPicks.fragments]
      .map((h) => byHash.get(h))
      .filter((p): p is SubclassPlug => !!p);
  })();
  // Assumptions: pieces counted as fully masterworked (legendary / exotic).
  // The settings (remembered on this PC), and their window.
  const [settings, setSettingsState] =
    useState<OptimizerSettings>(savedSettings);
  const setSettings = (v: OptimizerSettings) => {
    setSettingsState(v);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(v));
    } catch {
      // Not kept for next time; fine.
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mods = settings.mods;
  const [result, setResult] = useState<Result | null>(null);
  // The character's armor sets, and those wanted ([set hash, pieces]).
  const [sets, setSets] = useState<OwnedSet[] | null>(null);
  const [wantedSets, setWantedSets] = useState<[number, number][]>(first.sets);
  // Pieces picked by hand per slot, and the slot whose pieces are open.
  const [pinned, setPinned] = useState<(Choice | null)[]>(
    () => first.pinned ?? [null, null, null, null, null],
  );
  const [pinSlot, setPinSlot] = useState<number | null>(null);
  const pin = (slot: number, piece: Choice | null) =>
    setPinned((all) => all.map((p, i) => (i === slot ? piece : p)));
  // An exotic picked by hand is the build's exotic (any other one picked by
  // hand goes); a legendary one in the exotic's slot leaves it open (any).
  const pinPiece = (slot: number, piece: Choice | null) => {
    // One exotic per build: another exotic picked by hand goes.
    if (piece?.exotic)
      setPinned((all) =>
        all.map((p, i) => (i === slot ? piece : p?.exotic ? null : p)),
      );
    else pin(slot, piece);
    if (piece?.exotic) {
      const e = exotics?.find((x) => x.name === piece.name);
      if (e && e.hash !== exotic) pickExotic(e.hash);
      // An exotic class item: its two spirits as the perks asked for.
      if (piece.perkHashes?.length === 2)
        setPerks([piece.perkHashes[0], piece.perkHashes[1]]);
    } else if (
      piece &&
      exotics?.find((x) => x.hash === exotic)?.slot === slot
    ) {
      pickExotic(0);
    }
  };
  // An exotic picked in the exotic picker: pieces picked by hand that don't
  // fit it go (another exotic; whatever is in the new exotic's slot).
  const chooseExotic = (v: ExoticPick) => {
    pickExotic(v);
    // (Any exotic: what's picked by hand stays.)
    if (v === 0) return;
    const e = v > 0 ? exotics?.find((x) => x.hash === v) : undefined;
    setPinned((all) =>
      all.map((p, i) => {
        if (!p) return p;
        if (p.exotic && p.name !== e?.name) return null;
        if (e && i === e.slot && p.name !== e.name) return null;
        return p;
      }),
    );
  };
  useEffect(() => setSets(null), [character]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    void call<OwnedSet[]>("optimizer_sets", { characterId: character })
      .then((list) => alive && setSets(list ?? []))
      .catch(() => alive && setSets([]));
    return () => {
      alive = false;
    };
  }, [character, inv]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The character's armor by instance id (icons, names; the exotics to pick).
  const [owned, setOwned] = useState<Map<string, Choice> | null>(null);

  useEffect(() => setOwned(null), [character]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    let alive = true;
    void Promise.all(ARMOR_BUCKETS.map((b) => presets.candidates(character, b)))
      .then(
        (lists) =>
          alive && setOwned(new Map(lists.flat().map((c) => [c.id, c]))),
      )
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [character, inv]);

  // A piece picked by hand that's gone (dismantled; kept from a saved
  // loadout) is let go: with it no build could be found.
  useEffect(() => {
    if (!owned) return;
    if (pinned.some((p) => p && !owned.has(p.id)))
      setPinned((all) => all.map((p) => (p && !owned.has(p.id) ? null : p)));
  }, [owned, pinned]);
  // The class's exotics (owned or not), for the picker.
  const [exotics, setExotics] = useState<Exotic[] | null>(null);
  // More than one exotic picked by hand (kept from before): only the
  // build's exotic stays (else the first).
  useEffect(() => {
    const exoticAt = pinned
      .map((p, i) => (p?.exotic ? i : -1))
      .filter((i) => i >= 0);
    if (exoticAt.length < 2) return;
    const picked = exotics?.find((x) => x.hash === exotic)?.name;
    const keep =
      exoticAt.find((i) => pinned[i]!.name === picked) ?? exoticAt[0];
    setPinned((all) => all.map((p, i) => (p?.exotic && i !== keep ? null : p)));
  }, [pinned, exotic, exotics]);
  // Another character: another class, other armor.
  useEffect(() => {
    setExotics(null);
    setResult(null);
  }, [character]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    let alive = true;
    if (isTauri)
      void call<Exotic[]>("optimizer_exotics", { characterId: character })
        .then((list) => alive && setExotics(list ?? []))
        .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [character, inv]);

  // An exotic class item picked: its perks (as the player's copies have
  // them); the lists fold away once both are picked.
  const classItem = exotics?.find((e) => e.hash === exotic)?.slot === 4;
  const [perkList, setPerkList] = useState<ClassItemPerkList | null>(null);
  const [perkError, setPerkError] = useState<string | null>(null);
  useEffect(() => {
    setPerkList(null);
    setPerkError(null);
    if (!classItem || !isTauri) return;
    let alive = true;
    void call<ClassItemPerkList>("optimizer_exotic_perks", {
      characterId: character,
      hash: exotic,
    })
      .then((l) => alive && setPerkList(l ?? { columns: [[], []], combos: [] }))
      .catch((e) => alive && setPerkError(String(e)));
    return () => {
      alive = false;
    };
  }, [character, exotic, classItem]);
  const [perksFolded, setPerksFolded] = useState(false);
  // A badge clicked: just its column open again, its place empty until
  // another perk is picked (`editFrom`: the one it had).
  const [editingPerk, setEditingPerk] = useState<0 | 1 | null>(null);
  const [editFrom, setEditFrom] = useState(0);
  // Where each picked perk's chip was (it flies from there to its place).
  const perkFrom = useRef(new Map<number, DOMRect>());
  const pickPerks = (v: [number, number], from?: HTMLElement) => {
    const added = v.find((h, i) => h !== 0 && h !== perks[i]);
    if (from)
      perkFrom.current.set(
        added ?? v[editingPerk ?? 0],
        from.getBoundingClientRect(),
      );
    if (editingPerk !== null && v[0] === perks[0] && v[1] === perks[1]) {
      // The same perk again: back into its place.
      setPerksFolded(true);
      setEditingPerk(null);
      return;
    }
    setPerks(v);
  };
  const bothPicked = perks[0] !== 0 && perks[1] !== 0;
  useEffect(() => {
    if (!bothPicked) {
      setPerksFolded(false);
      setEditingPerk(null);
      return;
    }
    const id = window.setTimeout(() => {
      setPerksFolded(true);
      setEditingPerk(null);
    }, 350);
    return () => window.clearTimeout(id);
  }, [bothPicked, perks[0], perks[1]]);
  const picked = perkList
    ? perks
        .map((h, i) => perkList.columns[i].find((p) => p.hash === h))
        .filter((p): p is ItemInfo => !!p)
    : [];

  // Another character: its own picks as kept (or none). `draftOf`: whose
  // the picks on screen are, so they're never kept under another one.
  const [draftOf, setDraftOf] = useState(character);
  useEffect(() => {
    if (character === draftOf) return;
    const d = readDraft(character, edit);
    pendingOverrides.current = d.overrides ?? null;
    setMins(d.mins);
    setExotic(d.exotic);
    setPerks(d.perks);
    setSubclass(d.subclass);
    setSetupPicks(d.picks);
    setSetupDone(d.setupDone);
    setWantedSets(d.sets);
    setPinned(d.pinned ?? [null, null, null, null, null]);
    setPinSlot(null);
    setDraftOf(character);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);
  // Kept as soon as anything changes.
  useEffect(() => {
    if (draftOf !== character) return;
    const draft: OptimizerDraft = {
      mins,
      exotic,
      perks,
      subclass,
      picks: setupPicks,
      setupDone,
      sets: wantedSets,
      overrides: pendingOverrides.current ?? undefined,
      pinned,
    };
    try {
      localStorage.setItem(draftKey(character, edit), JSON.stringify(draft));
    } catch {
      // Not kept; fine.
    }
  }, [
    character,
    draftOf,
    mins,
    exotic,
    perks,
    subclass,
    setupPicks,
    setupDone,
    wantedSets,
    pinned,
  ]);

  // What's asked, for the search and for the limits.
  const request = {
    mins: BACKEND.map((s) => mins[s]),
    exotic,
    masterworkLegendary: settings.mwLegendary,
    masterworkExotic: settings.mwExotic,
    onlyMasterworkedLegendary: settings.onlyMwLegendary,
    onlyMasterworkedExotic: settings.onlyMwExotic,
    legacyLegendary: settings.legacyLegendary,
    legacyExotic: settings.legacyExotic,
    lowerTiers: settings.lowerTiers,
    artificeClass: settings.artificeClass,
    artificeLegendary: settings.artificeLegendary,
    artificeExotic: settings.artificeExotic,
    tuning: settings.tuning,
    mods,
    modCaps: settings.modCaps,
    limit: MAX_BUILDS,
    perks,
    bonus,
    sets: wantedSets,
    pinned: pinned.map((p) => p?.id ?? ""),
    excluded: settings.excluded.map((x) => x.id),
    own: own ?? [],
  };
  const requestKey = JSON.stringify(request);
  // The most each stat can reach with the others at their minimums (backend
  // order), worked out anew shortly after anything changes; null while it is.
  // The last ones stay while new ones are worked out: a stat's own
  // maximum doesn't depend on its own minimum, so dragging it stays capped
  // right. (Another character: none until its own come.)
  const [limits, setLimits] = useState<number[] | null>(null);
  // What the maxima on screen were worked out for: another ask than now
  // means they're outdated (the other stats lock until they're fresh).
  const [limitsFor, setLimitsFor] = useState<string | null>(null);
  useEffect(() => setLimits(null), [character]);
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const asked = requestKey;
    const id = window.setTimeout(() => {
      void call<number[]>("optimizer_limits", {
        characterId: character,
        request: JSON.parse(asked),
      })
        .then((l) => {
          if (!alive) return;
          setLimits(l ?? null);
          setLimitsFor(asked);
        })
        .catch(() => {});
    }, 120);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [character, requestKey]);
  // Outdated maxima, and whether a stat bar did it (else, e.g. another
  // exotic or set, every bar waits).
  const limitsStale = !!limits && limitsFor !== requestKey;
  const fromSlider =
    !!limitsFor &&
    (JSON.parse(limitsFor).mins as number[]).join() !==
      BACKEND.map((x) => mins[x]).join();
  // The stat changed last (dragging it stays free while the others wait).
  const lastStat = useRef<StatId | null>(null);
  // Fresh maxima: every stat above its maximum is pulled back to it, so
  // there's always a build. After the armor changed (exotic, a piece picked,
  // sets, subclass …), a stat that was at its maximum follows it, up too.
  const lastLimits = useRef<{ armor: string; limits: number[] } | null>(null);
  useEffect(() => {
    if (!limits || !limitsFor || limitsFor !== requestKey) return;
    // No build at all (nothing fits): the minimums stay as they are.
    if (limits.every((l) => l <= 0)) return;
    const armor = JSON.stringify({ ...JSON.parse(limitsFor), mins: null });
    const before = lastLimits.current;
    lastLimits.current = { armor, limits };
    const armorChanged = !!before && before.armor !== armor;
    setMins((m) => {
      let next = m;
      for (const s of STAT_ORDER) {
        const i = BACKEND.indexOf(s);
        const most = Math.max(0, limits[i]);
        const wasMax = armorChanged && m[s] > 0 && m[s] >= before!.limits[i];
        if (m[s] > most || (wasMax && m[s] !== most)) next = { ...next, [s]: most };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits, limitsFor]);

  // The builds, worked out anew shortly after anything changes (no
  // button); an answer for an older ask is dropped.
  const runSeq = useRef(0);
  // What the builds on screen were asked for: the same again (the items
  // fetched anew) is worked out quietly, the list not dimmed meanwhile.
  const ranFor = useRef("");
  useEffect(() => {
    if (!isTauri) return;
    const seq = ++runSeq.current;
    const quiet = ranFor.current === `${character}|${requestKey}`;
    ranFor.current = `${character}|${requestKey}`;
    const id = window.setTimeout(() => {
      if (!quiet) setRunning(true);
      setError(null);
      void call<Result>("optimize_armor", {
        characterId: character,
        request: JSON.parse(requestKey),
      })
        .then((r) => seq === runSeq.current && setResult(r ?? null))
        .catch((e) => seq === runSeq.current && setError(String(e)))
        .finally(() => seq === runSeq.current && setRunning(false));
    }, 350);
    return () => window.clearTimeout(id);
  }, [character, requestKey, inv]);
  // The build opened (its pieces, masterworks and costs).
  const [opened, setOpened] = useState<string | null>(null);
  // Editing: the other builds folded away until asked for.
  const [showOthers, setShowOthers] = useState(!own);
  const ownKey = result?.own?.items.join() ?? null;
  const others = (result?.builds ?? []).filter(
    (b) => b.items.join() !== ownKey,
  );

  // Everything in the build that may resist damage, with its exact text
  // (Clarity, else the Compendium, else Bungie's).
  const exoticPerkTexts = useClarityItems(exotic > 0 ? [exotic] : []);
  const drClarity = useClarity([
    ...setupPlugs.map((p) => p.hash),
    ...perks.filter(Boolean),
  ]);
  const [artifacts, setArtifacts] = useState<ArtifactOption[] | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    void loadArtifacts().then((l) => alive && setArtifacts(l ?? []));
    return () => {
      alive = false;
    };
  }, []);
  const resistSources: ResistSource[] = [
    ...setupPlugs.map((p) => ({
      key: `plug-${p.hash}`,
      name: p.name,
      icon: p.icon,
      kind: p.typeName,
      text: p.exact || clarityPlain(drClarity.get(p.hash)) || p.description,
    })),
    // The exotic: the Compendium's text (all its numbers), else Clarity's perks.
    ...(() => {
      const e = exotics?.find((x) => x.hash === exotic);
      if (e?.exact)
        return [
          {
            key: `exotic-${exotic}`,
            name: e.name,
            icon: e.icon,
            kind: t("dr.exotic"),
            text: e.exact,
          },
        ];
      return (exoticPerkTexts.get(exotic) ?? []).map((p, i) => ({
        key: `exotic-${exotic}-${i}`,
        name: p.name,
        icon: e?.icon ?? null,
        kind: e?.name ?? t("dr.exotic"),
        text: clarityPlain(p.text),
      }));
    })(),
    ...perks
      .filter(Boolean)
      .map((h) => ({
        key: `spirit-${h}`,
        name: t("dr.spirit"),
        icon: null,
        kind: t("dr.classItem"),
        text: clarityPlain(drClarity.get(h)),
      })),
    ...wantedSets.flatMap(([hash, n]) => {
      const set = sets?.find((x) => x.hash === hash)?.set;
      return (set?.perks ?? [])
        .filter((p) => p.required <= n)
        .map((p) => ({
          key: `set-${hash}-${p.required}`,
          name: p.name,
          icon: p.icon,
          kind: `${set!.name} · ${p.required}`,
          text: p.exact || p.description,
        }));
    }),
    ...(artifactPerks ?? []).flatMap((h) => {
      for (const a of artifacts ?? [])
        for (const tier of a.tiers) {
          const p = tier.find((x) => x.hash === h);
          if (p)
            return [
              {
                key: `art-${h}`,
                name: p.name,
                icon: p.icon,
                kind: a.name,
                text: p.text || p.description,
              },
            ];
        }
      return [];
    }),
  ];
  const drBuild =
    result?.own ??
    (opened
      ? result?.builds.find((b) => b.items.join() === opened)
      : undefined) ??
    result?.builds[0];
  const drHealth = drBuild
    ? drBuild.stats[BACKEND.indexOf("health")]
    : mins.health;
  // What the damage resist counts (shown under the stats).
  const [drCounted, setDrCounted] = useState<DrCounted | null>(null);

  // One build's card (`mine`: the loadout's own armor).
  const buildCard = (b: Build, mine = false) => {
    const pieces = b.items.map((id) => owned?.get(id));
    return (
      <div
        key={b.items.join()}
        role="button"
        tabIndex={0}
        aria-expanded={opened === b.items.join()}
        onClick={() =>
          setOpened((o) => (o === b.items.join() ? null : b.items.join()))
        }
        onKeyDown={(e) =>
          e.key === "Enter" &&
          setOpened((o) => (o === b.items.join() ? null : b.items.join()))
        }
        className={cx(
          "flex cursor-pointer flex-col gap-2 rounded-2xl border p-3 transition-colors",
          opened === b.items.join()
            ? "border-(--accent-glow) bg-white/[0.04]"
            : "border-white/[0.06] bg-white/[0.025] hover:border-white/15",
          mine && "ring-1 ring-(--accent-glow)",
          // Off screen: not laid out or painted (an open one: as it is).
          opened !== b.items.join() && "lazy-paint",
        )}
      >
        <div className="flex items-center gap-2">
          {pieces.map((p, i) => {
            const icon = (
              <span
                key={b.items[i]}
                className={cx(
                  "relative size-10 shrink-0 overflow-hidden rounded-lg border bg-black/30",
                  p?.exotic ? "border-[#e8c547]/70" : "border-white/10",
                )}
              >
                {p?.icon && (
                  <img
                    src={BUNGIE_ORIGIN + p.icon}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                )}
                {p?.watermark && (
                  <img
                    src={BUNGIE_ORIGIN + p.watermark}
                    alt=""
                    className="absolute inset-0 size-full"
                    draggable={false}
                  />
                )}
                <TierPips tier={p?.tier} size={40} />
              </span>
            );
            if (!p) return icon;
            // Its stats, archetype, set; an exotic's numbers and spirits.
            return (
              <PieceHover key={b.items[i]} character={character} piece={p}>
                {icon}
              </PieceHover>
            );
          })}
          <span className="ml-auto text-[12px] text-white/50 tabular-nums">
            {t("opt.total", { n: b.total })}
          </span>
          <GlassButton
            size="sm"
            disabled={pieces.some((p) => !p)}
            onClick={(e) => {
              e.stopPropagation();
              onTake(
                pieces.filter((p): p is Choice => !!p),
                // Each stat mod on its piece (armor bucket -> mods).
                b.mods.reduce<Record<number, number[]>>((by, m) => {
                  if (m.hash) (by[ARMOR_BUCKETS[m.slot]] ??= []).push(m.hash);
                  return by;
                }, {}),
                subclasses?.find((c) => c.id === subclass) ?? null,
                setup && setupPicks ? overridesOf(setup, setupPicks) : null,
              );
            }}
          >
            {t("opt.take")}
          </GlassButton>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {STAT_ORDER.map((s) => {
            const value = b.stats[BACKEND.indexOf(s)];
            return (
              <div
                key={s}
                className="rounded-lg bg-black/25 px-2 py-1 text-center"
              >
                <div className="truncate text-[10px] text-white/40">
                  {statName(s)}
                </div>
                <div
                  className={cx(
                    "text-[13px] font-semibold tabular-nums",
                    value > 200 ? "text-amber-300" : "text-white/85",
                  )}
                >
                  {value}
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-[11.5px] text-white/45">
          {b.mods.length > 0
            ? b.mods
                .map((m) => modLabel(m, (i) => statName(BACKEND[i]), t))
                .join(" · ")
            : t("opt.noMods")}
          {" · "}
          {t("opt.free", { n: b.freeMods })}
        </div>
        {opened === b.items.join() && (
          <div onClick={(e) => e.stopPropagation()} className="cursor-default">
            <BuildDetail
              build={b}
              pieces={pieces}
              character={character}
              onExclude={(piece) =>
                setSettings({
                  ...settings,
                  excluded: [
                    ...settings.excluded.filter((x) => x.id !== piece.id),
                    { id: piece.id, name: piece.name, icon: piece.icon },
                  ],
                })
              }
            />
          </div>
        )}
      </div>
    );
  };

  const statName = (s: StatId) => t(`statfx.name.${s}`);

  if (!isTauri)
    return (
      <p className="m-auto text-[13px] text-white/55">{t("dim.desktopOnly")}</p>
    );

  return (
    <div className="flex min-h-[560px] flex-1 flex-col gap-4">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <SubclassPicker
          subclasses={subclasses}
          value={subclass}
          onChange={pickSubclass}
          folded={setupDone}
          onUnfold={() => setSetupDone(false)}
          badges={
            setupDone && setupPlugs.length > 0 ? (
              <SubclassBadges
                plugs={setupPlugs}
                from={setupFrom}
                onOpen={() => setSetupDone(false)}
              />
            ) : null
          }
        />
        {/* Picked but its sockets still on their way: the same slide-in, empty. */}
        {subclass && !setup && (
          <div className="setup-reveal mt-3 h-24 rounded-xl border-t border-white/[0.06] shimmer" />
        )}
        {setup && setupPicks && (
          <SubclassSetup
            key={subclass ?? ""}
            stats={mins}
            sockets={setup}
            picks={setupPicks}
            onChange={setSetupPicks}
            done={setupDone}
            onDone={(from) => {
              setupFrom.current = from;
              setSetupDone(true);
            }}
          />
        )}
      </div>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <ExoticPicker
          exotics={exotics}
          value={exotic}
          onChange={chooseExotic}
          badges={
            // Shown once both are picked, and while one of them is changed.
            classItem &&
            picked.length === 2 &&
            (perksFolded || editingPerk !== null) ? (
              <PerkBadges
                perks={picked.map((p, i) =>
                  editingPerk === i && perks[i] === editFrom ? null : p,
                )}
                from={perkFrom}
                onOpen={(column) => {
                  setEditFrom(perks[column]);
                  setEditingPerk(column);
                  setPerksFolded(false);
                }}
              />
            ) : null
          }
        />
        {/* An exotic class item: its two perks to pick too. */}
        {classItem && (
          <ClassItemPerks
            list={perkList}
            error={perkError}
            value={perks}
            onChange={pickPerks}
            folded={perksFolded}
            only={editingPerk}
          />
        )}
      </div>
      {/* The armor sets, with all five slots (the exotic in its own). */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <SetPicker
          character={character}
          sets={sets}
          value={wantedSets}
          onChange={setWantedSets}
          exotic={(() => {
            const e = exotics?.find((x) => x.hash === exotic);
            return e
              ? {
                  slot: e.slot,
                  icon: e.icon,
                  name: e.name,
                  hash: e.hash,
                  exact: e.exact,
                }
              : null;
          })()}
          pinned={pinned}
          activeSlot={pinSlot}
          onSlot={(i) => setPinSlot((s) => (s === i ? null : i))}
          onUnpin={(i) => pinPiece(i, null)}
          onClearExotic={() => chooseExotic(0)}
          onDropPiece={(i, id) => {
            void presets
              .candidates(character, ARMOR_BUCKETS[i])
              .then((list) => {
                const piece = list.find((p) => p.id === id);
                if (piece) pinPiece(i, piece);
              });
          }}
        />
        {/* A slot clicked: its pieces, to pick one by hand. */}
        {pinSlot !== null && (
          <PiecePicker
            key={pinSlot}
            character={character}
            slot={pinSlot}
            // The piece in the slot (picked by hand, or the exotic picked for
            // it): its copies first (an exotic class item: all its perk pairs).
            only={(() => {
              if (pinned[pinSlot]) return pinned[pinSlot]!.name;
              const e = exotics?.find((x) => x.hash === exotic);
              return e && e.slot === pinSlot ? e.name : null;
            })()}
            pinned={pinned[pinSlot]}
            onPin={(piece) => pinPiece(pinSlot, piece)}
            onClose={() => setPinSlot(null)}
          />
        )}
      </div>
      {/* No scrolling of their own: the minimums and the results scroll
        with the rest of the builder. */}
      <div className="grid flex-1 grid-cols-[260px_minmax(0,1fr)] items-start gap-4">
        <div className="flex flex-col gap-1">
          {/* The settings: first, they change what the minimums can reach. */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="mb-2 flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left transition-colors hover:border-(--accent-glow) hover:bg-white/[0.05]"
          >
            <span className="text-(--accent-text)">
              <IconSettings />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium">
                {t("opt.settings")}
              </span>
              <span className="truncate text-[11px] text-white/50">
                {[
                  settings.mwLegendary || settings.mwExotic
                    ? t("opt.sumMasterwork")
                    : null,
                  settings.mods ? t("opt.sumMods") : t("opt.sumNoMods"),
                  t("opt.sumLimit", { n: MAX_BUILDS }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
          {settingsOpen && (
            <SettingsWindow
              value={settings}
              onChange={setSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          <div className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("opt.mins")}
          </div>
          {STAT_ORDER.map((s) => (
            <StatSlider
              key={s}
              id={s}
              label={statName(s)}
              value={mins[s]}
              reach={limits ? limits[BACKEND.indexOf(s)] : null}
              // While the maxima are outdated, only the stat just moved stays
              // free (its own maximum doesn't depend on it): the others wait,
              // so a build always fits.
              locked={limitsStale && (!fromSlider || lastStat.current !== s)}
              onChange={(v) => {
                lastStat.current = s;
                setMins((m) => ({ ...m, [s]: v }));
              }}
            />
          ))}
          <p className="mt-1 text-[11px] leading-snug text-white/45">
            {t("opt.reachHint")}
          </p>
          {/* The damage resist counted now, under the stats. */}
          {drCounted && (
            <div className="mt-3">
              <DrCountedList counted={drCounted} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 [&>*]:shrink-0">
          {error && (
            <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
              {error}
            </p>
          )}
          {!result && !running && !error && (
            <p className="mt-10 text-center text-[12.5px] text-white/45">
              {t("opt.start")}
            </p>
          )}
          {result && (
            <>
              <div
                className={cx(
                  "flex items-baseline justify-between gap-2 text-[11.5px] text-white/45 transition-opacity",
                  running && "opacity-50",
                )}
              >
                <span>
                  {running
                    ? t("opt.running")
                    : t("opt.found", {
                        n: result.builds.length,
                        pieces: result.pieces,
                        ms: result.millis,
                      })}
                </span>
                {mods && <span>{t("opt.modsNote")}</span>}
              </div>
              {result.own && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <span className="text-[10.5px] font-semibold tracking-[0.14em] text-(--accent) uppercase">
                      {t("opt.ownBuild")}
                    </span>
                    {result.ownShort && (
                      <span className="text-[11px] text-amber-300/80">
                        {t("opt.ownShort")}
                      </span>
                    )}
                  </div>
                  {buildCard(result.own, true)}
                </div>
              )}
              {artifact}
              <DamageResist
                sources={resistSources}
                health={drHealth}
                onCounted={setDrCounted}
              />
              {own && (
                <button
                  onClick={() => setShowOthers((v) => !v)}
                  aria-expanded={showOthers}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[12px] text-white/65 transition-colors hover:border-white/15 hover:text-white"
                >
                  <span>
                    {t(showOthers ? "opt.othersHide" : "opt.othersShow", {
                      n: others.length,
                    })}
                  </span>
                  <span
                    className={cx(
                      "transition-transform duration-200",
                      showOthers && "rotate-180",
                    )}
                  >
                    ▾
                  </span>
                </button>
              )}
              {showOthers && result.builds.length === 0 && (
                <p className="mt-6 text-center text-[12.5px] text-white/45">
                  {t("opt.none")}
                </p>
              )}
              {showOthers && others.map((b) => buildCard(b))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
