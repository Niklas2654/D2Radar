/**
 * An item's gear tier as in game (and DIM): that many small diamonds down
 * its icon's top-left corner. Nothing for gear without a tier. Put inside a
 * `relative` icon box.
 */
export function TierPips({ tier, size = 40 }: { tier?: number; size?: number }) {
  if (!tier || tier < 1) return null;
  // Scaled to the icon: ~5 px on a 40 px one.
  const pip = Math.max(3.5, Math.round(size * 0.13 * 2) / 2);
  return (
    <span
      className="pointer-events-none absolute top-[6%] left-[6%] z-[1] flex flex-col"
      style={{ gap: pip * 0.35 }}
      aria-label={`Tier ${tier}`}
    >
      {Array.from({ length: Math.min(tier, 5) }, (_, i) => (
        <span
          key={i}
          className="block rotate-45 bg-[#f3e6b0] shadow-[0_0_0_1px_rgb(0_0_0/0.65)]"
          style={{ width: pip, height: pip }}
        />
      ))}
    </span>
  );
}
