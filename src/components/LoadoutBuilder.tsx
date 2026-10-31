import { useEffect, useMemo, useState } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT, type TranslationKey } from "../lib/i18n";
import {
  ARMOR_BUCKETS,
  presets,
  SUBCLASS_BUCKET,
  WEAPON_BUCKETS,
  type Choice,
  type PresetPreview,
  type PresetSlot,
  type WeaponPlugs,
  choiceMatches,
} from "../lib/presets";
import { ArmorSetCard } from "../pages/FireteamPage";
import { ArmorOptimizer, clearOptimizerDraft, seedOptimizerDraft } from "./ArmorOptimizer";
import { ArtifactPicker } from "./ArtifactPicker";
import { TierPips } from "./TierPips";
import { SearchSuggest } from "./SearchSuggest";
import { Gear, ItemIcon } from "./LoadoutView";
import { ExoticHover, PerkHover } from "./Clarity";
import type { ItemInfo } from "../lib/fireteam";
import { call } from "../lib/tauri";
import { reloadInventory, useAgo, useInventoryLoading, useInventoryVersion } from "../lib/inventory";
import { useClarityItems } from "../lib/clarity";
import { cx, GlassButton, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { IconArrowLeft, IconClose, IconEdit, IconPlus, IconRefresh } from "./icons";

const SLOT_LABELS: Record<number, TranslationKey> = {
  [SUBCLASS_BUCKET]: "builder.slot.subclass",
  1498876634: "builder.slot.kinetic",
  2465295065: "builder.slot.energy",
  953998645: "builder.slot.power",
  3448274439: "builder.slot.helmet",
  3551918588: "builder.slot.gauntlets",
  14239492: "builder.slot.chest",
  20886954: "builder.slot.legs",
  1585787867: "builder.slot.class",
};

function ChoiceIcon({ item, size = 44 }: { item: Choice; size?: number }) {
  return (
    <span
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-black/30",
        item.exotic ? "border-[#e8c547]/70 shadow-[0_0_5px_-1px_rgb(232_197_71/0.5)]" : "border-white/10",
      )}
      style={{ width: size, height: size }}
    >
      {item.icon ? (
        <img src={BUNGIE_ORIGIN + item.icon} alt="" className="size-full object-cover" />
      ) : (
        <span className="text-[10px] text-white/45">{item.name.slice(0, 2)}</span>
      )}
      {item.watermark && <img src={BUNGIE_ORIGIN + item.watermark} alt="" className="absolute inset-0 size-full object-cover" />}
      <TierPips tier={item.tier} size={size} />
    </span>
  );
}

