import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { ItemInfo } from "../lib/fireteam";
import { useT } from "../lib/i18n";
import { loadouts, type DimLoadout, type EditSocket, type GameLoadout } from "../lib/loadouts";
import { ARMOR_BUCKETS, WEAPON_BUCKETS } from "../lib/presets";
import { subscribe } from "../lib/tauri";
import { cx, GlassButton, GlassInput, GlassPanel } from "./glass";
import { ExoticArmorHover } from "./Clarity";
import { FuseButton } from "./FuseButton";
import { IconCheck, IconClose } from "./icons";

/** Element colors (damage type -> color); 0 / unknown = prismatic. */
const ELEMENT: Record<number, string> = {
  1: "#cfd5de",
  2: "#79c8ff",
  3: "#ff9447",
  4: "#b58cff",
  6: "#5d8fff",
  7: "#3fdc9a",
};
const elementOf = (item?: ItemInfo | null) => ELEMENT[item?.damageType ?? 0];

export function ItemIcon({ item, size = 40, missing }: { item: ItemInfo; size?: number; missing?: boolean }) {
  return (
    <span
      title={`${item.name} – ${item.typeName}`}
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-black/30",
        missing
          ? "border-red-400/70 shadow-[0_0_5px_-1px_rgb(248_113_113/0.55)]"
          : item.exotic
            ? "border-[#e8c547]/70 shadow-[0_0_5px_-1px_rgb(232_197_71/0.5)]"
            : "border-white/10",
      )}
      style={{ width: size, height: size }}
    >
      {item.icon ? (
        <img
          src={BUNGIE_ORIGIN + item.icon}
          alt=""
          className={cx("size-full object-cover", missing && "opacity-60 grayscale")}
          draggable={false}
        />
      ) : (
        <span className="text-[9px] text-white/45">{item.name.slice(0, 2)}</span>
      )}
      {/* Not owned: a red wash over the icon. */}
      {missing && <span className="absolute inset-0 bg-red-500/30 mix-blend-color" />}
      {missing && <span className="absolute inset-0 bg-red-600/15" />}
    </span>
  );
}

/** The in-game loadout look: its icon on its color. */
export function SlotBadge({ icon, color, size = 36 }: { icon: string | null; color: string | null; size?: number }) {
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-md border border-white/15 bg-white/[0.06] bg-cover"
      style={{ width: size, height: size, backgroundImage: color ? `url(${BUNGIE_ORIGIN + color})` : undefined }}
    >
      {icon && <img src={BUNGIE_ORIGIN + icon} alt="" className="absolute inset-0 size-full" draggable={false} />}
    </span>
  );
}

export function IssueDot({ issues }: { issues: string[] }) {
  const t = useT();
  return (
    <span
      title={issues.join("\n") || t("loadouts.valid")}
      className={cx(
        "size-2 shrink-0 rounded-full",
        issues.length === 0
          ? "bg-emerald-400 shadow-[0_0_3px_rgb(52_211_153/0.7)]"
          : "bg-amber-400 shadow-[0_0_3px_rgb(251_191_36/0.7)]",
      )}
    />
  );
}

/** Follow the step messages of a running apply. */
export function useProgress(active: boolean, onStep: (step: string) => void) {
  useEffect(() => {
    if (!active) return;
    return subscribe<string>("loadout-progress", (step) => step && onStep(step));
  }, [active, onStep]);
}

