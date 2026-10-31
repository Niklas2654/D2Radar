import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useScrollTopOn } from "../lib/scrollTop";
import { CharacterPicker } from "../components/CharacterPicker";
import { cx, GlassButton, GlassInput, GlassPanel, PanelHeader } from "../components/glass";
import { IconClose, IconDownload, IconPlus, IconRefresh, IconSwap } from "../components/icons";
import { discardNewDraft, LoadoutBuilder, startEdit } from "../components/LoadoutBuilder";
import {
  IssueDot,
  ItemIcon,
  LoadoutDetail,
  LoadoutPreview,
  SlotBadge,
  useApplyRunning,
  useProgress,
} from "../components/LoadoutView";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import {
  fromSummary,
  loadouts,
  type DimLoadout,
  type DimSummary,
  type GameLoadout,
  type Identifiers,
  type OwnCharacter,
} from "../lib/loadouts";
import { REFRESHED_EVENT } from "../lib/preload";
import { loadoutSets, type LoadoutSet, type SetEntry } from "../lib/presets";
import { isTauri, navigate, subscribe } from "../lib/tauri";

/** Drag-and-drop type of a DIM loadout id. */
const DRAG_TYPE = "application/x-radar-loadout";

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mt-1 mb-1.5 flex items-center justify-between gap-2 px-0.5">
      <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{title}</span>
      {action}
    </div>
  );
}

function SmallAdd({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-(--accent-text) hover:bg-(--accent-soft) disabled:opacity-40"
    >
      <span className="scale-75">
        <IconPlus />
      </span>
      {label}
    </button>
  );
}

