import Link from "next/link";
import { Crown } from "lucide-react";
import { int, pct, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { CampaignPlatformGrainRow } from "@/db/queries/campaign";

type Row = CampaignPlatformGrainRow;

interface Board {
  label: string;
  /** value to rank by; null rows are excluded */
  value: (r: Row) => number | null;
  fmt: (v: number) => string;
  /** true ⇒ a lower value is better (cost metrics) */
  lower?: boolean;
  /** minimum footprint so a tiny-spend fluke can't top the chart */
  eligible: (r: Row) => boolean;
}

const BOARDS: Board[] = [
  { label: "Spend", value: (r) => r.spend, fmt: (v) => usd(v), eligible: () => true },
  { label: "Conversions", value: (r) => r.conversions, fmt: (v) => int(v), eligible: () => true },
  { label: "ROAS", value: (r) => r.roas, fmt: (v) => `${ratio(v)}×`, eligible: (r) => r.conversions >= 3 },
  { label: "CPA", value: (r) => r.cpa, fmt: (v) => usd(v), lower: true, eligible: (r) => r.conversions >= 3 },
  { label: "CvR", value: (r) => r.cvr, fmt: (v) => pct(v), eligible: (r) => r.landingPageViews >= 50 },
  { label: "CTR", value: (r) => r.ctr, fmt: (v) => pct(v), eligible: (r) => r.impressions >= 1000 },
  { label: "VOC", value: (r) => r.voc, fmt: (v) => pct(v), eligible: (r) => r.clicks >= 50 },
  { label: "CPM", value: (r) => r.cpm, fmt: (v) => usd(v), lower: true, eligible: (r) => r.impressions >= 1000 },
];

function topThree(rows: Row[], b: Board): Array<{ row: Row; v: number }> {
  const pool = rows
    .filter((r) => b.eligible(r))
    .map((r) => ({ row: r, v: b.value(r) }))
    .filter((x): x is { row: Row; v: number } => x.v !== null);
  pool.sort((a, c) => (b.lower ? a.v - c.v : c.v - a.v));
  return pool.slice(0, 3);
}

/**
 * Eight mini-leaderboards — top 3 campaigns for each headline metric. Cost
 * metrics (CPA / CPM) rank lowest-first; the rest highest-first, each behind a
 * minimum-footprint guard so a tiny campaign can't fluke to #1. Every entry
 * links to its campaign page.
 */
export function CampaignLeaderboards({ rows }: { rows: Row[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {BOARDS.map((b) => {
        const top = topThree(rows, b);
        return (
          <div key={b.label} className="rounded-lg border border-line bg-surface p-3.5 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-[0.14em] text-ink-2 font-medium">
                {b.label}
              </h3>
              {b.lower && <span className="text-[9px] text-ink-3">lowest</span>}
            </div>
            {top.length === 0 ? (
              <p className="text-[11px] text-ink-3 py-2">Not enough data.</p>
            ) : (
              <ol className="space-y-1.5">
                {top.map(({ row, v }, i) => (
                  <li key={`${row.platform}:${row.campaign}`}>
                    <Link
                      href={`/campaigns/${encodeURIComponent(row.campaign)}`}
                      className="flex items-center gap-2 group"
                      title={row.campaign}
                    >
                      <span className="shrink-0 w-4 text-center">
                        {i === 0 ? (
                          <Crown className="w-3.5 h-3.5 text-warn inline" />
                        ) : (
                          <span className="text-[11px] text-ink-3 tabular-nums">{i + 1}</span>
                        )}
                      </span>
                      <span
                        className="w-1.5 h-1.5 rounded-sm shrink-0"
                        style={{ background: PLATFORM_COLOR[row.platform] }}
                        title={PLATFORM_LABEL[row.platform]}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2 group-hover:text-brand transition-colors">
                        {row.campaign}
                      </span>
                      <span className="shrink-0 text-[12px] text-ink tabular-nums">
                        {b.fmt(v)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
