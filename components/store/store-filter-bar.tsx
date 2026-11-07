"use client";

import { useDebouncedSearchParam } from "@/components/filters/use-debounced-search-param";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import type { DateRangeValue } from "@/lib/date-presets";
import { FilterSearch } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";

/**
 * Store orders filters — date range + order-id search ONLY (deliberate; no
 * status/platform/product filters). On `FilterShell` (phase 2) as a ZERO-DEF
 * page: the same bar, with no Filters button and no chips row, because there
 * is no tier 2 to collapse. URL-backed; a search is debounced 250ms, and any
 * filter change resets to page 1.
 */
export function StoreFilterBar({
  from,
  to,
  resolvedRange,
  q,
}: {
  /** Raw URL range (drives the highlighted preset), null when absent. */
  from: string | null;
  to: string | null;
  /** What the query actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  q: string;
}) {
  const { update, searchParams } = useFilterParams();

  /** Any filter change → back to page 1. */
  const write = (mutate: (p: URLSearchParams) => void) =>
    update((next) => {
      mutate(next);
      next.delete("page");
    });

  // Debounced `?q=` (250ms) — the shared hook, so a late navigation can't eat
  // typed characters and Back/Forward re-reads the URL. Before the first
  // render the server's parsed `q` stands in for the URL.
  const [qLocal, setQLocal] = useDebouncedSearchParam(searchParams.get("q") ?? q, (v) =>
    write((p) => {
      if (v) p.set("q", v);
      else p.delete("q");
    }),
  );

  return (
    <FilterShell
      filters={[]}
      tier1={({ fullWidth }) => (
        <>
        <FilterSearch
          value={qLocal}
          onChange={setQLocal}
          placeholder="Search order ID…"
        />
        <DateRangePicker
          from={from}
          to={to}
          onChange={(nf, nt) =>
            write((p) => {
              if (nf) p.set("from", nf);
              else p.delete("from");
              if (nt) p.set("to", nt);
              else p.delete("to");
            })
          }
          remember
          fullWidth={fullWidth}
          fallback={resolvedRange}
        />
        </>
      )}
    />
  );
}