/** A DIM loadout in the list: subclass, name, check dot and its items. */
function LoadoutCard({
  loadout,
  active,
  disabled,
  draggable,
  onClick,
}: {
  loadout: DimLoadout;
  active: boolean;
  disabled: boolean;
  draggable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, loadout.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={cx(
        "spotlight flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-[background-color,border-color] duration-200",
        draggable && "cursor-grab active:cursor-grabbing",
        loadout.pending && "shimmer",
        active
          ? "border-(--accent-glow) bg-(--accent-soft)"
          : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
    >
      <div className="flex items-center gap-2">
        {loadout.subclass && <ItemIcon item={loadout.subclass} size={26} />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{loadout.name}</span>
        {!loadout.pending && <IssueDot issues={loadout.issues} />}
      </div>
      <div className="flex flex-wrap gap-1">
        {loadout.pending
          ? Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="skeleton size-6 rounded-lg" style={{ animationDelay: `${i * 0.08}s` }} />
            ))
          : loadout.items.map((it, i) => <ItemIcon key={`${it.hash}-${i}`} item={it} size={24} missing={loadout.missing?.includes(it.hash)} />)}
      </div>
    </button>
  );
}

/** A preset in the list; the × deletes it (asks once). */
function SetRow({
  set,
  active,
  disabled,
  onOpen,
  onDelete,
}: {
  set: LoadoutSet;
  active: boolean;
  disabled: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      onMouseLeave={() => setConfirm(false)}
      className={cx(
        "group flex items-center gap-2 rounded-xl border pr-1.5 transition-[background-color,border-color] duration-200",
        confirm
          ? "border-red-400/40 bg-red-500/10"
          : active
            ? "border-(--accent-glow) bg-(--accent-soft)"
            : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
    >
      <button onClick={onOpen} disabled={disabled} className="flex min-w-0 flex-1 items-center gap-2 p-2.5 text-left">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{set.name}</span>
        {!confirm && <span className="shrink-0 text-[11px] text-white/45">{t("sets.count", { n: set.entries.length })}</span>}
      </button>
      {confirm ? (
        <button
          onClick={onDelete}
          className="shrink-0 rounded-lg bg-red-500/80 px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-red-500"
        >
          {t("sets.confirmDelete")}
        </button>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          disabled={disabled}
          title={t("sets.delete")}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/35 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-200 disabled:hidden"
        >
          <IconClose />
        </button>
      )}
    </div>
  );
}

/**
 * The character's in-game loadout slots (when nothing else is open): what
 * each holds; a slot can be emptied (asks once).
 */
function GameLoadouts({
  game,
  character,
  disabled,
  onCleared,
  onSaved,
  onError,
}: {
  game: GameLoadout[];
  character: string | null;
  disabled: boolean;
  onCleared: (index: number) => void;
  /** A slot saved as a DIM loadout (the list reloads). */
  onSaved: (name: string) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState<number | null>(null);
  // A slot being saved to DIM, and the one just saved (a check for a moment).
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  // The slot asking for the DIM loadout's name, and the name typed.
  const [naming, setNaming] = useState<number | null>(null);
  const [name, setName] = useState("");
  const toDim = (slot: GameLoadout) => {
    const chosen = name.trim() || slot.name;
    setSaving(slot.index);
    loadouts
      .gameToDim(character, slot.index, chosen)
      .then(() => {
        setNaming(null);
        setSaved(slot.index);
        window.setTimeout(() => setSaved((s) => (s === slot.index ? null : s)), 2500);
        onSaved(chosen);
      })
      .catch((e) => onError(String(e)))
      .finally(() => setSaving(null));
  };
  const [clearing, setClearing] = useState<number | null>(null);
  const clear = (index: number) => {
    setClearing(index);
    loadouts
      .clearGame(character, index)
      .then(() => onCleared(index))
      .catch((e) => onError(String(e)))
      .finally(() => {
        setClearing(null);
        setConfirm(null);
      });
  };
  return (
    <GlassPanel className="flex flex-col gap-4 p-5">
      <PanelHeader title={t("game.title")} subtitle={t("game.subtitle", { n: game.filter((g) => !g.empty).length })} />
      <div className="grid grid-cols-2 gap-2">
        {game.map((slot) => (
          <div
            key={slot.index}
            onMouseLeave={() => confirm === slot.index && setConfirm(null)}
            className={cx(
              "group relative flex min-w-0 items-center gap-3 rounded-xl border p-2.5 pr-16 transition-colors",
              confirm === slot.index
                ? "border-red-400/40 bg-red-500/10"
                : slot.empty
                  ? "border-dashed border-white/[0.07] bg-transparent"
                  : "border-white/[0.06] bg-white/[0.03] hover:border-white/15",
            )}
          >
            <SlotBadge icon={slot.icon} color={slot.color} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold tracking-[0.12em] text-white/35 uppercase">
                  {t("sets.slot", { n: slot.index + 1 })}
                </span>
                <span className={cx("truncate text-[13px] font-medium", slot.empty && "text-white/35")}>
                  {slot.empty ? t("sets.slotEmpty") : slot.name}
                </span>
              </div>
              {!slot.empty && slot.items.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {slot.items.map((it, i) => (
                    <ItemIcon key={`${it.hash}-${i}`} item={it} size={22} />
                  ))}
                </div>
              )}
            </div>
            {/* Top right: save to DIM (its name in a field opening to the
                left), empty the slot (asks once). */}
            {!slot.empty && (
              <div
                className={cx(
                  "absolute top-1.5 right-1.5 flex items-center gap-1",
                  naming === slot.index && "rounded-lg bg-[#16181f] pl-1.5",
                )}
              >
                {naming === slot.index && (
                  <form
                    className="animate-fade-in flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      toDim(slot);
                    }}
                  >
                    <input
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                      placeholder={t("game.dimName")}
                      autoComplete="off"
                      className="h-7 w-44 rounded-lg border border-white/10 bg-black/30 px-2.5 text-[12.5px] text-white select-text placeholder:text-white/30 focus:border-(--accent) focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={saving !== null}
                      className="flex h-7 items-center gap-1.5 rounded-lg bg-(--accent-soft) px-2.5 text-[12px] font-semibold text-(--accent-text) hover:brightness-125 disabled:opacity-60"
                    >
                      {saving === slot.index && (
                        <span className="size-3 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                      )}
                      {t("game.save")}
                    </button>
                  </form>
                )}
                {confirm === slot.index ? (
                  <button
                    onClick={() => clear(slot.index)}
                    disabled={clearing !== null}
                    className="rounded-lg bg-red-500/80 px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-red-500 disabled:opacity-60"
                  >
                    {clearing === slot.index ? t("loadouts.deleting") : t("game.confirmClear")}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setNaming(naming === slot.index ? null : slot.index);
                        setName(slot.name);
                      }}
                      disabled={disabled || saving !== null}
                      title={t("game.toDim")}
                      className={cx(
                        "grid size-7 place-items-center rounded-lg text-[13px] transition-opacity hover:bg-white/10 hover:text-white disabled:cursor-default",
                        saved === slot.index
                          ? "text-[#7fd49a] opacity-100"
                          : naming === slot.index
                            ? "bg-white/10 text-white opacity-100"
                            : "text-white/40 opacity-0 group-hover:opacity-100",
                      )}
                    >
                      {saved === slot.index ? "✓" : <IconDownload />}
                    </button>
                    {naming !== slot.index && (
                      <button
                        onClick={() => setConfirm(slot.index)}
                        disabled={disabled || clearing !== null}
                        title={t("game.clear")}
                        className="grid size-7 place-items-center rounded-lg text-white/35 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-200 disabled:hidden"
                      >
                        <IconClose />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-white/35">{t("loadouts.pick")}</p>
    </GlassPanel>
  );
}

/** Loadouts per page in the list. */
const PAGE_SIZE = 12;

/** The last loadouts per character, shown at once when the tab opens. */
const lastList = new Map<string, { className: string; loadouts: DimSummary[] }>();

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const btn =
    "grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-[11.5px] text-white/50">
      <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        ‹
      </button>
      <span className="tabular-nums">
        {page + 1} / {pages}
      </span>
      <button className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        ›
      </button>
    </div>
  );
}

type View =
  | { kind: "loadout"; id: string }
  | { kind: "set"; id: string }
  | { kind: "newSet" }
  /** `edit`: a saved loadout opened again (its id). */
  | { kind: "newLoadout"; edit?: string }
  | null;

/**
 * Loadouts: presets (bundles of loadouts, one per in-game slot, written all
 * at once), all DIM loadouts (look at the gear, equip, write to a slot, or
 * drag into a preset), and a builder for new loadouts.
 */
/** In-game slots emptied here (character:index -> when): Bungie's profile
 *  still lists the old loadout for a while after clearing it. */
const clearedAt = new Map<string, number>();
const CLEARED_FOR_MS = 2 * 60_000;

/** `list` with the slots just emptied here shown empty, until Bungie's
 *  answer shows them empty too (or a while has passed). */
function withCleared(character: string | null, list: GameLoadout[]): GameLoadout[] {
  const now = Date.now();
  return list.map((slot) => {
    const key = `${character}:${slot.index}`;
    const at = clearedAt.get(key);
    if (at === undefined) return slot;
    if (slot.empty || now - at > CLEARED_FOR_MS) {
      clearedAt.delete(key);
      return slot;
    }
    return { ...slot, empty: true, name: "", icon: null, color: null, items: [] };
  });
}

const BUILDING_KEY = "radar.loadouts.building";

export function LoadoutsPage() {
  const t = useT();
  const [connected, setConnected] = useState<boolean | null>(null);
  // Known from the loading screen: there from the first frame (updated below).
  const [characters, setCharacters] = useState<OwnCharacter[]>(() => loadouts.knownCharacters() ?? []);
  const [character, setCharacter] = useState<string | null>(() => loadouts.knownCharacters()?.[0]?.id ?? null);
  // The light list of all loadouts, and details for those that were on screen.
  const [list, setList] = useState<{ className: string; loadouts: DimSummary[] } | null>(null);
  const [details, setDetails] = useState<Record<string, DimLoadout>>({});
  const dim = useMemo(
    () => (list ? { className: list.className, loadouts: list.loadouts.map((s) => details[s.id] ?? fromSummary(s)) } : null),
    [list, details],
  );
  const [game, setGame] = useState<GameLoadout[]>([]);
  const [sets, setSets] = useState<LoadoutSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Building a loadout stays open across tab switches and restarts.
  const [view, setView] = useState<View>(() => {
    try {
      // "1": a new one, else the id of the one edited.
      const kept = localStorage.getItem(BUILDING_KEY);
      return kept ? (kept === "1" ? { kind: "newLoadout" } : { kind: "newLoadout", edit: kept }) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (view?.kind === "newLoadout") localStorage.setItem(BUILDING_KEY, view.edit ?? "1");
      else localStorage.removeItem(BUILDING_KEY);
    } catch {
      // Not kept; fine.
    }
  }, [view]);
  const editing = view?.kind === "newLoadout" ? (view.edit ?? null) : null;
  const building = view?.kind === "newLoadout";
  // Another loadout / preset / character: from the top.
  const detailScroll = useScrollTopOn(`${character}|${view?.kind ?? ""}|${view && "id" in view ? view.id : ""}`);
  const [preview, setPreview] = useState<string | null>(null);
  const [localRunning, setRunning] = useState(false);
  // Gone from the list at once; saved in the background.
  const deleteSet = (id: string) => {
    setSets((all) => all.filter((x) => x.id !== id));
    if (view?.kind === "set" && view.id === id) openView(null);
    loadoutSets
      .remove(id)
      .then(setSets)
      .catch((e) => {
        setError(String(e));
        void loadoutSets.list().then(setSets);
      });
  };
  // Also an equip still going from an earlier visit of the tab.
  const running = useApplyRunning() || localRunning;
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  // A new search starts on the first page.
  useEffect(() => setPage(0), [query]);
  const [showOthers, setShowOthers] = useState(false);

  const classType = characters.find((c) => c.id === character)?.classType ?? 1;
  const fits = (l: DimLoadout) => l.classType === classType || l.classType === 3;

  // The character picked now, and the newest load: answers for an earlier
  // pick (quick switching) or an older load are dropped, so one character
  // never shows another's loadouts.
  const pickedRef = useRef<string | null>(null);
  const loadSeq = useRef(0);
  const load = useCallback(async (characterId: string | null, fresh = false) => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current && pickedRef.current === characterId;
    setError(null);
    setBusy(true);
    // Last result for this character right away; the fresh one replaces it.
    const cached = characterId ? lastList.get(characterId) : undefined;
    if (cached) setList(cached);
    if (fresh) {
      setDetails({});
      failed.current.clear();
    }
    try {
      const status = await loadouts.dimStatus();
      if (!current()) return;
      setConnected(status.connected);
      const [d, g, s] = await Promise.all([
        status.connected ? loadouts.list(characterId, fresh) : Promise.resolve(undefined),
        loadouts.game(characterId),
        loadoutSets.list(),
      ]);
      // Remembered for its own character either way.
      if (d && characterId) lastList.set(characterId, d);
      if (!current()) return;
      if (d) setList(d);
      if (g) setGame(withCleared(characterId, g.loadouts));
      setSets(s);
      return d;
    } catch (e) {
      if (current()) setError(String(e));
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }, []);

  // Characters first (most recently played preselected), then their loadouts.
  useEffect(() => {
    loadouts
      .characters()
      .then((list) => {
        setCharacters(list);
        setCharacter((c) => c ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  pickedRef.current = character;
  useEffect(() => {
    if (character) void load(character);
    else if (!isTauri) void load(null);
  }, [character, load]);

  const pickCharacter = (id: string) => {
    if (id === character) return;
    pickedRef.current = id;
    setCharacter(id);
    setList(null);
    setDetails({});
    setGame([]);
    // Building a new loadout stays open (for the new character); the rest
    // (an edit too: the loadout is the other character's) closes.
    setView((v) => (v?.kind === "newLoadout" && !v.edit ? v : null));
    setPreview(null);
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await loadouts.dimConnect();
      await load(character);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const editingSet = view?.kind === "set" || view?.kind === "newSet";
  const openView = (next: View) => {
    setView(next);
    setPreview(null);
  };
  // A click always opens the loadout itself (equip, edit, delete), also from
  // a preset (dragging still puts it into the preset's slots).
  const clickLoadout = (id: string) => openView({ kind: "loadout", id });

  const classSets = sets.filter((s) => s.classType === classType);
  // Search: by name, and (once loaded) by subclass, items and mods.
  const needle = query.trim().toLowerCase();
  const matches = (l: DimLoadout) =>
    !needle ||
    [l.name, l.subclass?.name, ...l.items.map((i) => i.name), ...l.mods.map((m) => m.name)].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  const all = (dim?.loadouts ?? []).filter(matches);
  const mine = all.filter(fits);
  const others = all.filter((l) => !fits(l));
  const pages = Math.ceil(mine.length / PAGE_SIZE);

  // Details only for what is on screen, one loadout at a time: the clicked
  // / previewed one first, then the open preset's, then the list top to bottom.
  const openSetIds = view?.kind === "set" ? (sets.find((x) => x.id === view.id)?.entries.map((e) => e.loadoutId) ?? []) : [];
  const onScreen: string[] = [];
  // Clicked / previewed: loaded right away, next to whatever is running.
  const priority = [view?.kind === "loadout" ? view.id : null, preview].filter((x): x is string => !!x);
  onScreen.push(...priority);
  onScreen.push(...openSetIds);
  onScreen.push(
    ...[...mine.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), ...(showOthers ? others.slice(0, PAGE_SIZE) : [])].map((l) => l.id),
  );
  const wanted = [...new Set(onScreen)].filter((id) => !details[id]);
  const queue = useRef<string[]>([]);
  queue.current = wanted;
  const urgent = useRef<string[]>([]);
  urgent.current = priority.filter((id) => !details[id]);
  const characterRef = useRef(character);
  characterRef.current = character;
  const inflight = useRef(new Set<string>());
  // Not tried again on its own (the error shows; reload retries).
  const failed = useRef(new Set<string>());
  const pump = useCallback(() => {
    // Two at a time (the next one is ready while one is being looked at);
    // a clicked one starts at once.
    for (;;) {
      const open = (x: string) => !inflight.current.has(x) && !failed.current.has(x);
      const id = urgent.current.find(open) ?? (inflight.current.size < 2 ? queue.current.find(open) : undefined);
      if (!id) return;
      const forCharacter = characterRef.current;
      inflight.current.add(id);
      queue.current = queue.current.filter((x) => x !== id);
      loadouts
        .details(forCharacter, [id])
        .then((got) => {
          if (pickedRef.current !== forCharacter || got.length === 0) return;
          setDetails((d) => ({ ...d, ...Object.fromEntries(got.map((l) => [l.id, l])) }));
        })
        .catch((e) => {
          failed.current.add(id);
          setError(String(e));
        })
        .finally(() => {
          inflight.current.delete(id);
          pump();
        });
    }
  }, []);
  const wantedKey = wanted.join(",");
  useEffect(() => {
    if (wantedKey) pump();
  }, [wantedKey, character, pump]);
  // Background refresh (lib/preload): the list and the loadouts already
  // shown, swapped in place (no placeholders in between).
  const detailsRef = useRef(details);
  detailsRef.current = details;
  useEffect(() => {
    const refresh = () => {
      if (running) return;
      void load(character);
      const ids = Object.keys(detailsRef.current);
      if (ids.length === 0) return;
      const forCharacter = character;
      void loadouts
        .details(forCharacter, ids)
        .then((got) => {
          if (pickedRef.current !== forCharacter) return;
          setDetails((d) => ({ ...d, ...Object.fromEntries(got.map((l) => [l.id, l])) }));
        })
        .catch(() => {});
    };
    window.addEventListener(REFRESHED_EVENT, refresh);
    // Weapons no longer owned were taken out of loadouts (backend).
    const stop = subscribe("loadouts-changed", refresh);
    return () => {
      window.removeEventListener(REFRESHED_EVENT, refresh);
      stop();
    };
  }, [character, load, running]);
  // Stay on a page that exists (fewer loadouts, other character).
  useEffect(() => {
    if (page > 0 && page >= pages) setPage(Math.max(0, pages - 1));
  }, [page, pages]);
  const loadout = view?.kind === "loadout" ? (all.find((l) => l.id === view.id) ?? null) : null;
  const previewed = editingSet && preview ? (all.find((l) => l.id === preview) ?? null) : null;
  const set =
    view?.kind === "set"
      ? (sets.find((s) => s.id === view.id) ?? null)
      : view?.kind === "newSet"
        ? { id: "", name: "", classType, entries: [] }
        : null;

  const refreshGame = () => {
    const forCharacter = character;
    void loadouts
      .game(forCharacter)
      .then((g) => g && pickedRef.current === forCharacter && setGame(withCleared(forCharacter, g.loadouts)));
  };
  // A slot just emptied: shown empty at once; Bungie's answer catches up a
  // few seconds later (see withCleared).
  const onGameCleared = (index: number) => {
    clearedAt.set(`${character}:${index}`, Date.now());
    setGame((list) => withCleared(character, list));
    window.setTimeout(refreshGame, 4000);
  };

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {characters.length > 0 && (
        <CharacterPicker characters={characters} value={character} onChange={pickCharacter} disabled={running} />
      )}
      {/* Building a loadout: the list slides away to the left and the
          builder takes the whole width (the columns animate, see
          .loadouts-grid). */}
      <div className={cx("loadouts-grid grid min-h-0 flex-1", building && "is-building")}>
        <div className="loadouts-list flex min-h-0 min-w-0" inert={building}>
        <GlassPanel className="flex min-h-0 w-[320px] shrink-0 flex-col p-4">
          <PanelHeader
            icon={<IconSwap />}
            title={t("loadouts.tabTitle")}
            subtitle={dim ? t("loadouts.fromDim", { cls: dim.className }) : t("loadouts.tabSubtitle")}
            right={
              connected && (
                <button
                  onClick={() => void load(character, true)}
                  disabled={busy}
                  title={t("loadouts.reload")}
                  className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/[0.08] hover:text-white"
                >
                  <span className={cx(busy && "animate-spin")}>
                    <IconRefresh />
                  </span>
                </button>
              )
            }
          />
          {connected === false && (
            <div className="mb-3 flex flex-col gap-3">
              <p className="text-[12.5px] leading-relaxed text-white/60">{t("loadouts.connectHint")}</p>
              <GlassButton variant="primary" onClick={() => void connect()} disabled={busy}>
                {busy ? t("loadouts.connecting") : t("loadouts.connect")}
              </GlassButton>
              <p className="text-[11.5px] text-white/40">{t("loadouts.connectNote")}</p>
            </div>
          )}
          {error && (
            <p className="mb-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
              {error}{" "}
              {/login|einlogg/i.test(error) && (
                <button onClick={() => navigate("settings")} className="underline">
                  {t("nav.settings")}
                </button>
              )}
            </p>
          )}
          <div className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 [&>*]:shrink-0">
            <SectionHeader
              title={t("sets.title")}
              action={
                <SmallAdd label={t("sets.new")} onClick={() => openView({ kind: "newSet" })} disabled={!connected || running} />
              }
            />
            {classSets.length === 0 && <p className="px-0.5 text-[12px] text-white/40">{t("sets.none")}</p>}
            {classSets.map((s) => (
              <SetRow
                key={s.id}
                set={s}
                active={view?.kind === "set" && view.id === s.id}
                disabled={running}
                onOpen={() => openView({ kind: "set", id: s.id })}
                onDelete={() => deleteSet(s.id)}
              />
            ))}

            <SectionHeader
              title={t("loadouts.dimTitle")}
              action={
                <SmallAdd
                  label={t("loadouts.newLoadout")}
                  onClick={() => {
                    // "+ Loadout": an empty one (not the last one left unsaved).
                    if (!(view?.kind === "newLoadout" && !view.edit)) discardNewDraft(character);
                    openView({ kind: "newLoadout" });
                  }}
                  disabled={!connected || running}
                />
              }
            />
            {(dim?.loadouts.length ?? 0) > 0 && (
              <GlassInput
                placeholder={t("loadouts.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                clearLabel={t("common.clear")}
                className="h-9 text-[13px]"
              />
            )}
            {!dim &&
              connected !== false &&
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="shimmer flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="skeleton size-[26px] rounded-full" />
                    <span className="skeleton h-3 w-32 rounded-full" />
                  </div>
                  <div className="flex gap-1">
                    {Array.from({ length: 8 }, (_, k) => (
                      <span key={k} className="skeleton size-6 rounded-lg" style={{ animationDelay: `${(i + k) * 0.06}s` }} />
                    ))}
                  </div>
                </div>
              ))}
            {dim && all.length === 0 && (
              <p className="px-0.5 text-[12px] text-white/40">{needle ? t("loadouts.noMatch") : t("loadouts.noDim")}</p>
            )}
            {mine.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((l) => (
              <LoadoutCard
                key={l.id}
                loadout={l}
                active={(view?.kind === "loadout" && view.id === l.id) || preview === l.id}
                disabled={running}
                draggable={editingSet}
                onClick={() => clickLoadout(l.id)}
              />
            ))}
            {pages > 1 && <Pager page={page} pages={pages} onPage={setPage} />}
            {others.length > 0 && (
              <>
                <button
                  onClick={() => setShowOthers(!showOthers)}
                  className="mt-1 flex items-center justify-between rounded-lg px-0.5 py-1 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase hover:text-white/70"
                >
                  {t("loadouts.otherClasses")} ({others.length})
                  <span className={cx("transition-transform", showOthers && "rotate-180")}>▾</span>
                </button>
                {showOthers && (
                <div className="flex flex-col gap-1.5 opacity-55">
                  {others.map((l) => (
                    <LoadoutCard
                      key={l.id}
                      loadout={l}
                      active={(view?.kind === "loadout" && view.id === l.id) || preview === l.id}
                      disabled={running}
                      draggable={false}
                      onClick={() => clickLoadout(l.id)}
                    />
                  ))}
                </div>
                )}
              </>
            )}
          </div>
        </GlassPanel>
        </div>

        <div ref={detailScroll} className="-m-4 flex min-h-0 flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0">
          {view?.kind === "set" && (
            <GlassButton
              size="sm"
              onClick={() => {
                setPreview(null);
                openView(null);
              }}
              className="self-start"
            >
              ← {t("loadouts.backToGame")}
            </GlassButton>
          )}
          {previewed && (
            <LoadoutPreview loadout={previewed} onClose={() => setPreview(null)} onOpen={() => openView({ kind: "loadout", id: previewed.id })} />
          )}
          {view?.kind === "newLoadout" ? (
            <LoadoutBuilder
              key={editing ?? "new"}
              edit={editing}
              character={character}
              onCancel={() => openView(null)}
              onSaved={(id) => {
                void load(character, true).then(() => openView(id ? { kind: "loadout", id } : null));
              }}
            />
          ) : set ? (
            <SetEditor
              key={set.id || "new"}
              set={set}
              game={game}
              dimLoadouts={mine}
              character={character}
              onRunning={setRunning}
              onWritten={refreshGame}
              onSaved={(all, id) => {
                setSets(all);
                setView({ kind: "set", id });
              }}
              onDeleted={(all) => {
                setSets(all);
                openView(null);
              }}
            />
          ) : loadout ? (
            <LoadoutDetail
              key={loadout.id}
              loadout={loadout}
              game={game}
              character={character}
              onRunning={setRunning}
              onWritten={refreshGame}
              onBack={() => openView(null)}
              onChanged={(l) => setDetails((d) => ({ ...d, [l.id]: l }))}
              onEdit={async () => {
                const id = loadout.id;
                try {
                  await startEdit(character, id);
                  openView({ kind: "newLoadout", edit: id });
                } catch (e) {
                  setError(String(e));
                }
              }}
              onDelete={async () => {
                // Gone from the list at once; DIM catches up in the background.
                const id = loadout.id;
                const before = list;
                const drop = (l: typeof list) => (l ? { ...l, loadouts: l.loadouts.filter((x) => x.id !== id) } : l);
                setList(drop);
                if (character && before) lastList.set(character, drop(before)!);
                openView(null);
                loadouts.remove(id).catch((e) => {
                  // Didn't work: back in the list, with the reason.
                  setList(before);
                  if (character && before) lastList.set(character, before);
                  setError(String(e));
                });
              }}
            />
          ) : (
            <GameLoadouts
              game={game}
              character={character}
              disabled={running}
              onCleared={onGameCleared}
              onSaved={() => void load(character, true)}
              onError={setError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Dark dropdown for a preset slot's loadout (the native select's list
 * can't be styled): subclass icon, name and check dot per loadout.
 */
function LoadoutSelect({
  value,
  loadouts: options,
  disabled,
  onChange,
}: {
  value: string;
  loadouts: DimLoadout[];
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chosen = options.find((l) => l.id === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = () => {
    if (!open && ref.current) {
      // Open upwards when there isn't room below.
      setUp(window.innerHeight - ref.current.getBoundingClientRect().bottom < 320);
    }
    setOpen(!open);
  };
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        onClick={toggle}
        disabled={disabled}
        className={cx(
          "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-xl border bg-black/25 px-2.5 text-left text-[12.5px] transition-[border-color,background-color] duration-150 disabled:opacity-50",
          open ? "border-(--accent)" : "border-white/10 hover:border-white/20 hover:bg-black/35",
        )}
      >
        {chosen?.subclass ? <ItemIcon item={chosen.subclass} size={24} /> : null}
        <span className={cx("min-w-0 flex-1 truncate", chosen ? "font-medium text-white" : "text-white/45")}>
          {chosen?.name ?? (value ? t("sets.missing") : t("sets.keep"))}
        </span>
        {chosen && <IssueDot issues={chosen.issues} />}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cx("shrink-0 text-white/40 transition-transform", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className={cx(
            "absolute right-0 left-0 z-30 max-h-72 overflow-y-auto rounded-xl border border-white/12 bg-[#14161c]/98 p-1 shadow-[0_24px_50px_-12px_rgb(0_0_0/0.8)] backdrop-blur",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          <button
            onClick={() => pick("")}
            className={cx(
              "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[12.5px] text-white/55 hover:bg-white/[0.06]",
              !value && "bg-white/[0.05]",
            )}
          >
            {t("sets.keep")}
          </button>
          {options.map((l) => (
            <button
              key={l.id}
              onClick={() => pick(l.id)}
              className={cx(
                "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white/[0.06]",
                l.id === value && "bg-(--accent-soft) text-white",
              )}
            >
              {l.subclass ? <ItemIcon item={l.subclass} size={24} /> : <span className="size-6 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <IssueDot issues={l.issues} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pick the name, color and icon an in-game slot gets. */
function LookPicker({
  ids,
  value,
  onChange,
  onClose,
}: {
  ids: Identifiers;
  value: { nameHash: number; colorHash: number; iconHash: number };
  onChange: (next: { nameHash: number; colorHash: number; iconHash: number }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [onClose]);
  const color = ids.colors.find((c) => c.hash === value.colorHash)?.value ?? null;
  const icon = ids.icons.find((c) => c.hash === value.iconHash)?.value ?? null;
  return (
    <div
      ref={ref}
      className="absolute top-full left-0 z-20 mt-2 w-[420px] rounded-2xl border border-white/15 bg-[#14161c]/95 p-3 shadow-[0_20px_50px_-10px_rgb(0_0_0/0.7)]"
    >
      <div className="mb-3 flex items-center gap-3">
        <SlotBadge icon={icon} color={color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("sets.look")}</div>
          <select
            value={value.nameHash}
            onChange={(e) => onChange({ ...value, nameHash: Number(e.target.value) })}
            className="mt-1 h-8 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-[12.5px] text-white focus:border-(--accent) focus:outline-none"
          >
            {ids.names.map((n) => (
              <option key={n.hash} value={n.hash}>
                {n.value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-1 text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">{t("sets.lookColor")}</div>
      <div className="mb-3 grid grid-cols-11 gap-1">
        {ids.colors.map((c) => (
          <button
            key={c.hash}
            onClick={() => onChange({ ...value, colorHash: c.hash })}
            className={cx(
              "aspect-square rounded-md border bg-white/10 bg-cover",
              c.hash === value.colorHash ? "border-white shadow-[0_0_0_2px_var(--accent-halo)]" : "border-white/10 hover:border-white/40",
            )}
            style={c.value ? { backgroundImage: `url(${BUNGIE_ORIGIN + c.value})` } : undefined}
          />
        ))}
      </div>
      <div className="mb-1 text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">{t("sets.lookIcon")}</div>
      <div className="grid grid-cols-11 gap-1">
        {ids.icons.map((c) => (
          <button
            key={c.hash}
            onClick={() => onChange({ ...value, iconHash: c.hash })}
            className={cx(
              "relative aspect-square overflow-hidden rounded-md border bg-cover",
              c.hash === value.iconHash ? "border-white shadow-[0_0_0_2px_var(--accent-halo)]" : "border-white/10 hover:border-white/40",
            )}
            style={color ? { backgroundImage: `url(${BUNGIE_ORIGIN + color})` } : undefined}
          >
            {c.value && <img src={BUNGIE_ORIGIN + c.value} alt="" className="absolute inset-0 size-full" />}
          </button>
        ))}
      </div>
    </div>
  );
}

type SetResult = { name: string; slot: number; ok: boolean; messages: string[] };
type Look = { nameHash: number; colorHash: number; iconHash: number };

/**
 * A preset: a DIM loadout per in-game slot (drag them in from the list or
 * pick them), how each slot should look, and writing them all at once.
 */
function SetEditor({
  set,
  game,
  dimLoadouts,
  character,
  onRunning,
  onWritten,
  onSaved,
  onDeleted,
}: {
  set: LoadoutSet;
  game: GameLoadout[];
  dimLoadouts: DimLoadout[];
  character: string | null;
  onRunning: (running: boolean) => void;
  onWritten: () => void;
  onSaved: (all: LoadoutSet[], id: string) => void;
  onDeleted: (all: LoadoutSet[]) => void;
}) {
  const t = useT();
  const [name, setName] = useState(set.name);
  const [entries, setEntries] = useState<Record<number, SetEntry>>(() =>
    Object.fromEntries(set.entries.map((e) => [e.slot, e])),
  );
  const [ids, setIds] = useState<Identifiers | null>(null);
  const [lookOpen, setLookOpen] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number; name: string; slot: number; step: string } | null>(null);
  const [results, setResults] = useState<SetResult[] | null>(null);
  const onStep = useCallback((step: string) => setProgress((p) => (p ? { ...p, step } : p)), []);
  useProgress(progress !== null, onStep);

  useEffect(() => {
    loadouts
      .identifiers()
      .then((i) => i && setIds(i))
      .catch(() => {});
  }, []);

  const byId = (id: string) => dimLoadouts.find((l) => l.id === id);
  const assigned = Object.values(entries)
    .filter((e) => e.loadoutId)
    .sort((a, b) => a.slot - b.slot);
  const withIssues = assigned.filter((e) => (byId(e.loadoutId)?.issues.length ?? 0) > 0).length;
  const missing = assigned.filter((e) => !byId(e.loadoutId)).length;

  const setEntry = (slot: number, patch: Partial<SetEntry>) =>
    setEntries((all) => ({ ...all, [slot]: { ...(all[slot] ?? { slot, loadoutId: "" }), ...patch } }));

  /** The look a slot will get: chosen, else what it has now. */
  const lookOf = (slot: GameLoadout): Look => {
    const e = entries[slot.index];
    return e?.nameHash && e.colorHash && e.iconHash
      ? { nameHash: e.nameHash, colorHash: e.colorHash, iconHash: e.iconHash }
      : {
          nameHash: slot.nameHash || ids?.names[0]?.hash || 0,
          colorHash: slot.colorHash || ids?.colors[0]?.hash || 0,
          iconHash: slot.iconHash || ids?.icons[0]?.hash || 0,
        };
  };
  const image = (list: { hash: number; value: string }[] | undefined, hash: number) =>
    list?.find((x) => x.hash === hash)?.value ?? null;

  const save = async () => {
    setError(null);
    try {
      const [all, id] = await loadoutSets.save({ ...set, name, entries: assigned });
      onSaved(all, id);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const remove = async () => {
    try {
      onDeleted(await loadoutSets.remove(set.id));
    } catch (e) {
      setError(String(e));
    }
  };

  // Every assigned loadout onto its slot, one after the other.
  const write = async () => {
    if (!(await save())) return;
    onRunning(true);
    setResults(null);
    const done: SetResult[] = [];
    for (const [i, e] of assigned.entries()) {
      const l = byId(e.loadoutId);
      const label = l?.name ?? t("sets.missing");
      setProgress({ i: i + 1, n: assigned.length, name: label, slot: e.slot, step: t("loadouts.starting") });
      if (!l) {
        done.push({ name: label, slot: e.slot, ok: false, messages: [t("sets.missingHint")] });
        continue;
      }
      const look: [number, number, number] | undefined =
        e.nameHash && e.colorHash && e.iconHash ? [e.nameHash, e.colorHash, e.iconHash] : undefined;
      try {
        const warnings = await loadouts.apply(l.id, e.slot, character, look);
        done.push({ name: label, slot: e.slot, ok: true, messages: warnings });
      } catch (err) {
        done.push({ name: label, slot: e.slot, ok: false, messages: [String(err)] });
      }
      setResults([...done]);
    }
    setResults(done);
    setProgress(null);
    onRunning(false);
    onWritten();
  };

  const busy = progress !== null;

  return (
    <GlassPanel className="flex flex-col gap-4 p-5">
      <PanelHeader title={set.id ? t("sets.editTitle") : t("sets.newTitle")} subtitle={t("sets.hint")} />
      <div className="flex gap-2">
        <GlassInput
          placeholder={t("sets.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus={!set.id}
        />
        <GlassButton onClick={() => void save()} disabled={busy || !name.trim()} className="shrink-0 whitespace-nowrap">
          {t("sets.save")}
        </GlassButton>
        <GlassButton
          variant="primary"
          onClick={() => void write()}
          disabled={busy || !name.trim() || assigned.length === 0}
          className="shrink-0 whitespace-nowrap"
        >
          {t("sets.write", { n: assigned.length })}
        </GlassButton>
      </div>
      {/* Writing: where it is, right below the button that started it. */}
      {progress && (
        <div className="animate-fade-in flex flex-col gap-2 rounded-xl border border-(--accent-glow) bg-(--accent-soft) px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-white">
            <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-(--accent)" />
            {t("sets.progress", { i: progress.i, n: progress.n, name: progress.name, slot: progress.slot + 1 })}
            <span className="ml-auto shrink-0 tabular-nums text-white/55">
              {progress.i} / {progress.n}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-text))] shadow-[0_0_4px_var(--accent-halo)] shadow-[0_0_5px_var(--accent)] transition-[width] duration-500"
              style={{ width: `${((progress.i - 1) / progress.n) * 100 + 100 / progress.n / 2}%` }}
            />
          </div>
          <p className="truncate text-[11.5px] text-white/60">{progress.step}</p>
        </div>
      )}
      {results && (
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {results.map((r, i) => (
            <li
              key={i}
              className={cx(
                "rounded-lg border px-3 py-2",
                !r.ok
                  ? "border-red-400/20 bg-red-500/10 text-red-200"
                  : r.messages.length
                    ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
                    : "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
              )}
            >
              <span className="font-semibold">
                {t("sets.slot", { n: r.slot + 1 })}: {r.name}
              </span>
              {r.ok && r.messages.length === 0 && ` – ${t("sets.ok")}`}
              {r.messages.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {r.messages.map((m, j) => (
                    <li key={j}>{m}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      {(withIssues > 0 || missing > 0) && (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
          {t("sets.issues", { n: withIssues + missing })}
        </p>
      )}
      <p className="-mb-2 text-[11.5px] text-white/40">{t("sets.dragHint")}</p>

      <div className="flex flex-col gap-1.5">
        {game.map((slot) => {
          const entry = entries[slot.index];
          const current = entry?.loadoutId ?? "";
          const look = lookOf(slot);
          const customLook = !!(entry?.nameHash && entry.colorHash && entry.iconHash);
          return (
            <div
              key={slot.index}
              onDragOver={(e) => {
                if (busy || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDragOver(slot.index);
              }}
              onDragLeave={() => setDragOver((d) => (d === slot.index ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = e.dataTransfer.getData(DRAG_TYPE);
                if (id) setEntry(slot.index, { loadoutId: id });
              }}
              className={cx(
                "relative flex items-center gap-3 rounded-xl border p-2 transition-[background-color,border-color] duration-150",
                dragOver === slot.index
                  ? "border-(--accent) bg-(--accent-soft)"
                  : "border-white/[0.06] bg-white/[0.03]",
              )}
            >
              <button
                onClick={() => setLookOpen(lookOpen === slot.index ? null : slot.index)}
                disabled={busy || !ids}
                title={t("sets.lookHint")}
                className={cx(
                  "shrink-0 rounded-md transition-[box-shadow] hover:shadow-[0_0_0_2px_var(--accent-halo)]",
                  customLook && "shadow-[0_0_0_2px_var(--accent-halo)]",
                )}
              >
                <SlotBadge
                  icon={image(ids?.icons, look.iconHash) ?? slot.icon}
                  color={image(ids?.colors, look.colorHash) ?? slot.color}
                  size={34}
                />
              </button>
              <div className="w-32 min-w-0 shrink-0">
                <div className="text-[10.5px] font-semibold tracking-[0.12em] text-white/40 uppercase">
                  {t("sets.slot", { n: slot.index + 1 })}
                </div>
                <div className="truncate text-[12px] text-white/70">
                  {customLook
                    ? (ids?.names.find((n) => n.hash === look.nameHash)?.value ?? slot.name)
                    : slot.empty
                      ? t("sets.slotEmpty")
                      : slot.name}
                </div>
              </div>
              <span className="text-white/25">→</span>
              <LoadoutSelect
                value={current}
                loadouts={dimLoadouts}
                disabled={busy}
                onChange={(id) => setEntry(slot.index, { loadoutId: id })}
              />
              {lookOpen === slot.index && ids && (
                <LookPicker
                  ids={ids}
                  value={look}
                  onChange={(next) => setEntry(slot.index, next)}
                  onClose={() => setLookOpen(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {set.id && (
        <div className="flex justify-end">
          <GlassButton
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
          >
            {confirmDelete ? t("sets.confirmDelete") : t("sets.delete")}
          </GlassButton>
        </div>
      )}
    </GlassPanel>
  );
}
