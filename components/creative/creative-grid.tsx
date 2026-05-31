import { CreativeCard } from "@/components/creative/creative-card";
import type { CreativeListRow } from "@/db/queries/creatives";

export function CreativeGrid({ rows }: { rows: CreativeListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No creatives match these filters.</p>
        <p className="text-ink-3 text-xs mt-1">
          Clear filters or add a new creative to the library.
        </p>
      </div>
    );
  }
  return (
    // Internal vertical scroll (same pattern as the Summary table) so the
    // board contains its own height instead of growing the page. The padding +
    // negative margin keep the cards' hover lift from clipping at the edges.
    <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden px-1 -mx-1 pt-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {rows.map((row) => (
          <CreativeCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
