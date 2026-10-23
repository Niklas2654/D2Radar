import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { cx, GlassButton } from "../components/glass";
import { IconDim, IconExternal, IconHome, IconRefresh } from "../components/icons";
import type { Direction, Phase } from "../components/PageTransition";
import { useT } from "../lib/i18n";
import { call, isTauri, nextSeq } from "../lib/tauri";

const DIM_URL = "https://app.destinyitemmanager.com/";
/** DIM itself only auto-refreshes every 120 s; nudge it more often while visible. */
const REFRESH_INTERVAL_MS = 30_000;
const USED_KEY = "radar.dimUsed";

/** Load DIM hidden at every app start, so its tab opens ready (and already
 *  in Radar's look, see dim.rs). */
export function preloadDimIfUsed(): boolean {
  try {
    if (isTauri) {
      void call("dim_preload");
      return true;
    }
  } catch {
    // DIM just loads when its tab is first opened.
  }
  return false;
}

/** The latest picture of DIM (data URL); kept across visits of the tab. */
let lastSnapshot: string | null = null;
/** How often a fresh picture is taken while DIM is shown. */
/** Pictures are taken when the pointer heads for the navbar; this is only a
 *  fallback (taking one makes the page stutter for a moment). */
const SNAPSHOT_EVERY_MS = 20_000;

/**
 * Hosts the native DIM webview, placed exactly over the host element.
 *
 * A native webview can't take part in the page's CSS animation, and
 * animating DIM's own document never quite keeps pace with the app. So the
 * page swap slides a picture of DIM (taken regularly, and when the pointer
 * heads for the navbar) along with the page, and the real webview is only
 * shown once the page has arrived (and hidden at once when it leaves).
 * Without a picture yet (first visit), DIM animates its own document.
 */
