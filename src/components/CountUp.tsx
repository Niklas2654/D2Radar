import { useEffect, useRef, useState } from "react";

const DURATION_MS = 650;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A number as text ("1.284", "53.00", "12"), counting up to it when it first
 * shows (and from the old to a new one). Its separators stay where they
 * are; a time ("23:51") or anything without digits shows as is.
 */
export function CountUp({ text }: { text: string }) {
  const target = countable(text);
  const [shown, setShown] = useState(() => (target === null || reduced() ? text : format(text, 0)));
  const from = useRef(0);

  useEffect(() => {
    if (target === null || reduced()) {
      setShown(text);
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      const value = Math.round(begin + (target - begin) * eased);
      from.current = value;
      setShown(k < 1 ? format(text, value) : text);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, target]);

  return <>{shown}</>;
}

/** Its digits as one whole number (separators left out); null: not a plain number. */
function countable(text: string): number | null {
  if (!/^-?[\d.,\s ]*\d$/.test(text) || text.includes(":")) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 12 ? Number(digits) : null;
}

/**
 * `value` laid into the shape of `template`: its digits from the right, the
 * separators where the template has them. A decimal part (not three
 * digits after the last separator) keeps its places ("0.05").
 */
function format(template: string, value: number): string {
  const last = template.match(/[.,](\d+)$/);
  const decimals = last && last[1].length !== 3 ? last[1].length : 0;
  const digits = String(value).padStart(decimals + 1, "0").split("");
  let out = "";
  for (let i = template.length - 1; i >= 0 && digits.length > 0; i--) {
    const c = template[i];
    if (/\d/.test(c)) out = digits.pop()! + out;
    else if (c !== "-") out = c + out;
  }
  // More digits than the template (counting past it): the rest in front.
  out = digits.join("") + out;
  return out.replace(/^[.,\s ]+/, "");
}
