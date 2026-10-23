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
} from "../lib/presets";
import { ArmorSetCard } from "../pages/FireteamPage";
import { Gear } from "./LoadoutView";
import { ExoticHover } from "./Clarity";
import { useClarityItems } from "../lib/clarity";
import { cx, GlassButton, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { IconClose, IconPlus, IconRefresh } from "./icons";

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

/**
 * Build a loadout item by item (starting from what `character` has
 * equipped) and save it to DIM. Lives in the Loadouts tab.
 */
export function LoadoutBuilder({
  character,
  onSaved,
  onCancel,
}: {
  character: string | null;
  /** Called with the new DIM loadout's id. */
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [slots, setSlots] = useState<PresetSlot[]>([]);
  const [name, setName] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Choice[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PresetPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Exact numbers for chosen exotic armor, on hover (Clarity).
  const exoticPerks = useClarityItems(slots.filter((s) => s.item?.exotic && ARMOR_BUCKETS.includes(s.bucket)).map((s) => s.item!.hash));

  const loadDraft = async (characterId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const draft = await presets.draft(characterId);
      if (draft) setSlots(draft.slots);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setActive(null);
    void loadDraft(character);
  }, [character]);

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
        .preview(character, ids)
        .then((p) => !cancelled && setPreview(p ?? null))
        .catch(() => {})
        .finally(() => !cancelled && setPreviewing(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, character]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.typeName.toLowerCase().includes(q));
  }, [candidates, query]);

  const setSlot = (bucket: number, item: Choice | null) =>
    setSlots((all) => all.map((s) => (s.bucket === bucket ? { ...s, item } : s)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const id = await presets.save(
        character,
        name,
        slots.flatMap((s) => (s.item ? [s.item.id] : [])),
      );
      onSaved(id ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const group = (title: TranslationKey, buckets: number[]) => (
    <div>
      <div className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t(title)}</div>
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
    <GlassPanel className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <PanelHeader
        icon={<IconPlus />}
        title={t("builder.title")}
        subtitle={t("builder.subtitle")}
        right={
          <button
            onClick={onCancel}
            title={t("builder.cancel")}
            className="grid size-8 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
          >
            <IconClose />
          </button>
        }
      />
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
        <GlassButton
          variant="primary"
          onClick={() => void save()}
          disabled={saving || !name.trim() || filledCount === 0}
          className="shrink-0 whitespace-nowrap"
        >
          {saving ? t("builder.saving") : t("builder.save")}
        </GlassButton>
      </div>
      {error && <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [&>*]:shrink-0">
          {loading && slots.length === 0 ? (
            <p className="text-[12.5px] text-white/45">{t("builder.loading")}</p>
          ) : (
            <>
              {group("builder.slot.subclass", [SUBCLASS_BUCKET])}
              {group("builder.weapons", WEAPON_BUCKETS)}
              {group("builder.armor", ARMOR_BUCKETS)}
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
              <GlassInput placeholder={t("builder.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
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
    </GlassPanel>
  );
}
