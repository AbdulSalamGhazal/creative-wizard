import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RATING_VALUES, type Rating } from "@/lib/rating";

const COLOR: Record<Rating, string> = {
  good: "var(--pos)",
  decent: "var(--warn)",
  bad: "var(--neg)",
  na: "var(--ink-3)",
};
const LABEL: Record<Rating, string> = {
  good: "Good",
  decent: "Decent",
  bad: "Bad",
  na: "N/A",
};

export interface RatingRow {
  rating: Rating;
  key: string;
  spend: number;
}

interface SeriesItem {
  key: string;
  label: string;
}

/**
 * Spend by rating as 100%-stacked bars: a row per platform (or campaign when
 * pinned), each split by Good / Decent / Bad / N/A. An emphasized "Overall" row
 * on top shows the blended split. Mirrors the type-mix composition.
 */
export function RatingMixBars({
  rows,
  series,
  overallLabel,
  dimension,
  dimensionLabel,
}: {
  rows: RatingRow[];
  series: SeriesItem[];
  overallLabel: string;
  dimension: "platform" | "campaign";
  dimensionLabel?: string;
}) {
  const present = RATING_VALUES.filter((r) =>
    rows.some((row) => row.rating === r && row.spend > 0),
  );

  const sumByRating = (predicate: (row: RatingRow) => boolean) => {
    const m = new Map<Rating, number>();
    let total = 0;
    for (const row of rows) {
      if (!predicate(row)) continue;
      m.set(row.rating, (m.get(row.rating) ?? 0) + row.spend);
      total += row.spend;
    }
    return { m, total };
  };

  const overall = sumByRating(() => true);
  const rowData = series
    .map((s) => ({ ...s, ...sumByRating((row) => row.key === s.key) }))
    .filter((r) => r.total > 0);

  const renderBar = (m: Map<Rating, number>, total: number, big: boolean) => (
    <div
      className={`flex ${big ? "h-4" : "h-2.5"} w-full rounded-full overflow-hidden bg-surface-2`}
    >
      {present.map((r) => {
        const frac = total > 0 ? (m.get(r) ?? 0) / total : 0;
        if (frac <= 0) return null;
        return (
          <span
            key={r}
            title={`${LABEL[r]}: ${Math.round(frac * 100)}%`}
            style={{ width: `${frac * 100}%`, background: COLOR[r] }}
          />
        );
      })}
    </div>
  );

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Spend by rating</CardTitle>
        {dimension === "campaign" && (
          <span className="text-[11px] text-ink-3 font-normal">
            by campaign{dimensionLabel ? ` · ${dimensionLabel}` : ""}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {present.map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-3"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: COLOR[r] }}
              />
              {LABEL[r]}
            </span>
          ))}
        </div>

        {overall.total <= 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-around gap-3">
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">{overallLabel}</span>
              {renderBar(overall.m, overall.total, true)}
            </div>
            {rowData.map((r) => (
              <div key={r.key} className="space-y-1">
                <span className="block truncate text-xs text-ink-2" title={r.label}>
                  {r.label}
                </span>
                {renderBar(r.m, r.total, false)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
