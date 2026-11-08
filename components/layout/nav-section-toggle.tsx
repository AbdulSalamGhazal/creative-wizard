"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A nav section's header — the accordion's toggle (2026-11-08). ONE component
 * for the desktop Sidebar and the mobile Sheet so the two never wear two looks.
 *
 * When the section holding the current page is folded, the 2px brand mark
 * that says "you are here" on an item moves to the header, so the page is
 * never lost behind a closed section.
 */
export function NavSectionToggle({
  icon: Icon,
  label,
  open,
  current,
  controls,
  onToggle,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  open: boolean;
  /** The current page lives in this section. */
  current: boolean;
  /** The id of the item list this header shows and hides. */
  controls: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        // Design A (2026-11-08): the section's icon + its name at item size,
        // medium weight, full ink — a heading, not a kicker.
        "relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink transition-colors",
        "hover:bg-surface-2",
        className,
      )}
    >
      {current && !open && (
        <span
          className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-sm bg-brand"
          aria-hidden
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {current && !open && <span className="sr-only">(current page)</span>}
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150",
          open && "rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}
