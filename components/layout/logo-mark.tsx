/**
 * WIZARD brand logomark — a colorful lightbulb whose filament is a rising
 * bar chart + breakout growth arrow, with sparkles. Rendered as a self-
 * contained gradient SVG so it stays crisp at every size (top bar, sign-in,
 * favicon). The favicon (app/icon.svg) carries the same artwork.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient
          id="wz-bulb"
          x1="10"
          y1="6"
          x2="54"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="0.22" stopColor="#06b6d4" />
          <stop offset="0.44" stopColor="#22c55e" />
          <stop offset="0.62" stopColor="#eab308" />
          <stop offset="0.8" stopColor="#f97316" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
        <linearGradient
          id="wz-arrow"
          x1="14"
          y1="40"
          x2="48"
          y2="10"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="0.55" stopColor="#f97316" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>

      {/* Bulb glass — a near-full circle left open at the bottom for the base */}
      <path
        d="M24 43 A21 21 0 1 1 36 43"
        stroke="url(#wz-bulb)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Screw base */}
      <g stroke="url(#wz-bulb)" strokeWidth="3" strokeLinecap="round">
        <path d="M25 49 H35" />
        <path d="M26.5 53.5 H33.5" />
      </g>
      <path
        d="M28.5 58 q3.5 3 7 0"
        stroke="url(#wz-bulb)"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Rising bar chart */}
      <rect x="19.5" y="31" width="5" height="10" rx="2" fill="#22c55e" />
      <rect x="26.5" y="27" width="5" height="14" rx="2" fill="#06b6d4" />
      <rect x="33.5" y="23" width="5" height="18" rx="2" fill="#f59e0b" />

      {/* Breakout growth arrow */}
      <path
        d="M15 38 L23 31 L29 35 L45 13"
        stroke="url(#wz-arrow)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M37 12.5 L46.5 11 L45 20.5"
        stroke="url(#wz-arrow)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sparkles */}
      <path
        d="M50 7 l1.5 3.2 3.2 1.5 -3.2 1.5 -1.5 3.2 -1.5 -3.2 -3.2 -1.5 3.2 -1.5z"
        fill="#fcc419"
      />
      <rect
        x="53.5"
        y="20"
        width="3.4"
        height="3.4"
        rx="0.8"
        transform="rotate(20 55.2 21.7)"
        fill="#ec4899"
      />
      <rect
        x="44.5"
        y="3.5"
        width="2.8"
        height="2.8"
        rx="0.7"
        transform="rotate(18 45.9 4.9)"
        fill="#3b82f6"
      />
    </svg>
  );
}
