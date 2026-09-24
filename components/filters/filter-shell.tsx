"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { cn } from "@/lib/utils";
import {
  activeFilterCount,
  filterChips,
  clearFilters,
  isFilterActive,
  toggleValue,
  type FilterDef,
} from "@/components/filters/filter-model";

/**
 * THE filter surface. One primitive owns the whole thing — bar, panel, sheet
 * and chips — the way `DataTable` owns a table: a page declares WHAT it
 * filters by and the shell decides how every part of it looks, so no two pages
 * can drift again. Hand-rolled filter bars are deprecated.
 *
 * THREE TIERS:
 *  1. the page's 2–4 always-visible controls (`tier1`), in the sticky bar;
 *  2. everything else — a declarative `FilterDef[]` that the shell renders as
 *     an anchored panel from `lg` up and as the existing mobile Sheet below it,
 *     from the SAME row renderer, plus the count badge;
 *  3. the chips row, which appears under the bar only while tier-2 filters are
 *     on, with one "Clear filters".
 *
 * The shell owns NO filter state — only whether the panel is open. Values come
 * in on the defs and go back out through their `onChange`, which the page maps
 * to its URL params through `useNavTransition` exactly as before.
 *
 * `toolbar` is for TABLE controls (Columns, CSV) and the Excluded toggle — a
 * data-scope switch that stays visible house-wide and is deliberately NOT a
 * filter, so Clear never touches it.
 */
export function FilterShell({
  filters,
  tier1,
  toolbar,
  mobileLead,
  notes,
  panelTitle = "Filters",
}: {
  filters: readonly FilterDef[];
  /** Tier 1, rendered inline on desktop and stacked in the sheet on mobile. */
  tier1?: (ctx: { fullWidth: boolean }) => React.ReactNode;
  /** The right-hand cluster: table controls + the Excluded toggle. */
  toolbar?: (ctx: { fullWidth: boolean }) => React.ReactNode;
  /** Stays inline on the mobile row (the search box) — never in the sheet. */
  mobileLead?: React.ReactNode;
  /** A full-width muted line under the controls — e.g. why a metric is locked. */
  notes?: React.ReactNode;
  panelTitle?: string;
}) {
  const count = activeFilterCount(filters);
  const chips = filterChips(filters);
  const clear = () => clearFilters(filters);

  /**
   * ZERO-DEF PAGES: a page whose tier 2 is empty (Store orders, Pacing,
   * Reconciliation) gets the SAME bar with no Filters button and no chips row
   * — consistency without a dead control. With nothing to collapse, tier 1
   * simply wraps at every width instead of folding into the sheet.
   */
  if (filters.length === 0) {
    return (
      <div className="sticky top-14 z-10 -mx-6 space-y-2 border-b border-line bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          {/* Fills the row on a phone, capped on a wide screen so it doesn't
              stretch to the full page width. */}
          {mobileLead && <div className="min-w-0 flex-1 lg:max-w-xs">{mobileLead}</div>}
          {tier1?.({ fullWidth: false })}
          {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar({ fullWidth: false })}</div>}
        </div>
        {notes}
      </div>
    );
  }

  return (
    <div className="sticky top-14 z-10 -mx-6 space-y-2 border-b border-line bg-background/95 px-6 py-3 backdrop-blur">
      {/* Desktop: tier 1 + the Filters button, table controls right */}
      <div className="hidden flex-wrap items-center gap-2 lg:flex">
        {tier1?.({ fullWidth: false })}
        <FilterPanel filters={filters} count={count} title={panelTitle} onClear={clear} />
        {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar({ fullWidth: false })}</div>}
      </div>

      {/* Mobile / tablet: the lead control stays inline, everything else folds
          into the Sheet — fed by the SAME defs, so the two can't diverge. */}
      <div className="flex items-center gap-2 lg:hidden">
        {mobileLead && <div className="min-w-0 flex-1">{mobileLead}</div>}
        <FilterSheet activeCount={count} onClear={clear} title={panelTitle}>
          {tier1?.({ fullWidth: true })}
          {filters.map((def) => (
            <FilterRow key={def.key} def={def} fullWidth />
          ))}
          {toolbar?.({ fullWidth: true })}
        </FilterSheet>
      </div>

      {notes}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-6 max-w-[16rem] items-center gap-1 rounded-md border border-brand/40 bg-[var(--brand-soft)] pl-2 pr-1 text-[11px] text-ink"
            >
              <span className="truncate" title={chip.label}>
                {chip.label}
              </span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
                className="shrink-0 rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

