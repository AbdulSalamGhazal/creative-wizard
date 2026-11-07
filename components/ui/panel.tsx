import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The house card frame (R-034): `rounded-lg border border-line` on a surface.
 * A frame used a hundred times deserves a name and ONE place to tune density.
 *
 * - `padding`: `md` = p-4 (every card body, forms included), `sm` = p-3 (a
 *   nested or sunken sub-panel), `none` (the body pads itself — a table, a
 *   list with its own rows). Nothing else: no p-5, no px-4 py-3 for a card
 *   body (px-4 py-3 is a one-line banner, not a card).
 * - `tone`: `surface` (default) or `sunken` (bg-surface-2, nested in a card).
 *
 * `panelClass()` is the same frame for an element that isn't a div (a
 * `<form>`, a `<section>`).
 */
export function panelClass({
  padding = "md",
  tone = "surface",
}: {
  padding?: "none" | "sm" | "md";
  tone?: "surface" | "sunken";
} = {}): string {
  return cn(
    "rounded-lg border border-line",
    tone === "sunken" ? "bg-surface-2" : "bg-surface",
    padding === "md" ? "p-4" : padding === "sm" ? "p-3" : null,
  );
}

export function Panel({
  padding,
  tone,
  className,
  ...props
}: ComponentProps<"div"> & {
  padding?: "none" | "sm" | "md";
  tone?: "surface" | "sunken";
}) {
  return <div className={cn(panelClass({ padding, tone }), className)} {...props} />;
}
