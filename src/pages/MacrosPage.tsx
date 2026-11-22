import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlassButton, GlassInput, KeyCap, Tooltip, cx } from "../components/glass";
import { HotkeyCaps } from "../components/HotkeysPanel";
import { IconClose, IconPlus, IconRefresh } from "../components/icons";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { keysFromEvent } from "../lib/hotkeys";
import { useLanguage, useT, type TranslationKey } from "../lib/i18n";
import {
  GAME_GROUPS,
  LINK_DELAY,
  MOUSE_BUTTONS,
  gameKeyFromKey,
  gameKeyFromMouse,
  gameKeyLabel,
  importCvars,
  keyName,
  macros as store,
  newMacro,
  lockCvars,
  readGameBindings,
  setGameKey,
  useAbilityIcons,
  useGameBindings,
  useKeyboardLayout,
  useMacros,
  usePlaying,
  type GameBindings,
  type Macro,
  type MacroMode,
  type Phase,
  type MouseButton,
  type Press,
  type Step,
} from "../lib/macros";

type Group = "basics" | keyof typeof GAME_GROUPS;
const GROUPS: readonly Group[] = ["basics", "abilities", "weapons", "movement", "vehicle", "menus", "other"];

/** What blocks look like: the game's keys and ability icons, the keyboard's labels. */
interface Look {
  bindings: GameBindings | null;
  icons: Record<string, string>;
  layout: ReturnType<typeof useKeyboardLayout>;
  german: boolean;
}

/** The blocks of a tab of the bar (and of the right-click menu). */
const groupSteps = (group: Group): Step[] =>
  group === "basics" ? BASICS : GAME_GROUPS[group].map((action): Step => ({ kind: "game", action, press: "tap" }));

/** A block of the bar told apart from the others. */
const stepId = (step: Step): string => (step.kind === "game" ? step.action : step.kind);

const BASICS: Step[] = [
  { kind: "key", code: "", press: "tap" },
  { kind: "mouse", button: "left", press: "tap" },
  { kind: "wait", ms: 100 },
];

const MODES: { mode: MacroMode; label: TranslationKey; hint: TranslationKey; icon: ReactNode }[] = [
  {
    mode: "once",
    label: "macros.mode.once",
    hint: "macros.mode.onceHint",
    icon: <path d="M4 12h15m-5-5 5 5-5 5" />,
  },
  {
    mode: "hold",
    label: "macros.mode.hold",
    hint: "macros.mode.holdHint",
    icon: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4" />,
  },
  {
    mode: "toggle",
    label: "macros.mode.toggle",
    hint: "macros.mode.toggleHint",
    icon: (
      <>
        <rect x="2.5" y="7" width="19" height="10" rx="5" />
        <circle cx="16" cy="12" r="2.6" fill="currentColor" />
      </>
    ),
  },
  {
    mode: "sequence",
    label: "macros.mode.sequence",
    hint: "macros.mode.sequenceHint",
    icon: (
      <>
        <rect x="3" y="5" width="9" height="9" rx="2" fill="currentColor" />
        <rect x="8" y="8" width="9" height="9" rx="2" />
        <rect x="13" y="11" width="8" height="8" rx="2" />
      </>
    ),
  },
];

const PHASES: { phase: Phase; label: TranslationKey }[] = [
  { phase: "press", label: "macros.phase.press" },
  { phase: "hold", label: "macros.phase.hold" },
  { phase: "release", label: "macros.phase.release" },
];
const PHASE_FIELD = { press: "pressSteps", hold: "steps", release: "releaseSteps" } as const;

/** Same key for two hotkey strings (modifiers in any order). */
const sameKey = (a: string, b: string) => {
  const norm = (k: string) => k.split("+").map((p) => p.trim().toLowerCase()).sort().join("+");
  return !!a && !!b && norm(a) === norm(b);
};

const PRESSES: { press: Press; label: string; hint: TranslationKey }[] = [
  { press: "tap", label: "↓↑", hint: "macros.press.tap" },
  { press: "down", label: "↓", hint: "macros.press.down" },
  { press: "up", label: "↑", hint: "macros.press.up" },
];

const actionLabel = (t: ReturnType<typeof useT>, action: string) => t(`macros.a.${action}` as TranslationKey);

/** Where a dragged block comes from: the bar below or the sequence itself. */
type Source = { from: "bar"; step: Step } | { from: "sequence"; index: number };
interface Drag {
  source: Source;
  x: number;
  y: number;
  /** Where it would land: the index among the other blocks (without the
   *  dragged one); null outside the sequence. */
  over: number | null;
  /** The dragged block's width, for the room made for it. */
  width: number;
}

/** Makros: macros built from blocks, like a recorder's timeline. The list
 *  on the left, the sequence of the open one in the middle, the blocks to
 *  drag into it in the bar below (keys, mouse buttons, waits and the game's
 *  own actions on whatever keys they're bound to in game). */
