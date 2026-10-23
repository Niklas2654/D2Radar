const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  "aria-hidden": true,
};

export const Logo = ({ size = 22 }: { size?: number }) => (
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
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="8s" repeatCount="indefinite" />
    </path>
    <circle cx="12" cy="12" r="10" fill="none" stroke="url(#logo-ring)" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="5.5" fill="none" stroke="url(#logo-ring)" strokeWidth="1.4" opacity="0.55" />
    <circle cx="12" cy="12" r="1.7" fill="#fff" />
    <circle cx="16.6" cy="6.6" r="1.5" fill="var(--accent)">
      <animate attributeName="opacity" values="0.8;0.45;0.45;1;0.8" keyTimes="0;0.3;0.905;0.915;1" dur="8s" repeatCount="indefinite" />
    </circle>
  </svg>
);

export const IconDownload = () => (
  <svg {...base}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const IconWindows = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden fill="currentColor">
    <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
  </svg>
);
export const IconOverlay = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="14" rx="2.5" />
    <rect x="13" y="7" width="5" height="4" rx="1" />
    <path d="M8 21h8" />
  </svg>
);
export const IconCrosshair = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);
export const IconUsers = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </svg>
);
export const IconSwap = () => (
  <svg {...base}>
    <path d="M4 8h14l-4-4M20 16H6l4 4" />
  </svg>
);
export const IconChart = () => (
  <svg {...base}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const IconChat = () => (
  <svg {...base}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);
export const IconBolt = () => (
  <svg {...base}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
);
export const IconShield = () => (
  <svg {...base}>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const IconCheck = () => (
  <svg {...base} strokeWidth={2.6}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);
export const IconChevron = () => (
  <svg {...base}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const IconArrow = () => (
  <svg {...base}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
