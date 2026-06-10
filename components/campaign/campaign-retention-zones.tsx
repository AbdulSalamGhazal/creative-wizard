"use client";

import {
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RetentionStage } from "@/db/queries/campaign";

const fmt = (v: number) => `${Math.round(v)}%`;

/**
 * Video retention curve with interpretive root-cause zones (static — no new
 * math): hook (2s→25%), pacing (25%→75%), offer (75%→100%). A steep drop in a
 * zone points at that failure mode.
 */
export function CampaignRetentionZones({ data }: { data: RetentionStage[] }) {
  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}>
          <ReferenceArea
            x1="2s view"
            x2="25%"
            fill="var(--neg)"
            fillOpacity={0.07}
            label={{ value: "hook", position: "insideTop", fill: "var(--ink-3)", fontSize: 10 }}
          />
          <ReferenceArea
            x1="25%"
            x2="75%"
            fill="var(--warn)"
            fillOpacity={0.07}
            label={{ value: "pacing", position: "insideTop", fill: "var(--ink-3)", fontSize: 10 }}
          />
          <ReferenceArea
            x1="75%"
            x2="100%"
            fill="var(--pos)"
            fillOpacity={0.07}
            label={{ value: "offer", position: "insideTop", fill: "var(--ink-3)", fontSize: 10 }}
          />
          <XAxis
            dataKey="stage"
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            tickMargin={6}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={fmt}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            width={44}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-2)" }}
            formatter={(v: number) => [fmt(v), "retained"]}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--ink-2)" }}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke="var(--brand)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--brand)" }}
            activeDot={{ r: 5 }}
            isAnimationActive
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
