import { GlassButton, GlassPanel, KeyCap } from "./components/glass";
import { DEFAULT_POSITIONS, readLayout, resetLayout, stage, Widget } from "./components/Widget";
import { SessionWidget, StatsWidget } from "./components/widgets";
import { HudPanel } from "./components/hud";
import { useDetectedGear } from "./lib/armor";
import { hotkeys, keyLabels, useHotkeys } from "./lib/hotkeys";
import { useBungie } from "./lib/bungie";
import { useLanguage, useT } from "./lib/i18n";
import { useOverlayState } from "./lib/overlay";
import { useSettings } from "./lib/settings";
import { call, isTauri, subscribe } from "./lib/tauri";
import { useEffect, useRef, useState } from "react";

/** Room left around the widgets, and the grid the frame is rounded out to
 *  (so it changes seldom: a widget a little bigger stays inside). */
const FRAME_MARGIN = 16;
const FRAME_GRID = 64;
/** The notice's size before it was ever shown (CSS px). */
const NOTICE_SIZE = { w: 460, h: 48 };

const at = (id: string) => () => DEFAULT_POSITIONS[id](stage().w, stage().h);
const sessionDefault = at("session");
const statsDefault = at("stats");
const noticeDefault = at("notice");

export function Overlay() {
  const t = useT();
  const [settings] = useSettings();
  const { edit, setEdit } = useOverlayState();
  const snapshot = useBungie();
  const gear = useDetectedGear();
  const language = useLanguage();
  const [keys] = useHotkeys();
  // Something recognized (an item on its inspect screen, a guardian's
  // character screen): a notice while it is on screen; the hotkey opens it
  // on the inspect page.
  const [guardian, setGuardian] = useState<string | null>(null);
  useEffect(() => subscribe<string | null>("guardian-present", (name) => setGuardian(name ?? null)), []);
  const [artifact, setArtifact] = useState<string | null>(null);
  useEffect(() => subscribe<string | null>("artifact-present", (name) => setArtifact(name ?? null)), []);
  const notice = gear?.weapon?.name ?? gear?.armor?.item.name ?? guardian ?? artifact;
  const inspectKeys = keyLabels(hotkeys.keysOf(keys, "weapon"), language === "de").join(" + ");
  const common = { edit, scale: settings.scale, opacity: settings.opacity };

  // Result of a loadout hotkey, shown for a moment at the top.
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    let id = 0;
    const off = subscribe<{ ok: boolean; message: string }>("loadout-equipped", (e) => {
      setToast(e);
      window.clearTimeout(id);
      id = window.setTimeout(() => setToast(null), 3000);
    });
    return () => {
      off();
      window.clearTimeout(id);
    };
  }, []);

  // The control window can also reset the layout.
  useEffect(() => subscribe("layout-reset", resetLayout), []);

  // The window shows only the part of the screen with the widgets (a window
  // over the game costs it frames, a smaller one fewer); the page is laid
  // out as the whole screen, moved by where that part is (CSS px).
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const originRef = useRef(origin);
  // The notice's last size shown (it is there only now and then; its room
  // is kept all the time, so the window doesn't change when it comes).
  const noticeSize = useRef(NOTICE_SIZE);
  const showsNotice = settings.widgets.weapon;

  // Tell Radar where the widgets are (in screen pixels): its own screen
  // reading blacks them out instead of reading the overlay's text; and the
  // part of the screen the window needs.
  useEffect(() => {
    if (!isTauri) return;
    let lastAreas = "";
    let lastFrame = "";
    const report = () => {
      const scale = window.devicePixelRatio;
      const o = originRef.current;
      const rects = [...document.querySelectorAll<HTMLElement>("[data-overlay-widget]")].map((el) => {
        const r = el.getBoundingClientRect();
        if (el.dataset.overlayWidget === "notice") noticeSize.current = { w: r.width, h: r.height };
        return { x: r.left + o.x, y: r.top + o.y, w: r.width, h: r.height };
      });
      const areas = rects.map((r) => ({ x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale }));
      const json = JSON.stringify(areas);
      if (json !== lastAreas) {
        lastAreas = json;
        void call("overlay_set_areas", { areas });
      }
      // The frame: every widget, the notice's room too, rounded out.
      const all = [...rects];
      if (showsNotice) {
        const p = readLayout().notice ?? noticeDefault();
        all.push({ x: p.x, y: p.y, w: noticeSize.current.w, h: noticeSize.current.h });
      }
      let frame: { x: number; y: number; w: number; h: number } | null = null;
      if (!edit && all.length) {
        const { w: sw, h: sh } = stage();
        const x0 = Math.max(0, Math.floor((Math.min(...all.map((r) => r.x)) - FRAME_MARGIN) / FRAME_GRID) * FRAME_GRID);
        const y0 = Math.max(0, Math.floor((Math.min(...all.map((r) => r.y)) - FRAME_MARGIN) / FRAME_GRID) * FRAME_GRID);
        const x1 = Math.min(sw, Math.ceil((Math.max(...all.map((r) => r.x + r.w)) + FRAME_MARGIN) / FRAME_GRID) * FRAME_GRID);
        const y1 = Math.min(sh, Math.ceil((Math.max(...all.map((r) => r.y + r.h)) + FRAME_MARGIN) / FRAME_GRID) * FRAME_GRID);
        frame = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      const frameJson = JSON.stringify(frame);
      if (frameJson !== lastFrame) {
        lastFrame = frameJson;
        const next = frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 };
        originRef.current = next;
        setOrigin(next);
        void call("overlay_set_frame", {
          frame: frame && { x: frame.x * scale, y: frame.y * scale, w: frame.w * scale, h: frame.h * scale },
        });
      }
    };
    report();
    const id = window.setInterval(report, 500);
    return () => window.clearInterval(id);
    // (At once when the loadout message comes: the window takes it in.)
  }, [edit, showsNotice, !!toast]);

  return (
    <div
      className="absolute top-0 left-0"
      style={{ width: stage().w, height: stage().h, transform: `translate(${-origin.x}px, ${-origin.y}px)` }}
    >
      {edit && (
        <div className="animate-fade-in edit-grid absolute inset-0 bg-black/35">
          <GlassPanel
            radius={16}
            className="absolute top-6 left-1/2 flex -translate-x-1/2 items-center gap-4 py-2.5 pr-2.5 pl-4"
          >
            <span className="size-2 animate-pulse-dot rounded-full bg-(--accent)" />
            <span className="text-[13.5px] font-medium">{t("overlay.edit")}</span>
            <span className="text-[12.5px] text-white/50">{t("overlay.dragHint")}</span>
            <GlassButton size="sm" onClick={resetLayout}>
              {t("overlay.resetLayout")}
            </GlassButton>
            <GlassButton size="sm" variant="primary" onClick={() => setEdit(false)}>
              {t("overlay.done")} <KeyCap>F9</KeyCap>
            </GlassButton>
          </GlassPanel>
        </div>
      )}

      {/* (Counted as a widget: the window takes it in while it shows.) */}
      {toast && (
        <div data-overlay-widget="toast" className="absolute top-6 left-1/2 -translate-x-1/2">
          <HudPanel className="animate-fade-in">
            <div className={"px-4 py-2 text-[13px] font-medium " + (toast.ok ? "text-white" : "text-red-300")}>
              {toast.ok ? t("loadouts.equipped", { name: toast.message }) : toast.message}
            </div>
          </HudPanel>
        </div>
      )}

      {/* "… recognized": while it is on screen; placed in the layout editor
          (a sample there). */}
      {settings.widgets.weapon && (notice || edit) && (
        <Widget key="notice" id="notice" label={t("widgets.weapon")} defaultPosition={noticeDefault} {...common}>
          <HudPanel>
            <div className="flex items-center gap-3 px-4 py-2 text-[13px] whitespace-nowrap">
              <span className="size-1.5 rounded-full bg-(--accent-text)" />
              <span className="font-medium text-white">{t("inspect.noticed", { name: notice ?? "Ace of Spades" })}</span>
              {inspectKeys && <span className="text-white/55">{t("inspect.noticedHint", { keys: inspectKeys })}</span>}
            </div>
          </HudPanel>
        </Widget>
      )}

      {settings.widgets.session && (
        <Widget id="session" label={t("widgets.session")} defaultPosition={sessionDefault} {...common}>
          <SessionWidget snapshot={snapshot} />
        </Widget>
      )}
      {settings.widgets.stats && (
        <Widget id="stats" label={t("widgets.stats")} defaultPosition={statsDefault} delay={80} {...common}>
          <StatsWidget snapshot={snapshot} />
        </Widget>
      )}
    </div>
  );
}