export function DimPage({ phase, dir }: { phase: Phase; dir: Direction }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState(lastSnapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  // Decided anew on each arrival: with a picture or with DIM's own
  // animation. (Back on DIM while it still slides out, the page stays the
  // same one: a decision of an earlier visit doesn't count.)
  const visit = useRef({ phase, picture: phase === "enter" && !!lastSnapshot && !reduced });
  if (phase === "enter" && visit.current.phase !== "enter") visit.current.picture = !!lastSnapshot && !reduced;
  visit.current.phase = phase;
  const arriveWithPicture = visit.current.picture;
  // The webview shows once the page is in place (with a picture) or right
  // away (animating itself), until the page starts leaving.
  const webviewShown = phase === "active" || (phase === "enter" && !arriveWithPicture);
  // What lies under the webview (its picture, the loading hint) only shows
  // while the page moves: under the see-through webview it would shine
  // through (and look smeared when scrolling).
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (phase !== "active") {
      setSettled(false);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), 250);
    return () => window.clearTimeout(id);
  }, [phase]);
  const underlay = phase !== "active" || !settled;
  // Whether DIM has loaded (it loads in the background at start): only
  // then is there nothing to wait for and no loading hint to show.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    let timer = 0;
    const check = () =>
      void call<{ dim: boolean }>("webviews_ready")
        .then((r) => {
          if (!alive) return;
          if (r?.dim) setReady(true);
          else timer = window.setTimeout(check, 300);
        })
        .catch(() => {});
    check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  // Read when visibility flips; the direction is set together with the phase.
  const direction = useRef(dir);
  direction.current = dir;

  useEffect(() => {
    const el = host.current;
    if (!isTauri || !webviewShown || !el) return;
    try {
      localStorage.setItem(USED_KEY, "1");
    } catch {
      // Storage unavailable; preloading is only a convenience.
    }
    // When the page animation started (the app's CSS animation starts with
    // this render); DIM's own animation catches up to it.
    const startedAt = Date.now();
    // Final (untransformed) bounds: the page layer may still be sliding in,
    // but offsetLeft/Top ignore transforms and the layer's container doesn't move.
    const show = (animate: Direction | null, reset = false) => {
      const container = el.offsetParent?.parentElement;
      if (!container) return;
      const base = container.getBoundingClientRect();
      void call("dim_show", {
        bounds: {
          x: base.left + el.offsetLeft,
          y: base.top + el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        },
        animate,
        startedAt: animate ? startedAt : null,
        reset,
        seq: nextSeq(),
      });
    };
    // Only an arrival without a picture animates DIM itself; resizes just reposition.
    const animate = phase === "enter" && !reduced;
    // Arrived with a picture: DIM shows as is, reset from earlier animations.
    show(animate ? direction.current : null, !animate);
    const sync = () => show(null);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      // Leaving: DIM hides at once (its picture, if any, slides out with the
      // page). Its own exit animation would leave it standing still over
      // the next page until it ends.
      void call("dim_hide_now", { seq: nextSeq() });
    };
    // phase only matters for the first show; webviewShown drives the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webviewShown]);

  // Keep the picture fresh while DIM is shown.
  useEffect(() => {
    if (!isTauri || phase !== "active") return;
    let last = 0;
    const take = () => {
      if (document.hidden || Date.now() - last < 400) return;
      last = Date.now();
      void call<string | null>("dim_snapshot")
        .then((url) => {
          if (url) {
            lastSnapshot = url;
            setSnapshot(url);
          }
        })
        .catch(() => {});
    };
    const first = window.setTimeout(take, 900);
    const id = window.setInterval(take, SNAPSHOT_EVERY_MS);
    window.addEventListener("radar:nav-hover", take);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      window.removeEventListener("radar:nav-hover", take);
    };
  }, [phase]);

  useEffect(() => {
    if (!isTauri || phase === "exit") return;
    const id = window.setInterval(() => {
      if (!document.hidden) void call("dim_refresh");
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phase === "exit"]);

  return (
    <div className="flex h-full flex-col gap-3 p-5 pt-4">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-(--accent-glow) bg-[radial-gradient(circle_at_50%_30%,var(--accent-soft),rgb(0_0_0/0.35))] text-(--accent-text) shadow-[0_0_9px_-2px_var(--accent-halo),inset_0_1px_0_rgb(255_255_255/0.12)]">
          <IconDim />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[15px] font-semibold tracking-tight">Destiny Item Manager</h1>
          <p className="text-[12px] text-white/45">{t("dim.subtitle", { n: REFRESH_INTERVAL_MS / 1000 })}</p>
        </div>
        <GlassButton size="sm" onClick={() => void call("dim_refresh")} disabled={!isTauri}>
          <IconRefresh /> {t("dim.refresh")}
        </GlassButton>
        <GlassButton size="sm" onClick={() => void call("dim_home")} disabled={!isTauri}>
          <IconHome /> {t("dim.home")}
        </GlassButton>
        <GlassButton
          size="sm"
          onClick={() => (isTauri ? void openUrl(DIM_URL) : window.open(DIM_URL))}
        >
          <IconExternal /> {t("dim.browser")}
        </GlassButton>
      </div>

      {/* The native webview is placed exactly over this element. */}
      <div
        ref={host}
        // No panel of its own: DIM has no background either (Radar's shows
        // through), so the area looks the same before and after DIM shows.
        className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[14px]"
      >
        {/* DIM as last seen: slides with the page while the webview is hidden. */}
        {underlay && snapshot && !reduced && (
          <img src={snapshot} alt="" draggable={false} className="absolute inset-0 z-10 size-full object-cover" />
        )}
        {/* Only while DIM really still loads (it would shine through it). */}
        <div className={cx("flex flex-col items-center gap-3 text-center", (!underlay || (ready && isTauri)) && "invisible")}>
          <span className="size-9 animate-spin rounded-full border-2 border-white/10 border-t-(--accent)" />
          <p className="text-[13px] text-white/55">
            {isTauri ? t("dim.loading") : t("dim.desktopOnly")}
          </p>
        </div>
      </div>
    </div>
  );
}
