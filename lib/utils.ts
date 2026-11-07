import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's own scale, so it read the house
 * micro-label utilities (`text-label`, `text-eyebrow`, globals.css) as text
 * COLOURS and dropped them beside `text-ink-3` — `cn("text-label text-ink-3")`
 * rendered plain body-size text. They are sizes (UI audit R-051, 2026-11).
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["label", "eyebrow"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * THE recipe for an affordance that appears on hover (R-002, 2026-11-07; the
 * comment row's, written once): visible on hover of its `group`, while
 * anything in that group has keyboard focus, when it is itself focused, and
 * ALWAYS where there is no hover (a phone or tablet) — ux-standards
 * "Discoverability". Put it on the control (or its wrapper) inside a `group`.
 */
export const REVEAL_ON_HOVER =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";
