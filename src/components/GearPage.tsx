import { useEffect, useRef, useState } from "react";
import { armorApi, withCopyPerks, type ArmorDetail } from "../lib/armor";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { call, hasBackend } from "../lib/tauri";
import { weapons, type WeaponDetail, type WeaponSummary } from "../lib/weapons";
import { ArmorCopies } from "./ArmorCopies";
import { cx, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { HudArmor } from "./hud";
import { IconCrosshair } from "./icons";
import { WeaponIcon, WeaponView } from "./WeaponView";
import { WeaponUsage } from "./WeaponUsage";

/** An armor piece found: light (for the list), every version of the name. */
interface ArmorFound {
  name: string;
  icon: string | null;
  typeName: string;
  className: string;
  exotic: boolean;
  /** 0 helmet, 1 arms, 2 chest, 3 legs, 4 class item. */
  slot: number;
  hashes: number[];
}
type Hit = { kind: "weapon"; weapon: WeaponSummary } | { kind: "armor"; armor: ArmorFound };
interface Source {
  name: string;
  key: string;
  count: number;
}
/** What is open on the right. */
type Shown = { kind: "weapon"; weapon: WeaponDetail } | { kind: "armor"; armor: ArmorDetail };

/** Armor is listed by class in this order (none last). */
const CLASS_ORDER = ["Hunter", "Jäger", "Titan", "Warlock", ""];

const HISTORY_KEY = "radar.gearSearches";
const HISTORY_MAX = 8;
const readHistory = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};
const writeHistory = (list: string[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the history lasts this session only.
  }
};

const src = (icon: string | null | undefined) => (icon ? (icon.startsWith("http") ? icon : BUNGIE_ORIGIN + icon) : null);
const EXOTIC = 6;

/** The sources (fetched once a run). */
let sourcesOnce: Promise<Source[]> | null = null;
const loadSources = () => (sourcesOnce ??= hasBackend ? call<Source[]>("gear_sources").then((s) => s ?? []) : Promise.resolve([]));

/**
 * Weapons and armor in one (the inspect page over the game): one search
 * for both, by name and by where they drop (`source:vaultofglass`,
 * completed while typing); a weapon opens as the weapons tab shows it, a
 * piece of armor with its set, the player's copies and their mods.
 * `initial`: what the game showed last, open at first (back leads to it).
 */
