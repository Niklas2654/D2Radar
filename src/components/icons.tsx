import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const IconLayers = () => (
  <svg {...base}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export const IconSliders = () => (
  <svg {...base}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
);

export const IconGrid = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </svg>
);

export const IconKeyboard = () => (
  <svg {...base}>
    <rect x="2" y="6" width="20" height="12" rx="3" />
    <path d="M6 10h0M10 10h0M14 10h0M18 10h0M7 14h10" />
  </svg>
);

export const IconLink = () => (
  <svg {...base}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </svg>
);

export const IconRadar = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12 18.5 5.5" />
  </svg>
);

/** Backpack-style inventory icon for DIM. */
export const IconInventory = () => (
  <svg {...base}>
    <path d="M6 8a6 6 0 0 1 12 0v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z" />
    <path d="M9 4.5V3h6v1.5M9 13h6M9 13v3h6v-3" />
  </svg>
);

export const IconUsers = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
  </svg>
);

export const IconCrosshair = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </svg>
);

export const IconPlus = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconEdit = () => (
  <svg {...base}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

/** DIM's logo mark (from its site's pinned-tab icon), in the current color. */
export const IconDim = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.598 8L8 6.403 6.403 8 8 9.597z" />
    <path d="M14.508 6.521l-.119-.118-1.597-1.598-1.597-1.597-1.763-1.763L8 .013 6.403 1.611l1.296 1.296 1.898 1.898 1.598 1.598L12.792 8l-1.597 1.597-1.298 1.299L8 12.792l-1.597-1.597-1.598-1.598-1.474-1.474L3.208 8 5 6.207l1.402-1.402-1.598-1.597-1.597 1.597L1.61 6.403.013 8l1.598 1.597 1.597 1.598 1.597 1.597 1.598 1.597L8 15.987l1.597-1.598 1.598-1.597 1.597-1.597 1.597-1.598L15.987 8 14.646 6.66z" />
  </svg>
);

export const IconChat = () => (
  <svg {...base}>
    <path d="M5 18.5 3.5 21V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2Z" />
    <path d="M8 9.5h8M8 13h5" />
  </svg>
);

export const IconSwap = () => (
  <svg {...base}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </svg>
);

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const IconGlobe = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);

export const IconCheck = () => (
  <svg {...base} width={14} height={14} strokeWidth={2.4}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);

export const IconCrown = () => (
  <svg {...base} width={13} height={13}>
    <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z" />
  </svg>
);

export const IconSearch = () => (
  <svg {...base} width={15} height={15}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconRefresh = () => (
  <svg {...base} width={15} height={15}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" />
  </svg>
);

export const IconHome = () => (
  <svg {...base} width={15} height={15}>
    <path d="m3 11 9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5" />
  </svg>
);

export const IconExternal = () => (
  <svg {...base} width={15} height={15}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconMinus = () => (
  <svg {...base} width={14} height={14}>
    <path d="M5 12h14" />
  </svg>
);

export const IconDownload = () => (
  <svg {...base} width={14} height={14}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);

export const IconClose = () => (
  <svg {...base} width={14} height={14}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconMove = () => (
  <svg {...base} width={14} height={14}>
    <path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />
  </svg>
);

/** Radar logomark (rings, sweep, blip) used in the title bar and HUD.
 *  `animated`: the sweep turns slowly and the blip lights up as it passes
 *  (title bar only: the HUD over the game stays still). Animated in SVG
 *  itself (not a CSS transform), so it is redrawn sharp in every frame
 *  instead of turning a blurry bitmap. */
export const Logo = ({ size = 20, animated = false }: { size?: number; animated?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden shapeRendering="geometricPrecision">
    <defs>
      <linearGradient id="logo-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" />
        <stop offset="1" stopColor="var(--accent)" />
      </linearGradient>
      <linearGradient id="logo-sweep" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="var(--accent)" stopOpacity="0.9" />
        <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M12 12 12 2A10 10 0 0 1 21.5 8.9Z" fill="url(#logo-sweep)">
      {animated && <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="8s" repeatCount="indefinite" />}
    </path>
    <circle cx="12" cy="12" r="10" fill="none" stroke="url(#logo-ring)" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="5.5" fill="none" stroke="url(#logo-ring)" strokeWidth="1.4" opacity="0.55" />
    <circle cx="12" cy="12" r="1.7" fill="#fff" />
    <circle cx="16.6" cy="6.6" r="1.5" fill="var(--accent)">
      {animated && (
        // Lights up as the sweep's leading edge passes (~91% of a turn).
        <animate
          attributeName="opacity"
          values="0.8;0.45;0.45;1;0.8"
          keyTimes="0;0.3;0.905;0.915;1"
          dur="8s"
          repeatCount="indefinite"
        />
      )}
    </circle>
  </svg>
);

export const IconArrowLeft = () => (
  <svg {...base}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);
