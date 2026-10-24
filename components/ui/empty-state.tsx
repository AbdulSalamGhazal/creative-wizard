"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFilterScope } from "@/lib/filter-scope";
import { useNavTransition } from "@/lib/nav-progress";
import { LIFETIME_FLOOR, todayIso } from "@/lib/date-presets";
import { cn } from "@/lib/utils";

/**
 * THE empty state (D24, 2026-10). Twenty-odd surfaces hand-rolled the same
 * dashed box, and most said only what was missing: "No performance in this
 * window." — a dead end (ux-standards "No dead ends"). Now one primitive, and
 * ONE HINT PER KIND, each with the button that does it:
 *  · `filtered` — an analytics view under a date range and filters:
 *    "Try a wider date range or clear filters." + Show lifetime / Clear filters
 *  · `range`    — a view with a range but no filter bar.
 *  · `filters`  — a listing with filters but no range (the Library).
 * A first-use state ("No uploads yet.") passes its own `hint` and `action`.
 * Each button renders only when it would change something. A chart sitting
 * beside an empty table passes `buttons={false}`: the hint stays, the buttons
 * live once, on the table's empty state — not three times down one page.
 */
export const EMPTY_HINTS = {
  filtered: "Try a wider date range or clear filters.",
  range: "Try a wider date range.",
  filters: "Try clearing filters.",
} as const;
export type EmptyKind = keyof typeof EMPTY_HINTS;

const PAD = { sm: "py-8", md: "py-12", lg: "py-16" } as const;

export function EmptyState({
  title,
  kind,
  hint,
  action,
  icon,
  size = "md",
  buttons = true,
  className,
}: {
  /** What is missing, in one line. */
  title: ReactNode;
  /** The standard hint + its buttons. */
  kind?: EmptyKind;
  /** A first-use hint (when there is no standard kind). */
  hint?: ReactNode;
  /** A first-use action (a Link button, an "Add" dialog trigger). */
  action?: ReactNode;
  icon?: ReactNode;
  size?: keyof typeof PAD;
  /** Render the kind's buttons (default). Off for a secondary surface. */
  buttons?: boolean;
  /** Extra classes — a chart frame passes its height + centring. */
  className?: string;
}) {
  const shownHint = kind ? EMPTY_HINTS[kind] : hint;
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-line bg-surface px-6 text-center",
        PAD[size],
        className,
      )}
    >
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-2">
          {icon}
        </div>
      )}
      <p className="text-sm text-ink-2">{title}</p>
      {shownHint && (
        <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">{shownHint}</div>
      )}
      {((kind && buttons) || action) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 empty:hidden">
          {buttons && (kind === "filtered" || kind === "range") && <WidenRangeAction />}
          {buttons && (kind === "filtered" || kind === "filters") && <ClearFiltersAction />}
          {action}
        </div>
      )}
    </div>
  );
}

/** "Show lifetime": the page's range widened to everything, in the URL. A
 *  one-off look — it doesn't change the saved default range. */
function WidenRangeAction() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startNav] = useNavTransition();
  const to = todayIso();
  if (params.get("from") === LIFETIME_FLOOR && params.get("to") === to) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        const next = new URLSearchParams(params.toString());
        next.set("from", LIFETIME_FLOOR);
        next.set("to", to);
        startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
      }}
    >
      Show lifetime
    </Button>
  );
}

/** "Clear filters": the page bar's own Clear (tier-2 only), via the scope it
 *  registered. Nothing on → no button. */
function ClearFiltersAction() {
  const scope = useFilterScope();
  if (!scope?.active) return null;
  return (
    <Button type="button" size="sm" variant="outline" onClick={scope.clear}>
      Clear filters
    </Button>
  );
}
