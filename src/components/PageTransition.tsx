import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./glass";

/** "enter": animating in, "active": settled, "exit": animating out. */
export type Phase = "enter" | "active" | "exit";
export type Direction = "forward" | "back";

interface Layer<K> {
  key: K;
  phase: Phase;
  dir: Direction;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Pushes between pages: the new page slides in from the side that matches
 * its position in `order` and pushes the old one out the other side.
 */
export function PageTransition<K extends string>({
  page,
  order,
  render,
}: {
  page: K;
  order: readonly K[];
  render: (key: K, phase: Phase, dir: Direction) => ReactNode;
}) {
  const [layers, setLayers] = useState<Layer<K>[]>([{ key: page, phase: "active", dir: "forward" }]);
  const previous = useRef(page);

  useEffect(() => {
    if (previous.current === page) return;
    const dir: Direction = order.indexOf(page) > order.indexOf(previous.current) ? "forward" : "back";
    previous.current = page;
    if (reducedMotion()) {
      setLayers([{ key: page, phase: "active", dir }]);
      return;
    }
    // Keep at most one outgoing page; anything already leaving is dropped.
    setLayers((current) => [
      ...current
        .filter((l) => l.key !== page && l.phase !== "exit")
        .map((l) => ({ ...l, phase: "exit" as const, dir })),
      { key: page, phase: "enter", dir },
    ]);
  }, [page, order]);

  const settle = (layer: Layer<K>) =>
    setLayers((current) =>
      layer.phase === "exit"
        ? current.filter((l) => l !== layer)
        : current.map((l) => (l === layer ? { ...l, phase: "active" } : l)),
    );

  // overflow-clip, not -hidden: a hidden box can still be scrolled, and
  // focusing an input on a page that is sliding in (autoFocus) would scroll it.
  return (
    <div className="relative min-h-0 flex-1 overflow-clip">
      {layers.map((layer) => (
        <div
          key={layer.key}
          className={cx(
            "absolute inset-0",
            layer.phase === "enter" && `page-enter-${layer.dir}`,
            layer.phase === "exit" && `page-exit-${layer.dir} pointer-events-none`,
          )}
          onAnimationEnd={(e) => {
            // Ignore animations bubbling up from inside the page.
            if (e.target === e.currentTarget) settle(layer);
          }}
        >
          {render(layer.key, layer.phase, layer.dir)}
        </div>
      ))}
    </div>
  );
}