export function MacrosPage() {
  const t = useT();
  const [list, setList] = useMacros();
  const [bindings, setBindings] = useGameBindings();
  const icons = useAbilityIcons();
  const layout = useKeyboardLayout();
  const german = useLanguage() === "de";
  const look: Look = { bindings, icons, layout, german };
  const playing = usePlaying();
  const [selected, setSelected] = useState<string | null>(null);
  // The game's own key bindings open instead of a macro.
  const [gameKeys, setGameKeys] = useState(false);
  // Counts the clicks on it: each one reads the cvars.xml anew.
  const [gameKeysOpened, setGameKeysOpened] = useState(0);
  // Unsaved changes, per macro (kept when another one is opened).
  const [drafts, setDrafts] = useState<Record<string, Macro>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // The first one is open by default; a deleted one makes way for the next.
  useEffect(() => {
    if (!list.some((m) => m.id === selected)) setSelected(list[0]?.id ?? null);
  }, [list, selected]);
  useEffect(() => setError(null), [selected]);

  const saved = list.find((m) => m.id === selected) ?? null;
  const current = selected ? (drafts[selected] ?? saved) : null;
  const dirty = !!(saved && current && JSON.stringify(saved) !== JSON.stringify(current));

  // On the latest draft: several edits before a render (keys recorded in a
  // row) all count.
  const edit = (change: (m: Macro) => Macro) => {
    if (!saved) return;
    const base = saved;
    setDrafts((d) => ({ ...d, [base.id]: change(d[base.id] ?? base) }));
    setSavedFlash(false);
  };

  const create = () => {
    void store.save(newMacro(t("macros.untitled", { n: list.length + 1 }))).then((next) => {
      setList(next);
      setSelected(next[next.length - 1]?.id ?? null);
      setGameKeys(false);
    });
  };

  const save = () => {
    if (!current) return;
    void store
      .save(current)
      .then((next) => {
        setList(next);
        setDrafts(({ [current.id]: _, ...rest }) => rest);
        setError(null);
        setSavedFlash(true);
      })
      .catch((e) => setError(String(e)));
  };

  const reset = () => {
    if (!selected) return;
    setDrafts(({ [selected]: _, ...rest }) => rest);
    setError(null);
  };

  const remove = (id: string) => {
    void store.remove(id).then((next) => {
      setList(next);
      setDrafts(({ [id]: _, ...rest }) => rest);
    });
  };

  // The switch in the list saves at once (the saved macro, not the draft).
  const setEnabled = (item: Macro, enabled: boolean) => {
    setDrafts((d) => (d[item.id] ? { ...d, [item.id]: { ...d[item.id], enabled } } : d));
    void store
      .save({ ...item, enabled })
      .then(setList)
      .catch((e) => {
        setSelected(item.id);
        setError(String(e));
      });
  };

  // Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "s" && dirty) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-black/25">
        <div className="flex h-12 items-center justify-between pr-2 pl-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">{t("macros.title")}</span>
          <Tooltip label={t("macros.new")} align="end">
            <button
              type="button"
              aria-label={t("macros.new")}
              onClick={create}
              className="grid size-8 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconPlus />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {list.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelected(item.id);
                setGameKeys(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                setSelected(item.id);
                setGameKeys(false);
              }}
              className={cx(
                "mb-1 flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors",
                item.id === selected && !gameKeys ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {playing.has(item.id) && (
                    <span title={t("macros.playing")} className="size-1.5 shrink-0 animate-pulse rounded-full bg-(--accent)" />
                  )}
                  <span className={cx("truncate text-[13px]", item.enabled ? "text-white/90" : "text-white/40")}>
                    {item.name || t("macros.untitled", { n: "" })}
                  </span>
                  {drafts[item.id] && JSON.stringify(drafts[item.id]) !== JSON.stringify(item) && (
                    <span title={t("macros.unsaved")} className="size-1.5 shrink-0 rounded-full bg-amber-300/80" />
                  )}
                </div>
                <div className="mt-1 scale-90 origin-left">
                  <HotkeyCaps keys={item.hotkey} />
                </div>
              </div>
              <Switch checked={item.enabled} label={t("macros.on")} onChange={(on) => setEnabled(item, on)} />
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.06] p-2">
          <button
            type="button"
            onClick={() => {
              setGameKeys(true);
              setGameKeysOpened((n) => n + 1);
            }}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors",
              gameKeys ? "bg-white/[0.08] text-white" : "text-white/70 hover:bg-white/[0.04] hover:text-white",
            )}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
            </svg>
            {t("macros.gameKeys")}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {gameKeys ? (
          <GameKeys key={gameKeysOpened} look={look} onBindings={setBindings} />
        ) : current ? (
          <Editor
            key={current.id}
            item={current}
            others={list.filter((m) => m.id !== current.id)}
            look={look}
            onBindings={setBindings}
            dirty={dirty}
            error={error}
            savedFlash={savedFlash}
            onEdit={edit}
            onSave={save}
            onReset={reset}
            onRemove={() => remove(current.id)}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="flex max-w-sm flex-col items-center text-center">
              <button
                type="button"
                onClick={create}
                className="flex items-center gap-4 rounded-xl text-left text-white/85 transition-colors hover:text-white"
              >
                <span className="grid size-12 place-items-center rounded-lg bg-white/[0.1] transition-colors hover:bg-white/[0.16]">
                  <IconPlus />
                </span>
                <span className="text-[13px] font-semibold tracking-[0.08em] uppercase">{t("macros.start")}</span>
              </button>
              <p className="mt-5 text-[12.5px] leading-relaxed text-white/45">{t("macros.emptyHint")}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Editor({
  item: full,
  others,
  look,
  onBindings,
  dirty,
  error,
  savedFlash,
  onEdit: editFull,
  onSave,
  onReset,
  onRemove,
}: {
  item: Macro;
  others: Macro[];
  look: Look;
  onBindings: (b: GameBindings) => void;
  dirty: boolean;
  error: string | null;
  savedFlash: boolean;
  onEdit: (change: (m: Macro) => Macro) => void;
  onSave: () => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { bindings, icons } = look;
  // A sequence edits one of its three parts at a time: the editor below works
  // on `item.steps`, which is that part.
  const [phase, setPhase] = useState<Phase>("press");
  const sequenceMode = full.mode === "sequence";
  const field = sequenceMode ? PHASE_FIELD[phase] : "steps";
  const item: Macro = sequenceMode ? { ...full, steps: full[field] ?? [] } : full;
  const onEdit = (change: (m: Macro) => Macro) =>
    editFull((m) => {
      if (m.mode !== "sequence" || field === "steps") return change(m);
      const view = change({ ...m, steps: m[field] ?? [] });
      return { ...view, steps: m.steps, [field]: view.steps };
    });
  const sharing = others.filter((m) => sameKey(m.hotkey, full.hotkey));
  const [group, setGroup] = useState<Group>("abilities");
  // Searched in the bar: the blocks of every tab instead of one.
  const [blockQuery, setBlockQuery] = useState("");
  const [recording, setRecording] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Right-click on the sequence: a menu of every block, put in where clicked.
  const [menu, setMenu] = useState<{ x: number; y: number; at: number } | null>(null);
  const held = useRef(new Set<string>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sequence = useRef<HTMLDivElement>(null);
  // The blocks in the sequence by their place among the others (the dragged
  // one isn't among them), and the room made for the dragged one.
  const chips = useRef(new Map<number, HTMLElement>());
  const gap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const id = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmDelete]);

  const setSteps = (change: (steps: Step[]) => Step[]) => onEdit((m) => ({ ...m, steps: change(m.steps) }));
  const setStep = (index: number, step: Step) => setSteps((s) => s.map((old, i) => (i === index ? step : old)));

  const insert = (step: Step, at: number) => {
    setSteps((s) => [...s.slice(0, at), step, ...s.slice(at)]);
    // A key block asks for its key right away.
    if (step.kind === "key" && !step.code) setRecording(at);
  };

  // Recording the key of a key block: the next key pressed (any, Esc too);
  // a click elsewhere cancels.
  useEffect(() => {
    if (recording === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const step = item.steps[recording];
      if (step?.kind === "key") setStep(recording, { ...step, code: e.code });
      setRecording(null);
    };
    const cancel = () => setRecording(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("blur", cancel);
    };
  });

  // Recording: every key and mouse button pressed becomes a block at the
  // end. Pressed and let go with nothing between: a tap; else its press and
  // its letting go (Shift held over A: Shift down, A tap, Shift up). The
  // wheel: a block per notch. Clicks do nothing else meanwhile (but stop).
  useEffect(() => {
    if (!capturing) return;
    held.current.clear();
    const ident = (step: Step) => (step.kind === "key" ? `key:${step.code}` : step.kind === "mouse" ? `mouse:${step.button}` : "");
    const down = (step: Step & { press: Press }) => {
      const id = ident(step);
      if (held.current.has(id)) return;
      held.current.add(id);
      setSteps((s) => [...s, { ...step, press: "down" }]);
    };
    const up = (step: Step & { press: Press }) => {
      const id = ident(step);
      if (!held.current.delete(id)) return;
      setSteps((s) => {
        const last = s[s.length - 1];
        return last && last.kind !== "wait" && last.press === "down" && ident(last) === id
          ? [...s.slice(0, -1), { ...last, press: "tap" }]
          : [...s, { ...step, press: "up" }];
      });
    };
    const isStop = (e: Event) => !!(e.target as Element | null)?.closest?.("[data-capture-stop]");
    const BUTTONS: (MouseButton | undefined)[] = ["left", "middle", "right", "x1", "x2"];

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || !e.code) return;
      const step: Step = { kind: "key", code: e.code, press: "tap" };
      if (e.type === "keydown") down(step);
      else up(step);
    };
    const onMouse = (e: MouseEvent) => {
      if (isStop(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const button = BUTTONS[e.button];
      if (!button) return;
      const step: Step = { kind: "mouse", button, press: "tap" };
      if (e.type === "mousedown") down(step);
      else up(step);
    };
    // A notch at a time (a touchpad sends many small ones).
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      if (isStop(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.deltaY === 0 || e.timeStamp - lastWheel < 80) return;
      lastWheel = e.timeStamp;
      const button: MouseButton = e.deltaY < 0 ? "wheelup" : "wheeldown";
      setSteps((s) => [...s, { kind: "mouse", button, press: "tap" }]);
    };
    // Clicks reach nothing else while recording.
    const swallow = (e: Event) => {
      if (isStop(e)) return;
      if (e.type !== "pointerdown" && e.type !== "pointerup") e.preventDefault();
      e.stopImmediatePropagation();
    };
    const stop = () => setCapturing(false);

    const events: [string, (e: never) => void, AddEventListenerOptions][] = [
      ["keydown", onKey, { capture: true }],
      ["keyup", onKey, { capture: true }],
      ["mousedown", onMouse, { capture: true }],
      ["mouseup", onMouse, { capture: true }],
      ["wheel", onWheel, { capture: true, passive: false }],
      ["pointerdown", swallow, { capture: true }],
      ["pointerup", swallow, { capture: true }],
      ["click", swallow, { capture: true }],
      ["auxclick", swallow, { capture: true }],
      ["dblclick", swallow, { capture: true }],
      ["contextmenu", swallow, { capture: true }],
      ["blur", stop, {}],
    ];
    for (const [type, fn, options] of events) window.addEventListener(type, fn as EventListener, options);
    return () => {
      for (const [type, fn, options] of events) window.removeEventListener(type, fn as EventListener, options);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  // Where in the sequence a point lands: before or after the block nearest
  // to it (among the others); on the room already made for it, there.
  const dropIndex = (x: number, y: number, now: number | null): number | null => {
    const box = sequence.current?.getBoundingClientRect();
    if (!box || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    const room = gap.current?.getBoundingClientRect();
    if (now !== null && room && x >= room.left - 6 && x <= room.right + 6 && y >= room.top - 8 && y <= room.bottom + 8) return now;
    let best: { slot: number; distance: number; after: boolean } | null = null;
    for (const [slot, el] of chips.current) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Rows count more than columns: the nearest block in the row under the pointer.
      const distance = Math.abs(x - cx) + Math.abs(y - cy) * 3;
      if (!best || distance < best.distance) best = { slot, distance, after: x > cx };
    }
    return best ? best.slot + (best.after ? 1 : 0) : 0;
  };

  // Dragging (by pointer: the webview has no HTML drag and drop). The other
  // blocks make room where it would land, so the sequence shows how it will
  // be. A click without moving adds a block from the bar at the end.
  const startDrag = (e: ReactPointerEvent<HTMLElement>, source: Source) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const width = source.from === "sequence" ? e.currentTarget.getBoundingClientRect().width : 140;
    let moved = false;
    let over: number | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      moved = true;
      over = dropIndex(ev.clientX, ev.clientY, over);
      setDrag({ source, x: ev.clientX, y: ev.clientY, over, width });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moved) {
        if (source.from === "bar") insert(source.step, item.steps.length);
        return;
      }
      if (over === null) return;
      if (source.from === "bar") insert(source.step, over);
      else {
        const to = over;
        setSteps((s) => {
          const rest = s.filter((_, i) => i !== source.index);
          rest.splice(to, 0, s[source.index]);
          return rest;
        });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // What the sequence shows: its blocks; while dragging over it, without the
  // dragged one and with room for it where it would land.
  const draggedIndex = drag?.source.from === "sequence" ? drag.source.index : null;
  const draggedStep = drag ? (drag.source.from === "bar" ? drag.source.step : item.steps[drag.source.index]) : null;
  type Entry = { gap: false; step: Step; index: number; slot: number | null } | { gap: true; step: Step };
  let entries: Entry[] = item.steps.map((step, index) => ({
    gap: false,
    step,
    index,
    slot: draggedIndex === null ? index : index === draggedIndex ? null : index - (index > draggedIndex ? 1 : 0),
  }));
  if (drag?.over != null && draggedStep) {
    entries = entries.filter((e) => e.gap || e.slot !== null);
    entries.splice(drag.over, 0, { gap: true, step: draggedStep });
  }
  const mode = MODES.find((m) => m.mode === item.mode) ?? MODES[0];

  const blockLabel = (step: Step): string =>
    step.kind === "game"
      ? actionLabel(t, step.action)
      : step.kind === "key"
        ? step.code
          ? `${t("macros.kind.key")} ${keyName(step.code, look.german, look.layout)}`
          : t("macros.kind.key")
        : step.kind === "mouse"
          ? t("macros.kind.mouse")
          : t("macros.kind.wait");

  // The bar's blocks: the open tab's, or while searching those of every tab
  // whose name, tab or bound key has every word.
  const blockWords = blockQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = blockWords.length > 0;
  const onSearchedKey = (step: Step) =>
    step.kind === "game" &&
    (bindings?.keys[step.action] ?? []).some((k) => blockWords.includes(gameKeyLabel(k, look.german, look.layout).toLowerCase()));
  const barSteps = !searching
    ? groupSteps(group)
    : GROUPS.flatMap((g) => {
        const title = t(`macros.group.${g}` as TranslationKey).toLowerCase();
        return groupSteps(g).filter((step) => {
          const keys =
            step.kind === "game"
              ? (bindings?.keys[step.action] ?? []).map((k) => gameKeyLabel(k, look.german, look.layout).toLowerCase())
              : [];
          const text = `${blockLabel(step)} ${title} ${step.kind === "game" ? step.action.replace(/_/g, " ") : ""}`.toLowerCase();
          return blockWords.every((w) => text.includes(w) || keys.includes(w));
        });
      })
        .filter((step, i, all) => all.findIndex((s) => stepId(s) === stepId(step)) === i)
        // Those on a searched key first.
        .sort((a, b) => Number(onSearchedKey(b)) - Number(onSearchedKey(a)));

  return (
    <div className={cx("flex min-h-0 flex-1 flex-col", drag && "cursor-grabbing select-none")}>
      {/* Name, type and hotkey; the options on the right. */}
      <div className="flex shrink-0 gap-8 px-7 pt-6 pb-4">
        <div className="min-w-0 flex-1">
          <input
            value={item.name}
            onChange={(e) => onEdit((m) => ({ ...m, name: e.target.value }))}
            placeholder={t("macros.name")}
            spellCheck={false}
            maxLength={60}
            className="w-full max-w-md border-b border-transparent bg-transparent pb-1 font-display text-[22px] font-semibold text-white outline-none placeholder:text-white/25 hover:border-white/10 focus:border-white/25"
          />
          <div className="mt-3 flex items-center gap-3">
            <span className="w-20 text-[12.5px] font-medium text-white/60">{t("macros.type")}</span>
            <div className="flex gap-1.5">
              {MODES.map((m) => (
                <Tooltip key={m.mode} label={t(m.label)}>
                  <button
                    type="button"
                    aria-label={t(m.label)}
                    aria-pressed={item.mode === m.mode}
                    onClick={() => onEdit((x) => ({ ...x, mode: m.mode }))}
                    className={cx(
                      "grid size-9 place-items-center rounded-lg border transition-colors",
                      item.mode === m.mode
                        ? "border-(--accent) bg-(--accent-soft) text-white"
                        : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white",
                    )}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      {m.icon}
                    </svg>
                  </button>
                </Tooltip>
              ))}
            </div>
            <span className="text-[12px] text-white/45">{t(mode.hint)}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-20 text-[12.5px] font-medium text-white/60">{t("macros.hotkey")}</span>
            <HotkeyField keys={item.hotkey} onChange={(hotkey) => onEdit((m) => ({ ...m, hotkey }))} />
            <span className="text-[12px] text-white/40">{t("macros.hotkeyHint")}</span>
          </div>
          {sharing.length > 0 && (
            <p className="mt-2 ml-[92px] inline-flex items-center gap-1.5 rounded-md bg-amber-300/10 px-2 py-1 text-[12px] text-amber-200/90">
              <span aria-hidden>ⓘ</span>
              {t(sharing.length === 1 ? "macros.sharedOne" : "macros.sharedMany", {
                names: sharing.map((m) => m.name || t("macros.untitled", { n: "" })).join(", "),
              })}
            </p>
          )}
          {sequenceMode && (
            <div className="mt-3 flex items-center gap-3">
              <span className="w-20 text-[12.5px] font-medium text-white/60">{t("macros.phase")}</span>
              <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
                {PHASES.map((p) => (
                  <button
                    key={p.phase}
                    type="button"
                    aria-pressed={phase === p.phase}
                    onClick={() => setPhase(p.phase)}
                    className={cx(
                      "rounded-md px-3 py-1 text-[12.5px] transition-colors",
                      phase === p.phase ? "bg-(--accent-soft) text-white" : "text-white/55 hover:text-white",
                    )}
                  >
                    {t(p.label)}
                    <span className="ml-1.5 text-white/35">{(full[PHASE_FIELD[p.phase]] ?? []).length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex w-64 shrink-0 flex-col gap-3 pt-1">
          <div>
            <div className="flex items-center gap-2.5">
              <Check
                checked={item.delay > 0}
                label={t("macros.delay")}
                onChange={(on) => onEdit((m) => ({ ...m, delay: on ? 50 : 0 }))}
              />
              <span className="flex-1 text-[12.5px] font-semibold tracking-[0.04em] text-white/85 uppercase">{t("macros.delay")}</span>
              {item.delay > 0 && (
                <MsInput value={item.delay} min={1} onChange={(delay) => onEdit((m) => ({ ...m, delay }))} />
              )}
            </div>
            <p className="mt-1 pl-[30px] text-[12px] leading-snug text-white/45">{t("macros.delayHint")}</p>
          </div>
          <div className="mt-auto flex justify-end">
            <GlassButton
              size="sm"
              variant={confirmDelete ? "danger" : "ghost"}
              onClick={() => (confirmDelete ? onRemove() : setConfirmDelete(true))}
            >
              {t(confirmDelete ? "macros.deleteConfirm" : "macros.delete")}
            </GlassButton>
          </div>
        </div>
      </div>

      {/* The sequence: blocks dropped here, in order. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-7 py-3"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea")) return;
          e.preventDefault();
          if (drag) return;
          setRecording(null);
          setMenu({ x: e.clientX, y: e.clientY, at: dropIndex(e.clientX, e.clientY, null) ?? item.steps.length });
        }}
      >
        <div
          ref={sequence}
          className={cx(
            "flex min-h-full flex-wrap content-start items-center gap-y-4 rounded-2xl border border-dashed p-5 transition-colors",
            drag?.over != null ? "border-(--accent)/50 bg-white/[0.02]" : "border-white/[0.07]",
          )}
        >
          {entries.length === 0 && (
            <div className="grid w-full place-items-center py-14 text-center">
              <div className="flex items-center gap-4 text-white/70">
                <span className="grid size-12 place-items-center rounded-lg bg-white/[0.08]">
                  <IconPlus />
                </span>
                <div className="text-left">
                  <div className="text-[13px] font-semibold tracking-[0.06em] uppercase">{t("macros.dropHere")}</div>
                  <div className="text-[12px] text-white/40">{t("macros.dropHint")}</div>
                </div>
              </div>
            </div>
          )}
          {entries.flatMap((entry, i) => {
            const out: ReactNode[] = [];
            if (i > 0) {
              // Between two blocks: the standard delay, or (without it) the
              // wait set here, 50 ms unless changed; nothing next to a wait.
              const before = entries[i - 1];
              const prev = before.step;
              const timed = prev.kind !== "wait" && entry.step.kind !== "wait";
              const ms = item.delay > 0 ? item.delay : prev.kind !== "wait" ? (prev.after ?? LINK_DELAY) : 0;
              out.push(
                <span key={`link${entry.gap ? "gap" : entry.index}`} className="flex shrink-0 items-center px-1 text-[10.5px] text-white/30 tabular-nums">
                  {!timed ? (
                    <span className="h-px w-3 bg-white/15" />
                  ) : item.delay > 0 || drag || before.gap ? (
                    `${ms} ms`
                  ) : (
                    <MsInput small value={ms} min={0} onChange={(after) => setStep(before.index, { ...prev, after })} />
                  )}
                </span>,
              );
            }
            if (entry.gap) {
              out.push(
                <div
                  key="gap"
                  ref={gap}
                  style={{ width: drag?.width }}
                  className="h-[74px] shrink-0 rounded-xl border border-dashed border-(--accent)/70 bg-(--accent-soft)"
                />,
              );
              return out;
            }
            const { step, index, slot } = entry;
            out.push(
              <div
                key={`step${index}`}
                ref={(el) => {
                  if (slot === null) return;
                  if (el) chips.current.set(slot, el);
                  else chips.current.delete(slot);
                }}
                onPointerDown={(e) => startDrag(e, { from: "sequence", index })}
                className={cx("touch-none", slot === null && "opacity-30")}
              >
                <StepBlock
                  step={step}
                  look={look}
                  recording={recording === index}
                  onRecord={() => setRecording(index)}
                  onChange={(next) => setStep(index, next)}
                  onRemove={() => setSteps((s) => s.filter((_, i) => i !== index))}
                />
              </div>,
            );
            return out;
          })}
        </div>
      </div>

      {/* The blocks to drag in, by group. */}
      <div className="shrink-0 border-t border-white/[0.06] bg-black/35">
        <div className="flex items-center gap-1 px-5 pt-2.5">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                setGroup(g);
                setBlockQuery("");
              }}
              className={cx(
                "rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors",
                group === g && !searching ? "bg-white/[0.08] text-white" : "text-white/40 hover:text-white/75",
              )}
            >
              {t(`macros.group.${g}` as TranslationKey)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={capturing}
            data-capture-stop
            onClick={() => {
              setRecording(null);
              setCapturing(!capturing);
            }}
            className={cx(
              "ml-3 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors",
              capturing ? "bg-white/[0.1] text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
            )}
          >
            <span className={cx("size-2 rounded-full bg-red-400", capturing ? "animate-pulse" : "opacity-70")} />
            {t(capturing ? "macros.recordStop" : "macros.record")}
          </button>
          {capturing && <span className="text-[11.5px] text-white/55">{t("macros.recordHint")}</span>}
          <div className="mr-4 ml-auto w-56 shrink-0">
            <GlassInput
              className="h-7 text-[12px]"
              placeholder={t("macros.gameKeysSearch")}
              value={blockQuery}
              onChange={(e) => setBlockQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBlockQuery("")}
              onClear={() => setBlockQuery("")}
              clearLabel={t("common.clear")}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-white/55 hover:text-white/80">
            <Check
              checked={item.focused ?? true}
              label={t("macros.onlyInGame")}
              onChange={(focused) => onEdit((m) => ({ ...m, focused }))}
            />
            {t("macros.onlyInGame")}
          </label>
        </div>
        {bindings && !bindings.found && (group !== "basics" || searching) && (
          <div className="mx-5 mt-2 flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-amber-200">{t("macros.noCvars")}</p>
            <CvarsUpload label={t("macros.uploadCvars")} onLoaded={onBindings} />
          </div>
        )}
        {bindings?.uploaded && (group !== "basics" || searching) && (
          <div className="mx-5 mt-2 flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[12px] text-white/45">{t("macros.cvarsUploaded")}</p>
            <CvarsUpload label={t("macros.replaceCvars")} onLoaded={onBindings} />
          </div>
        )}
        <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto px-5 pt-2.5 pb-3">
          {barSteps.length === 0 && <span className="py-2 text-[12.5px] text-white/40">{t("macros.gameKeysNone")}</span>}
          {barSteps.map((step) => {
            const keys = step.kind === "game" ? (bindings?.keys[step.action] ?? []) : null;
            const unbound = keys !== null && keys.length === 0;
            return (
              <Tooltip key={stepId(step)} label={unbound ? t("macros.unbound") : t("macros.dragHint")}>
                <div
                  onPointerDown={(e) => !unbound && startDrag(e, { from: "bar", step })}
                  className={cx(
                    "flex h-9 touch-none items-center gap-2 rounded-lg border px-3 text-[12.5px] select-none",
                    unbound
                      ? "cursor-not-allowed border-white/[0.05] text-white/25"
                      : "cursor-grab border-white/10 bg-white/[0.05] text-white/85 hover:border-white/20 hover:bg-white/[0.09]",
                  )}
                >
                  <BlockGlyph step={step} icons={icons} />
                  {blockLabel(step)}
                  {keys && keys[0] && <span className="text-[11px] text-white/40">{gameKeyLabel(keys[0], look.german, look.layout)}</span>}
                </div>
              </Tooltip>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-white/[0.04] px-5 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[12px]">
            {error ? (
              <span className="text-red-300">{error}</span>
            ) : dirty ? (
              <span className="text-amber-200/80">{t("macros.unsaved")}</span>
            ) : savedFlash ? (
              <span className="text-white/45">{t("macros.saved")}</span>
            ) : null}
          </span>
          <GlassButton size="sm" disabled={!dirty} onClick={onReset} className="w-32">
            {t("macros.reset")}
          </GlassButton>
          <GlassButton size="sm" variant="primary" disabled={!dirty} onClick={onSave} className="w-32">
            {t("macros.save")}
          </GlassButton>
        </div>
      </div>

      {menu && (
        <BlockMenu
          x={menu.x}
          y={menu.y}
          label={blockLabel}
          icons={icons}
          bindings={bindings}
          look={look}
          onPick={(step) => {
            insert(step, menu.at);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {drag && (
        // The block under the pointer while dragged.
        <div className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-1/2" style={{ left: drag.x, top: drag.y }}>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-(--accent) bg-[#0d1017]/95 px-3 text-[12.5px] text-white shadow-[0_8px_24px_-8px_rgb(0_0_0/0.9)]">
            {draggedStep && (
              <>
                <BlockGlyph step={draggedStep} icons={icons} />
                {blockLabel(draggedStep)}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The right-click menu: the tabs of the bar from top to bottom, a tab's
 *  blocks beside it while pointed at (or clicked). */
function BlockMenu({
  x,
  y,
  label,
  icons,
  bindings,
  look,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  label: (step: Step) => string;
  icons: Record<string, string>;
  bindings: GameBindings | null;
  look: Look;
  onPick: (step: Step) => void;
  onClose: () => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<{ group: Group; top: number } | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Inside the window: moved back from the right and bottom edges.
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);
  // The blocks beside the menu, on the right unless there is no room.
  useLayoutEffect(() => {
    const m = box.current?.getBoundingClientRect();
    const r = sub.current?.getBoundingClientRect();
    if (!open || !m || !r) return setSubPos(null);
    const right = m.right + 4;
    setSubPos({
      left: right + r.width > window.innerWidth - 8 ? m.left - r.width - 4 : right,
      top: Math.max(8, Math.min(open.top - 4, window.innerHeight - r.height - 8)),
    });
  }, [open, pos]);
  // Closed by a click elsewhere, Escape, or the window losing focus.
  useEffect(() => {
    const inside = (e: Event) => !!(e.target as Element | null)?.closest?.("[data-block-menu]");
    const down = (e: PointerEvent) => !inside(e) && close.current();
    const wheel = (e: WheelEvent) => !inside(e) && close.current();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const blur = () => close.current();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("wheel", wheel, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, []);

  const panel = "fixed rounded-lg border border-white/10 bg-[#0b0d14]/95 py-1 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]";
  const offscreen = { left: -9999, top: -9999 };
  return createPortal(
    <>
      <div
        ref={box}
        data-block-menu
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        className={cx(panel, "z-[200] w-48")}
        style={pos ?? offscreen}
      >
        <div className="px-3 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-white/35 uppercase">
          {t("macros.insertBlock")}
        </div>
        {GROUPS.map((g) => {
          const show = (el: HTMLElement) => setOpen({ group: g, top: el.getBoundingClientRect().top });
          return (
            <button
              key={g}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open?.group === g}
              onPointerEnter={(e) => show(e.currentTarget)}
              onClick={(e) => show(e.currentTarget)}
              className={cx(
                "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] transition-colors",
                open?.group === g ? "bg-white/[0.08] text-white" : "text-white/75 hover:bg-white/[0.05]",
              )}
            >
              {t(`macros.group.${g}` as TranslationKey)}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          );
        })}
      </div>
      {open && (
        <div
          ref={sub}
          data-block-menu
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          className={cx(panel, "z-[201] max-h-[min(420px,calc(100vh-16px))] w-60 overflow-y-auto")}
          style={subPos ?? offscreen}
        >
          {groupSteps(open.group).map((step) => {
            const keys = step.kind === "game" ? (bindings?.keys[step.action] ?? []) : null;
            const unbound = keys !== null && keys.length === 0;
            return (
              <button
                key={step.kind === "game" ? step.action : step.kind}
                type="button"
                role="menuitem"
                disabled={unbound}
                title={unbound ? t("macros.unbound") : undefined}
                onClick={() => onPick(step)}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors",
                  unbound ? "cursor-not-allowed text-white/25" : "text-white/85 hover:bg-white/[0.08] hover:text-white",
                )}
              >
                <BlockGlyph step={step} icons={icons} />
                <span className="min-w-0 flex-1 truncate">{label(step)}</span>
                {keys && keys[0] && <span className="shrink-0 text-[11px] text-white/40">{gameKeyLabel(keys[0], look.german, look.layout)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>,
    document.body,
  );
}

/** Destiny's own key bindings (its cvars.xml), changed right there: each
 *  action with its two places. */
function GameKeys({ look, onBindings }: { look: Look; onBindings: (b: GameBindings) => void }) {
  const t = useT();
  const { bindings, icons } = look;
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [query, setQuery] = useState("");
  const editable = !!bindings?.found && !bindings.uploaded;

  // The actions whose name (or group) has every word searched for.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (Object.keys(GAME_GROUPS) as (keyof typeof GAME_GROUPS)[])
    .map((group) => {
      const title = t(`macros.group.${group}` as TranslationKey);
      const actions = GAME_GROUPS[group].filter((action) => {
        const text = `${actionLabel(t, action)} ${title} ${action.replace(/_/g, " ")}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      return { group, title, actions };
    })
    .filter((g) => g.actions.length > 0);

  const apply = (change: Promise<GameBindings>) => {
    setBusy(true);
    setNote(null);
    void change
      .then((b) => {
        onBindings(b);
        setError(null);
        setNote(t("macros.keySaved"));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  // Reads the cvars.xml anew (on opening and with the button): Destiny may
  // have changed it since. The spinner turns at least a moment.
  const read = () => {
    setReading(true);
    setNote(null);
    void Promise.all([readGameBindings(), new Promise((done) => setTimeout(done, 450))])
      .then(([b]) => {
        onBindings(b);
        setError(null);
        setNote(t("macros.keysRead", { time: new Date().toLocaleTimeString() }));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setReading(false));
  };
  useEffect(read, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-6 border-b border-white/[0.06] px-7 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-white">{t("macros.gameKeys")}</h2>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-white/45">{t("macros.gameKeysHint")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            title={t("macros.readKeys")}
            aria-label={t("macros.readKeys")}
            disabled={reading || busy}
            onClick={read}
            className="grid size-8 place-items-center rounded-md text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none"
          >
            <span className={cx("grid place-items-center", reading && "animate-spin")}>
              <IconRefresh />
            </span>
          </button>
          {editable && (
            <label
              title={t("macros.lockCvarsHint")}
              className="flex cursor-pointer items-center gap-2 text-[12px] text-white/55 hover:text-white/80"
            >
              <Check
                checked={bindings.locked}
                label={t("macros.lockCvars")}
                onChange={(locked) => !busy && apply(lockCvars(locked))}
              />
              {t("macros.lockCvars")}
            </label>
          )}
        </div>
      </header>
      <div className="flex shrink-0 items-center gap-4 px-7 py-3 text-[12px]">
        <div className="w-72 shrink-0">
          <GlassInput
            className="h-9 text-[13px]"
            placeholder={t("macros.gameKeysSearch")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            onClear={() => setQuery("")}
            clearLabel={t("common.clear")}
          />
        </div>
        {!editable ? (
          <span className="text-amber-200/80">{t("macros.gameKeysNoFile")}</span>
        ) : error ? (
          <span className="text-red-300">{error}</span>
        ) : note ? (
          <span className="text-white/45">{note}</span>
        ) : null}
        {editable && bindings.locked && (
          <span className="ml-auto text-right text-amber-200/70">{t("macros.lockedNoSave")}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {shown.length === 0 && <p className="px-2 pt-2 text-[12.5px] text-white/40">{t("macros.gameKeysNone")}</p>}
        {shown.map(({ group, title, actions }) => (
          <section key={group} className="mb-5">
            <h3 className="mb-1 px-2 text-[10.5px] font-semibold tracking-[0.1em] text-white/35 uppercase">{title}</h3>
            {actions.map((action) => (
              <div key={action} className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-white/[0.03]">
                <BlockGlyph step={{ kind: "game", action, press: "tap" }} icons={icons} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{actionLabel(t, action)}</span>
                {[0, 1].map((slot) => {
                  const value = bindings?.slots[action]?.[slot] ?? "";
                  return (
                    <div key={slot} className="flex shrink-0 items-center gap-1">
                      <GameKeyField
                        look={look}
                        value={value}
                        disabled={!editable || busy || reading}
                        onChange={(key) => apply(setGameKey(action, slot, key))}
                        onUnsupported={(dropped) => {
                          setNote(null);
                          setError(t(dropped ? "macros.keyDropped" : "macros.keyNotWritable"));
                        }}
                      />
                      {/* Frees this place only. */}
                      <button
                        type="button"
                        title={t("macros.clearKey")}
                        aria-label={t("macros.clearKey")}
                        disabled={!editable || busy || !value}
                        onClick={() => apply(setGameKey(action, slot, ""))}
                        className={cx(
                          "grid size-8 shrink-0 place-items-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white",
                          "disabled:pointer-events-none",
                          !value && "invisible",
                        )}
                      >
                        <IconRefresh />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** One place of a game action: click, then press a key, a mouse button or
 *  turn the wheel (Esc cancels; the button beside it frees it). */
function GameKeyField({
  look,
  value,
  disabled,
  onChange,
  onUnsupported,
}: {
  look: Look;
  value: string;
  disabled: boolean;
  onChange: (key: string) => void;
  onUnsupported: (dropped: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const done = useRef({ onChange, onUnsupported });
  done.current = { onChange, onUnsupported };
  useEffect(() => {
    if (!recording) return;
    const take = (key: string | null) => {
      setRecording(false);
      if (key === null) done.current.onUnsupported(false);
      else if (key !== value) done.current.onChange(key);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return setRecording(false);
      // ß on a German keyboard: Destiny loses it when it starts.
      if (e.code === "Minus") {
        setRecording(false);
        return done.current.onUnsupported(true);
      }
      take(gameKeyFromKey(e));
    };
    // The click that binds a mouse button reaches nothing else (no new
    // recording, no menu, no going back a page).
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const after = ["mouseup", "click", "auxclick", "contextmenu"];
    const release = () => after.forEach((type) => window.removeEventListener(type, swallow, true));
    const onMouse = (e: MouseEvent) => {
      swallow(e);
      window.addEventListener("mouseup", () => setTimeout(release, 0), { capture: true, once: true });
      after.forEach((type) => window.addEventListener(type, swallow, true));
      setTimeout(release, 3000);
      take(gameKeyFromMouse(e.button));
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      swallow(e);
      take(e.deltaY < 0 ? "mouse wheel up" : "mouse wheel down");
    };
    const cancel = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recording, value]);
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setRecording(true)}
      className={cx(
        "flex h-8 w-36 shrink-0 items-center justify-center rounded-lg border px-2 text-[12px] transition-colors",
        recording
          ? "border-(--accent) bg-(--accent-soft)"
          : "border-white/10 bg-white/[0.04] enabled:hover:border-white/20 enabled:hover:bg-white/[0.08]",
        disabled && !recording && "cursor-not-allowed opacity-50",
      )}
    >
      {recording ? (
        <span className="animate-pulse text-(--accent-text)">{t("hotkeys.press")}</span>
      ) : value ? (
        <span className="flex items-center gap-1">
          {value.split("+").map((part, i) => (
            <KeyCap key={i}>{gameKeyLabel(part, look.german, look.layout)}</KeyCap>
          ))}
        </span>
      ) : (
        <span className="text-white/25">–</span>
      )}
    </button>
  );
}

/** A small mark per kind of block. */
function BlockGlyph({ step, icons }: { step: Step; icons?: Record<string, string> }) {
  const icon = step.kind === "game" ? icons?.[step.action] : undefined;
  if (icon) return <img src={BUNGIE_ORIGIN + icon} alt="" draggable={false} className="size-4 shrink-0 opacity-75" />;
  const path =
    step.kind === "key" ? (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
      </>
    ) : step.kind === "mouse" ? (
      <>
        <rect x="6" y="3" width="12" height="18" rx="6" />
        <path d="M12 7v3" />
      </>
    ) : step.kind === "wait" ? (
      <>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2M10 2h4" />
      </>
    ) : (
      <path d="m12 3 2.6 5.6L20 9.5l-4 4 1 5.8-5-2.8-5 2.8 1-5.8-4-4 5.4-.9Z" />
    );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-white/45">
      {path}
    </svg>
  );
}

/** One block of the sequence: what it presses and how; × removes it. */
function StepBlock({
  step,
  look,
  recording,
  onRecord,
  onChange,
  onRemove,
}: {
  step: Step;
  look: Look;
  recording: boolean;
  onRecord: () => void;
  onChange: (step: Step) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { bindings } = look;
  const kind = step.kind === "game" ? t("macros.kind.game") : t(`macros.kind.${step.kind}` as TranslationKey);
  let body: ReactNode;
  if (step.kind === "key") {
    body = (
      <button
        type="button"
        data-nodrag
        // Recording starts on click; the pointerdown would cancel it.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRecord}
        className={cx("rounded-md", recording && "outline outline-1 outline-(--accent)")}
      >
        {recording ? (
          <span className="block animate-pulse px-1.5 py-1 text-[12px] text-(--accent-text)">{t("macros.pressKey")}</span>
        ) : step.code ? (
          <KeyCap>{keyName(step.code, look.german, look.layout)}</KeyCap>
        ) : (
          <span className="block px-1.5 py-1 text-[12px] text-amber-200/80">{t("macros.pickKey")}</span>
        )}
      </button>
    );
  } else if (step.kind === "mouse") {
    body = (
      <select
        data-nodrag
        value={step.button}
        onChange={(e) => onChange({ ...step, button: e.target.value as MouseButton })}
        className="h-7 rounded-md border border-white/10 bg-[#0d1017] px-1.5 text-[12.5px] text-white outline-none focus:border-(--accent)"
      >
        {MOUSE_BUTTONS.map((b) => (
          <option key={b} value={b}>
            {t(`macros.mouse.${b}` as TranslationKey)}
          </option>
        ))}
      </select>
    );
  } else if (step.kind === "game") {
    const keys = bindings?.keys[step.action] ?? [];
    body = (
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium whitespace-nowrap text-white">{actionLabel(t, step.action)}</span>
        {keys[0] ? (
          <span className="text-[11px] text-white/45">{gameKeyLabel(keys[0], look.german, look.layout)}</span>
        ) : (
          bindings && <span className="text-[11px] text-amber-200/80">{t("macros.unbound")}</span>
        )}
      </div>
    );
  } else {
    body = <MsInput value={step.ms} min={0} onChange={(ms) => onChange({ ...step, ms })} />;
  }

  return (
    <div
      className={cx(
        "group relative flex h-[74px] min-w-[104px] cursor-grab flex-col justify-between rounded-xl border px-3 py-2 select-none",
        step.kind === "wait" ? "border-white/[0.07] bg-white/[0.02]" : "border-white/10 bg-white/[0.05] hover:border-white/20",
      )}
    >
      <div className="flex items-center gap-1.5 pr-4 text-[10.5px] font-semibold tracking-[0.08em] text-white/40 uppercase">
        <BlockGlyph step={step} icons={look.icons} />
        {kind}
      </div>
      <button
        type="button"
        data-nodrag
        aria-label={t("macros.remove")}
        onClick={onRemove}
        className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded text-white/35 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white [&_svg]:size-3"
      >
        <IconClose />
      </button>
      <div className="flex items-center gap-2">
        {body}
        {step.kind !== "wait" && (
          <div data-nodrag className="ml-auto flex overflow-hidden rounded-md border border-white/10">
            {PRESSES.map((p) => (
              <button
                key={p.press}
                type="button"
                title={t(p.hint)}
                onClick={() => onChange({ ...step, press: p.press })}
                className={cx(
                  "px-1.5 py-0.5 text-[11px] tabular-nums transition-colors",
                  step.press === p.press ? "bg-white/[0.14] text-white" : "text-white/40 hover:text-white/80",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Picks a cvars.xml by hand (from another PC, or a copy) when the game's
 *  isn't found here. */
function CvarsUpload({ label, onLoaded }: { label: string; onLoaded: (b: GameBindings) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed && <span className="shrink-0 text-[12px] text-red-300">{t("macros.cvarsInvalid")}</span>}
      <input
        ref={input}
        type="file"
        accept=".xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 4_000_000) return setFailed(true);
          void file
            .text()
            .then(importCvars)
            .then(onLoaded, () => setFailed(true));
        }}
      />
      <GlassButton
        size="sm"
        className="shrink-0"
        onClick={() => {
          setFailed(false);
          input.current?.click();
        }}
      >
        {label}
      </GlassButton>
    </>
  );
}

function MsInput({ value, min, small, onChange }: { value: number; min: number; small?: boolean; onChange: (ms: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const ms = Math.round(Number(text));
    if (Number.isFinite(ms)) onChange(Math.min(60000, Math.max(min, ms)));
    else setText(String(value));
  };
  return (
    <label data-nodrag className={cx("flex items-center gap-1 text-white/50", small ? "text-[11px]" : "text-[12px]")}>
      <input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className={cx(
          "rounded-md border border-white/10 bg-black/30 px-1.5 text-right text-white tabular-nums outline-none focus:border-(--accent)",
          small ? "h-6 w-11 text-[11.5px]" : "h-7 w-14 text-[12.5px]",
        )}
      />
      ms
    </label>
  );
}

/** The keys that are a macro hotkey on their own too (see mousekeys.rs);
 *  AltGr is the right Alt. */
const LONE_KEYS: Record<string, string> = { Control: "Ctrl", Alt: "Alt", AltGraph: "Alt", Shift: "Shift" };

/** The macro's hotkey: click, then press it (Esc cancels, Backspace removes
 *  it; Ctrl/Alt/Shift alone is taken when let go). */
function HotkeyField({ keys, onChange }: { keys: string; onChange: (keys: string) => void }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    // Ctrl, Alt or Shift held on its own: taken when it's let go with no
    // other key pressed in between (else the combo is taken, as before).
    let alone: string | null = null;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return setRecording(false);
      if (e.key in LONE_KEYS) {
        if (e.repeat) return;
        const mine = (key: string) => e.key === key || (e.key === "AltGraph" && (key === "Control" || key === "Alt"));
        const others = (e.ctrlKey && !mine("Control")) || (e.altKey && !mine("Alt")) || (e.shiftKey && !mine("Shift")) || e.metaKey;
        alone = others ? null : LONE_KEYS[e.key];
        return;
      }
      alone = null;
      const next = ["Backspace", "Delete"].includes(e.key) && !e.ctrlKey && !e.altKey ? "" : keysFromEvent(e);
      if (next === null) return;
      setRecording(false);
      onChange(next);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!(e.key in LONE_KEYS)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const keys = alone;
      alone = null;
      if (keys === LONE_KEYS[e.key]) {
        setRecording(false);
        onChange(keys);
      }
    };
    // The side buttons of the mouse (4 and 5) work as a hotkey too.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Letting go would go back a page.
      const keep = (u: MouseEvent) => (u.button === 3 || u.button === 4) && u.preventDefault();
      window.addEventListener("mouseup", keep, { capture: true, once: true });
      setRecording(false);
      onChange(e.button === 3 ? "Mouse4" : "Mouse5");
    };
    const cancel = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recording, onChange]);
  return (
    <button
      type="button"
      onClick={() => setRecording(!recording)}
      title={t("macros.hotkeyPress")}
      className={cx(
        "flex h-9 min-w-24 shrink-0 items-center justify-center rounded-lg border px-2 transition-colors",
        recording ? "border-(--accent) bg-(--accent-soft)" : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]",
      )}
    >
      {recording ? <span className="animate-pulse text-[12px] text-(--accent-text)">{t("hotkeys.press")}</span> : <HotkeyCaps keys={keys} />}
    </button>
  );
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        checked ? "border-(--accent) bg-(--accent-soft)" : "border-white/10 bg-white/[0.04]",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-[left,background-color]",
          checked ? "left-[18px] bg-white" : "left-[2px] bg-white/45",
        )}
      />
    </button>
  );
}

function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "grid size-5 shrink-0 place-items-center rounded border transition-colors",
        checked ? "border-white/30 bg-white/25 text-white" : "border-white/20 bg-transparent text-transparent hover:border-white/40",
      )}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </button>
  );
}
