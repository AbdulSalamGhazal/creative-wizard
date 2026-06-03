import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, pct, usd } from "@/lib/format";
import type { PlatformFunnelRow } from "@/db/queries/funnel";

type RateKey = "cpm" | "ctr" | "voc" | "cvr";

const RATES: Array<{
  key: RateKey;
  label: string;
  fmt: (v: number | null) => string;
  /** CPM is a cost — the leader is the LOWEST, the rest are the highest. */
  lowerBetter: boolean;
  hint: string;
}> = [
  { key: "cpm", label: "CPM", fmt: (v) => usd(v), lowerBetter: true, hint: "cost / 1k impressions" },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v), lowerBetter: false, hint: "clicks / impressions" },
  { key: "voc", label: "VOC", fmt: (v) => pct(v), lowerBetter: false, hint: "LP views / clicks" },
  { key: "cvr", label: "CvR", fmt: (v) => pct(v), lowerBetter: false, hint: "conversions / LP views" },
];

/**
 * Platforms side-by-side across the funnel. Volumes (spend → impressions →
 * clicks → LP views → conversions) as plain numbers; the four funnel rates get
 * a magnitude bar (scaled to the highest platform) plus a leader highlight
 * (green = best for that metric — lowest CPM, highest CTR/VOC/CvR).
 */
export function PlatformFunnelComparison({
  rows,
}: {
  rows: PlatformFunnelRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No platform activity in this window.</p>
      </div>
    );
  }

  // Per rate: which platform leads, and the max magnitude (for bar scaling).
  const best: Partial<Record<RateKey, string>> = {};
  const maxAbs: Record<RateKey, number> = { cpm: 0, ctr: 0, voc: 0, cvr: 0 };
  for (const r of RATES) {
    let bestPlat: string | null = null;
    let bestVal: number | null = null;
    let max = 0;
    for (const row of rows) {
      const v = row[r.key];
      if (v === null) continue;
      if (v > max) max = v;
      if (
        bestVal === null ||
        (r.lowerBetter ? v < bestVal : v > bestVal)
      ) {
        bestVal = v;
        bestPlat = row.platform;
      }
    }
    if (bestPlat) best[r.key] = bestPlat;
    maxAbs[r.key] = max;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Platform</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            <th className="font-medium px-3 py-2.5 text-right">Impr.</th>
            <th className="font-medium px-3 py-2.5 text-right">Clicks</th>
            <th className="font-medium px-3 py-2.5 text-right">LP views</th>
            <th className="font-medium px-3 py-2.5 text-right">Conv.</th>
            {RATES.map((r) => (
              <th
                key={r.key}
                className="font-medium px-3 py-2.5 text-right whitespace-nowrap"
                title={r.hint}
              >
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.platform} className="hover:bg-surface-2/40 transition-colors">
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-2 text-ink whitespace-nowrap">
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: PLATFORM_COLOR[row.platform] }}
                  />
                  {PLATFORM_LABEL[row.platform]}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(row.spend)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(row.impressions)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(row.clicks)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(row.landingPageViews)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(row.conversions)}</td>
              {RATES.map((r) => {
                const v = row[r.key];
                const isBest = best[r.key] === row.platform;
                const widthPct =
                  v !== null && maxAbs[r.key] > 0
                    ? Math.max((v / maxAbs[r.key]) * 100, 4)
                    : 0;
                return (
                  <td key={r.key} className="px-3 py-2 align-middle">
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={
                          "tabular-nums " +
                          (isBest ? "text-pos font-semibold" : "text-ink")
                        }
                        title={isBest ? `Best ${r.label} across platforms` : undefined}
                      >
                        {r.fmt(v)}
                      </span>
                      <span className="block h-1 w-14 rounded bg-surface-2 overflow-hidden">
                        <span
                          className="block h-full rounded"
                          style={{
                            width: `${widthPct}%`,
                            background: PLATFORM_COLOR[row.platform],
                            opacity: isBest ? 1 : 0.5,
                          }}
                        />
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
