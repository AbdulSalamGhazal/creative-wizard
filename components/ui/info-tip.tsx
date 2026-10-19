"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The ⓘ beside a label: a helper sentence that genuinely matters, kept out of
 * the body copy ("Show, don't label" — docs/decisions/ux-standards.md). The
 * house popover + title pattern rather than a hover-only tooltip: hover reads
 * the native title, click / Enter / Space opens the popover (so a phone, which
 * has no hover, still reaches it), Escape closes it. `label` is what a screen
 * reader hears on the button; `children` is the sentence itself.
 */
export function InfoTip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const text = typeof children === "string" ? children : undefined;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label}
        title={text}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 data-[state=open]:text-ink",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 px-3 py-2 text-xs leading-relaxed text-ink-2"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
