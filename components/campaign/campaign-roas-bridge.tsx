"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ratio } from "@/lib/format";
import type { BridgeResult } from "@/lib/decomposition";

interface WaterfallBar {
  name: string;
  base: number;
  val: number;
  fill: string;
  display: number;
  signed: boolean;
}

/**
 * Mix-vs-Rate waterfall: ROAS-A → Mix → Rate → ROAS-B. The floating Mix/Rate
 * bars are a transparent base series + a value series; green when they lift
 * ROAS, red when they drag it. (Chart only — the plain-language "read" is
 * rendered by the server section.)
 */
export function CampaignRoasBridge({ data }: { data: BridgeResult }) {
  const { roasA, roasB, mix, rate } = data;
  const afterMix = roasA + mix;

  const bars: WaterfallBar[] = [
    { name: "Prior", base: 0, val: roasA, fill: "var(--ink-3)", display: roasA, signed: false },
    {
      name: "Mix",
      base: Math.min(roasA, afterMix),
      val: Math.abs(mix),
      fill: mix >= 0 ? "var(--pos)" : "var(--neg)",
      display: mix,
      signed: true,
    },
    {
      name: "Rate",
      base: Math.min(afterMix, roasB),
      val: Math.abs(rate),
      fill: rate >= 0 ? "var(--pos)" : "var(--neg)",
      display: rate,
      signed: true,
    },
    { name: "Now", base: 0, val: roasB, fill: "var(--brand)", display: roasB, signed: false },
  ];

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            tickMargin={6}
          />
          <YAxis
            tickFormatter={(v: number) => `${ratio(v)}×`}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            stroke="var(--line-2)"
            width={48}
          />
          <Tooltip cursor={{ fill: "var(--surface-2)", opacity: 0.5 }} content={<BridgeTooltip />} />
          <Bar dataKey="base" stackId="a" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="val" stackId="a" radius={[3, 3, 0, 0]} isAnimationActive>
            {bars.map((b) => (
              <Cell key={b.name} fill={b.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BridgeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: WaterfallBar }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const b = payload[payload.length - 1]!.payload;
  const sign = b.signed && b.display >= 0 ? "+" : "";
  return (
    <div className="rounded-md border border-line bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <div className="text-ink-2">{b.name}</div>
      <div className="text-ink num font-semibold">
        {sign}
        {ratio(b.display)}×
      </div>
    </div>
  );
}
