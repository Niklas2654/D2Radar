import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck } from "./icons";

/**
 * A label that turns into "✓ Copied" (and back). The current text always
 * sets the width itself; only the change is animated: the box eases from
 * the old width to the new one while the old text drifts up out of a blur
 * and the new one settles in with a glow in the accent color.
 */
export function CopySwap({ copied, label, done }: { copied: boolean; label: ReactNode; done: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  const width = useRef(0);
  // The state it just left (shown on its way out), set on each change.
  const [shown, setShown] = useState(copied);
  const [leaving, setLeaving] = useState<{ copied: boolean; n: number } | null>(null);
  if (shown !== copied) {
    setShown(copied);
    setLeaving({ copied: shown, n: (leaving?.n ?? 0) + 1 });
  }
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(null), 450);
    return () => window.clearTimeout(id);
  }, [leaving]);

  // Width: from the old text's to the new one's, then back to automatic.
  const changes = leaving?.n ?? 0;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.width = "";
    const to = el.offsetWidth;
    const from = width.current;
    width.current = to;
    if (!changes || !from || from === to) return;
    el.style.width = `${from}px`;
    void el.offsetWidth;
    el.style.width = `${to}px`;
    const settle = (e: TransitionEvent) => {
      if (e.propertyName === "width") el.style.width = "";
    };
    el.addEventListener("transitionend", settle, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes]);
  // Text changes without a copy (e.g. the name loading): just remember it.
  useLayoutEffect(() => {
    if (box.current && !box.current.style.width) width.current = box.current.offsetWidth;
  });

  const content = (isCopied: boolean) =>
    isCopied ? (
      <span className="inline-flex items-center gap-1">
        <span className="grid size-3.5 place-items-center rounded-full bg-(--accent-text) text-black shadow-[0_0_5px_var(--accent)] [&_svg]:size-2.5">
          <IconCheck />
        </span>
        {done}
      </span>
    ) : (
      label
    );

  return (
    <span
      ref={box}
      className="relative inline-flex justify-center overflow-x-clip whitespace-nowrap transition-[width] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
    >
      <span key={`now-${changes}`} className={changes ? "copy-in" : undefined}>
        {content(copied)}
      </span>
      {leaving && (
        <span
          key={`out-${leaving.n}`}
          aria-hidden
          className="copy-out pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        >
          {content(leaving.copied)}
        </span>
      )}
    </span>
  );
}
