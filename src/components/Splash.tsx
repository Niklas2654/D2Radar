import { useEffect, useRef, useState } from "react";
import { useT, type TranslationKey } from "../lib/i18n";
import { preloadAll, type PreloadStep } from "../lib/preload";
import { cx } from "./glass";
import { VaporText } from "./VaporText";

/** Shown at least this long (the intro, and "RADAR" condensing out of
 *  vapor), at most this long (then the app opens and loading goes on
 *  behind it). */
const MIN_MS = 4300;
/** A safety net only (Bungie, DIM or Discord hanging). */
const MAX_MS = 60_000;
/** The loading run and where it reports to (the mounted screen). */
let running: Promise<void> | null = null;
let report: ((steps: PreloadStep[]) => void) | null = null;
/** The way out: "RADAR" evaporates and the radar collapses (CLOSE_MS, its
 *  last flash dying away), half a second of black (BLACK_MS), then the app
 *  fades in (EXIT_MS). */
const CLOSE_MS = 1050;
const BLACK_MS = 500;
/** Before the way out, the progress ring closes all the way (it eases
 *  behind the loading, and a step may end unreported). */
const FILL_MS = 250;
/** Quick and soft (styles.css, .splash-reveal). */
const EXIT_MS = 900;

/**
 * The loading screen at start: a radar sweeping for contacts while Radar
 * loads everything the tabs show (see preloadAll). Opens the app when done,
 * after MAX_MS, or on "Skip".
 */
