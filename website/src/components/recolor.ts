/** The app pictures (taken in Void) in an accent colour of the visitor's own
 *  (the app's preset ones have pictures of their own): only the pixels close
 *  to the accent's hue (tabs, highlights, switches) take the new hue, scaled
 *  to its saturation and brightness; other colours stay, also the legendary
 *  purple of item icons just beside it (a hue of about 279). */

/** The colour the pictures were taken in (Void, #b47dff). */
export const RECORDED_ACCENT = "#b47dff";

/** The accent's hue in the pictures, ± this much counts as accent. */
const HUE = 265;
const HUE_RANGE = 9;
/** Void's own saturation (HSV), to scale from. */
const SAT = 0.51;

const cache = new Map<string, Promise<string>>();

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max / 255];
}

function rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** The picture `src` with the accent `to` ("#rrggbb"), as an object URL. */
export function recolor(src: string, to: string): Promise<string> {
  const key = `${src} ${to}`;
  let done = cache.get(key);
  if (done) return done;
  done = new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Half the size: quick (it's redone for each colour), and the pictures
      // beside the front show smaller than that.
      const w = Math.round(img.naturalWidth / 2);
      const h = Math.round(img.naturalHeight / 2);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      if (!g) return resolve(src);
      g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      const d = data.data;
      const [th, ts, tv] = hsv(parseInt(to.slice(1, 3), 16), parseInt(to.slice(3, 5), 16), parseInt(to.slice(5, 7), 16));
      for (let i = 0; i < d.length; i += 4) {
        const [ph, ps, pv] = hsv(d[i], d[i + 1], d[i + 2]);
        if (ps < 0.18 || pv < 0.1 || Math.abs(ph - HUE) > HUE_RANGE) continue;
        const [r, gr, b] = rgb(th, Math.min(1, (ps * ts) / SAT), Math.min(1, pv * tv));
        d[i] = r;
        d[i + 1] = gr;
        d[i + 2] = b;
      }
      g.putImageData(data, 0, 0);
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : src), "image/webp", 0.9);
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
  cache.set(key, done);
  return done;
}
