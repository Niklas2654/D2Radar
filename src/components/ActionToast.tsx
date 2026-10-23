import { useEffect, useState } from "react";
import { cx } from "./glass";

/** How an action goes: running (a spinner), then done or failed. */
export type ActionState = { kind: "busy" | "ok" | "error"; text: string } | null;

/**
 * An action's progress at the bottom middle of the page (pulling a piece
 * from the vault, putting a mod in): while it runs, then its outcome for a
 * moment (an error a little longer).
 */
export function ActionToast({ state }: { state: ActionState }) {
  const [shown, setShown] = useState(state);
  useEffect(() => {
    setShown(state);
    if (!state || state.kind === "busy") return;
    const id = window.setTimeout(() => setShown(null), state.kind === "ok" ? 2500 : 6000);
    return () => window.clearTimeout(id);
  }, [state]);
  if (!shown) return null;
  return (
    <div className="animate-fade-in pointer-events-none fixed bottom-[6vh] left-1/2 z-[150] -translate-x-1/2">
      <div
        className={cx(
          "flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-[13px] font-medium whitespace-nowrap shadow-[0_18px_40px_-12px_rgb(0_0_0/0.9)]",
          shown.kind === "busy"
            ? "border-white/10 bg-[#0b0d14]/95 text-white"
            : shown.kind === "ok"
              ? "border-[#7fd49a]/40 bg-[#0d1a13]/95 text-[#b6ecc6]"
              : "border-[#e2626b]/45 bg-[#1a0d0f]/95 text-[#f5a3a8]",
        )}
      >
        {shown.kind === "busy" ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        ) : (
          <span aria-hidden>{shown.kind === "ok" ? "✓" : "!"}</span>
        )}
        {shown.text}
      </div>
    </div>
  );
}
