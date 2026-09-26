"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { setPersistedKeys } from "@/lib/filter-prefs";
import {
  activeFilterCount,
  clearFilters,
  filterChips,
  filterDepth,
  filterSummary,
  isFilterActive,
  needsOptionSearch,
  persistedFilterKeys,
  toggleValue,
  type FilterDef,
  type FilterOption,
} from "@/components/filters/filter-model";

/**
 * THE filter surface. One primitive owns the whole thing — bar, dialog and
 * chips — the way `DataTable` owns a table: a page declares WHAT it filters by
 * and the shell decides how every part of it looks, so no two pages can drift
 * again. NEVER hand-roll a filter bar.
 *
 * THREE TIERS:
 *  1. the page's 2–4 always-visible controls (`tier1`), in the sticky bar;
 *  2. everything else — a declarative `FilterDef[]`, opened as a MASTER-DETAIL
 *     DIALOG (below), plus the count badge;
 *  3. the chips row, which appears under the bar only while tier-2 filters are
 *     on, with one "Clear filters".
 *
 * PRESENTATION (2026-09, replacing the F1/F2 popover panel + mobile Sheet):
 * the Filters button opens ONE centered Dialog — full-screen on a phone — that
 * lists the filters as settings-style rows (label · current selection ·
 * chevron). Opening a row goes one of two ways, decided automatically by
 * `filterDepth`: a SHORT option list drops a compact droplist anchored to the
 * row, and a long list or a custom def DRILLS the dialog to level 2 (a
 * check-list with a search box past `SEARCH_MIN_OPTIONS`, or the def's own
 * component). Selections apply IMMEDIATELY — "Done" only closes.
 *
 * The shell owns NO filter state — only what is open. Values come in on the
 * defs and go back out through their `onChange`, which the page maps to its
 * URL params through `useFilterParams` exactly as before.
 *
 * `toolbar` is for TABLE controls (Columns, CSV) and the Excluded toggle — a
 * data-scope switch that stays visible house-wide and is deliberately NOT a
 * filter, so Clear never touches it.
 */
export function FilterShell({
  filters,
  tier1,
  toolbar,
  notes,
  panelTitle = "Filters",
}: {
  filters: readonly FilterDef[];
  /**
   * Tier 1, rendered inline in the bar at every width (it wraps on a phone).
   * `fullWidth` is kept for the controls that take it and is always false now
   * that there is no stacked sheet.
   */
  tier1?: (ctx: { fullWidth: boolean }) => React.ReactNode;
  /** The right-hand cluster: table controls + the Excluded toggle. */
  toolbar?: (ctx: { fullWidth: boolean }) => React.ReactNode;
  /** A full-width muted line under the controls — e.g. why a metric is locked. */
  notes?: React.ReactNode;
  panelTitle?: string;
}) {
  const count = activeFilterCount(filters);
  const chips = filterChips(filters);
  const clear = () => clearFilters(filters);

  // Which of THIS page's params are remembered: every standard def (a custom
  // def, or one a page opts out of, is excluded) plus `platforms` — the tier-1
  // control every page shares, and the reason a zero-def page like Pacing
  // remembers anything at all. Declared with the filters, obeyed by the one
  // writer. See lib/filter-prefs.
  setPersistedKeys(["platforms", ...persistedFilterKeys(filters)]);

  return (
    <div className="sticky top-14 z-10 -mx-6 space-y-2 border-b border-line bg-background/95 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        {tier1?.({ fullWidth: false })}
        {/* ZERO-DEF PAGES (Store orders, Pacing, Reconciliation): the same bar
            with no Filters button and no chips row — consistency without a
            dead control. */}
        {filters.length > 0 && (
          <FilterDialog filters={filters} count={count} title={panelTitle} onClear={clear} />
        )}
        {toolbar && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar({ fullWidth: false })}
          </div>
        )}
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