function SlotCard({
  slot,
  active,
  onPick,
  onClear,
}: {
  slot: PresetSlot;
  active: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => e.key === "Enter" && onPick()}
      className={cx(
        "group flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border p-2 transition-[background-color,border-color,box-shadow] duration-200",
        active
          ? "border-(--accent) bg-(--accent-soft) shadow-[0_0_9px_-4px_var(--accent-halo)]"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
    >
      {slot.item ? (
        <ChoiceIcon item={slot.item} />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-white/35">
          <IconPlus />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">{t(SLOT_LABELS[slot.bucket])}</div>
        <div className={cx("truncate text-[13px] font-medium", slot.item?.exotic && "text-[#f0d66b]", !slot.item && "text-white/40")}>
          {slot.item?.name ?? t("builder.empty")}
        </div>
        {slot.item && <div className="truncate text-[11px] text-white/40">{slot.item.location}</div>}
      </div>
      {slot.item && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          title={t("builder.clear")}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/35 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white"
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}

/** Everything the loadout will store: subclass setup, weapons with their
 *  perks and mods, armor with mods and tuning, artifact and set bonuses. */
function SavedSetup({ preview, loading }: { preview: PresetPreview | null; loading: boolean }) {
  const t = useT();
  if (!preview) {
    return loading ? <p className="text-[12px] text-white/40">{t("builder.previewLoading")}</p> : null;
  }
  const { loadout, weapons, armorSets } = preview;
  const armor = loadout.items.filter((i) => ARMOR_BUCKETS.includes(i.bucket ?? 0));
  const shown = { ...loadout, items: [...weapons, ...armor] };
  return (
    <div className={cx("flex flex-col gap-3 transition-opacity", loading && "opacity-60")}>
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
        {t("builder.savedSetup")}
        {loading && <span className="size-3 animate-spin rounded-full border-2 border-white/10 border-t-(--accent)" />}
      </div>
      {loadout.subclassPlugs.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="mb-1.5 px-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {loadout.subclass?.name ?? t("builder.slot.subclass")}
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {loadout.subclassPlugs.map((p, i) => (
              <span
                key={`${p.hash}-${i}`}
                title={`${p.name} – ${p.typeName}`}
                className="grid size-9 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black/25"
              >
                {p.icon && <img src={BUNGIE_ORIGIN + p.icon} alt="" className="size-full" draggable={false} />}
              </span>
            ))}
          </div>
        </div>
      )}
      <Gear loadout={shown} />
      {armorSets.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="mb-2 px-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("fireteam.armorSets")}
          </div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {armorSets.map((set) => (
              <ArmorSetCard key={set.name} set={set} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** A weapon's perk / mod socket with its choices (weapon_sockets). */
interface WeaponSocket {
  index: number;
  label: string;
  current: ItemInfo | null;
  options: ItemInfo[];
  /** The rest of the column's perk pool: not on this roll. */
  pool?: ItemInfo[];
  /** A perk column (else the mod and the like). */
  perk?: boolean;
}

/** A column's perks once each by name: a perk and its enhanced version are
 *  one choice, shown as the version the roll has (enhanced or not). */
function onePerName(options: ItemInfo[], now: ItemInfo | null): ItemInfo[] {
  const enhanced = (o: ItemInfo) => /enhanced|verbessert|amélioré|mejorad|potenziat|ulepszon|aprimorad|улучшен/i.test(o.typeName);
  const wantEnhanced = now ? enhanced(now) : false;
  const out: ItemInfo[] = [];
  for (const o of options) {
    const at = out.findIndex((x) => x.name === o.name);
    if (at < 0) out.push(o);
    else if (enhanced(o) === wantEnhanced && enhanced(out[at]) !== wantEnhanced) out[at] = o;
  }
  return out;
}

/**
 * A weapon of the loadout, big: every perk and mod socket with what goes in
 * (as rolled, or as picked here), and its choices to pick from.
 */
function WeaponEditor({
  character,
  item,
  plugs,
  onPick,
}: {
  character: string | null;
  item: Choice;
  /** Picked here: socket index -> plug. */
  plugs: Record<number, number>;
  /** A pick (null: back to how it's rolled). */
  onPick: (index: number, plug: number | null) => void;
}) {
  const t = useT();
  const [sockets, setSockets] = useState<WeaponSocket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setSockets(null);
    setError(null);
    call<WeaponSocket[]>("weapon_sockets", { characterId: character, instanceId: item.id })
      .then((list) => {
        if (!alive) return;
        setSockets(list ?? []);
      })
      .catch((e) => alive && (setError(String(e)), setSockets([])));
    return () => {
      alive = false;
    };
  }, [character, item.id]);
  const shownIn = (s: WeaponSocket) => (plugs[s.index] ? (s.options.find((o) => o.hash === plugs[s.index]) ?? s.current) : s.current);
  // Perk columns side by side; the mod and the like as chips (many choices).
  const perkColumns = (sockets ?? []).filter((s) => s.perk);
  const otherSockets = (sockets ?? []).filter((s) => !s.perk);
  const active = otherSockets.find((s) => s.index === open) ?? null;
  return (
    <div className="setup-reveal mt-3 rounded-2xl border border-(--accent-glow) bg-white/[0.03] p-3">
      <div className="mb-3 flex items-center gap-3">
        <ChoiceIcon item={item} size={56} />
        <div className="min-w-0">
          <div className={cx("truncate text-[15px] font-semibold", item.exotic ? "text-[#f0d66b]" : "text-white")}>{item.name}</div>
          <div className="truncate text-[11.5px] text-white/45">
            {item.typeName} · {item.location}
          </div>
        </div>
      </div>
      {error && <p className="mb-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      {sockets === null ? (
        <p className="text-[12px] text-white/45">{t("builder.loading")}</p>
      ) : sockets.length === 0 ? (
        <p className="text-[12px] text-white/45">{t("loadouts.editNothing")}</p>
      ) : (
        <>
          {/* The perk grid, as in game: every column side by side, what this
              roll has to pick, the rest of the pool dimmed. */}
          {perkColumns.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {perkColumns.map((s) => {
                const now = shownIn(s);
                return (
                  <div key={s.index} className="flex w-44 shrink-0 flex-col gap-1 rounded-xl border border-white/[0.06] bg-black/15 p-1.5">
                    <div className="flex items-center justify-between gap-1 px-1 pb-0.5">
                      <span className="truncate text-[10px] font-semibold tracking-[0.1em] text-white/40 uppercase">{s.label}</span>
                      {plugs[s.index] ? (
                        <button
                          type="button"
                          onClick={() => onPick(s.index, null)}
                          title={t("builder.weaponAsRolled")}
                          className="shrink-0 rounded px-1 text-[10px] text-(--accent-text) hover:bg-white/[0.06]"
                        >
                          ↺
                        </button>
                      ) : null}
                    </div>
                    {onePerName(s.options, now).map((o) => {
                      const chosen = now?.name === o.name;
                      return (
                        <PerkHover key={o.hash} perk={{ hash: o.hash, name: o.name, icon: o.icon, typeName: o.typeName, description: o.description ?? "" }} exact={o.exact}>
                          <button
                            type="button"
                            onClick={() => !chosen && onPick(s.index, o.hash === s.current?.hash ? null : o.hash)}
                            className={cx(
                              "flex min-w-0 items-center gap-2 rounded-lg border p-1 text-left transition-colors",
                              chosen ? "border-(--accent) bg-(--accent-soft)" : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
                            )}
                          >
                            <ItemIcon item={o} size={30} />
                            <span className={cx("min-w-0 truncate text-[11.5px]", chosen ? "font-semibold text-white" : "text-white/80")}>{o.name}</span>
                          </button>
                        </PerkHover>
                      );
                    })}
                    {(s.pool ?? []).length > 0 && <div className="mx-1 my-0.5 border-t border-white/[0.06]" />}
                    {(s.pool ?? []).map((o) => (
                      <PerkHover
                        key={`pool-${o.hash}`}
                        perk={{ hash: o.hash, name: o.name, icon: o.icon, typeName: `${o.typeName} · ${t("builder.notRolled")}`, description: o.description ?? "" }}
                        exact={o.exact}
                      >
                        <span className="flex min-w-0 cursor-not-allowed items-center gap-2 rounded-lg p-1 opacity-35 grayscale">
                          <ItemIcon item={o} size={30} />
                          <span className="min-w-0 truncate text-[11.5px] text-white/70">{o.name}</span>
                        </span>
                      </PerkHover>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {/* The mod (and other sockets with many choices): a chip, its
              choices below. */}
          {otherSockets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {otherSockets.map((s) => {
                const now = shownIn(s);
                return (
                  <button
                    key={s.index}
                    type="button"
                    onClick={() => setOpen((o) => (o === s.index ? null : s.index))}
                    className={cx(
                      "flex min-w-0 max-w-60 items-center gap-2 rounded-xl border p-1.5 pr-2.5 text-left transition-colors",
                      open === s.index ? "border-(--accent) bg-(--accent-soft)" : "border-white/[0.07] bg-white/[0.03] hover:border-white/15",
                    )}
                  >
                    {now ? <ItemIcon item={now} size={34} /> : <span className="size-[34px] shrink-0 rounded-lg border border-dashed border-white/15" />}
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-semibold tracking-[0.1em] text-white/40 uppercase">{s.label}</span>
                      <span className="block truncate text-[12px] font-medium">{now?.name ?? t("loadouts.editEmpty")}</span>
                    </span>
                    {plugs[s.index] ? <span className="ml-1 size-1.5 shrink-0 rounded-full bg-(--accent)" title={t("builder.weaponPicked")} /> : null}
                  </button>
                );
              })}
            </div>
          )}
          {active && (
            <div className="mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
              {plugs[active.index] ? (
                <button
                  type="button"
                  onClick={() => onPick(active.index, null)}
                  className="flex items-center gap-2 rounded-lg border border-transparent p-1.5 text-left text-[12px] text-white/60 hover:border-white/10 hover:bg-white/[0.05]"
                >
                  {active.current ? <ItemIcon item={active.current} size={32} /> : <span className="size-8" />}
                  <span className="min-w-0">
                    <span className="block truncate">{t("builder.weaponAsRolled")}</span>
                    <span className="block truncate text-[10.5px] text-white/40">{active.current?.name}</span>
                  </span>
                </button>
              ) : null}
              {active.options.map((o) => {
                const chosen = shownIn(active)?.hash === o.hash;
                return (
                  <PerkHover key={o.hash} perk={{ hash: o.hash, name: o.name, icon: o.icon, typeName: o.typeName, description: o.description ?? "" }} exact={o.exact}>
                    <button
                      type="button"
                      onClick={() => !chosen && onPick(active.index, o.hash === active.current?.hash ? null : o.hash)}
                      className={cx(
                        "flex min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors",
                        chosen ? "border-(--accent-glow) bg-(--accent-soft)" : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
                      )}
                    >
                      <ItemIcon item={o} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium">{o.name}</span>
                        <span className="block truncate text-[10.5px] text-white/40">{o.typeName}</span>
                      </span>
                    </button>
                  </PerkHover>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The loadout's weapons, next to the optimizer: the three slots, and every
 * weapon the player owns to search (name or type, by slot). A click puts
 * one in its slot, or drag it onto the slot.
 */
function WeaponSlots({
  character,
  slots,
  onSet,
  plugs,
  onPlug,
}: {
  character: string | null;
  slots: PresetSlot[];
  onSet: (bucket: number, item: Choice | null) => void;
  /** Perks / mods picked per weapon. */
  plugs: WeaponPlugs;
  onPlug: (weapon: string, index: number, plug: number | null) => void;
}) {
  const t = useT();
  // Every owned weapon per slot (again when the items were fetched anew).
  const inv = useInventoryVersion();
  const [owned, setOwned] = useState<Record<number, Choice[]> | null>(null);
  useEffect(() => setOwned(null), [character]);
  // (Items fetched anew: the list on screen stays until the new one's there.)
  useEffect(() => {
    let alive = true;
    void Promise.all(WEAPON_BUCKETS.map((b) => presets.candidates(character, b).catch(() => [] as Choice[]))).then(
      (lists) => alive && setOwned(Object.fromEntries(WEAPON_BUCKETS.map((b, i) => [b, lists[i]]))),
    );
    return () => {
      alive = false;
    };
  }, [character, inv]);
  const [query, setQuery] = useState("");
  // The slot searched in (null: all three).
  const [only, setOnly] = useState<number | null>(null);
  // A weapon being dragged (its slot), and the slot it's over.
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!owned) return [];
    const all = WEAPON_BUCKETS.filter((b) => only === null || b === only).flatMap((b) => (owned[b] ?? []).map((item) => ({ bucket: b, item })));
    return all
      .filter(({ item }) => choiceMatches(item, q))
      .sort((a, b) => a.item.name.localeCompare(b.item.name))
      .slice(0, 80);
  }, [owned, only, q]);
  const put = (bucket: number, item: Choice) => onSet(bucket, item);
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("builder.weapons")}</span>
        <span className="text-[11px] text-white/40">{t("builder.weaponsHint")}</span>
      </div>
      {/* The three slots: drop targets, a click searches in that one. */}
      <div className="grid grid-cols-3 gap-2">
        {WEAPON_BUCKETS.map((bucket) => {
          const item = slots.find((s) => s.bucket === bucket)?.item ?? null;
          const takes = dragging === bucket;
          return (
            <div
              key={bucket}
              role="button"
              tabIndex={0}
              onClick={() => setOnly((o) => (o === bucket ? null : bucket))}
              onKeyDown={(e) => e.key === "Enter" && setOnly((o) => (o === bucket ? null : bucket))}
              onDragOver={(e) => {
                if (!takes) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== bucket) setOver(bucket);
              }}
              onDragLeave={() => over === bucket && setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                const picked = owned?.[bucket]?.find((c) => c.id === id);
                if (picked) put(bucket, picked);
                setOver(null);
                setDragging(null);
              }}
              className={cx(
                "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border p-2 transition-[border-color,background-color,transform] duration-150",
                only === bucket ? "border-(--accent-glow) bg-(--accent-soft)" : "border-white/[0.08] bg-black/15 hover:border-white/20",
                takes && "border-dashed border-(--accent)",
                over === bucket && "scale-[1.02] bg-(--accent-soft)",
              )}
            >
              {item ? <ChoiceIcon item={item} size={40} /> : <span className="size-10 shrink-0 rounded-lg border border-dashed border-white/15" />}
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-[0.12em] text-white/40 uppercase">{t(SLOT_LABELS[bucket])}</div>
                <div className={cx("truncate text-[12.5px] font-medium", item?.exotic ? "text-[#f0d66b]" : item ? "text-white/90" : "text-white/40")}>
                  {item?.name ?? t("builder.empty")}
                </div>
                {item && <div className="truncate text-[10.5px] text-white/40">{item.typeName}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {/* The slot opened: its weapon big, with its perks and mods to pick. */}
      {(() => {
        const opened = only === null ? null : (slots.find((s) => s.bucket === only)?.item ?? null);
        return opened ? (
          <WeaponEditor
            key={opened.id}
            character={character}
            item={opened}
            plugs={plugs[opened.id] ?? {}}
            onPick={(index, plug) => onPlug(opened.id, index, plug)}
          />
        ) : null;
      })()}
      <div className="mt-2.5">
        <SearchSuggest
          placeholder={only === null ? t("builder.weaponSearch") : t("builder.weaponSearchIn", { slot: t(SLOT_LABELS[only]) })}
          value={query}
          onChange={setQuery}
          // (What it completes: the weapons it searches.)
          items={WEAPON_BUCKETS.filter((b) => only === null || b === only).flatMap((b) => owned?.[b] ?? [])}
        />
      </div>
      {/* What there is: the search's weapons (all of a slot without one). */}
      {(q || only !== null) && (
        <div className="mt-2 flex max-h-64 flex-wrap gap-1.5 overflow-y-auto pr-1">
          {!owned && <p className="text-[12px] text-white/40">{t("builder.loading")}</p>}
          {owned && shown.length === 0 && <p className="text-[12px] text-white/40">{t("builder.noWeapons")}</p>}
          {shown.map(({ bucket, item }) => {
            const now = slots.find((s) => s.bucket === bucket)?.item?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  setDragging(bucket);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onClick={() => put(bucket, item)}
                title={`${item.name} · ${item.typeName} · ${item.location}`}
                className={cx(
                  "flex w-[calc(50%-0.1875rem)] min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors xl:w-[calc(33.333%-0.25rem)]",
                  now ? "border-(--accent-glow) bg-(--accent-soft)" : "border-white/[0.06] bg-black/15 hover:border-white/20",
                )}
              >
                <ChoiceIcon item={item} size={34} />
                <span className="min-w-0">
                  <span className={cx("block truncate text-[12px]", item.exotic ? "text-[#f0d66b]" : "text-white/85")}>{item.name}</span>
                  <span className="block truncate text-[10.5px] text-white/40">
                    {item.typeName} · {item.location}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** How old the items are, and a button to fetch them now. */
function InventoryReload() {
  const t = useT();
  const at = useInventoryVersion();
  const loading = useInventoryLoading();
  const ago = useAgo(at);
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      type="button"
      onClick={() => {
        setError(null);
        reloadInventory().catch((e) => setError(String(e)));
      }}
      disabled={loading}
      title={error ?? t("builder.itemsReloadHint")}
      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-white/60 transition-colors hover:border-white/20 hover:text-white disabled:cursor-wait"
    >
      <span className={cx("grid place-items-center", loading && "animate-spin")}>
        <IconRefresh />
      </span>
      {loading ? t("builder.itemsLoading") : ago < 0 ? t("builder.itemsReload") : ago === 0 ? t("builder.itemsNow") : t("builder.itemsAgo", { n: ago })}
    </button>
  );
}

/** The builder's state, kept per character on this PC. */
interface BuilderDraft {
  slots: PresetSlot[];
  name: string;
  optimizing: boolean;
  statMods: Record<number, number[]> | null;
  subclassPlugs: Record<number, number> | null;
  /** The artifact perks picked (null / missing: the character's active ones). */
  artifact?: number[] | null;
  /** Weapons' perks and mods picked. */
  weaponPlugs?: WeaponPlugs;
}

/** `edit`: a saved loadout being edited (its own draft, apart from the new one's). */
const builderKey = (character: string | null, edit?: string | null) => `radar.builder.draft.${character ?? ""}${edit ? `.edit.${edit}` : ""}`;

function readBuilderDraft(character: string | null, edit?: string | null): BuilderDraft | null {
  try {
    return JSON.parse(localStorage.getItem(builderKey(character, edit)) ?? "null");
  } catch {
    return null;
  }
}

/** Start a new loadout afresh: the one left unsaved (builder and
 *  optimizer) is dropped, so it opens empty. */
export function discardNewDraft(character: string | null) {
  try {
    localStorage.removeItem(builderKey(character));
  } catch {
    // Nothing kept anyway.
  }
  clearOptimizerDraft(character);
}

/** Open a saved loadout (`id`) for editing: the builder and the optimizer
 *  start from it, in the optimizer. Rejects if it can't be read. */
export async function startEdit(character: string | null, id: string) {
  const e = await presets.edit(character, id);
  if (!e) throw new Error("no loadout");
  const draft: BuilderDraft = { slots: e.slots, name: e.name, optimizing: true, statMods: e.statMods, subclassPlugs: e.subclassPlugs, artifact: e.artifact, weaponPlugs: e.weaponPlugs ?? {} };
  try {
    localStorage.setItem(builderKey(character, id), JSON.stringify(draft));
  } catch {
    // Not kept; the builder starts from the gear worn.
  }
  seedOptimizerDraft(character, id, {
    exotic: e.exotic,
    perks: e.perks,
    stats: e.stats,
    sets: e.sets ?? [],
    subclass: e.slots.find((s) => s.bucket === SUBCLASS_BUCKET)?.item?.id ?? null,
    overrides: e.subclassPlugs,
  });
}

/**
 * Build a loadout item by item (starting from what `character` has
 * equipped) and save it to DIM. Lives in the Loadouts tab. The armor can
 * also come from the optimizer.
 */
export function LoadoutBuilder({
  character,
  edit = null,
  onSaved,
  onCancel,
}: {
  character: string | null;
  /** A saved loadout being edited (its id; see startEdit). */
  edit?: string | null;
  /** Called with the new DIM loadout's id. */
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  // As kept for the character (a tab switch or a restart goes on from there).
  const [first] = useState(() => readBuilderDraft(character, edit));
  const [slots, setSlots] = useState<PresetSlot[]>(first?.slots ?? []);
  const [name, setName] = useState(first?.name ?? "");
  const [active, setActive] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Choice[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PresetPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // The optimizer first (a new loadout starts from it), or the slots.
  const [optimizing, setOptimizing] = useState(first?.optimizing ?? true);
  const [notice, setNotice] = useState<string | null>(null);
  // The optimizer's stat mods (mod items), saved in place of the armor's
  // own; dropped when the armor changes by hand.
  const [statMods, setStatMods] = useState<Record<number, number[]> | null>(first?.statMods ?? null);
  // The optimizer's subclass setup (socket index -> plug), saved in place of
  // the subclass's own; dropped when the subclass changes by hand.
  const [subclassPlugs, setSubclassPlugs] = useState<Record<number, number> | null>(first?.subclassPlugs ?? null);
  // The artifact perks saved with it (null: the character's active ones).
  const [artifact, setArtifact] = useState<number[] | null>(first?.artifact ?? null);
  // Weapons' perks and mods picked here (instance id -> socket -> plug).
  const [weaponPlugs, setWeaponPlugs] = useState<WeaponPlugs>(first?.weaponPlugs ?? {});
  const pickWeaponPlug = (weapon: string, index: number, plug: number | null) =>
    setWeaponPlugs((all) => {
      const mine = { ...(all[weapon] ?? {}) };
      if (plug === null) delete mine[index];
      else mine[index] = plug;
      return { ...all, [weapon]: mine };
    });
  // Exact numbers for chosen exotic armor, on hover (Clarity).
  const exoticPerks = useClarityItems(slots.filter((s) => s.item?.exotic && ARMOR_BUCKETS.includes(s.bucket)).map((s) => s.item!.hash));

  const loadDraft = async (characterId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const draft = await presets.draft(characterId);
      // A new loadout starts empty (its slots only): nothing of what's worn.
      if (draft) setSlots(draft.slots.map((sl) => ({ ...sl, item: null })));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // The character's draft as kept, else its gear as worn. `draftOf`: whose
  // the draft on screen is, so it's never kept under another one.
  const [draftOf, setDraftOf] = useState<string | null | undefined>(first ? character : undefined);
  useEffect(() => {
    if (draftOf === character) return;
    setActive(null);
    setNotice(null);
    const kept = readBuilderDraft(character, edit);
    if (kept) {
      setSlots(kept.slots);
      setName(kept.name);
      setOptimizing(kept.optimizing);
      setStatMods(kept.statMods);
      setSubclassPlugs(kept.subclassPlugs);
      setArtifact(kept.artifact ?? null);
      setWeaponPlugs(kept.weaponPlugs ?? {});
    } else {
      setStatMods(null);
      setSubclassPlugs(null);
      setArtifact(null);
      setWeaponPlugs({});
      setOptimizing(true);
      void loadDraft(character);
    }
    setDraftOf(character);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character]);
  useEffect(() => {
    if (draftOf !== character || slots.length === 0) return;
    try {
      localStorage.setItem(builderKey(character, edit), JSON.stringify({ slots, name, optimizing, statMods, subclassPlugs, artifact, weaponPlugs } satisfies BuilderDraft));
    } catch {
      // Not kept; fine.
    }
  }, [character, draftOf, slots, name, optimizing, statMods, subclassPlugs, artifact, weaponPlugs]);

  // Candidates for the slot being picked.
  useEffect(() => {
    if (active === null) return;
    let cancelled = false;
    setCandidates(null);
    presets
      .candidates(character, active)
      .then((list) => !cancelled && setCandidates(list))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [active, character]);

  // What saving would store, for the items chosen (shortly after a change).
  const ids = slots.flatMap((s) => (s.item ? [s.item.id] : []));
  const idsKey = ids.join(",");
  useEffect(() => {
    if (ids.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      presets
        .preview(character, ids, statMods, subclassPlugs, artifact, weaponPlugs)
        .then((p) => !cancelled && setPreview(p ?? null))
        .catch(() => {})
        .finally(() => !cancelled && setPreviewing(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, character, statMods, subclassPlugs, artifact, weaponPlugs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? []).filter((c) => choiceMatches(c, q));
  }, [candidates, query]);

  const setSlot = (bucket: number, item: Choice | null) => {
    if (ARMOR_BUCKETS.includes(bucket)) setStatMods(null);
    if (bucket === SUBCLASS_BUCKET) setSubclassPlugs(null);
    setSlots((all) => all.map((s) => (s.bucket === bucket ? { ...s, item } : s)));
  };

  // A build of the optimizer: its pieces in the armor slots.
  const takeOptimized = (pieces: Choice[], mods: Record<number, number[]>, subclass: Choice | null, plugs: Record<number, number> | null) => {
    setOptimizing(false);
    setStatMods(mods);
    setSubclassPlugs(subclass ? plugs : null);
    if (subclass) setSlots((all) => all.map((s) => (s.bucket === SUBCLASS_BUCKET ? { ...s, item: subclass } : s)));
    setError(null);
    // (In ARMOR_BUCKETS order.)
    setSlots((all) =>
      all.map((s) => {
        const i = ARMOR_BUCKETS.indexOf(s.bucket);
        return i >= 0 && pieces[i] ? { ...s, item: pieces[i] } : s;
      }),
    );
    const count = Object.values(mods).flat().length;
    setNotice(count > 0 ? t("opt.takenMods", { n: count }) : t("opt.taken"));
  };

  // `asNew`: an edited loadout saved as another one (it stays as it was).
  const save = async (asNew = false) => {
    setSaving(true);
    setError(null);
    try {
      const id = await presets.save(
        character,
        name,
        slots.flatMap((s) => (s.item ? [s.item.id] : [])),
        statMods,
        subclassPlugs,
        asNew ? null : edit,
        artifact,
        weaponPlugs,
      );
      // Saved: the next new loadout (or edit) starts afresh.
      try {
        localStorage.removeItem(builderKey(character, edit));
      } catch {
        // Nothing kept anyway.
      }
      clearOptimizerDraft(character, edit, id ?? null);
      onSaved(id ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const group = (title: TranslationKey, buckets: number[], action?: React.ReactNode) => (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t(title)}</span>
        {action}
      </div>
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {slots
          .filter((s) => buckets.includes(s.bucket))
          .map((s) => (
            <ExoticHover key={s.bucket} perks={s.item ? exoticPerks.get(s.item.hash) : undefined}>
            <SlotCard
              key={s.bucket}
              slot={s}
              active={active === s.bucket}
              onPick={() => {
                setQuery("");
                setActive(s.bucket);
              }}
              onClear={() => setSlot(s.bucket, null)}
            />
            </ExoticHover>
          ))}
      </div>
    </div>
  );

  const filledCount = slots.filter((s) => s.item).length;


  return (
    <GlassPanel className="builder-wide flex flex-1 flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        {/* Back to the loadouts (the list slides back in). */}
        <button
          onClick={onCancel}
          title={t("builder.back")}
          aria-label={t("builder.back")}
          className="group grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-white/70 transition-[background-color,border-color,color] hover:border-(--accent-glow) hover:bg-(--accent-soft) hover:text-white"
        >
          <span className="transition-transform duration-200 group-hover:-translate-x-0.5">
            <IconArrowLeft />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <PanelHeader
            icon={edit ? <IconEdit /> : <IconPlus />}
            title={edit ? t("builder.editTitle") : t("builder.title")}
            subtitle={edit ? name || t("builder.editSubtitle") : t("builder.subtitle")}
          />
        </div>
        <InventoryReload />
        {/* Editing: the slots as saved, without picking a build. */}
        {edit && optimizing && slots.length > 0 && (
          <GlassButton onClick={() => setOptimizing(false)} className="shrink-0 whitespace-nowrap" title={t("builder.toSlotsHint")}>
            {t("builder.toSlots")}
          </GlassButton>
        )}
      </div>
      {/* Name and save once there is a loadout to save (not in the optimizer, but when editing: a weapon or the artifact changed). */}
      {(!optimizing || edit) && (
      <div className="flex gap-2">
        <GlassInput
          placeholder={t("builder.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
        />
        <GlassButton
          onClick={() => void loadDraft(character)}
          disabled={loading || saving}
          title={t("builder.fromEquippedHint")}
          className="shrink-0 whitespace-nowrap"
        >
          <IconRefresh /> {t("builder.fromEquipped")}
        </GlassButton>
        {/* Editing: also as a new loadout (the saved one as a template). */}
        {edit && (
          <GlassButton
            onClick={() => void save(true)}
            disabled={saving || !name.trim() || filledCount === 0}
            title={t("builder.saveAsNewHint")}
            className="shrink-0 whitespace-nowrap"
          >
            {t("builder.saveAsNew")}
          </GlassButton>
        )}
        <GlassButton
          variant="primary"
          onClick={() => void save()}
          disabled={saving || !name.trim() || filledCount === 0}
          className="shrink-0 whitespace-nowrap"
        >
          {saving ? t("builder.saving") : t("builder.save")}
        </GlassButton>
      </div>
      )}
      {error && <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      {notice && !error && (
        <p className="rounded-lg border border-(--accent-glow) bg-(--accent-soft) px-3 py-2 text-[12px] text-white/80">{notice}</p>
      )}
      {optimizing && <WeaponSlots character={character} slots={slots} onSet={setSlot} plugs={weaponPlugs} onPlug={pickWeaponPlug} />}
      {optimizing ? (
        <ArmorOptimizer
          character={character}
          edit={edit}
          onTake={takeOptimized}
          // Editing: the loadout's own armor, shown first.
          own={edit ? slots.filter((s) => ARMOR_BUCKETS.includes(s.bucket) && s.item).map((s) => s.item!.id) : undefined}
          artifact={<ArtifactPicker character={character} value={artifact} onChange={setArtifact} />}
          artifactPerks={artifact}
        />
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [&>*]:shrink-0">
          {loading && slots.length === 0 ? (
            <p className="text-[12.5px] text-white/45">{t("builder.loading")}</p>
          ) : (
            <>
              {group("builder.slot.subclass", [SUBCLASS_BUCKET])}
              {group("builder.weapons", WEAPON_BUCKETS)}
              {group(
                "builder.armor",
                ARMOR_BUCKETS,
                <GlassButton
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setActive(null);
                    setNotice(null);
                    setOptimizing(true);
                  }}
                  title={t("opt.title")}
                >
                  {t("opt.open")}
                </GlassButton>,
              )}
              <ArtifactPicker character={character} value={artifact} onChange={setArtifact} />
              <SavedSetup preview={preview} loading={previewing} />
            </>
          )}
          <p className="text-[11.5px] text-white/40">{t("builder.hint")}</p>
        </div>

        <div className="flex min-h-0 flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
          {active === null ? (
            <p className="m-auto max-w-52 text-center text-[12.5px] text-white/45">{t("builder.pickSlot")}</p>
          ) : (
            <>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">{t(SLOT_LABELS[active])}</span>
                <span className="text-[11px] text-white/40">
                  {candidates ? t("builder.count", { n: candidates.length }) : t("builder.loading")}
                </span>
              </div>
              <SearchSuggest placeholder={t("builder.search")} value={query} onChange={setQuery} items={candidates ?? []} />
              <div className="-mx-1 mt-2 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 [&>*]:shrink-0">
                {filtered.map((c) => {
                  const chosen = slots.some((s) => s.item?.id === c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSlot(active, c)}
                      className={cx(
                        "flex min-w-0 items-center gap-2.5 rounded-xl border p-1.5 text-left transition-[background-color,border-color] duration-200",
                        chosen
                          ? "border-(--accent-glow) bg-(--accent-soft)"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
                      )}
                    >
                      <ChoiceIcon item={c} size={36} />
                      <div className="min-w-0">
                        <div className={cx("truncate text-[12.5px] font-medium", c.exotic && "text-[#f0d66b]")}>{c.name}</div>
                        <div className="truncate text-[11px] text-white/45">
                          {c.typeName} · {c.location}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {candidates && filtered.length === 0 && <p className="px-1 text-[12px] text-white/40">{t("builder.none")}</p>}
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </GlassPanel>
  );
}
