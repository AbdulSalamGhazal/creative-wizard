import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RATING_VALUES, type Rating, type RatingWindow } from "@/lib/rating";
import { RatingWindowControl } from "@/components/charts/rating-window-control";

const COLOR: Record<Rating, string> = {
  // --pos is bright enough that white in-segment text washes out, so darken it
  // ~22% just for this chart (the global --pos is untouched elsewhere).
  good: "color-mix(in srgb, var(--pos) 78%, #000 22%)",
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

// Only label a segment when it's wide enough to fit "NN%" without clipping;
// smaller slivers stay color-only (the tooltip still has the exact figure).
const LABEL_MIN_FRAC = 0.1;

/**
 * Spend by rating as 100%-stacked bars: a row per platform (or campaign when
 * pinned), each split by Good / Decent / Bad / N/A with the percentage written
 * inside each segment. An emphasized "Overall" row on top shows the blended
 * split. Label sits left of the bar so many rows (campaign view) stay compact.
 */
export function RatingMixBars({
  rows,
  series,
  overallLabel,
  dimension,
  dimensionLabel,
  ratingWindow,
}: {
  rows: RatingRow[];
  series: SeriesItem[];
  overallLabel: string;
  dimension: "platform" | "campaign";
  dimensionLabel?: string;
  ratingWindow: RatingWindow;
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

  const bar = (m: Map<Rating, number>, total: number, tall: boolean) => (
    <div
      className={`flex ${tall ? "h-8" : "h-7"} w-full rounded-lg overflow-hidden bg-surface-2`}
    >
      {present.map((r) => {
        const frac = total > 0 ? (m.get(r) ?? 0) / total : 0;
        if (frac <= 0) return null;
        const p = Math.round(frac * 100);
        return (
          <span
            key={r}
            title={`${LABEL[r]}: ${p}%`}
            className="flex items-center justify-center overflow-hidden text-[11px] font-semibold tabular-nums leading-none"
            style={{
              width: `${frac * 100}%`,
              background: COLOR[r],
              color: "rgba(255,255,255,0.96)",
              textShadow: "0 1px 1.5px rgba(0,0,0,0.4)",
            }}
          >
            {frac >= LABEL_MIN_FRAC ? `${p}%` : ""}
          </span>
        );
      })}
    </div>
  );

  const row = (label: string, m: Map<Rating, number>, total: number, tall: boolean) => (
    <div className="flex items-center gap-2.5">
      <span
        className={`w-20 shrink-0 truncate text-xs ${tall ? "font-semibold text-ink" : "text-ink-2"}`}
        title={label}
      >
        {label}
      </span>
      <div className="flex-1">{bar(m, total, tall)}</div>
    </div>
  );

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <CardTitle className="text-sm">Spend by rating</CardTitle>
          {dimension === "campaign" && (
            <span className="text-[11px] text-ink-3 font-normal truncate">
              by campaign{dimensionLabel ? ` · ${dimensionLabel}` : ""}
            </span>
          )}
        </div>
        <RatingWindowControl value={ratingWindow} />
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
          <div className="flex-1 flex flex-col justify-center gap-2.5">
            {row(overallLabel, overall.m, overall.total, true)}
            {rowData.map((r) => (
              <div key={r.key}>{row(r.label, r.m, r.total, false)}</div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
