import { useEffect, useRef } from "react";

/** Seconds the word takes to condense, and to evaporate. */
export const VAPOR_CONDENSE = 1.6;
export const VAPOR_DISSOLVE = 1.5;

/**
 * A word that condenses out of vapor (sweeping in from the left) and, once
 * `dissolveAt` is set (a performance.now() time), drifts away again as
 * vapor. Particles: the accent color as vapor, white as lettering.
 */
export function VaporText({
  text,
  startAt,
  dissolveAt,
  fontSize = 34,
  letterSpacing = 0.55,
}: {
  text: string;
  /** When it starts condensing (performance.now()). */
  startAt: number;
  dissolveAt: number | null;
  fontSize?: number;
  /** In em. */
  letterSpacing?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dissolveRef = useRef(dissolveAt);
  dissolveRef.current = dissolveAt;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const W = 520;
    const H = 150;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // The lettering, drawn once off screen and sampled into particles.
    const font = `700 ${fontSize}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
    const letters = document.createElement("canvas");
    letters.width = W;
    letters.height = H;
    const lc = letters.getContext("2d")!;
    lc.font = font;
    lc.textBaseline = "middle";
    const spacing = letterSpacing * fontSize;
    const chars = [...text];
    const widths = chars.map((c) => lc.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let x = (W - total) / 2;
    const positions = chars.map((_, i) => {
      const at = x;
      x += widths[i] + spacing;
      return at;
    });
    lc.fillStyle = "#fff";
    chars.forEach((c, i) => lc.fillText(c, positions[i], H / 2));
    const data = lc.getImageData(0, 0, W, H).data;
    const left = (W - total) / 2;

    type P = { x: number; y: number; sx: number; sy: number; d: number; seed: number };
    const ps: P[] = [];
    const STEP = 2;
    for (let y = 0; y < H; y += STEP) {
      for (let px = 0; px < W; px += STEP) {
        if (data[(y * W + px) * 4 + 3] < 128) continue;
        const seed = Math.random();
        const along = (px - left) / total;
        ps.push({
          x: px,
          y,
          // Where it drifts in from: behind, above and around.
          sx: px + 40 + seed * 90,
          sy: y - 30 - Math.random() * 60,
          d: along * 0.55 + Math.random() * 0.15,
          seed,
        });
      }
    }

    const probe = document.createElement("canvas").getContext("2d");
    let rgb = [91, 140, 255];
    if (probe) {
      probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#5b8cff";
      const hex = String(probe.fillStyle);
      if (hex.startsWith("#") && hex.length === 7) rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    }
    // From the accent (vapor) to white (lettering).
    const mix = (k: number, a: number) =>
      `rgba(${Math.round(rgb[0] + (255 - rgb[0]) * k)},${Math.round(rgb[1] + (255 - rgb[1]) * k)},${Math.round(rgb[2] + (255 - rgb[2]) * k)},${a})`;
    const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

    let frame = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      const t = (now - startAt) / 1000;
      const gone = dissolveRef.current;
      const td = gone === null ? -1 : (now - gone) / 1000;
      // Fully formed and not leaving: the crisp lettering, glowing.
      const formed = t > VAPOR_CONDENSE + 0.7;
      if (formed && td < 0) {
        ctx.shadowColor = mix(0, 0.8);
        ctx.shadowBlur = 14;
        ctx.drawImage(letters, 0, 0, W, H);
        ctx.shadowBlur = 0;
      } else if (t > 0) {
        ctx.globalCompositeOperation = "lighter";
        for (const p of ps) {
          let px: number;
          let py: number;
          let a: number;
          let k: number; // 0 vapor .. 1 lettering
          if (td < 0) {
            // Condensing, sweeping in from the left.
            const local = (t - p.d * VAPOR_CONDENSE) / (VAPOR_CONDENSE * 0.55);
            const e = ease(local);
            if (local <= 0) continue;
            const curl = Math.sin(p.seed * 12 + t * 3) * 8 * (1 - e);
            px = p.sx + (p.x - p.sx) * e + curl;
            py = p.sy + (p.y - p.sy) * e + Math.cos(p.seed * 9 + t * 2.4) * 6 * (1 - e);
            a = Math.min(1, local * 1.6);
            k = e * e;
          } else {
            // Evaporating, from the left: rising, curling and fading.
            const local = (td - p.d * VAPOR_DISSOLVE * 0.8) / (VAPOR_DISSOLVE * 0.6);
            const e = ease(local);
            if (local <= 0) {
              px = p.x;
              py = p.y;
              a = 1;
              k = 1;
            } else {
              const drift = e * (60 + p.seed * 110);
              px = p.x + drift + Math.sin(p.seed * 14 + td * 4) * 10 * e;
              py = p.y - e * (25 + p.seed * 55) + Math.cos(p.seed * 7 + td * 3) * 8 * e;
              a = 1 - e;
              k = 1 - e;
            }
            if (a <= 0.01) continue;
          }
          ctx.fillStyle = mix(k, a * (0.55 + 0.45 * k));
          const size = 1.3 + (1 - k) * 0.8;
          ctx.fillRect(px, py, size, size);
        }
        ctx.globalCompositeOperation = "source-over";
        // The lettering firming up at the end of condensing.
        if (td < 0 && t > VAPOR_CONDENSE) {
          ctx.globalAlpha = Math.min(1, (t - VAPOR_CONDENSE) / 0.7);
          ctx.shadowColor = mix(0, 0.8);
          ctx.shadowBlur = 14;
          ctx.drawImage(letters, 0, 0, W, H);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [text, startAt, fontSize, letterSpacing]);

  return <canvas ref={ref} className="h-[150px] w-[520px] max-w-[100vw]" aria-label={text} role="img" />;
}