export function GearPage({ initial, usage = false }: { initial: Shown | null; usage?: boolean }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(initial);
  const [opening, setOpening] = useState<string | null>(null);
  const latest = useRef(0);
  const [sources, setSources] = useState<Source[]>([]);
  const [suggest, setSuggest] = useState(0);

  useEffect(() => {
    void loadSources().then(setSources);
  }, []);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q || /^source:\s*$/i.test(q)) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      call<Hit[]>("gear_search", { query: q })
        .then((r) => !cancelled && setHits(r ?? []))
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setSearching(false));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  // Completing `source:`: what follows it, however written ("source: vault
  // of"), while it still starts a source.
  const at = query.toLowerCase().lastIndexOf("source:");
  const typed = at < 0 ? null : query.slice(at + 7).toLowerCase().replace(/[^a-z0-9]/g, "");
  const sourcing = typed !== null && sources.some((s) => s.key.startsWith(typed)) ? typed : null;
  const matches =
    sourcing === null ? [] : sources.filter((s) => s.key.startsWith(sourcing) && s.key !== sourcing).slice(0, 8);
  const complete = (s: Source) => {
    setQuery(`${query.slice(0, at)}source:${s.key} `);
    setSuggest(0);
    document.getElementById("gear-search")?.focus();
  };

  // Searches made (one of their results opened), newest first.
  const [history, setHistory] = useState<string[]>(readHistory);
  const remember = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setHistory((h) => {
      const next = [query, ...h.filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, HISTORY_MAX);
      writeHistory(next);
      return next;
    });
  };
  const forget = (q: string) =>
    setHistory((h) => {
      const next = h.filter((x) => x !== q);
      writeHistory(next);
      return next;
    });

  const open = (hit: Hit) => {
    remember(query);
    setError(null);
    const request = ++latest.current;
    const name = hit.kind === "weapon" ? hit.weapon.name : hit.armor.name;
    setOpening(name);
    const done = (s: Shown | null) => request === latest.current && s && setShown(s);
    const work =
      hit.kind === "weapon"
        ? weapons.detail(hit.weapon.hash).then((w) => done(w ? { kind: "weapon", weapon: w } : null))
        : armorApi.detail(hit.armor.hashes).then((a) => done(a ? { kind: "armor", armor: a } : null));
    work.catch((e) => request === latest.current && setError(String(e))).finally(() => request === latest.current && setOpening(null));
  };
  const openWeapon = (hash: number) => {
    const request = ++latest.current;
    void weapons.detail(hash).then((w) => request === latest.current && w && setShown({ kind: "weapon", weapon: w }));
  };
  const shownKey = shown ? (shown.kind === "weapon" ? `w${shown.weapon.hash}` : `a${shown.armor.item.hash}`) : null;
  const initialKey = initial ? (initial.kind === "weapon" ? `w${initial.weapon.hash}` : `a${initial.armor.item.hash}`) : null;
  const weaponHits = hits.filter((h) => h.kind === "weapon");
  const armorHits = hits.filter((h) => h.kind === "armor");

  const row = (hit: Hit) => {
    const isWeapon = hit.kind === "weapon";
    const name = isWeapon ? hit.weapon.name : hit.armor.name;
    const exotic = isWeapon ? hit.weapon.tier === EXOTIC : hit.armor.exotic;
    const active = isWeapon
      ? shown?.kind === "weapon" && hit.weapon.versions.some((v) => v.hash === shown.weapon.hash)
      : shown?.kind === "armor" && hit.armor.hashes.includes(shown.armor.item.hash);
    return (
      <button
        key={(isWeapon ? "w" : "a") + (isWeapon ? hit.weapon.hash : hit.armor.hashes[0])}
        type="button"
        onClick={() => open(hit)}
        className={cx(
          "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border p-1.5 text-left transition-[background-color,border-color] duration-200",
          active ? "border-(--accent-glow) bg-(--accent-soft)" : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
          opening === name && "animate-pulse",
        )}
      >
        {isWeapon ? (
          <WeaponIcon icon={hit.weapon.icon} watermark={hit.weapon.watermark} exotic={exotic} className="size-9" />
        ) : src(hit.armor.icon) ? (
          <img src={src(hit.armor.icon)!} alt="" className="size-9 shrink-0 rounded-md border border-white/15" />
        ) : (
          <span className="size-9 shrink-0 rounded-md bg-white/[0.06]" />
        )}
        <span className="min-w-0">
          <span className={cx("block truncate text-[13px] font-medium", exotic && "text-[#f0d66b]")}>{name}</span>
          <span className="block truncate text-[11px] text-white/45">
            {isWeapon
              ? hit.weapon.typeName
              : [hit.armor.className, hit.armor.typeName].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="grid h-full grid-cols-[320px_minmax(0,1fr)] gap-4 p-5">
      <GlassPanel className="flex min-h-0 flex-col p-4">
        <PanelHeader icon={<IconCrosshair />} title={t("gear.title")} subtitle={t("gear.subtitle")} />
        <div className="relative">
          <GlassInput
            id="gear-search"
            // The browser's own suggestions ("Saved info"): off; the page
            // has its history below.
            autoComplete="off"
            name="radar-gear-query"
            placeholder={t("gear.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSuggest(0);
            }}
            onKeyDown={(e) => {
              if (!matches.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSuggest((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              } else if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                complete(matches[suggest] ?? matches[0]);
              }
            }}
            onClear={() => setQuery("")}
            clearLabel={t("common.clear")}
            autoFocus
          />
          {/* The sources matching what follows "source:". */}
          {matches.length > 0 && (
            <div className="animate-fade-in absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#0b0d14]/97 py-1 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]">
              {matches.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    complete(s);
                  }}
                  onMouseEnter={() => setSuggest(i)}
                  className={cx(
                    "flex w-full cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[12.5px]",
                    i === suggest ? "bg-white/[0.08] text-white" : "text-white/70",
                  )}
                >
                  <span>
                    <span className="text-white/40">source:</span>
                    {s.key}
                    <span className="ml-2 text-white/45">{s.name}</span>
                  </span>
                  <span className="text-[11px] text-white/35 tabular-nums">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Nothing typed: the searches made before, a click searches again. */}
        {!query.trim() && history.length > 0 && (
          <div className="mt-2 flex flex-col">
            {history.map((h) => (
              <div key={h} className="group flex items-center gap-1 rounded-lg hover:bg-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setQuery(h)}
                  className="min-w-0 flex-1 cursor-pointer truncate px-2 py-1.5 text-left text-[12.5px] text-white/70 group-hover:text-white"
                >
                  {h}
                </button>
                <button
                  type="button"
                  aria-label={t("common.clear")}
                  onClick={() => forget(h)}
                  className="mr-1 cursor-pointer px-1.5 text-[13px] text-white/30 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {!query.trim() && history.length === 0 && (
          <p className="mt-2 px-1 text-[11.5px] text-white/40">{t("gear.sourceHint")}</p>
        )}
        <div className="-mx-1 mt-3 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
          {searching && hits.length === 0 && <p className="px-1 text-[12px] text-white/40">{t("weapons.loading")}</p>}
          {!searching && query.trim() && hits.length === 0 && !matches.length && (
            <p className="px-1 text-[12px] text-white/40">{t("gear.none")}</p>
          )}
          {weaponHits.length > 0 && armorHits.length > 0 && (
            <div className="px-1 pt-1 text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">
              {t("gear.weapons", { n: weaponHits.length })}
            </div>
          )}
          {weaponHits.map(row)}
          {weaponHits.length > 0 && armorHits.length > 0 && (
            <div className="px-1 pt-2 text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">
              {t("gear.armor", { n: armorHits.length })}
            </div>
          )}
          {/* Armor by class (each its own small heading), class-less last. */}
          {CLASS_ORDER.map((cls) => {
            // Each class's pieces head to toe: helmet, arms, chest, legs, class item.
            const of = armorHits
              .filter((h) => h.kind === "armor" && (h.armor.className || "") === cls)
              .sort((a, b) =>
                a.kind === "armor" && b.kind === "armor"
                  ? a.armor.slot - b.armor.slot || a.armor.name.localeCompare(b.armor.name)
                  : 0,
              );
            if (!of.length) return null;
            return (
              <div key={cls || "any"} className="flex flex-col gap-1">
                {(cls || armorHits.length !== of.length) && (
                  <div className="px-1 pt-1.5 text-[11px] font-semibold text-white/55">{cls || t("gear.anyClass")}</div>
                )}
                {of.map(row)}
              </div>
            );
          })}
          {error && <p className="px-1 text-[12px] text-red-300">{error}</p>}
        </div>
      </GlassPanel>

      <div className="-m-4 min-h-0 overflow-y-auto p-4 pr-5">
        {opening ? (
          <p className="px-1 py-6 text-center text-[13px] text-white/50">{t("inspect.opening", { name: opening })}</p>
        ) : shown ? (
          <div key={shownKey} className="zoom-in-deeper">
            {/* In the app, nothing recognized: back to the overview. */}
            {usage && !initial && (
              <button
                type="button"
                onClick={() => setShown(null)}
                className="mb-3 cursor-pointer text-[12px] text-white/45 transition-colors hover:text-white"
              >
                ← {t("usage.back")}
              </button>
            )}
            {/* Back to what the game showed (from something searched). */}
            {initial && shownKey !== initialKey && (
              <button
                type="button"
                onClick={() => setShown(initial)}
                className="mb-3 cursor-pointer text-[12px] text-white/45 transition-colors hover:text-white"
              >
                ← {t("inspect.backTo", { name: initial.kind === "weapon" ? initial.weapon.name : initial.armor.item.name })}
              </button>
            )}
            {shown.kind === "weapon" ? (
              <GlassPanel className="p-5">
                <WeaponView weapon={shown.weapon} onVersion={openWeapon} onCopiesChanged={() => openWeapon(shown.weapon.hash)} />
              </GlassPanel>
            ) : shown.armor.versions?.length ? (
              <ArmorCopies versions={shown.armor.versions}>
                {(copy) => <HudArmor armor={withCopyPerks(shown.armor, copy)} wide />}
              </ArmorCopies>
            ) : (
              <HudArmor armor={shown.armor} wide />
            )}
          </div>
        ) : (
          usage ? (
            // In the app: the weapons played most, to open one from.
            <WeaponUsage onOpen={(hash) => openWeapon(hash)} />
          ) : (
            <p className="px-1 py-6 text-center text-[13px] text-white/40">{t("gear.empty")}</p>
          )
        )}
      </div>
    </div>
  );
}
