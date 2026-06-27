"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A titled section that collapses to just its header. Hidden by default —
 * clicking the header (chevron + title) reveals the children. The body only
 * mounts while open, so a heavy table isn't rendered until asked for.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Small muted note shown next to the title (e.g. a row count). */
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink transition-colors"
      >
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 transition-transform",
            open && "rotate-90",
          )}
        />
        {title}
        {subtitle && (
          <span className="normal-case tracking-normal text-ink-3 num">
            · {subtitle}
          </span>
        )}
      </button>
      {open && children}
    </div>
  );
}
