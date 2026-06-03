"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { int, pct, ratio, usd } from "@/lib/format";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CampaignPlatformGrainRow } from "@/db/queries/campaign";

type YMetric = "roas" | "cvr" | "ctr" | "cpa";

const Y: Record<
  YMetric,
  { label: string; fmt: (v: number | null) => string; tick: (v: number) => string; refOne?: boolean }
> = {
  roas: { label: "ROAS", fmt: (v) => (v === null ? "—" : `${ratio(v)}×`), tick: (v) => `${ratio(v)}×`, refOne: true },
  cvr: { label: "CvR", fmt: pct, tick: (v) => pct(v) },
  ctr: { label: "CTR", fmt: pct, tick: (v) => pct(v) },
  cpa: { label: "CPA", fmt: usd, tick: (v) => compactUsd.format(v) },
};
const ORDER: YMetric[] = ["roas", "cvr", "ctr", "cpa"];

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Each dot is a campaign (on one platform): X = spend, Y = the chosen
 * efficiency metric, bubble size = conversions, colour = platform. Lets you
 * spot the efficient performers vs. the big-but-mediocre spend at a glance.
 */
export function CampaignScatter({ rows }: { rows: CampaignPlatformGrainRow[] }) {
  const [metric, setMetric] = useState<YMetric>("roas");

  const series = useMemo(() => {
    const m = new Map<string, CampaignPlatformGrainRow[]>();
    for (const r of rows) {
      if (r[metric] === null) continue;
      const list = m.get(r.platform) ?? [];
      list.push(r);
      m.set(r.platform, list);
    }
    return ALL_PLATFORMS.filter((p) => m.has(p)).map((p) => ({
      platform: p,
      data: m.get(p)!.map((r) => ({
        x: r.spend,
        y: r[metric] as number,
        z: Math.max(r.conversions, 1),
        campaign: r.campaign,
        conversions: r.conversions,
      })),
    }));
  }, [rows, metric]);

  const y = Y[metric];
  const hasData = series.some((s) => s.data.length > 0);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Spend vs {y.label}</h3>
          <p className="text-[10px] text-ink-3">
            Each dot is a campaign · bubble = conversions · colour = platform
          </p>
        </div>
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
              {Y[k].label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="h-80 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No campaigns to plot in this window.
        </div>
      ) : (
        <>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Spend"
                  tickFormatter={(v: number) => compactUsd.format(v)}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name={y.label}
                  tickFormatter={y.tick}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={56}
                />
                <ZAxis type="number" dataKey="z" range={[40, 420]} />
                {y.refOne && (
                  <ReferenceLine
                    y={1}
                    stroke="var(--ink-3)"
                    strokeDasharray="4 4"
                    label={{ value: "break-even", fill: "var(--ink-3)", fontSize: 10, position: "insideTopRight" }}
                  />
                )}
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: "var(--line-2)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0]?.payload as {
                      campaign: string;
                      x: number;
                      y: number;
                      conversions: number;
                    };
                    return (
                      <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs max-w-xs">
                        <div className="text-ink font-medium mb-1 truncate">{p.campaign}</div>
                        <div className="flex items-center justify-between gap-4 text-ink-2">
                          <span>Spend</span>
                          <span className="tabular-nums">{usd(p.x)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-ink-2">
                          <span>{y.label}</span>
                          <span className="tabular-nums">{y.fmt(p.y)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-ink-2">
                          <span>Conversions</span>
                          <span className="tabular-nums">{int(p.conversions)}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                {series.map((s) => (
                  <Scatter
                    key={s.platform}
                    name={PLATFORM_LABEL[s.platform]}
                    data={s.data}
                    fill={PLATFORM_COLOR[s.platform]}
                    fillOpacity={0.7}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-2">
            {series.map((s) => (
              <span key={s.platform} className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: PLATFORM_COLOR[s.platform] }} />
                {PLATFORM_LABEL[s.platform]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