export function Splash({ startWebviews, onDone }: { startWebviews: () => boolean | void; onDone: () => void }) {
  const t = useT();
  const [steps, setSteps] = useState<PreloadStep[]>([]);
  const started = useRef(performance.now()).current;
  // performance.now() when the way out started (null: still loading).
  const [closingAt, setClosingAt] = useState<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  // Leaving: the ring shows everything loaded.
  const [complete, setComplete] = useState(false);
  const left = useRef(false);

  // Done (or skipped): "RADAR" evaporates, the radar collapses, black,
  // then the app fades in. Skip goes straight to the fade.
  const leave = (skip = false) => {
    if (left.current) return;
    left.current = true;
    const reveal = () => {
      setRevealing(true);
      window.setTimeout(onDone, EXIT_MS);
    };
    if (skip) return reveal();
    setComplete(true);
    window.setTimeout(() => {
      setClosingAt(performance.now());
      window.setTimeout(reveal, CLOSE_MS + BLACK_MS);
    }, FILL_MS);
  };

  useEffect(() => {
    const started = Date.now();
    let stop = false;
    // Once per app run (React may run this effect twice in development).
    running ??= preloadAll((s) => report?.(s), startWebviews, false, true);
    report = (s) => !stop && setSteps(s);
    void running.finally(() => {
      window.setTimeout(() => !stop && leave(), Math.max(0, MIN_MS - (Date.now() - started)));
    });
    const cap = window.setTimeout(() => !stop && leave(), MAX_MS);
    return () => {
      stop = true;
      window.clearTimeout(cap);
    };
    // Once per start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finished = steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const progress = steps.length ? finished / steps.length : 0;
  // The running steps take turns in the status line.
  const runningSteps = steps.filter((s) => s.state === "running");
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTurn((n) => n + 1), 1300);
    return () => window.clearInterval(id);
  }, []);
  const now = runningSteps.length ? runningSteps[turn % runningSteps.length] : null;
  const status = now
    ? t(now.label as TranslationKey)
    : steps.length > 0 && finished === steps.length
      ? t("preload.ready")
      : "";

  return (
    <div
      className={cx("splash fixed inset-0 z-[100] grid place-items-center overflow-hidden", revealing && "splash-reveal")}
      style={{ "--exit": `${EXIT_MS}ms` } as React.CSSProperties}
      data-tauri-drag-region
    >
      <div className="relative flex flex-col items-center" data-tauri-drag-region>
        <NeonRadar progress={complete ? 1 : progress} closingAt={closingAt} />
        {/* "RADAR" condensing out of vapor once the radar has unfolded. */}
        <div className="-mt-16 -mb-12">
          <VaporText text="RADAR" startAt={started + (IMPACT + UNFOLD * 0.5) * 1000} dissolveAt={closingAt} />
        </div>
        <div className={cx("flex flex-col items-center transition-opacity duration-500", closingAt !== null && "opacity-0")}>
          <p key={status} className="splash-late mt-3 h-4 text-[11.5px] tracking-wide text-white/35">
            {status || " "}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Intro timing (seconds): dark, then a beam of light flies in… */
const BEAM_FROM = 0.45;
/** …hits the center (flash), and the radar unfolds from there. */
const IMPACT = 1.25;
const UNFOLD = 0.9;

/**
 * The loading animation: a neon radar on black. It starts dark; a beam of
 * light shoots in and hits the center, the rings burst out and the light
 * spirals out into a comet that sweeps the scope with a glowing tail. A
 * soft core breathes in the middle, contacts flash as the beam passes them,
 * and a faint arc outside the scope shows how far loading is.
 */
export function NeonRadar({ progress, closingAt }: { progress: number; closingAt: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const closingRef = useRef(closingAt);
  closingRef.current = closingAt;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = 760;
    const H = 360;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const cx = W / 2;
    const cy = H / 2;
    const R = 118;

    // The theme's accent, and a violet it blends into (like the references).
    const probe = document.createElement("canvas").getContext("2d");
    let rgb = [91, 140, 255];
    if (probe) {
      probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5b8cff";
      const hex = String(probe.fillStyle);
      if (hex.startsWith("#") && hex.length === 7) rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    const A = (a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, a)})`;
    const V = (a: number) => `rgba(150,90,255,${Math.max(0, a)})`;
    const WHITE = (a: number) => `rgba(255,255,255,${Math.max(0, a)})`;
    const CLEAR = "rgba(0,0,0,0)";
    const TAU = Math.PI * 2;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    const out3 = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
    const glowDot = (x: number, y: number, r: number, core: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, WHITE(core));
      g.addColorStop(0.2, color);
      g.addColorStop(1, CLEAR);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    };

    // Contacts at fixed spots; each flashes when the beam passes.
    const blips = Array.from({ length: 7 }, (_, i) => ({
      angle: (i * 2.399 + 0.6) % TAU,
      dist: 0.3 + ((i * 0.37) % 0.6),
      lit: -10,
    }));
    const norm = (x: number) => ((x % TAU) + TAU) % TAU;

    let shown = 0;
    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      // Eases after the loading; all of it quickly (so it closes in time).
      const target = progressRef.current;
      shown += (target - shown) * (target >= 1 ? 0.2 : 0.06);
      if (target - shown < 0.002) shown = target;
      ctx.globalCompositeOperation = "source-over";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // Closing: the radar pulls into its center and goes out with a last
      // flash (it starts a little after the word begins to evaporate).
      const closing = closingRef.current;
      const k = closing === null ? 0 : (now - closing - 250) / 800;
      if (k > 0) {
        const s = Math.max(0, 1 - (1 - Math.pow(1 - Math.min(1, k), 3)));
        canvas.style.opacity = String(Math.max(0, 1 - Math.pow(Math.min(1, k), 2)));
        if (k >= 1) {
          // Only the flash is left.
          const f = Math.max(0, 1 - (k - 1) / 0.5);
          canvas.style.opacity = "1";
          ctx.globalCompositeOperation = "lighter";
          if (f > 0) glowDot(cx, cy, 30 * f + 6, f, A(0.7 * f));
          frame = requestAnimationFrame(draw);
          return;
        }
        ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cx * (1 - s), dpr * cy * (1 - s));
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      // 1. A beam of light flies in from the left and hits the center.
      if (t > BEAM_FROM && t < IMPACT + 0.5) {
        const p = out3((t - BEAM_FROM) / (IMPACT - BEAM_FROM));
        const fadeOut = 1 - clamp((t - IMPACT) / 0.5);
        const hx = -60 + (cx + 60) * p;
        const len = 80 + 360 * (1 - p) + 120 * p;
        const beam = ctx.createLinearGradient(hx - len, cy, hx, cy);
        beam.addColorStop(0, CLEAR);
        beam.addColorStop(0.6, V(0.35 * fadeOut));
        beam.addColorStop(1, A(0.95 * fadeOut));
        ctx.strokeStyle = beam;
        ctx.shadowColor = A(1);
        ctx.shadowBlur = 24;
        for (const [w, a] of [
          [7, 0.5],
          [2.5, 1],
        ]) {
          ctx.globalAlpha = a;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(hx - len, cy);
          ctx.lineTo(hx, cy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        glowDot(hx, cy, 34, 0.95 * fadeOut, A(0.8 * fadeOut));
      }

      // 2. Impact: a flash and a shockwave ring.
      if (t > IMPACT && t < IMPACT + 1.2) {
        const k = (t - IMPACT) / 1.2;
        glowDot(cx, cy, 40 + 160 * out3(k), 0.9 * (1 - k) ** 2, A(0.5 * (1 - k) ** 2));
        ctx.strokeStyle = A(0.6 * (1 - k));
        ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, (R + 40) * out3(k), 0, TAU);
        ctx.stroke();
      }

      // 3. The radar, unfolding from the center.
      const u = (t - IMPACT) / UNFOLD;
      if (u > 0) {
        const grow = out3(u);
        const fade = clamp(u * 1.5);

        // Breathing core: soft, drifting glows (a morphing blob).
        for (let k = 0; k < 3; k++) {
          const wob = t * (0.7 + k * 0.23) + k * 2.1;
          const x = cx + Math.cos(wob) * 9;
          const y = cy + Math.sin(wob * 1.3) * 9;
          const r = (52 + Math.sin(t * 1.6 + k) * 8) * grow;
          if (r <= 1) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, k === 1 ? V(0.22 * fade) : A(0.2 * fade));
          g.addColorStop(1, CLEAR);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }

        // Rings, one after the other.
        ctx.lineWidth = 1;
        [0.33, 0.66, 1].forEach((f, i) => {
          const g = out3(u * 1.4 - i * 0.18);
          if (g <= 0) return;
          ctx.strokeStyle = A((f === 1 ? 0.11 : 0.07) * g);
          ctx.beginPath();
          ctx.arc(cx, cy, R * f * g, 0, TAU);
          ctx.stroke();
        });

        // The comet starts where the beam hit and spirals out to the rim.
        const sweep = Math.PI + (t - IMPACT) * 2.6;
        const r = R * grow;
        const span = 1.1 * grow;
        if (span > 0.01) {
          // The beam: a soft wedge behind the sweep.
          const wedge = ctx.createConicGradient(sweep - span, cx, cy);
          wedge.addColorStop(0, CLEAR);
          wedge.addColorStop(span / TAU, A(0.16 * fade));
          wedge.addColorStop(span / TAU + 0.001, CLEAR);
          wedge.addColorStop(1, CLEAR);
          ctx.fillStyle = wedge;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.fill();
        }
        // The tail along the rim (shorter while it unfolds).
        const tail = 2.4 * grow;
        const steps = 60;
        for (let i = steps; i > 0; i--) {
          const f = i / steps;
          const a = 1 - f;
          const glow = Math.pow(a, 2.2);
          ctx.strokeStyle = f > 0.5 ? V(0.5 * glow) : A(0.75 * glow);
          ctx.lineWidth = 1 + 4.5 * glow;
          ctx.shadowColor = A(0.9);
          ctx.shadowBlur = 18 * glow;
          ctx.beginPath();
          ctx.arc(cx, cy, r, sweep - tail * f, sweep - tail * (f - 1 / steps));
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        // A white-hot head, and the sweep line to it.
        const hx = cx + Math.cos(sweep) * r;
        const hy = cy + Math.sin(sweep) * r;
        glowDot(hx, hy, 26, 0.95, A(0.8));
        const line = ctx.createLinearGradient(cx, cy, hx, hy);
        line.addColorStop(0, A(0));
        line.addColorStop(1, A(0.45 * fade));
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        // Contacts (once unfolded): flash, then fade with a ring going out.
        if (u > 1) {
          for (const b of blips) {
            if (Math.abs(norm(sweep) - b.angle) < 0.06) b.lit = t;
            const age = t - b.lit;
            if (age > 2.2) continue;
            const glow = 1 - age / 2.2;
            const x = cx + Math.cos(b.angle) * R * b.dist;
            const y = cy + Math.sin(b.angle) * R * b.dist;
            glowDot(x, y, 12, 0.9 * glow, A(0.7 * glow));
            ctx.strokeStyle = A(0.35 * glow);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, 4 + age * 14, 0, TAU);
            ctx.stroke();
          }
        }

        // Loading progress: a thin arc just outside the scope.
        if (shown > 0.002 && u > 0.6) {
          ctx.strokeStyle = A(0.55 * clamp((u - 0.6) * 2));
          ctx.shadowColor = A(1);
          ctx.shadowBlur = 8;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(cx, cy, R + 16, -Math.PI / 2, -Math.PI / 2 + TAU * shown);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // The center.
        glowDot(cx, cy, 10, 0.95 * fade, A(0.6 * fade));
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} className="h-[360px] w-[760px] max-w-[100vw]" aria-hidden />;
}
