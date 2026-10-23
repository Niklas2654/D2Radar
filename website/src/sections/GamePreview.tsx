import { useEffect, useRef, useState } from "react";
import { ACCENT_EVENT, savedAccent, type SiteAccent } from "../fx";
import { SectionTitle } from "./Features";

/** The game screen the preview draws, in its own pixels (scaled to fit). */
const W = 1920;
const H = 1080;
const BUNGIE = "https://www.bungie.net";

interface Item {
  hash: number;
  name: string;
  icon: string | null;
  typeName: string;
  exotic: boolean;
  description?: string;
  perks?: Item[];
  mods?: Item[];
}
interface Build {
  characterId: string;
  subclass: { item: Item };
  weapons: Item[];
  armor: Item[];
  stats: { hash: number; name: string; icon: string | null; value: number }[];
}
interface Character {
  id: string;
  className: string;
  light: number;
  emblemPath: string | null;
}
interface Demo {
  character: Character;
  build: Build;
  artifact: Item[][];
}

/** The player's character as recorded for the demo (app/demo/data.json). */
async function loadDemo(): Promise<Demo | null> {
  const calls = (await fetch("app/demo/data.json").then((r) => r.json())) as { cmd: string; result: unknown }[];
  const player = calls.find((c) => c.cmd === "fireteam_player")?.result as { characters: Character[]; builds: Build[] } | undefined;
  const artifact = (calls.find((c) => c.cmd === "artifact_layout")?.result as Item[][]) ?? [];
  const character = player?.characters[0];
  const build = player?.builds.find((b) => b.characterId === character?.id) ?? player?.builds[0];
  return character && build ? { character, build, artifact } : null;
}

const ARTIFACT_NAME = "Encrypted Data Disk";

type Looked = { weapon?: number; armor?: number[]; artifact?: string };

/** An in-game screen to look around in, with Radar over it as in the game:
 *  the character screen (weapons, armor) and the artifact. Hovering an item
 *  is inspecting it: the real overlay (the app's, in its demo) shows its
 *  notice; a click or F10 opens Radar's inspect page on it. */
