"use client";

import { useEffect, useRef, useState } from "react";
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
  const { update } = useFilterParams();
  const [qLocal, setQLocal] = useState(q);

  /** Any filter change → back to page 1. */
  const write = (mutate: (p: URLSearchParams) => void) =>
    update((next) => {
      mutate(next);
      next.delete("page");
    });

  // Debounce the search box (250ms) before writing `?q=`.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      write((p) => {
        const v = qLocal.trim();
        if (v) p.set("q", v);
        else p.delete("q");
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  return (
    <FilterShell
      filters={[]}
      mobileLead={
        <FilterSearch
          fullWidth
          value={qLocal}
          onChange={setQLocal}
          placeholder="Search order ID…"
        />
      }
      tier1={({ fullWidth }) => (
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
      )}
    />
  );
}