/** "All good" or "n problems" (click to see them). */
function StatusChip({ issues }: { issues: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (issues.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-200">
        <span className="scale-75">
          <IconCheck />
        </span>
        {t("loadouts.valid")}
      </span>
    );
  }
  return (
    <span className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/35 bg-amber-400/12 px-2.5 py-1 text-[11.5px] font-semibold text-amber-100 hover:bg-amber-400/20"
      >
        <span className="size-1.5 rounded-full bg-amber-300" />
        {t("loadouts.issues", { n: issues.length })}
      </button>
      {open && (
        <ul className="absolute top-full left-0 z-20 mt-2 w-80 list-disc rounded-xl border border-amber-300/25 bg-[#1b1a14]/95 py-2.5 pr-3 pl-7 text-[12px] text-amber-100 shadow-[0_20px_40px_-10px_rgb(0_0_0/0.7)]">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** Big header: subclass in its element color, name, status, actions. */
function Hero({ loadout, compact, right }: { loadout: DimLoadout; compact?: boolean; right?: ReactNode }) {
  const color = elementOf(loadout.subclass);
  const glow: CSSProperties = color
    ? { background: `radial-gradient(120% 140% at 0% 0%, ${color}33 0%, transparent 55%)` }
    : {
        background:
          "radial-gradient(90% 130% at 0% 0%, #ff6fd833 0%, transparent 50%), radial-gradient(90% 130% at 35% 0%, #5ad1ff22 0%, transparent 55%)",
      };
  const size = compact ? 48 : 64;
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-white/[0.08] bg-white/[0.03]">
      <div className="pointer-events-none absolute inset-0" style={glow} />
      {loadout.subclass?.icon && (
        <img
          src={BUNGIE_ORIGIN + loadout.subclass.icon}
          alt=""
          className="pointer-events-none absolute -top-10 -right-8 size-56 opacity-[0.07] blur-[1px]"
          draggable={false}
        />
      )}
      <div className={cx("relative flex items-center gap-4", compact ? "p-4" : "p-5")}>
        {loadout.subclass ? (
          <span
            className="grid shrink-0 place-items-center rounded-2xl border border-white/15 bg-black/30 p-1"
            style={{ boxShadow: `0 0 28px -6px ${color ?? "#ff6fd8"}` }}
          >
            <img
              src={loadout.subclass.icon ? BUNGIE_ORIGIN + loadout.subclass.icon : undefined}
              alt=""
              style={{ width: size, height: size }}
              draggable={false}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.16em] uppercase" style={{ color: color ?? "#f0a6e6" }}>
            {[loadout.className, loadout.subclass?.name].filter(Boolean).join(" · ")}
          </div>
          <h2 className={cx("truncate font-display font-semibold tracking-tight", compact ? "text-[18px]" : "text-[24px]")}>
            {loadout.name}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusChip issues={loadout.issues} />
            {loadout.notes && <span className="truncate text-[12px] text-white/50">{loadout.notes}</span>}
          </div>
        </div>
        {right}
      </div>
      {loadout.subclassPlugs.length > 0 && (
        <div className={cx("relative flex flex-wrap gap-1.5 border-t border-white/[0.06]", compact ? "px-4 py-3" : "px-5 py-3.5")}>
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
      )}
    </div>
  );
}

/** One weapon or armor piece as in the character screen. */
function GearTile({
  item,
  compact,
  missing,
  onEdit,
  editing,
}: {
  item: ItemInfo;
  compact?: boolean;
  missing?: boolean;
  /** Makes it clickable: change its perks / mods. */
  onEdit?: () => void;
  editing?: boolean;
}) {
  const t = useT();
  const color = elementOf(item);
  const size = compact ? 40 : 52;
  return (
    <div
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onClick={onEdit}
      onKeyDown={(e) => onEdit && e.key === "Enter" && onEdit()}
      title={onEdit ? t("loadouts.editItem") : undefined}
      className={cx(
        "group relative flex min-w-0 items-center gap-3 rounded-xl border p-1.5 transition-colors",
        editing
          ? "border-(--accent) bg-(--accent-soft)"
          : "border-transparent hover:bg-white/[0.04]",
        onEdit && !editing && "cursor-pointer hover:border-white/10",
      )}
    >
      <span className="relative shrink-0">
        <ItemIcon item={item} size={size} missing={missing} />
        {color && item.damageType !== 1 && !missing && (
          <span className="absolute inset-x-1 -bottom-1 h-[3px] rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cx(
            "truncate font-medium",
            compact ? "text-[12.5px]" : "text-[13.5px]",
            missing ? "text-red-300" : item.exotic && "text-[#f0d66b]",
          )}
        >
          {item.name}
        </div>
        <div className={cx("truncate text-[11.5px]", missing ? "text-red-300/70" : "text-white/45")}>
          {missing ? `${item.typeName} · ${t("loadouts.notOwned")}` : item.typeName}
        </div>
      {/* Its perks and the mods it gets, under its name (fits narrow columns). */}
      {((item.perks?.length ?? 0) > 0 || (item.mods?.length ?? 0) > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.perks?.map((p, i) => (
            <span key={`p${p.hash}-${i}`} title={`${p.name} – ${p.typeName}`} className="grid shrink-0 place-items-center">
              <ItemIcon item={p} size={compact ? 24 : 28} />
            </span>
          ))}
          {(item.perks?.length ?? 0) > 0 && (item.mods?.length ?? 0) > 0 && <span className="mx-0.5 h-5 w-px bg-white/15" />}
          {item.mods?.map((m, i) => (
            <span key={`m${m.hash}-${i}`} title={`${m.name} – ${m.typeName}`} className="grid shrink-0 place-items-center">
              <ItemIcon item={m} size={compact ? 24 : 28} />
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="mb-1.5 px-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

/** The season's artifact, loaded once and shared by every loadout view. */
let artifactLayout: Promise<ItemInfo[][]> | null = null;

/** The whole artifact as in game, the loadout's perks lit, the rest dim. */
function Artifact({ chosen }: { chosen: ItemInfo[] }) {
  const t = useT();
  const [layout, setLayout] = useState<ItemInfo[][] | null>(null);
  useEffect(() => {
    let alive = true;
    artifactLayout ??= loadouts.artifactLayout().catch(() => {
      artifactLayout = null;
      return [];
    });
    void artifactLayout.then((l) => alive && setLayout(l));
    return () => {
      alive = false;
    };
  }, []);
  const picked = new Set(chosen.map((c) => c.hash));
  const columns = layout && layout.length > 0 ? layout : null;
  if (!columns && chosen.length === 0) return null;
  return (
    <Column title={t("loadouts.artifact")}>
      {columns ? (
        <div className="flex gap-3 overflow-x-auto px-1 pb-1">
          {columns.map((column, c) => (
            <div key={c} className="flex flex-col gap-1.5">
              {column.map((perk, r) => {
                const on = picked.has(perk.hash);
                return (
                  <span
                    key={`${perk.hash}-${r}`}
                    className={cx(
                      "rounded-lg transition-opacity",
                      on ? "ring-2 ring-(--accent) shadow-[0_0_6px_-1px_var(--accent)]" : "opacity-30 grayscale",
                    )}
                  >
                    <ItemIcon item={perk} size={34} />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-1">
          {chosen.map((m, i) => (
            <ItemIcon key={`${m.hash}-${i}`} item={m} size={34} />
          ))}
        </div>
      )}
      {chosen.length > 0 && <p className="mt-1.5 px-1.5 text-[11px] text-white/40">{t("loadouts.artifactHint")}</p>}
    </Column>
  );
}

/** Gear still loading: the columns' shape, pulsing, with a sheen. */
function GearSkeleton() {
  const column = (rows: number, key: string) => (
    <div key={key} className="shimmer min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="skeleton mb-3 h-2.5 w-20 rounded-full" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-1.5">
          <span className="skeleton size-11 shrink-0 rounded-lg" style={{ animationDelay: `${i * 0.1}s` }} />
          <div className="flex-1">
            <div className="skeleton h-3 w-2/3 rounded-full" style={{ animationDelay: `${i * 0.1}s` }} />
            <div className="skeleton mt-2 h-2.5 w-1/3 rounded-full" style={{ animationDelay: `${i * 0.1 + 0.05}s` }} />
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {column(3, "w")}
        {column(5, "a")}
      </div>
      <div className="shimmer h-28 rounded-2xl border border-white/[0.06] bg-white/[0.025]" />
    </div>
  );
}

/** Weapons | armor, then the mods. With `onEdit`, items open an editor
 *  (`editor`, shown under the gear) for their perks and mods. */
export function Gear({
  loadout,
  compact,
  onEdit,
  editing,
  editor,
}: {
  loadout: DimLoadout;
  compact?: boolean;
  onEdit?: (item: ItemInfo) => void;
  editing?: number | null;
  editor?: ReactNode;
}) {
  const editable = (it: ItemInfo) => (onEdit && !loadout.missing?.includes(it.hash) ? () => onEdit(it) : undefined);
  const t = useT();
  const weapons = loadout.items.filter((i) => WEAPON_BUCKETS.includes(i.bucket ?? 0));
  const armor = loadout.items.filter((i) => ARMOR_BUCKETS.includes(i.bucket ?? 0));
  const other = loadout.items.filter((i) => !weapons.includes(i) && !armor.includes(i));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Column title={t("builder.weapons")}>
          {[...weapons, ...other].map((it, i) => (
            <GearTile
              key={`${it.hash}-${i}`}
              item={it}
              compact={compact}
              missing={loadout.missing?.includes(it.hash)}
              onEdit={WEAPON_BUCKETS.includes(it.bucket ?? 0) ? editable(it) : undefined}
              editing={editing === it.hash}
            />
          ))}
        </Column>
        <Column title={t("builder.armor")}>
          {armor.map((it, i) => (
            <ExoticArmorHover key={`${it.hash}-${i}`} item={it}>
              <GearTile
                item={it}
                compact
                missing={loadout.missing?.includes(it.hash)}
                onEdit={editable(it)}
                editing={editing === it.hash}
              />
            </ExoticArmorHover>
          ))}
        </Column>
      </div>
      {editor}
      {loadout.mods.length > 0 && (
        <Column title={t("loadouts.mods")}>
          <div className="grid grid-cols-2 gap-1 xl:grid-cols-3">
            {loadout.mods.map((m, i) => (
              <div key={`${m.hash}-${i}`} className="flex min-w-0 items-center gap-2 rounded-lg p-1" title={m.typeName}>
                <ItemIcon item={m} size={28} />
                <span className="truncate text-[12px] text-white/75">{m.name}</span>
              </div>
            ))}
          </div>
        </Column>
      )}
      <Artifact chosen={loadout.artifact} />
    </div>
  );
}

/** A loadout's gear shown above an open preset. */
export function LoadoutPreview({ loadout, onClose }: { loadout: DimLoadout; onClose: () => void }) {
  const t = useT();
  return (
    <GlassPanel className="flex shrink-0 flex-col gap-3 p-3">
      <Hero
        loadout={loadout}
        compact
        right={
          <div className="flex items-center gap-2 self-start">
            <span className="hidden text-[11.5px] text-white/40 xl:inline">{t("sets.previewHint")}</span>
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
            >
              <IconClose />
            </button>
          </div>
        }
      />
      {loadout.pending ? (
        <GearSkeleton />
      ) : (
        <Gear loadout={loadout} compact />
      )}
    </GlassPanel>
  );
}

type Run =
  | { kind: "idle" }
  | { kind: "running"; step: string; steps: string[] }
  | { kind: "done"; warnings: string[]; slot: number | null; steps: string[] }
  | { kind: "error"; message: string };

/* Equipping outlives the page: switching tabs mid-way doesn't stop it, and
 * coming back shows where it is (or how it ended). */
const runs = new Map<string, Run>();
const runListeners = new Set<() => void>();
const IDLE: Run = { kind: "idle" };
function setRunOf(id: string, run: Run) {
  runs.set(id, run);
  runListeners.forEach((l) => l());
}
function onRuns(listener: () => void) {
  runListeners.add(listener);
  return () => void runListeners.delete(listener);
}
const anyRunning = () => [...runs.values()].some((r) => r.kind === "running");
/** Whether a loadout is being equipped / written right now (any page). */
export function useApplyRunning() {
  return useSyncExternalStore(onRuns, anyRunning);
}

/** Equip a loadout (slot null) or write it onto an in-game slot. */
async function startApply(id: string, slot: number | null, character: string | null, startText: string) {
  setRunOf(id, { kind: "running", step: startText, steps: [startText] });
  // Every step as it happens (Radar's apply.rs reports them).
  const off = subscribe<string>("loadout-progress", (step) => {
    const run = runs.get(id);
    if (step && run?.kind === "running") setRunOf(id, { kind: "running", step, steps: [...run.steps, step] });
  });
  try {
    const warnings = await loadouts.apply(id, slot, character);
    const before = runs.get(id);
    setRunOf(id, { kind: "done", warnings, slot, steps: before?.kind === "running" ? before.steps : [] });
    return true;
  } catch (e) {
    setRunOf(id, { kind: "error", message: String(e) });
    return false;
  } finally {
    off();
  }
}

/** An item's perks / mods in a loadout, each socket with its choices. A
 *  pick is saved to the loadout (DIM) right away. */
function ItemEditor({
  loadout,
  hash,
  character,
  onClose,
  onChanged,
}: {
  loadout: DimLoadout;
  hash: number;
  character: string | null;
  onClose: () => void;
  onChanged: (loadout: DimLoadout) => void;
}) {
  const t = useT();
  const target = loadout.items.find((i) => i.hash === hash);
  const [sockets, setSockets] = useState<EditSocket[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    try {
      const list = await loadouts.itemSockets(character, loadout.id, hash);
      setSockets(list);
      setOpen((now) => now ?? list[0]?.index ?? null);
    } catch (e) {
      setError(String(e));
      setSockets([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, loadout.id, character]);

  const pick = async (socket: EditSocket, plug: number) => {
    setSaving(socket.index);
    setError(null);
    try {
      const updated = await loadouts.setPlug(character, loadout.id, hash, socket.index, plug);
      if (updated) onChanged(updated);
      // Shown at once; the list catches up from the saved loadout.
      setSockets((all) =>
        all?.map((s) =>
          s.index === socket.index ? { ...s, current: s.options.find((o) => o.hash === plug) ?? null } : s,
        ) ?? all,
      );
      void load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(null);
    }
  };

  const active = sockets?.find((s) => s.index === open) ?? null;
  const q = query.trim().toLowerCase();
  const shown = active?.options.filter((o) => !q || o.name.toLowerCase().includes(q) || o.typeName.toLowerCase().includes(q)) ?? [];

  return (
    <div className="animate-fade-in rounded-2xl border border-(--accent-glow) bg-white/[0.03] p-3">
      <div className="mb-2.5 flex items-center gap-2.5">
        {target && <ItemIcon item={target} size={34} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{target?.name}</div>
          <div className="text-[11px] text-white/45">{t("loadouts.editHint")}</div>
        </div>
        <button
          onClick={onClose}
          title={t("loadouts.editClose")}
          className="grid size-8 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
        >
          <IconClose />
        </button>
      </div>
      {error && <p className="mb-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
      {sockets === null ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-white/45">
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/10 border-t-(--accent)" />
          {t("loadouts.editLoading")}
        </div>
      ) : sockets.length === 0 ? (
        <p className="py-2 text-[12px] text-white/45">{t("loadouts.editNothing")}</p>
      ) : (
        <>
          {/* The sockets: what's in each now. */}
          <div className="flex flex-wrap gap-1.5">
            {sockets.map((s) => (
              <button
                key={s.index}
                onClick={() => {
                  setOpen(s.index);
                  setQuery("");
                }}
                className={cx(
                  "flex min-w-0 max-w-56 items-center gap-2 rounded-xl border p-1.5 pr-2.5 text-left transition-colors",
                  open === s.index
                    ? "border-(--accent) bg-(--accent-soft)"
                    : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                )}
              >
                {s.current ? (
                  <ItemIcon item={s.current} size={30} />
                ) : (
                  <span className="grid size-[30px] shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-white/30">
                    +
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[10px] font-semibold tracking-[0.1em] text-white/40 uppercase">{s.label}</span>
                  <span className="block truncate text-[12px] font-medium">{s.current?.name ?? t("loadouts.editEmpty")}</span>
                </span>
                {saving === s.index && (
                  <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-white/10 border-t-(--accent)" />
                )}
              </button>
            ))}
          </div>
          {/* The choices for the open socket. */}
          {active && (
            <div className="mt-3">
              {active.options.length > 12 && (
                <div className="mb-2">
                  <GlassInput
                    placeholder={t("loadouts.editSearch")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClear={query ? () => setQuery("") : undefined}
                  />
                </div>
              )}
              <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1 xl:grid-cols-2">
                {active.removable && active.current && (
                  <button
                    onClick={() => void pick(active, 0)}
                    disabled={saving !== null}
                    className="flex items-center gap-2 rounded-lg border border-transparent p-1.5 text-left text-[12px] text-white/60 hover:border-white/10 hover:bg-white/[0.05]"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-white/35">
                      <IconClose />
                    </span>
                    {t("loadouts.editRemove")}
                  </button>
                )}
                {shown.map((o) => {
                  const chosen = active.current?.hash === o.hash;
                  return (
                    <button
                      key={o.hash}
                      onClick={() => !chosen && void pick(active, o.hash)}
                      disabled={saving !== null}
                      title={o.typeName}
                      className={cx(
                        "flex min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left transition-colors disabled:cursor-wait",
                        chosen
                          ? "border-(--accent-glow) bg-(--accent-soft)"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
                      )}
                    >
                      <ItemIcon item={o} size={32} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium">{o.name}</span>
                        <span className="block truncate text-[10.5px] text-white/40">{o.typeName}</span>
                      </span>
                      {chosen && (
                        <span className="ml-auto grid size-4 shrink-0 place-items-center rounded-full bg-(--accent-text) text-black [&_svg]:size-2.5">
                          <IconCheck />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One DIM loadout: hero, gear, equip it or write it onto an in-game slot. */
export function LoadoutDetail({
  loadout,
  game,
  character,
  onRunning,
  onWritten,
  onDelete,
  onBack,
  onChanged,
}: {
  loadout: DimLoadout;
  game: GameLoadout[];
  character: string | null;
  onRunning: (running: boolean) => void;
  onWritten: () => void;
  /** Delete the loadout from DIM. */
  onDelete: () => Promise<void>;
  /** Back to the in-game loadouts. */
  onBack?: () => void;
  /** The loadout changed (an item's perks / mods were edited). */
  onChanged?: (loadout: DimLoadout) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => setEditing(null), [loadout.id]);
  const [confirmSlot, setConfirmSlot] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Runs once the delete button's fuse has burnt down (Undo stops it).
  const remove = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } catch (e) {
      setRunOf(loadout.id, { kind: "error", message: String(e) });
      setDeleting(false);
    }
  };
  const run = useSyncExternalStore(onRuns, () => runs.get(loadout.id) ?? IDLE);
  const running = useApplyRunning();

  const apply = async (slot: number | null) => {
    setConfirmSlot(null);
    onRunning(true);
    const ok = await startApply(loadout.id, slot, character, t("loadouts.starting"));
    onRunning(false);
    if (ok && slot !== null) onWritten();
  };

  return (
    <GlassPanel className="flex flex-col gap-4 p-4">
      <Hero
        loadout={loadout}
        right={
          <div className="flex shrink-0 items-center gap-2 self-start">
            <FuseButton
              key={loadout.id}
              label={t("loadouts.delete")}
              undoLabel={t("loadouts.undo")}
              busyLabel={t("loadouts.deleting")}
              busy={deleting}
              disabled={running || !!loadout.pending}
              onCommit={() => void remove()}
            />
            <GlassButton variant="primary" onClick={() => void apply(null)} disabled={running || !!loadout.pending}>
              {t("loadouts.equip")}
            </GlassButton>
            {onBack && (
              <button
                onClick={onBack}
                title={t("loadouts.close")}
                className="grid size-9 place-items-center rounded-lg text-white/50 hover:bg-white/[0.08] hover:text-white"
              >
                <IconClose />
              </button>
            )}
          </div>
        }
      />
      <RunStatus run={run} slotName={run.kind === "done" && run.slot !== null ? game[run.slot]?.name : undefined} />
      {loadout.pending ? (
        <GearSkeleton />
      ) : (
        <Gear
          loadout={loadout}
          onEdit={running ? undefined : (it) => setEditing((now) => (now === it.hash ? null : it.hash))}
          editing={editing}
          editor={
            editing !== null && (
              <ItemEditor
                key={editing}
                loadout={loadout}
                hash={editing}
                character={character}
                onClose={() => setEditing(null)}
                onChanged={(l) => onChanged?.(l)}
              />
            )
          }
        />
      )}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("loadouts.writeTitle")}</span>
          <span className="truncate text-[11px] text-white/35">{t("loadouts.writeHintShort")}</span>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {game.map((slot) => {
            const confirming = confirmSlot === slot.index;
            return (
              <button
                key={slot.index}
                disabled={running}
                title={slot.empty ? t("loadouts.emptySlot", { n: slot.index + 1 }) : slot.name}
                onClick={() => (slot.empty || confirming ? void apply(slot.index) : setConfirmSlot(slot.index))}
                className={cx(
                  "flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-xl border p-1.5 text-center transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 disabled:opacity-50",
                  confirming
                    ? "border-amber-300/60 bg-amber-400/10"
                    : "border-transparent hover:border-(--accent-glow) hover:bg-(--accent-soft)",
                )}
              >
                <SlotBadge icon={slot.icon} color={slot.color} size={44} />
                <span className="w-full truncate text-[10.5px] text-white/65">
                  {confirming ? t("loadouts.overwrite") : slot.empty ? `${slot.index + 1} · ${t("sets.slotEmpty")}` : slot.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </GlassPanel>
  );
}

function RunStatus({ run, slotName }: { run: Run; slotName?: string }) {
  const t = useT();
  if (run.kind === "idle") return null;
  if (run.kind === "error") {
    return <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{run.message}</p>;
  }
  // Every step so far: done ones ticked, the current one spinning.
  const steps = run.steps;
  const running = run.kind === "running";
  return (
    <div
      className={cx(
        "animate-fade-in rounded-2xl border px-3.5 py-3",
        running ? "border-(--accent-glow) bg-(--accent-soft)" : "border-emerald-400/25 bg-emerald-400/[0.07]",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
        {running ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/15 border-t-(--accent)" />
        ) : (
          <span className="grid size-4 place-items-center rounded-full bg-emerald-400 text-black [&_svg]:size-2.5">
            <IconCheck />
          </span>
        )}
        <span className={running ? "text-white" : "text-emerald-100"}>
          {running ? run.step : slotName ? t("loadouts.savedTo", { slot: slotName }) : t("loadouts.equippedNow")}
        </span>
      </div>
      <ol className="flex max-h-40 flex-col gap-1 overflow-y-auto pl-0.5 text-[12px] [&>*]:shrink-0">
        {steps.map((step, i) => {
          const current = running && i === steps.length - 1;
          return (
            <li key={i} className={cx("flex items-center gap-2", current ? "text-white" : "text-white/55")}>
              <span className={cx("size-1.5 shrink-0 rounded-full", current ? "animate-pulse bg-(--accent)" : "bg-emerald-400/70")} />
              {step}
            </li>
          );
        })}
      </ol>
      {run.kind === "done" && run.warnings.length > 0 && (
        <ul className="mt-2.5 list-disc rounded-lg border border-amber-400/25 bg-amber-400/10 py-2 pr-3 pl-7 text-[12px] text-amber-100">
          {run.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
