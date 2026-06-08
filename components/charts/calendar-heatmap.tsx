"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { int, ratio, usd } from "@/lib/format";
import type { DailyTotalsRow } from "@/db/queries/performance";

type MetricKey = "spend" | "revenue" | "conversions" | "roas";

interface MetricDef {
  value: MetricKey;
  label: string;
  /** Diverging (ROAS, good-vs-bad) vs sequential (more = darker). */
  diverging: boolean;
  pick: (r: DailyTotalsRow) => number | null;
  fmt: (v: number | null) => string;
}

const METRICS: MetricDef[] = [
  { value: "spend", label: "Spend", diverging: false, pick: (r) => r.spend, fmt: usd },
  {
    value: "revenue",
    label: "Revenue",
    diverging: false,
    pick: (r) => r.conversionValue,
    fmt: usd,
  },
  {
    value: "conversions",
    label: "Conversions",
    diverging: false,
    pick: (r) => r.conversions,
    fmt: int,
  },
  {
    value: "roas",
    label: "ROAS",
    diverging: true,
    pick: (r) => (r.spend > 0 ? r.conversionValue / r.spend : null),
    fmt: (v) => (v === null ? "—" : `${ratio(v)}×`),
  },
];

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Sun-first rows; only label alternating days to avoid crowding.
const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

// Sequential intensity (var(--brand) at increasing opacity) for levels 1–4.
const SEQ_OP = [0, 0.3, 0.52, 0.74, 1] as const;

function parseUTC(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}
function isoOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}
const dowOf = (ms: number) => new Date(ms).getUTCDay();

interface Cell {
  /** null = filler cell outside the date range (keeps the grid aligned). */
  bg: string | null;
  op: number;
  title: string;
}

/**
 * GitHub-style calendar heatmap: one cell per day (weekday rows × week columns),
 * colored by the selected metric. Sequential metrics (Spend/Revenue/Conversions)
 * shade from light to brand by quantile; ROAS is diverging (red < 1× → green ≥
 * 1×) on absolute thresholds. Days with no spend render as empty cells, so gaps
 * in spending (dark periods) are visible at a glance. Respects all dashboard
 * filters via the upstream query. A native title tooltip shows the day's value.
 */
