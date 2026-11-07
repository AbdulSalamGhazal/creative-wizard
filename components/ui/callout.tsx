import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The inline notice (UI audit R-106, 2026-11): a form's failure banner, an
 * upload warning, a "this will switch the month to daily" note. Before it the
 * same idea had seven neg and six warn recipes (rounded / md / lg, /30 or /40
 * borders, /5 or /10 fills, p-3 to p-5). ONE shape: rounded-md, tone/30
 * border, tone/5 fill, px-3 py-2, text-xs (`md` = text-sm, for a flow's
 * blocking error). The text stays `text-ink`; the tone is the frame.
 */
const calloutVariants = cva("rounded-md border px-3 py-2 text-ink", {
  variants: {
    tone: {
      neg: "border-neg/30 bg-neg/5",
      warn: "border-warn/30 bg-warn/5",
      info: "border-line bg-surface-2/60",
    },
    size: { sm: "text-xs", md: "text-sm" },
  },
  defaultVariants: { tone: "neg", size: "sm" },
});

function Callout({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  return <div data-slot="callout" className={cn(calloutVariants({ tone, size }), className)} {...props} />;
}

/**
 * A destructive action's own panel at the foot of an entity page (delete this
 * creative / campaign): the callout's neg tokens on a card's shape.
 */
function DangerZone({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="danger-zone"
      className={cn("rounded-lg border border-neg/30 bg-neg/5 p-4 md:p-5", className)}
      {...props}
    />
  );
}

export { Callout, DangerZone, calloutVariants };