export function GamePreview() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [near, setNear] = useState(false);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [tab, setTab] = useState<"character" | "artifact">("character");
  const [hover, setHover] = useState<{ item: Item; x: number; y: number; side: "left" | "right" } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const overlay = useRef<HTMLIFrameElement>(null);
  const inspect = useRef<HTMLIFrameElement>(null);
  const looked = useRef<Looked>({});
  const leave = useRef(0);
  const [accent] = useState<SiteAccent>(() => savedAccent() ?? { accent: "void", color: "#b47dff" });

  // Loaded once it's near (two more app frames: not before they're seen).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "300px" });
    io.observe(el);
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    if (near) void loadDemo().then(setDemo);
  }, [near]);

  const post = (frame: HTMLIFrameElement | null, msg: Record<string, unknown>) => frame?.contentWindow?.postMessage(msg, location.origin);
  /** What's looked at, to the overlay (its notice). */
  const detect = (l: Looked) => {
    looked.current = l;
    post(overlay.current, { radarDemo: "detect", ...l });
  };
  const openInspect = (l: Looked) => {
    if (!l.weapon && !l.armor && !l.artifact) return;
    post(inspect.current, { radarDemo: "inspect", ...l });
    setInspecting(true);
  };

  // The frames' news: loaded (send what's looked at), the inspect page closed.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data?.radarDemo) return;
      if (e.data.radarDemo === "backend" && e.source === overlay.current?.contentWindow) detect(looked.current);
      if (e.data.radarDemo === "inspect-close") setInspecting(false);
      // A colour picked in the tour's live app: these frames too.
    };
    window.addEventListener("message", on);
    const onAccent = (e: Event) => {
      const a = (e as CustomEvent<SiteAccent>).detail;
      for (const f of [overlay.current, inspect.current]) post(f, { radarDemo: "set-accent", accent: a.accent });
    };
    window.addEventListener(ACCENT_EVENT, onAccent);
    return () => {
      window.removeEventListener("message", on);
      window.removeEventListener(ACCENT_EVENT, onAccent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // F10 (as in the game): the inspect page on what's looked at; Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const r = box.current?.getBoundingClientRect();
      const seen = r && r.top < innerHeight && r.bottom > 0;
      if (!seen) return;
      if (e.key === "F10") {
        e.preventDefault();
        openInspect(looked.current);
      } else if (e.key === "Escape") setInspecting(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The artifact screen open: Radar recognizes the artifact.
  useEffect(() => {
    if (!demo) return;
    detect(tab === "artifact" ? { artifact: ARTIFACT_NAME } : {});
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, demo]);

  const enter = (item: Item, kind: "weapon" | "armor", x: number, y: number, side: "left" | "right") => {
    window.clearTimeout(leave.current);
    setHover({ item, x, y, side });
    detect(kind === "weapon" ? { weapon: item.hash } : { armor: [item.hash] });
  };
  const exit = () => {
    window.clearTimeout(leave.current);
    leave.current = window.setTimeout(() => {
      setHover(null);
      detect(tab === "artifact" ? { artifact: ARTIFACT_NAME } : {});
    }, 200);
  };

  const src = (kind: "overlay" | "inspect") =>
    `app/${kind === "overlay" ? "overlay.html" : "index.html"}?demo${kind === "inspect" ? "&inspect" : ""}&accent=${encodeURIComponent(accent.accent)}`;

  return (
    <section id="preview" className="relative mx-auto max-w-[1500px] px-5 py-24">
      <SectionTitle
        kicker="In-game overlay preview"
        title="Look around, as in the game."
        text="Hover a weapon or armor piece: Radar recognizes it and shows its notice. Click it or press F10 for Radar's page on it. Open the artifact too."
      />
      <div
        ref={box}
        className="reveal relative mt-12 w-full overflow-hidden rounded-2xl border border-white/[0.08]"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>
          <GameScreen demo={demo} tab={tab} setTab={setTab} enter={enter} exit={exit} open={(l) => openInspect(l)} hover={hover} />
          {near && (
            <iframe
              ref={overlay}
              src={src("overlay")}
              title="Radar overlay"
              tabIndex={-1}
              className="pointer-events-none absolute inset-0 border-0"
              style={{ width: W, height: H, background: "transparent" }}
              allowTransparency
            />
          )}
          {near && (
            <div
              className={`absolute inset-0 transition-opacity duration-200 ${inspecting ? "opacity-100" : "pointer-events-none opacity-0"}`}
              onClick={() => setInspecting(false)}
            >
              <iframe
                ref={inspect}
                src={src("inspect")}
                title="Radar inspect page"
                className="absolute border-0"
                style={{ left: 240, top: 110, width: 1440, height: 860, background: "transparent" }}
                onClick={(e) => e.stopPropagation()}
                allowTransparency
              />
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-[12px] text-white/30">
        A drawn game screen with your gear; the notice and the page over it are the real Radar · Destiny 2 isn't running here
      </p>
    </section>
  );
}

const RARITY = { exotic: "#ceae33", legendary: "#522f65" };

function Slot({
  item,
  x,
  y,
  size = 96,
  onEnter,
  onLeave,
  onClick,
}: {
  item: Item;
  x: number;
  y: number;
  size?: number;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  return (
    <button
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      className="absolute block overflow-hidden outline-offset-2 hover:outline-2 hover:outline-white"
      style={{ left: x, top: y, width: size, height: size, border: `3px solid ${item.exotic ? RARITY.exotic : RARITY.legendary}`, background: "#1c1a22" }}
      aria-label={item.name}
    >
      {item.icon && <img src={BUNGIE + item.icon} alt="" className="block size-full object-cover" draggable={false} />}
    </button>
  );
}

/** The game's character and artifact screens, drawn (no game art: the
 *  player's real items and icons from Bungie's API on a calm ground). */
function GameScreen({
  demo,
  tab,
  setTab,
  enter,
  exit,
  open,
  hover,
}: {
  demo: Demo | null;
  tab: "character" | "artifact";
  setTab: (t: "character" | "artifact") => void;
  enter: (item: Item, kind: "weapon" | "armor", x: number, y: number, side: "left" | "right") => void;
  exit: () => void;
  open: (l: Looked) => void;
  hover: { item: Item; x: number; y: number; side: "left" | "right" } | null;
}) {
  const b = demo?.build;
  const c = demo?.character;
  return (
    <div
      className="absolute inset-0 select-none"
      style={{
        background: "radial-gradient(60% 75% at 50% 45%, #5d4c66 0%, #3a3341 45%, #1d1a22 100%)",
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        color: "#f2f0f5",
      }}
    >
      {/* Top bar: emblem, name, power; the screens. */}
      <div className="absolute inset-x-0 top-0 h-[115px]" style={{ background: "linear-gradient(#0d0c10ee, #0d0c1088)" }}>
        {c?.emblemPath && <img src={BUNGIE + c.emblemPath} alt="" className="absolute" style={{ left: 140, top: 22, width: 76, height: 76 }} />}
        <div className="absolute" style={{ left: 248, top: 22, fontSize: 40, fontWeight: 700, letterSpacing: "0.04em" }}>
          Guardian
        </div>
        <div className="absolute" style={{ left: 250, top: 76, fontSize: 21, letterSpacing: "0.06em", color: "#d8d4de" }}>
          {c ? `${c.className} · ◆ ${c.light}` : ""}
        </div>
        <div className="absolute flex gap-11" style={{ left: 883, top: 54, fontSize: 21, letterSpacing: "0.08em" }}>
          {["CLAN", "COLLECTIONS", "JOURNEY"].map((t) => (
            <span key={t} className="opacity-45">
              {t}
            </span>
          ))}
          {(["character", "artifact"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`relative uppercase ${tab === t ? "text-white" : "text-white/70 hover:text-white"}`}>
              {t}
              {tab === t && <span className="absolute -bottom-[26px] left-0 h-[4px] w-full bg-white/80" />}
            </button>
          ))}
        </div>
      </div>

      {tab === "character" && b && (
        <>
          {/* Subclass. */}
          {b.subclass.item.icon && (
            <img
              src={BUNGIE + b.subclass.item.icon}
              alt=""
              className="absolute rounded-full"
              style={{ left: 466, top: 178, width: 124, height: 124, boxShadow: "0 0 0 3px #ffffff30" }}
            />
          )}
          {/* Weapons, left; armor, right. */}
          {b.weapons.slice(0, 3).map((w, i) => (
            <Slot key={w.hash} item={w} x={480} y={350 + i * 126} onEnter={() => enter(w, "weapon", 480, 350 + i * 126, "right")} onLeave={exit} onClick={() => open({ weapon: w.hash })} />
          ))}
          {b.armor.slice(0, 5).map((a, i) => (
            <Slot key={a.hash} item={a} x={1361} y={223 + i * 126} onEnter={() => enter(a, "armor", 1361, 223 + i * 126, "left")} onLeave={exit} onClick={() => open({ armor: [a.hash] })} />
          ))}
          {/* Power and stats. */}
          <div className="absolute text-right" style={{ right: 1920 - 1335, top: 216 }}>
            <div style={{ fontSize: 26, letterSpacing: "0.05em" }}>POWER</div>
            <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1, color: "#e8c851" }}>◆{c?.light}</div>
          </div>
          <div className="absolute flex flex-col gap-[14px] rounded-sm px-4 py-4" style={{ left: 1233, top: 470, background: "#00000022" }}>
            {b.stats.slice(0, 6).map((s) => (
              <div key={s.hash} className="flex items-center justify-end gap-3" style={{ fontSize: 26 }}>
                {s.value}
                {s.icon && <img src={BUNGIE + s.icon} alt="" style={{ width: 26, height: 26 }} />}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "artifact" && demo && <ArtifactScreen columns={demo.artifact} open={() => open({ artifact: ARTIFACT_NAME })} />}

      {/* The game's own tooltip for what's hovered. */}
      {hover && <Tooltip {...hover} />}

      {/* The keys, as at the bottom of the game's screens. */}
      <div className="absolute inset-x-0 bottom-0 flex h-[62px] items-center justify-end gap-10 pr-[120px]" style={{ background: "#0d0c10cc", fontSize: 22 }}>
        <span>
          <Key>Hover</Key> Inspect
        </span>
        <span>
          <Key>F10</Key> Radar page
        </span>
        <span>
          <Key>Esc</Key> Close
        </span>
      </div>
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <span className="mr-2 rounded-[4px] border border-white/50 px-1.5 py-0.5 text-[17px]">{children}</span>;
}

/** A game-like tooltip beside the hovered item: name in its rarity's colour,
 *  its perks or mods. */
function Tooltip({ item, x, y, side }: { item: Item; x: number; y: number; side: "left" | "right" }) {
  const parts = (item.perks ?? item.mods ?? []).filter((p) => p.icon).slice(0, 6);
  return (
    <div
      className="pointer-events-none absolute"
      style={{ top: Math.min(y - 10, H - 420), width: 430, ...(side === "right" ? { left: x + 118 } : { left: x - 448 }) }}
    >
      <div className="px-5 py-3" style={{ background: item.exotic ? RARITY.exotic : RARITY.legendary, color: item.exotic ? "#1d1a12" : "#fff" }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.02em" }}>{item.name.toUpperCase()}</div>
        <div style={{ fontSize: 18, opacity: 0.85 }}>{item.typeName}</div>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4" style={{ background: "#0d0c10e8" }}>
        {parts.map((p) => (
          <div key={p.hash} className="flex items-center gap-3" style={{ fontSize: 19 }}>
            <img src={BUNGIE + p.icon} alt="" style={{ width: 34, height: 34 }} />
            {p.name}
          </div>
        ))}
        <div className="pt-1 text-white/55" style={{ fontSize: 16 }}>
          Click or F10: Radar's page on it
        </div>
      </div>
    </div>
  );
}

/** The seasonal artifact: its perks by column, as in the game. */
function ArtifactScreen({ columns, open }: { columns: Item[][]; open: () => void }) {
  const [perk, setPerk] = useState<Item | null>(null);
  return (
    <div className="absolute inset-x-0" style={{ top: 160 }}>
      <div className="text-center" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "0.1em" }}>
        {ARTIFACT_NAME.toUpperCase()}
      </div>
      <div className="mt-2 text-center text-white/60" style={{ fontSize: 20 }}>
        Seasonal artifact · Renegades
      </div>
      <div className="mx-auto mt-10 flex justify-center gap-10">
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col gap-4">
            {col.map((p) => (
              <button
                key={p.hash}
                onMouseEnter={() => setPerk(p)}
                onMouseLeave={() => setPerk(null)}
                onClick={open}
                className="block rounded-md hover:outline-2 hover:outline-white"
                style={{ width: 72, height: 72, background: "#ffffff12", border: "1px solid #ffffff22" }}
              >
                {p.icon && <img src={BUNGIE + p.icon} alt={p.name} className="block size-full" draggable={false} />}
              </button>
            ))}
          </div>
        ))}
      </div>
      {perk && (
        <div className="absolute rounded-sm px-5 py-4" style={{ left: 1420, top: 160, width: 380, background: "#0d0c10ee" }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{perk.name}</div>
          <div className="mt-2 text-white/70" style={{ fontSize: 18, lineHeight: 1.35 }}>
            {perk.description}
          </div>
        </div>
      )}
    </div>
  );
}