/** The Filters button + its anchored panel (lg and up). */
function FilterPanel({
  filters,
  count,
  title,
  onClear,
}: {
  filters: readonly FilterDef[];
  count: number;
  title: string;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `${title}, ${count} active` : title}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs transition-colors",
            count > 0
              ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
              : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>{title}</span>
          {count > 0 && (
            <span className="inline-flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-medium tabular-nums text-[var(--primary-foreground)]">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* Wide and anchored, never taller than the viewport. Apply-on-change,
          like every dropdown in the app — there is no Apply button. */}
      <PopoverContent
        align="start"
        className="w-[min(46rem,92vw)] max-h-[min(34rem,calc(100dvh-8rem))] overflow-y-auto p-0"
      >
        <div className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {filters.map((def) => (
            <FilterRow key={def.key} def={def} />
          ))}
        </div>
        <div className="sticky bottom-0 flex items-center justify-between border-t border-line bg-surface px-4 py-2">
          <span className="text-[11px] text-ink-3">
            {count === 0 ? "No filters applied" : `${count} filter${count === 1 ? "" : "s"} applied`}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={count === 0}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <X className="h-3 w-3" />
            Clear filters
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * ONE renderer for a def, used by the panel AND the sheet — which is what
 * stops the mobile presentation from becoming a separate hand-fed thing.
 */
function FilterRow({ def, fullWidth = false }: { def: FilterDef; fullWidth?: boolean }) {
  if (def.type === "custom") {
    return (
      <div className={cn("min-w-0 space-y-1.5", fullWidth && "w-full")}>
        <FilterRowLabel def={def} />
        {def.render({ fullWidth })}
      </div>
    );
  }

  const values = def.type === "multi" ? def.values : def.value === null ? [] : [def.value];
  const toggle = (value: string) => {
    if (def.type === "multi") def.onChange(toggleValue(def.values, value));
    else def.onChange(def.value === value ? null : value);
  };

  return (
    <div className={cn("min-w-0 space-y-1.5", fullWidth && "w-full")}>
      <FilterRowLabel def={def} />
      {def.type === "multi" && def.header}
      {def.options.length === 0 ? (
        <p className="text-[11px] text-ink-3">
          {(def.type === "multi" ? def.emptyHint : undefined) ?? "Nothing to choose yet"}
        </p>
      ) : (
        <div className="max-h-44 space-y-0.5 overflow-y-auto pr-1">
          {def.options.map((o) => {
            const checked = values.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors",
                  o.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface-2",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={o.disabled}
                  onCheckedChange={() => toggle(o.value)}
                  className="h-3.5 w-3.5"
                />
                {o.dot && (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: o.dot }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-ink-2">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[10px] text-ink-3">{o.hint}</span>}
              </label>
            );
          })}
        </div>
      )}
      {def.type === "multi" && def.note && (
        <p className="text-[10px] text-ink-3">{def.note}</p>
      )}
    </div>
  );
}

function FilterRowLabel({ def }: { def: FilterDef }) {
  const active = isFilterActive(def);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-label text-ink-3">{def.label}</span>
      {active && (
        <button
          type="button"
          onClick={() => {
            if (def.type === "multi") def.onChange([]);
            else if (def.type === "single") def.onChange(null);
            else def.onClear();
          }}
          className="text-[10px] text-ink-3 transition-colors hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
