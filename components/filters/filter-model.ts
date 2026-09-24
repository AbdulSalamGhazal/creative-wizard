import type { ReactNode } from "react";

/**
 * The declarative filter model behind `FilterShell` — PURE, no React, no DOM,
 * so the derivations below are unit-testable and every surface derives the
 * same things from one entry.
 *
 * THE CONTRACT: from ONE `FilterDef` the shell derives the panel row, the
 * chip, the count badge and the mobile sheet. Adding a filter to a page is
 * adding one entry to its `FilterDef[]` — never an edit to the shell
 * (pinned by `filter-model.test.ts`).
 */

export interface FilterOption {
  value: string;
  label: string;
  /** A colour for a leading dot (status, platform) — a CSS colour or var(). */
  dot?: string;
  /** Rendered muted after the label (e.g. "TOF"). */
  hint?: string;
  disabled?: boolean;
}

/** One removable chip in the tier-3 row. */
export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface FilterDefBase {
  /** Stable id — also the React key and the chip key prefix. */
  key: string;
  label: string;
}

export interface MultiFilterDef extends FilterDefBase {
  type: "multi";
  options: readonly FilterOption[];
  values: readonly string[];
  onChange: (next: string[]) => void;
  /** Rendered ABOVE the options inside the panel row — e.g. a scope picker. */
  header?: ReactNode;
  /** Shown in place of an empty option list ("No products yet"). */
  emptyHint?: string;
  /** A muted line under the options (a cap notice, say). */
  note?: ReactNode;
  /**
   * Overrides "active = something is selected". For a filter whose DEFAULT is
   * a non-empty set (Canvas's statuses default to all-but-terminated), active
   * means "the URL says something", not "values.length > 0".
   */
  active?: boolean;
  /** Overrides the default "A" / "A +2" value wording (chips AND rows). */
  chipFormat?: (values: readonly string[], options: readonly FilterOption[]) => string;
  /**
   * Force the dialog to DRILL for this filter instead of opening a droplist.
   * The depth is automatic (see `filterDepth`); this is the escape hatch for a
   * page whose short option list still deserves the whole level.
   */
  depth?: FilterDepth;
}

export interface SingleFilterDef extends FilterDefBase {
  type: "single";
  options: readonly FilterOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  chipFormat?: (value: string, options: readonly FilterOption[]) => string;
  /** Same override as the multi case. */
  active?: boolean;
  /** Same presentation hint as the multi case. */
  depth?: FilterDepth;
}

/**
 * An escape hatch for a filter whose control is its own component (the metric
 * filter's rule builder). It still declares its active state, its chips and
 * how to clear, so the badge, the chips row and Clear keep working without the
 * shell knowing anything about it.
 */
export interface CustomFilterDef extends FilterDefBase {
  type: "custom";
  active: boolean;
  chips: readonly FilterChip[];
  onClear: () => void;
  render: (ctx: { fullWidth: boolean }) => ReactNode;
}

export type FilterDef = MultiFilterDef | SingleFilterDef | CustomFilterDef;

/**
 * How the dialog opens a filter — a compact droplist anchored to its row, or
 * the whole second level.
 */
export type FilterDepth = "popover" | "drill";

/** Above this many options a droplist stops being comfortable. */
export const POPOVER_MAX_OPTIONS = 8;
/** Above this many, a level-2 list needs a search box (angles, products). */
export const SEARCH_MIN_OPTIONS = 12;

/**
 * AUTOMATIC from the def — no new config to keep in sync. A custom filter
 * always takes the level (the metric builder needs the room); a long option
 * list does too; everything else is a droplist.
 */
export function filterDepth(def: FilterDef): FilterDepth {
  if (def.type === "custom") return "drill";
  if (def.depth) return def.depth;
  return def.options.length > POPOVER_MAX_OPTIONS ? "drill" : "popover";
}

/** A level-2 list long enough to need its own search box. */
export function needsOptionSearch(def: FilterDef): boolean {
  return def.type !== "custom" && def.options.length > SEARCH_MIN_OPTIONS;
}

/** An option's label, falling back to the raw value (a stale URL token). */
export function optionLabel(options: readonly FilterOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function isFilterActive(def: FilterDef): boolean {
  switch (def.type) {
    case "multi":
      return def.active ?? def.values.length > 0;
    case "single":
      return def.active ?? def.value !== null;
    case "custom":
      return def.active;
  }
}

/** The number on the Filters button — how many FILTERS are on, not values. */
export function activeFilterCount(defs: readonly FilterDef[]): number {
  return defs.filter(isFilterActive).length;
}

/**
 * The VALUE half of a filter's wording — "A", "A +2", or whatever
 * `chipFormat` says. ONE source: the chips read it with the label in front,
 * the dialog's rows read it on its own.
 */
export function filterValueSummary(def: MultiFilterDef | SingleFilterDef): string {
  if (def.type === "single") {
    const value = def.value!;
    return def.chipFormat ? def.chipFormat(value, def.options) : optionLabel(def.options, value);
  }
  if (def.chipFormat) return def.chipFormat(def.values, def.options);
  const [first, ...rest] = def.values;
  const head = optionLabel(def.options, first!);
  return rest.length === 0 ? head : `${head} +${rest.length}`;
}

/** "Label: A" for one value, "Label: A +2" for more — the house chip text. */
export function defaultChipLabel(def: MultiFilterDef | SingleFilterDef): string {
  return `${def.label}: ${filterValueSummary(def)}`;
}

/**
 * What a filter ROW shows on the right in the dialog: the same wording the
 * chip uses, or a muted "Any" when the filter is off. A custom filter shows
 * its own first chip (and how many more), since only it knows its rules.
 */
export function filterSummary(def: FilterDef): string {
  if (!isFilterActive(def)) return "Any";
  if (def.type === "custom") {
    const [first, ...rest] = def.chips;
    if (!first) return "On";
    return rest.length === 0 ? first.label : `${first.label} +${rest.length}`;
  }
  return filterValueSummary(def);
}

/**
 * The tier-3 row: one chip per active filter — except a custom filter, which
 * contributes its own (the metric filter shows one chip per rule).
 */
export function filterChips(defs: readonly FilterDef[]): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const def of defs) {
    if (!isFilterActive(def)) continue;
    if (def.type === "custom") {
      chips.push(...def.chips);
      continue;
    }
    chips.push({
      key: def.key,
      label: defaultChipLabel(def),
      onRemove: () => (def.type === "multi" ? def.onChange([]) : def.onChange(null)),
    });
  }
  return chips;
}

/**
 * CLEAR SEMANTICS (user decision, 2026-09): clearing resets the TIER-2
 * FILTERS AND NOTHING ELSE. Sort, columns, the saved view, the date range and
 * every tier-1 control are untouched, because this function can only reach
 * what the defs declare — there is no param list to drift.
 */
export function clearFilters(defs: readonly FilterDef[]): void {
  for (const def of defs) {
    if (!isFilterActive(def)) continue;
    if (def.type === "multi") def.onChange([]);
    else if (def.type === "single") def.onChange(null);
    else def.onClear();
  }
}

/** Toggle one value of a multi filter — the shell's checkbox handler. */
export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
