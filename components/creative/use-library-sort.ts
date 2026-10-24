"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { CreativeListRow } from "@/db/queries/creatives";
import type { CreativeSort } from "@/validators/creative";
import { DEFAULT_CREATIVE_SORT, parseCreativeSort, sortCreativeRows } from "@/lib/creative-sort";
import { shallowParams } from "@/lib/shallow-url";

/**
 * The Library's sort, SHALLOW (D12, 2026-10): the table header and the
 * toolbar's Sort menu rewrite `?sort=` with the native history API (no server
 * render — it used to re-run the page's queries for an order of rows already
 * here), and the table and the grid re-order from the URL they read live with
 * `sortCreativeRows` — the SAME function the server listed with, so a fresh
 * load and a click agree. `replace`, as before: a sort is not a history step.
 */
export function writeLibrarySort(sort: CreativeSort): void {
  shallowParams((params) => {
    if (sort === DEFAULT_CREATIVE_SORT) params.delete("sort");
    else params.set("sort", sort);
  }, "replace");
}

/**
 * The rows in the URL's order, and the list context every detail link carries
 * — with the LIVE sort in it (the server built it with the sort of its own
 * render), so the detail page's pager walks the order on screen.
 */
export function useLibrarySort(rows: CreativeListRow[], listCtx: string | undefined) {
  const searchParams = useSearchParams();
  const sort = parseCreativeSort(searchParams.get("sort"));
  const sorted = useMemo(() => sortCreativeRows(rows, sort), [rows, sort]);
  const ctx = useMemo(() => {
    const params = new URLSearchParams(listCtx ?? "");
    params.set("sort", sort);
    return params.toString();
  }, [listCtx, sort]);
  return { sort, rows: sorted, listCtx: ctx };
}
