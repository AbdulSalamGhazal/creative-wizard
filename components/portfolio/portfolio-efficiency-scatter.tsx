"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { int, ratio, usd } from "@/lib/format";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { PortfolioCampaignRow } from "@/db/queries/portfolio";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type YMetric = "cpa" | "roas";

/**
 * Every campaign as a dot: X = spend, Y = CPA (toggle ROAS), bubble = orders,
 * colour = platform. A reference line marks the target so above/below is
 * instant. Click a dot to open that campaign.
 */
export function PortfolioEfficiencyScatter({
  rows,
  targetCpa,
  targetRoas,
}: {
  rows: PortfolioCampaignRow[];
  targetCpa: number | null;
  targetRoas: number | null;
}) {
  const router = useRouter();
  const [metric, setMetric] = useState<YMetric>("cpa");

  const series = useMemo(() => {
    const m = new Map<string, PortfolioCampaignRow[]>();
    for (const r of rows) {
      if (r[metric] === null || r.spend <= 0) continue;
      const platform = r.platforms[0] ?? "instagram";
      const list = m.get(platform) ?? [];
      list.push(r);
      m.set(platform, list);
    }
    return ALL_PLATFORMS.filter((p) => m.has(p)).map((p) => ({
      platform: p,
      data: m.get(p)!.map((r) => ({
        x: r.spend,
        y: r[metric] as number,
        z: Math.max(r.orders, 1),
        campaign: r.campaign,
        orders: r.orders,
        cpa: r.cpa,
        roas: r.roas,
      })),
    }));
  }, [rows, metric]);

  const hasData = series.some((s) => s.data.length > 0);
  const isCpa = metric === "cpa";
  const refY = isCpa ? targetCpa : targetRoas;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Efficiency — spend vs {isCpa ? "CPA" : "ROAS"}</h3>
          <p className="text-[10px] text-ink-3">
            Each dot is a campaign · bubble = orders · click to open
          </p>
        </div>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {(["cpa", "roas"] as YMetric[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors uppercase",
                metric === k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {k}
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
                  name={isCpa ? "CPA" : "ROAS"}
                  tickFormatter={(v: number) => (isCpa ? compactUsd.format(v) : `${ratio(v)}×`)}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  stroke="var(--line-2)"
                  width={56}
                />
                <ZAxis type="number" dataKey="z" range={[40, 420]} />
                {refY !== null && (
                  <ReferenceLine
                    y={refY}
                    stroke="var(--ink-3)"
                    strokeDasharray="4 4"
                    label={{
                      value: isCpa ? "target CPA" : "target ROAS",
                      fill: "var(--ink-3)",
                      fontSize: 10,
                      position: "insideTopRight",
                    }}
                  />
                )}
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: "var(--line-2)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0]?.payload as {
                      campaign: string;
                      x: number;
                      orders: number;
                      cpa: number | null;
                      roas: number | null;
                    };
                    return (
                      <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs max-w-xs">
                        <div className="text-ink font-medium mb-1 truncate">{p.campaign}</div>
                        <TipRow label="Spend" value={usd(p.x)} />
                        <TipRow label="Orders" value={int(p.orders)} />
                        <TipRow label="CPA" value={p.cpa === null ? "—" : usd(p.cpa)} />
                        <TipRow label="ROAS" value={p.roas === null ? "—" : `${ratio(p.roas)}×`} />
                        <div className="mt-1 text-[10px] text-ink-3">Click to open campaign</div>
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
                    onClick={(d: { campaign?: string }) => {
                      if (d?.campaign) {
                        router.push(`/campaigns/${encodeURIComponent(d.campaign)}`);
                      }
                    }}
                    className="cursor-pointer"
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

function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-ink-2">
      <span>{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}
