"use client";

import { CreativeCard } from "@/components/creative/creative-card";
import type { CreativeListRow } from "@/db/queries/creatives";
import { useLibrarySort } from "@/components/creative/use-library-sort";
import { EmptyState } from "@/components/ui/empty-state";

export function CreativeGrid({
  rows: serverRows,
  listCtx: serverListCtx,
}: {
  rows: CreativeListRow[];
  listCtx?: string;
}) {
  // The URL's order, re-applied here so a shallow sort (D12) re-orders the
  // cards without a server render.
  const { rows, listCtx } = useLibrarySort(serverRows, serverListCtx);
  if (rows.length === 0) {
    return (
      // The table view's twin, word for word (C-20: they disagreed).
      <EmptyState size="lg" title="No creatives match these filters." kind="filters" />
    );
  }
  return (
    // Internal vertical scroll (same pattern as the Summary table) so the
    // board contains its own height instead of growing the page. The padding +
    // negative margin keep the cards' hover lift from clipping at the edges.
    <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-1 -mx-1 pt-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {rows.map((row) => (
          <CreativeCard key={row.id} row={row} listCtx={listCtx} />
        ))}
      </div>
    </div>
  );
}
