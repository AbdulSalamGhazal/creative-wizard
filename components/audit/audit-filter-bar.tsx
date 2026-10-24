"use client";

import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef, FilterOption } from "@/components/filters/filter-model";

/**
 * The Audit log's filter bar — on `FilterShell` (D27, 2026-10). It used to be
 * a row of plain `<Link>` chips: no progress bar, no chips row, a second way
 * to filter a page. Now ONE `single` def keyed `category` (the URL param is
 * unchanged, so links into the log keep working), each option carrying its
 * event count. Not remembered: the log opens on everything.
 */
export function AuditFilterBar({
  options,
  category,
}: {
  /** Every category, labelled, with its count as the hint. */
  options: readonly FilterOption[];
  /** The category the page is filtered to, or null for all activity. */
  category: string | null;
}) {
  const { update } = useFilterParams();
  const filters: FilterDef[] = [
    {
      key: "category",
      label: "Category",
      type: "single",
      options,
      value: category,
      persist: false,
      onChange: (next) =>
        update((params) => {
          if (next) params.set("category", next);
          else params.delete("category");
        }),
    },
  ];
  return <FilterShell filters={filters} />;
}
