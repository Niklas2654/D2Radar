import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { armorApi, type ArmorMods as Mods, type ModPlug } from "../lib/armor";
import { BUNGIE_ORIGIN, useBungie } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { call } from "../lib/tauri";
import { ActionToast, type ActionState } from "./ActionToast";
import { cx } from "./glass";

const src = (icon: string | null) => (icon ? (icon.startsWith("http") ? icon : BUNGIE_ORIGIN + icon) : null);

/**
 * The mods in the player's copy of an armor piece: a hover shows what one
 * does (exact numbers where known), a click picks another for its socket.
 * Bungie lets mods change only out of activities: in one, the sockets are
 * ringed red and locked.
 */
export function ArmorMods({
  versions,
  instanceId,
  onUsed,
  onSlots,
}: {
  versions: number[];
  instanceId?: string;
  /** The energy the mods take (for an energy bar elsewhere). */
  onUsed?: (used: number) => void;
  /** The mods as they are (changed here too): stats elsewhere follow them. */
  onSlots?: (slots: Mods["slots"]) => void;
}) {
  const t = useT();
  const snapshot = useBungie();
  const [mods, setMods] = useState<Mods | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // The socket whose choice is open.
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  // A socket's outcome for a moment (a green or red flash).
  const [flash, setFlash] = useState<{ socket: number; ok: boolean } | null>(null);
  const [action, setAction] = useState<ActionState>(null);
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(id);
  }, [flash]);

  const load = () =>
    armorApi
      .mods(versions, instanceId)
      .then((m) => setMods(m ?? null))
      .catch((e) => {
        setMods(null);
        setError(String(e));
      });
  useEffect(() => {
    setMods(undefined);
    setPicking(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.join(","), instanceId]);

  const used = mods?.slots.reduce((sum, s) => sum + (s.plug?.cost ?? 0), 0) ?? null;
  useEffect(() => {
    if (used !== null) onUsed?.(used);
  }, [used, onUsed]);
  useEffect(() => {
    if (mods) onSlots?.(mods.slots);
  }, [mods, onSlots]);
  // Every socket's choices loaded ahead: a click on one opens at once.
  useEffect(() => {
    if (!mods) return;
    for (const slot of mods.slots) void modOptions(mods.itemHash, slot.socket, mods.instanceId).catch(() => {});
    // (Once per piece.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods?.instanceId]);

  // In orbit, or not playing: mods can change. In an activity only the
  // played character's are locked: the vault's and the other characters'
  // armor changes through one of those (Bungie locks per character).
  const free = snapshot.online === false || snapshot.activity?.name === "Orbit" || !snapshot.activity;
  const canEquip = free || (mods ? !mods.onActive : false);

  if (mods === undefined) return <p className="mt-4 px-1 text-[12px] text-white/40">{t("mods.loading")}</p>;
  if (mods === null || mods.slots.length === 0)
    return error ? <p className="mt-4 px-1 text-[12px] text-red-300">{error}</p> : null;


  // Put a mod in: shown in its socket at once (Bungie's profile still has
  // the old one for a while after: reloading then looked like it failed),
  // back to the old one if Bungie says no.
  const equip = (socket: number, plug: ModPlug) => {
    const before = mods.slots.find((s) => s.socket === socket)?.plug ?? null;
    if (before?.item.hash === plug.item.hash) {
      setPicking(null);
      return;
    }
    // Not enough energy: said here, not by Bungie a moment later.
    if (mods.energy != null && (used ?? 0) - (before?.cost ?? 0) + plug.cost > mods.energy) {
      setAction({ kind: "error", text: t("mods.noEnergy", { name: plug.item.name }) });
      setFlash({ socket, ok: false });
      return;
    }
    // The empty plug: the socket shows empty.
    const shown = /empty/i.test(plug.item.name) || plug.cost === 0 && !plug.item.icon ? null : plug;
    const put = (p: ModPlug | null) =>
      setMods((m) => (m ? { ...m, slots: m.slots.map((s) => (s.socket === socket ? { ...s, plug: p } : s)) } : m));
    setPicking(null);
    setError(null);
    setBusy(socket);
    put(shown);
    setAction({ kind: "busy", text: t("mods.equipping", { name: plug.item.name }) });
    armorApi
      .setMod(mods.instanceId, mods.characterId, socket, plug.item.hash)
      .then(() => {
        setFlash({ socket, ok: true });
        setAction({ kind: "ok", text: t("mods.equipped", { name: plug.item.name }) });
      })
      .catch((e) => {
        put(before);
        setFlash({ socket, ok: false });
        setAction({ kind: "error", text: String(e) });
      })
      .finally(() => {
        setBusy(null);
        // Over the game: the page stays in front (the game may take the
        // focus when its armor changes).
        void call("inspect_focus").catch(() => {});
      });
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-white/85">{t("mods.title")}</span>
        {/* (Shown as boxes elsewhere when asked for.) */}
        {mods.energy != null && !onUsed && (
          <span className="text-[11.5px] text-white/50 tabular-nums">{t("mods.energy", { used: used ?? 0, max: mods.energy })}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {mods.slots.map((slot) => (
          <ModTile
            key={slot.socket}
            plug={slot.plug}
            locked={!canEquip}
            active={picking === slot.socket}
            busy={busy === slot.socket}
            flash={flash?.socket === slot.socket ? (flash.ok ? "ok" : "error") : null}
            onClick={() => canEquip && setPicking(picking === slot.socket ? null : slot.socket)}
          />
        ))}
        {/* Putting a mod in, and how it went: beside the sockets. */}
        <div className="ml-2 min-w-0 flex-1">
          <ActionToast state={action} inline />
        </div>
      </div>
      {!canEquip && <p className="mt-2 text-[11.5px] text-[#f5a3a8]">{t("mods.notInOrbit")}</p>}
      {error && <p className="mt-2 text-[11.5px] text-red-300">{error}</p>}
      {picking !== null && canEquip && (
        <ModPicker
          itemHash={mods.itemHash}
          instanceId={mods.instanceId}
          socket={picking}
          current={mods.slots.find((s) => s.socket === picking)?.plug?.item.hash ?? null}
          // The energy a mod here may take: what's free, plus what's in it now.
          room={mods.energy == null ? null : mods.energy - (used ?? 0) + (mods.slots.find((s) => s.socket === picking)?.plug?.cost ?? 0)}
          onPick={(plug) => equip(picking, plug)}
        />
      )}
    </div>
  );
}

/** A mod's tile: its icon (an empty socket dashed); its card on hover. */
function ModTile({
  plug,
  locked = false,
  active = false,
  busy = false,
  flash = null,
  cost,
  disabled = false,
  title,
  onClick,
}: {
  plug: ModPlug | null;
  /** Can't go in (not enough energy): greyed out, no click. */
  disabled?: boolean;
  title?: string;
  locked?: boolean;
  active?: boolean;
  busy?: boolean;
  /** Just put in (ok) or turned down (error): a short ring. */
  flash?: "ok" | "error" | null;
  /** Shown in the corner (the picker's tiles). */
  cost?: number;
  onClick?: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const icon = src(plug?.item.icon ?? null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        title={title}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        className={cx(
          "relative size-12 shrink-0 overflow-hidden rounded-lg border transition-[border-color,box-shadow,opacity] duration-300",
          locked
            ? "cursor-not-allowed border-[#e2626b]/70"
            : flash === "ok"
              ? "border-[#7fd49a] shadow-[0_0_0_2px_rgb(127_212_154/0.45)]"
              : flash === "error"
                ? "border-[#e2626b] shadow-[0_0_0_2px_rgb(226_98_107/0.45)]"
                : active
                  ? "cursor-pointer border-(--accent-text)"
                  : "cursor-pointer border-white/[0.12] hover:border-white/35",
          !plug && "border-dashed",
          disabled && "cursor-not-allowed opacity-30 grayscale hover:border-white/[0.12]",
        )}
      >
        {icon ? (
          <img key={icon} src={icon} alt={plug?.item.name ?? ""} className="animate-fade-in size-full" />
        ) : (
          <span className="block size-full bg-white/[0.03]" />
        )}
        {/* Going in: a spinner over it. */}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/55">
            <span className="size-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
          </span>
        )}
        {cost !== undefined && cost > 0 && (
          <span className="absolute top-0 right-0 rounded-bl bg-black/70 px-1 text-[10px] font-semibold text-white tabular-nums">{cost}</span>
        )}
      </button>
      {hover && plug && plug.item.name && <ModCard plug={plug} anchor={anchor.current} />}
    </>
  );
}

/** What a mod does, next to its tile. */
function ModCard({ plug, anchor }: { plug: ModPlug; anchor: HTMLElement | null }) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !card.current) return;
    const a = anchor.getBoundingClientRect();
    const c = card.current.getBoundingClientRect();
    const left = Math.min(window.innerWidth - c.width - 8, Math.max(8, a.left + a.width / 2 - c.width / 2));
    const below = a.bottom + 8;
    const top = below + c.height > window.innerHeight - 8 ? a.top - c.height - 8 : below;
    setPos({ left, top });
  }, [anchor]);
  return createPortal(
    <div
      ref={card}
      className="pointer-events-none fixed z-[200] w-72 rounded-xl border border-white/10 bg-[#0b0d14]/95 p-3 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]"
      style={pos ?? { left: -9999, top: -9999 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-white">{plug.item.name}</span>
        {plug.cost > 0 && <span className="text-[11px] text-white/50 tabular-nums">{t("mods.cost", { n: plug.cost })}</span>}
      </div>
      {plug.item.typeName && <div className="text-[11px] text-white/40">{plug.item.typeName}</div>}
      {plug.item.description && <p className="mt-1.5 text-[12px] leading-snug text-white/75">{plug.item.description}</p>}
      {plug.item.exact && (
        <p className="mt-1.5 border-t border-white/[0.08] pt-1.5 text-[11.5px] leading-snug text-(--accent-text)">{plug.item.exact}</p>
      )}
    </div>,
    document.body,
  );
}

/** The options of a socket (of a piece, for a copy), loaded ahead: kept
 *  for the run (the backend keeps them a while too). */
const optionsOf = new Map<string, Promise<ModPlug[]>>();
export function modOptions(itemHash: number, socket: number, instanceId: string) {
  const key = `${itemHash}:${socket}:${instanceId}`;
  let list = optionsOf.get(key);
  if (!list) {
    list = armorApi.modOptions(itemHash, socket, instanceId).then((o) => o ?? []);
    list.catch(() => optionsOf.delete(key));
    optionsOf.set(key, list);
  }
  return list;
}

/** Every mod the socket takes (the dearest first, by element); a click
 *  puts it in. */
function ModPicker({
  itemHash,
  instanceId,
  socket,
  current,
  room,
  onPick,
}: {
  itemHash: number;
  instanceId: string;
  socket: number;
  current: number | null;
  /** The energy a mod here may cost (null: not known, all allowed). */
  room: number | null;
  onPick: (plug: ModPlug) => void;
}) {
  const t = useT();
  const [options, setOptions] = useState<ModPlug[] | null>(null);
  useEffect(() => {
    setOptions(null);
    let live = true;
    void modOptions(itemHash, socket, instanceId).then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [itemHash, socket, instanceId]);
  return (
    <div className="animate-fade-in mt-3 border-t border-white/[0.06] pt-3">
      {options === null ? (
        <p className="px-1 text-[12px] text-white/40">{t("mods.loading")}</p>
      ) : (
        <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
          {options.map((o) => (
            <ModTile
              key={o.item.hash}
              plug={o}
              cost={o.cost}
              active={o.item.hash === current}
              disabled={room !== null && o.cost > room}
              title={room !== null && o.cost > room ? t("mods.noEnergy", { name: o.item.name }) : undefined}
              onClick={() => onPick(o)}
            />
          ))}
          {options.length === 0 && <p className="px-1 text-[12px] text-white/40">{t("mods.none")}</p>}
        </div>
      )}
    </div>
  );
}
