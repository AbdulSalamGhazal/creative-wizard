import { cn } from "@/lib/utils";

/**
 * WIZARD brand logomark — a lightbulb whose filament is a rising bar chart +
 * breakout growth arrow, with sparkles. Single-ink (`text-ink` → near-black in
 * light themes, near-white in dark) to match the wordmark; everything paints
 * with `currentColor`. Self-contained SVG so it stays crisp at every size (top
 * bar, sign-in, favicon).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("text-ink", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Bulb glass — a near-full circle left open at the bottom for the base */}
      <path
        d="M24 43 A21 21 0 1 1 36 43"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Screw base */}
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M25 49 H35" />
        <path d="M26.5 53.5 H33.5" />
      </g>
      <path
        d="M28.5 58 q3.5 3 7 0"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Rising bar chart */}
      <rect x="19.5" y="31" width="5" height="10" rx="2" fill="currentColor" />
      <rect x="26.5" y="27" width="5" height="14" rx="2" fill="currentColor" />
      <rect x="33.5" y="23" width="5" height="18" rx="2" fill="currentColor" />

      {/* Breakout growth arrow */}
      <path
        d="M15 38 L23 31 L29 35 L45 13"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M37 12.5 L46.5 11 L45 20.5"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sparkles */}
      <path
        d="M50 7 l1.5 3.2 3.2 1.5 -3.2 1.5 -1.5 3.2 -1.5 -3.2 -3.2 -1.5 3.2 -1.5z"
        fill="currentColor"
      />
      <rect
        x="53.5"
        y="20"
        width="3.4"
        height="3.4"
        rx="0.8"
        transform="rotate(20 55.2 21.7)"
        fill="currentColor"
      />
      <rect
        x="44.5"
        y="3.5"
        width="2.8"
        height="2.8"
        rx="0.7"
        transform="rotate(18 45.9 4.9)"
        fill="currentColor"
      />
    </svg>
  );
}
