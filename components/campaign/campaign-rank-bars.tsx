"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { int, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CampaignPlatformGrainRow } from "@/db/queries/campaign";

type Metric = "spend" | "conversions" | "conversionValue" | "roas";

const METRICS: Record<Metric, { label: string; fmt: (v: number | null) => string }> = {
  spend: { label: "Spend", fmt: (v) => usd(v) },
  conversions: { label: "Conversions", fmt: (v) => int(v ?? 0) },
  conversionValue: { label: "Conv. value", fmt: (v) => usd(v) },
  roas: { label: "ROAS", fmt: (v) => (v === null ? "—" : `${ratio(v)}×`) },
};
const ORDER: Metric[] = ["spend", "conversions", "conversionValue", "roas"];

const TOP_N = 12;

/**
 * Top campaigns ranked by a chosen metric, as a clickable bar list (campaign
 * names get long, so a horizontal list reads better than an axis chart). Each
 * bar is colour-coded by platform.
 */
export function CampaignRankBars({ rows }: { rows: CampaignPlatformGrainRow[] }) {
  const [metric, setMetric] = useState<Metric>("spend");

  const top = useMemo(() => {
    const arr = rows.filter((r) => (r[metric] ?? 0) > 0);
    arr.sort((a, b) => (b[metric] ?? 0) - (a[metric] ?? 0));
    return arr.slice(0, TOP_N);
  }, [rows, metric]);

  const max = top[0]?.[metric] ?? 0;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-sm text-ink-2">Top campaigns by {METRICS[metric].label.toLowerCase()}</h3>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                metric === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {METRICS[k].label}
            </button>
          ))}
        </div>
      </div>

      {top.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-ink-3 text-sm">
          Nothing to rank in this window.
        </div>
      ) : (
        <div className="space-y-1.5">
          {top.map((r) => {
            const v = r[metric] ?? 0;
            const widthPct = max > 0 ? Math.max((v / max) * 100, 1.5) : 0;
            return (
              <Link
                key={`${r.platform}:${r.campaign}`}
                href={`/campaigns/${encodeURIComponent(r.campaign)}`}
                className="group block"
                title={r.campaign}
              >
                <div className="flex items-center justify-between gap-3 text-[12px] mb-0.5">
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ background: PLATFORM_COLOR[r.platform] }}
                      title={PLATFORM_LABEL[r.platform]}
                    />
                    <span className="truncate text-ink-2 group-hover:text-brand transition-colors">
                      {r.campaign}
                    </span>
                  </span>
                  <span className="shrink-0 text-ink tabular-nums">{METRICS[metric].fmt(v)}</span>
                </div>
                <div className="h-1.5 rounded bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded transition-all"
                    style={{ width: `${widthPct}%`, background: PLATFORM_COLOR[r.platform], opacity: 0.85 }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
