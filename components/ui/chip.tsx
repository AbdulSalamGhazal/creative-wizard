import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The house TAG (UI audit R-005, 2026-11): one small labelled square chip —
 * a stage, a rate, a status, an error code, "You", "Excluded". Before it the
 * same idea was drawn in six shapes (4/6px or pill corners, 16/20px or auto
 * height, 9–11px text). `Badge` (the pill) is kept only for SENTENCE-length
 * header chips that wrap.
 *
 * - `size`: `md` (h-5, 11px) everywhere; `sm` (h-4, 10px) only where the chip
 *   rides a KPI tile header (DeltaBadge).
 * - `tone`: a tinted tone, or `solid` — the caller supplies a status fill and
 *   its on-fill ink (`bg-pos text-on-fill-strong`, see RATING_META), so text
 *   on a fill follows the fill's lightness in every theme (R-006).
 *
 * Casing is the content's own: chips render sentence case ("Active"), an
 * error code is already upper case. Never add `uppercase` here.
 */
const chipVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-sm border font-medium leading-none whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0",
  {
    variants: {
      size: {
        sm: "h-4 px-1 text-[10px] [&>svg]:size-2.5",
        md: "h-5 px-1.5 text-[11px] [&>svg]:size-3",
      },
      tone: {
        neutral: "border-line bg-surface-2 text-ink-2",
        outline: "border-line text-ink-2",
        brand: "border-brand/40 bg-brand-soft text-brand",
        pos: "border-pos/40 bg-pos/10 text-pos",
        neg: "border-neg/40 bg-neg/10 text-neg",
        warn: "border-warn/40 bg-warn/10 text-warn",
        solid: "border-transparent font-semibold",
      },
    },
    defaultVariants: { size: "md", tone: "neutral" },
  },
);

export type ChipTone = NonNullable<VariantProps<typeof chipVariants>["tone"]>;

function Chip({
  className,
  size,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof chipVariants>) {
  return <span data-slot="chip" className={cn(chipVariants({ size, tone }), className)} {...props} />;
}

export { Chip, chipVariants };
