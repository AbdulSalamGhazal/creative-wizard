"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ClearButton } from "@/components/filters/filter-pill";
import { cn } from "@/lib/utils";

/**
 * Mobile/tablet collapse for a filter bar. Below `lg` every bar renders as one
 * row — an optional search box plus this single "Filters · N" pill that opens a
 * Sheet holding all the bar's controls stacked full-width. Everything stays
 * URL-backed exactly as on desktop; the Sheet only relocates the same controls.
 * Build once, reuse on every bar — do not copy per bar.
 */
export function FilterSheet({
  activeCount,
  onClear,
  children,
  title = "Filters",
}: {
  /** Number of active filters — shown as a badge and drives the Clear button. */
  activeCount: number;
  /** Clear-all handler; the in-Sheet Clear button also closes the Sheet. */
  onClear?: () => void;
  /** The bar's controls, rendered stacked and full-width inside the Sheet. */
  children: React.ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            activeCount > 0
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-brand text-[10px] font-medium text-[var(--primary-foreground)] tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,90vw)] p-0 flex flex-col">
        <SheetHeader className="border-b border-line">
          <SheetTitle className="text-left">{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {children}
        </div>
        {onClear && activeCount > 0 && (
          <div className="border-t border-line p-4">
            <ClearButton
              fullWidth
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
