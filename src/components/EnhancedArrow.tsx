import { cx } from "./glass";

/**
 * Destiny's enhanced-perk mark: a gold arrow pointing up (with a stem).
 * `dim`: the perk can be enhanced but isn't (yet).
 */
export function EnhancedArrow({ size = 10, dim = false, className }: { size?: number; dim?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 10 12"
      width={size}
      height={size * 1.2}
      aria-label="Enhanced"
      className={cx(
        "shrink-0",
        dim ? "opacity-40" : "drop-shadow-[0_0_2px_rgb(232_197_71/0.9)]",
        className,
      )}
    >
      <defs>
        <linearGradient id="enhanced-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset="0.55" stopColor="#f0c94a" />
          <stop offset="1" stopColor="#c9921f" />
        </linearGradient>
      </defs>
      <path d="M5 0.6 9.4 5.6H6.6V11.4H3.4V5.6H0.6Z" fill="url(#enhanced-gold)" stroke="rgb(0 0 0 / 0.55)" strokeWidth="0.7" strokeLinejoin="round" />
    </svg>
  );
}
