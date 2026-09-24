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
  /** Overrides the default "Label: A" / "Label: A +2" chip text. */
  chipFormat?: (values: readonly string[], options: readonly FilterOption[]) => string;
}

export interface SingleFilterDef extends FilterDefBase {
  type: "single";
  options: readonly FilterOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  chipFormat?: (value: string, options: readonly FilterOption[]) => string;
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

/** An option's label, falling back to the raw value (a stale URL token). */
export function optionLabel(options: readonly FilterOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function isFilterActive(def: FilterDef): boolean {
  switch (def.type) {
    case "multi":
      return def.values.length > 0;
    case "single":
      return def.value !== null;
    case "custom":
      return def.active;
  }
}

/** The number on the Filters button — how many FILTERS are on, not values. */
export function activeFilterCount(defs: readonly FilterDef[]): number {
  return defs.filter(isFilterActive).length;
}

/** "Label: A" for one value, "Label: A +2" for more — the house chip text. */
export function defaultChipLabel(def: MultiFilterDef | SingleFilterDef): string {
  if (def.type === "single") {
    const value = def.value!;
    return `${def.label}: ${def.chipFormat ? def.chipFormat(value, def.options) : optionLabel(def.options, value)}`;
  }
  if (def.chipFormat) return `${def.label}: ${def.chipFormat(def.values, def.options)}`;
  const [first, ...rest] = def.values;
  const head = optionLabel(def.options, first!);
  return rest.length === 0 ? `${def.label}: ${head}` : `${def.label}: ${head} +${rest.length}`;
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
