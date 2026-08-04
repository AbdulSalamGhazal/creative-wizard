"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { FilterSearch, ClearButton } from "@/components/filters/filter-pill";
import { useNavTransition } from "@/lib/nav-progress";

/**
 * Store orders filters — date range + order-id search ONLY (deliberate; no
 * status/platform/product filters). URL-backed; a search is debounced 250ms.
 * Any filter change resets to page 1.
 */
export function StoreFilterBar({
  from,
  to,
  q,
}: {
  from: string | null;
  to: string | null;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  const [qLocal, setQLocal] = useState(q);

  const update = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mut(next);
    next.delete("page"); // any filter change → back to page 1
    startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Debounce the search box (250ms) before writing `?q=`.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      update((p) => {
        const v = qLocal.trim();
        if (v) p.set("q", v);
        else p.delete("q");
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qLocal]);

  const setRange = (nf: string | null, nt: string | null) =>
    update((p) => {
      if (nf) p.set("from", nf);
      else p.delete("from");
      if (nt) p.set("to", nt);
      else p.delete("to");
    });

  const hasFilter = Boolean(from || to || q);

  return (
    <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 bg-background py-2">
      <DateRangePicker from={from} to={to} onChange={setRange} />
      <FilterSearch
        value={qLocal}
        onChange={setQLocal}
        placeholder="Search order ID…"
      />
      {hasFilter && (
        <ClearButton
          onClick={() => {
            setQLocal("");
            update((p) => {
              p.delete("from");
              p.delete("to");
              p.delete("q");
            });
          }}
        />
      )}
    </div>
  );
}
