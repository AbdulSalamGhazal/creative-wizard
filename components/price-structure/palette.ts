import type { Status } from "@/price-structure/engine/types";

/**
 * The module's colours and status chips — constants over the house CSS
 * variables, never new ones. A product's colour comes from its `colorSlot`
 * (0–7) through the house 8-colour categorical palette; the four parts of a
 * riyal keep ONE colour each across every chart and table (brief §8.2).
 */
export type Part = "cml" | "cogs" | "marketing" | "undelivered";

export const PARTS: readonly Part[] = ["cml", "cogs", "marketing", "undelivered"];

export const PART_LABEL: Record<Part, string> = {
  cml: "CML",
  cogs: "COGS",
  marketing: "Marketing",
  undelivered: "Undelivered",
};

export const PART_COLOR: Record<Part, string> = {
  cml: "var(--series-1)",
  cogs: "var(--series-3)",
  marketing: "var(--series-2)",
  undelivered: "var(--ink-3)",
};

export function productColor(slot: number): string {
  return `var(--product-${(((slot % 8) + 8) % 8) + 1})`;
}

export const PRODUCT_SLOTS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];

/** Status chips: green ✓ Hits B · amber ◐ Hits A · red ✕ Misses A. */
export const STATUS_META: Record<
  Status,
  { label: string; short: string; icon: string; chip: string; text: string }
> = {
  b: { label: "Hits B", short: "B", icon: "✓", chip: "bg-pos text-[#101014]", text: "text-pos" },
  a: { label: "Hits A", short: "A", icon: "◐", chip: "bg-warn text-[#101014]", text: "text-warn" },
  miss: { label: "Misses A", short: "Miss", icon: "✕", chip: "bg-neg text-white", text: "text-neg" },
};

export const STATUS_ORDER: readonly Status[] = ["b", "a", "miss"];

/** The marks on the ROAS ladder. */
export const LADDER_COLOR = {
  targetA: "var(--warn)",
  targetB: "var(--pos)",
  baked: "var(--brand)",
  planMix: "var(--series-5)",
  actual: "var(--ink)",
  meta: "var(--series-6)",
} as const;