export function CalendarHeatmap({
  days,
  from,
  to,
}: {
  days: DailyTotalsRow[];
  from?: string;
  to?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const def = METRICS.find((m) => m.value === metric) ?? METRICS[0]!;

  const grid = useMemo(() => {
    if (days.length === 0 && !(from && to)) {
      return { weeks: [] as Cell[][], months: [] as string[], hasData: false };
    }

    const byDate = new Map(days.map((d) => [d.date, d]));
    const dates = days.map((d) => d.date).sort();
    const startStr = from ?? dates[0]!;
    const endStr = to ?? dates[dates.length - 1]!;
    const startMs = parseUTC(startStr);
    const endMs = parseUTC(endStr);

    // In-range positive values → quantile thresholds for sequential shading.
    const positives: number[] = [];
    for (const d of days) {
      const ms = parseUTC(d.date);
      if (ms < startMs || ms > endMs) continue;
      const v = def.pick(d);
      if (v !== null && v > 0) positives.push(v);
    }
    positives.sort((a, b) => a - b);
    const q = (p: number) =>
      positives.length ? positives[Math.min(positives.length - 1, Math.floor(p * positives.length))]! : 0;
    const thresholds = [q(0.25), q(0.5), q(0.75)];

    const seqStyle = (v: number): { bg: string; op: number } => {
      if (v <= 0) return { bg: "var(--surface-2)", op: 1 };
      const level = 1 + thresholds.filter((t) => v >= t).length; // 1..4
      return { bg: "var(--brand)", op: SEQ_OP[level] ?? 1 };
    };
    const divStyle = (v: number): { bg: string; op: number } => {
      // ROAS has absolute meaning, so fixed thresholds around break-even (1×).
      if (v < 0.5) return { bg: "var(--neg)", op: 1 };
      if (v < 1) return { bg: "var(--neg)", op: 0.5 };
      if (v < 2) return { bg: "var(--pos)", op: 0.5 };
      if (v < 4) return { bg: "var(--pos)", op: 0.78 };
      return { bg: "var(--pos)", op: 1 };
    };

    // Align the grid to whole weeks (Sun → Sat) spanning the range.
    const gridStart = startMs - dowOf(startMs) * DAY_MS;
    const gridEnd = endMs + (6 - dowOf(endMs)) * DAY_MS;
    const weekCount = Math.round((gridEnd - gridStart) / (7 * DAY_MS)) + 1;

    const weeks: Cell[][] = [];
    const months: string[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weekCount; w++) {
      const col: Cell[] = [];
      for (let r = 0; r < 7; r++) {
        const ms = gridStart + (w * 7 + r) * DAY_MS;
        if (ms < startMs || ms > endMs) {
          col.push({ bg: null, op: 0, title: "" });
          continue;
        }
        const iso = isoOf(ms);
        const row = byDate.get(iso);
        const v = row ? def.pick(row) : def.diverging ? null : 0;
        let style: { bg: string; op: number };
        if (v === null) style = { bg: "var(--surface-2)", op: 1 };
        else style = def.diverging ? divStyle(v) : seqStyle(v);
        const valText = v === null ? "no spend" : `${def.label}: ${def.fmt(v)}`;
        col.push({ bg: style.bg, op: style.op, title: `${iso} · ${valText}` });
      }
      weeks.push(col);
      // Month label at the column where the month changes.
      const colMonth = new Date(gridStart + w * 7 * DAY_MS).getUTCMonth();
      if (colMonth !== lastMonth) {
        months.push(MONTHS[colMonth]!);
        lastMonth = colMonth;
      } else {
        months.push("");
      }
    }
    return { weeks, months, hasData: positives.length > 0 || days.length > 0 };
  }, [days, from, to, def]);

  return (
    <Card className="bg-surface border-line h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Activity calendar</CardTitle>
        <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
          <SelectTrigger className="h-7 w-[130px] text-xs font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METRICS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-sm">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center">
        {!grid.hasData ? (
          <div className="h-40 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-md">
            No data in the selected window.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto pb-1">
              <div className="inline-flex flex-col gap-[2px]">
                {/* Month labels, offset past the weekday-label column. */}
                <div className="flex gap-[3px] pl-[22px] text-[9px] text-ink-3 leading-none">
                  {grid.months.map((m, i) => (
                    <span
                      key={i}
                      className="w-3 overflow-visible whitespace-nowrap"
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <div className="flex gap-[3px]">
                  {/* Weekday labels */}
                  <div className="flex flex-col gap-[3px] w-[19px] text-[9px] text-ink-3">
                    {WEEKDAY_LABELS.map((l, i) => (
                      <span key={i} className="h-3 leading-3 text-right pr-1">
                        {l}
                      </span>
                    ))}
                  </div>
                  {/* Week columns */}
                  {grid.weeks.map((col, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                      {col.map((cell, ri) =>
                        cell.bg === null ? (
                          <span key={ri} className="h-3 w-3" />
                        ) : (
                          <span
                            key={ri}
                            className="h-3 w-3 rounded-[2px]"
                            style={{ backgroundColor: cell.bg, opacity: cell.op }}
                            title={cell.title}
                          />
                        ),
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Legend diverging={def.diverging} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Legend({ diverging }: { diverging: boolean }) {
  if (diverging) {
    const steps: Array<{ bg: string; op: number }> = [
      { bg: "var(--neg)", op: 1 },
      { bg: "var(--neg)", op: 0.5 },
      { bg: "var(--pos)", op: 0.5 },
      { bg: "var(--pos)", op: 0.78 },
      { bg: "var(--pos)", op: 1 },
    ];
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
        <span>&lt;1×</span>
        {steps.map((s, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: s.bg, opacity: s.op }}
          />
        ))}
        <span>≥4×</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
      <span>Less</span>
      <span
        className="h-2.5 w-2.5 rounded-[2px]"
        style={{ backgroundColor: "var(--surface-2)" }}
      />
      {SEQ_OP.slice(1).map((op, i) => (
        <span
          key={i}
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: "var(--brand)", opacity: op }}
        />
      ))}
      <span>More</span>
    </div>
  );
}
