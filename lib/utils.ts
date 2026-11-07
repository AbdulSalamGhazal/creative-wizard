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