/** The Filters button and its master-detail dialog. */
function FilterDialog({
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
  /** null = level 1; a def key = drilled into that filter. */
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const detail = filters.find((d) => d.key === detailKey) ?? null;

  /** Back to level 1, with focus on the row we came from. */
  const closeDetail = useCallback(() => {
    const key = detailKey;
    setDetailKey(null);
    if (key) requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
  }, [detailKey]);

  // Every opening starts at level 1.
  useEffect(() => {
    if (!open) setDetailKey(null);
  }, [open]);

  /** Arrow keys walk the rows; the dialog's trap handles the rest. */
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = filters
      .map((d) => rowRefs.current.get(d.key))
      .filter((el): el is HTMLButtonElement => !!el);
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next]!.focus();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* A real DialogTrigger, so closing returns focus to it — the last step
          of "focus returns to what you came from" at every depth. */}
      <DialogTrigger asChild>
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
      </DialogTrigger>

        <DialogContent
          showCloseButton={false}
          // Full-screen on a phone; a centered card from `sm` up.
          className={cn(
            "gap-0 overflow-hidden p-0 sm:max-w-md",
            "max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none",
          )}
          // ESC has DEPTH: at level 2 it goes back, and only closes from level 1.
          onEscapeKeyDown={(e) => {
            if (detail) {
              e.preventDefault();
              closeDetail();
            }
          }}
        >
          {/* ONE flex column inside the dialog. DialogContent is a grid, and
              at full height its rows would distribute — leaving the header
              floating mid-screen on a phone. */}
          <div className="flex min-h-0 flex-col max-sm:h-full">
          {detail ? (
            <FilterDetail def={detail} onBack={closeDetail} />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <DialogTitle className="text-sm font-medium text-ink">{title}</DialogTitle>
                <DialogDescription className="sr-only">
                  Choose filters. Changes apply immediately.
                </DialogDescription>
                <span className="text-[11px] text-ink-3">
                  {count === 0 ? "None applied" : `${count} applied`}
                </span>
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto sm:max-h-[min(60vh,32rem)]"
                onKeyDown={onListKeyDown}
              >
                {filters.map((def) => (
                  <FilterListRow
                    key={def.key}
                    def={def}
                    ref={(el) => {
                      rowRefs.current.set(def.key, el);
                    }}
                    onDrill={() => setDetailKey(def.key)}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-line px-4 py-3">
                <button
                  type="button"
                  onClick={onClear}
                  disabled={count === 0}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
                {/* "Done" only CLOSES — every change applied the moment it was made. */}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </>
          )}
          </div>
        </DialogContent>
    </Dialog>
  );
}

/**
 * A level-1 row: the whole width is the target. A short option list opens its
 * droplist right here (the row is the popover's anchor); everything else
 * drills.
 */
const FilterListRow = function FilterListRow({
  def,
  onDrill,
  ref,
}: {
  def: FilterDef;
  onDrill: () => void;
  ref: (el: HTMLButtonElement | null) => void;
}) {
  const [openPopover, setOpenPopover] = useState(false);
  const drills = filterDepth(def) === "drill";
  const active = isFilterActive(def);

  const row = (
    <button
      type="button"
      ref={ref}
      onClick={drills ? onDrill : undefined}
      aria-haspopup={drills ? "dialog" : "listbox"}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
    >
      <span className="min-w-0 flex-1 truncate text-xs text-ink">{def.label}</span>
      <span
        className={cn("max-w-[10rem] truncate text-xs", active ? "text-ink-2" : "text-ink-3")}
        title={filterSummary(def)}
      >
        {filterSummary(def)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
    </button>
  );

  // A custom def always drills, so past here the def has options.
  if (drills || def.type === "custom") return row;

  return (
    <Popover open={openPopover} onOpenChange={setOpenPopover}>
      <PopoverTrigger asChild>{row}</PopoverTrigger>
      {/* Anchored to the row, over the dialog. A multi keeps it open per
          toggle; outside-click and ESC dismiss the popover ALONE. */}
      <PopoverContent align="end" side="bottom" className="w-56 p-1">
        <OptionList def={def} />
      </PopoverContent>
    </Popover>
  );
};

/** Level 2: one filter, the whole dialog. */
function FilterDetail({ def, onBack }: { def: FilterDef; onBack: () => void }) {
  const [query, setQuery] = useState("");
  const backRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const withSearch = needsOptionSearch(def);

  useEffect(() => {
    // The search box takes focus when there is one; otherwise Back does, so
    // the level always opens somewhere sensible.
    if (withSearch) searchRef.current?.focus();
    else backRef.current?.focus();
  }, [withSearch]);

  return (
    <div className="flex min-h-0 flex-col motion-safe:animate-in motion-safe:slide-in-from-right-2 motion-safe:duration-150 max-sm:h-full">
      <div className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button
          type="button"
          ref={backRef}
          onClick={onBack}
          aria-label="Back to filters"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {def.label}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {def.label} options. Changes apply immediately; Escape goes back.
        </DialogDescription>
        {isFilterActive(def) && (
          <button
            type="button"
            onClick={() => {
              if (def.type === "multi") def.onChange([]);
              else if (def.type === "single") def.onChange(null);
              else def.onClear();
            }}
            className="rounded-md px-2 py-1 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {def.type === "custom" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{def.render({ fullWidth: true })}</div>
      ) : (
        <>
          {withSearch && (
            <div className="relative border-b border-line px-3 py-2">
              <Search
                className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${def.label.toLowerCase()}…`}
                aria-label={`Search ${def.label}`}
                className="h-8 w-full rounded-md border border-line bg-surface pl-7 pr-3 text-xs text-ink outline-none placeholder:text-ink-3 focus:border-line-2"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-1 max-sm:max-h-none sm:max-h-[min(50vh,24rem)]">
            <OptionList def={def} query={query} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The option check-list — the SAME renderer for a droplist and a drilled
 * level, so a filter reads identically at either depth.
 */
function OptionList({
  def,
  query = "",
}: {
  def: Exclude<FilterDef, { type: "custom" }>;
  query?: string;
}) {
  const values = def.type === "multi" ? def.values : def.value === null ? [] : [def.value];
  const toggle = (value: string) => {
    if (def.type === "multi") def.onChange(toggleValue(def.values, value));
    else def.onChange(def.value === value ? null : value);
  };
  const q = query.trim().toLowerCase();
  const shown: readonly FilterOption[] = q
    ? def.options.filter((o) => o.label.toLowerCase().includes(q))
    : def.options;

  if (def.options.length === 0) {
    return (
      <p className="px-3 py-2 text-[11px] text-ink-3">
        {(def.type === "multi" ? def.emptyHint : undefined) ?? "Nothing to choose yet"}
      </p>
    );
  }
  if (shown.length === 0) {
    return <p className="px-3 py-2 text-[11px] text-ink-3">Nothing matches that.</p>;
  }

  return (
    <>
      {def.type === "multi" && def.header && <div className="px-2 pb-2 pt-1">{def.header}</div>}
      {shown.map((o) => {
        const checked = values.includes(o.value);
        return (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
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
      {def.type === "multi" && def.note && (
        <p className="px-2 py-1 text-[10px] text-ink-3">{def.note}</p>
      )}
    </>
  );
}
