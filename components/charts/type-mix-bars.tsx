import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TYPE_COLOR, TYPE_LABEL } from "@/lib/palette";
import type { TypeDimensionSpendRow } from "@/db/queries/performance";

type CreativeType = "video" | "image" | "slides";
const TYPE_ORDER: CreativeType[] = ["video", "image", "slides"];

interface SeriesItem {
  key: string;
  label: string;
}

/**
 * Type mix as 100%-stacked bars: a row per platform (or campaign when pinned),
 * each bar split by creative type — so you read each channel's type composition
 * as percentages. An emphasized "Overall" row on top shows the blended split.
 */
export function TypeMixBars({
  rows,
  series,
  overallLabel,
  dimension,
  dimensionLabel,
}: {
  rows: TypeDimensionSpendRow[];
  series: SeriesItem[];
  overallLabel: string;
  dimension: "platform" | "campaign";
  dimensionLabel?: string;
}) {
  const types = TYPE_ORDER.filter((t) =>
    rows.some((r) => r.type === t && r.spend > 0),
  );

  const sumByType = (predicate: (r: TypeDimensionSpendRow) => boolean) => {
    const m = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      if (!predicate(r)) continue;
      m.set(r.type, (m.get(r.type) ?? 0) + r.spend);
      total += r.spend;
    }
    return { m, total };
  };

  const overall = sumByType(() => true);
  const rowData = series
    .map((s) => ({ ...s, ...sumByType((r) => r.key === s.key) }))
    .filter((r) => r.total > 0);

  const renderBar = (m: Map<string, number>, total: number, big: boolean) => (
    <div
      className={`flex ${big ? "h-4" : "h-2.5"} w-full rounded-full overflow-hidden bg-surface-2`}
    >
      {types.map((t) => {
        const frac = total > 0 ? (m.get(t) ?? 0) / total : 0;
        if (frac <= 0) return null;
        return (
          <span
            key={t}
            title={`${TYPE_LABEL[t]}: ${Math.round(frac * 100)}%`}
            style={{ width: `${frac * 100}%`, background: TYPE_COLOR[t] }}
          />
        );
      })}
    </div>
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Type mix</CardTitle>
        {dimension === "campaign" && (
          <span className="text-[11px] text-ink-3 font-normal">
            by campaign{dimensionLabel ? ` · ${dimensionLabel}` : ""}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        {/* Type legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {types.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-3"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: TYPE_COLOR[t] }}
              />
              {TYPE_LABEL[t]}
            </span>
          ))}
        </div>

        {overall.total <= 0 ? (
          <div className="flex-1 flex items-center justify-center text-ink-3 text-sm">
            No spend in this window.
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-around gap-3">
            {/* Overall (emphasized) */}
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">{overallLabel}</span>
              {renderBar(overall.m, overall.total, true)}
            </div>
            {/* Per platform / campaign */}
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
