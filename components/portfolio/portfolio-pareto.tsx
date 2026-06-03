"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { int } from "@/lib/format";
import type { PortfolioCampaignRow } from "@/db/queries/portfolio";

/**
 * Pareto / concentration: how few campaigns produce most of the orders.
 * Bars = orders per campaign (top 20), line = cumulative share. The callout
 * states the top-5 concentration outright.
 */
export function PortfolioPareto({ rows }: { rows: PortfolioCampaignRow[] }) {
  const { data, totalOrders, top5Share, nCampaigns } = useMemo(() => {
    const ranked = rows
      .filter((r) => r.orders > 0)
      .sort((a, b) => b.orders - a.orders);
    const total = ranked.reduce((s, r) => s + r.orders, 0);
    let cum = 0;
    const pts = ranked.slice(0, 20).map((r, i) => {
      cum += r.orders;
      return {
        name: r.campaign,
        short: `#${i + 1}`,
        orders: r.orders,
        cumulative: total > 0 ? (cum / total) * 100 : 0,
      };
    });
    const top5 =
      total > 0
        ? (ranked.slice(0, 5).reduce((s, r) => s + r.orders, 0) / total) * 100
        : 0;
    return { data: pts, totalOrders: total, top5Share: top5, nCampaigns: ranked.length };
  }, [rows]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Concentration</h3>
          <p className="text-[10px] text-ink-3">
            How concentrated orders are across campaigns
          </p>
        </div>
        {nCampaigns > 0 && (
          <div className="text-xs text-ink-2">
            Top 5 ={" "}
            <span className="text-ink font-medium tabular-nums">
              {top5Share.toFixed(0)}%
            </span>{" "}
            of orders · {nCampaigns} campaigns
          </div>
        )}
      </div>

      {totalOrders === 0 ? (
        <div className="h-56 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No orders in this window.
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="short"
                tick={{ fill: "var(--ink-3)", fontSize: 9 }}
                stroke="var(--line-2)"
                interval={0}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "var(--ink-3)", fontSize: 10 }}
                stroke="var(--line-2)"
                width={40}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: "var(--ink-3)", fontSize: 10 }}
                stroke="var(--line-2)"
                width={40}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0]?.payload as {
                    name: string;
                    orders: number;
                    cumulative: number;
                  };
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-lg shadow-black/30 text-xs max-w-xs">
                      <div className="text-ink font-medium mb-1 truncate">{p.name}</div>
                      <div className="flex justify-between gap-4 text-ink-2">
                        <span>Orders</span>
                        <span className="tabular-nums text-ink">{int(p.orders)}</span>
                      </div>
                      <div className="flex justify-between gap-4 text-ink-2">
                        <span>Cumulative</span>
                        <span className="tabular-nums text-ink">{p.cumulative.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="left" dataKey="orders" fill="var(--brand)" fillOpacity={0.6} radius={[2, 2, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke="#fbbf24"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
