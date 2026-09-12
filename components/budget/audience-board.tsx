"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { History, Plus } from "lucide-react";
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
import type { TooltipProps } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartHeader, ChartShell, ExpandButton } from "@/components/charts/chart-shell";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { MetricPicker } from "@/components/charts/metric-picker";
import { SeriesLegend } from "@/components/charts/series-legend";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, intCompact, monthDay, usd, usdCompact } from "@/lib/format";
import { isoDaysBetween } from "@/lib/budget";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGES,
  STAGE_SHORT,
  asOfLabel,
  audienceKey,
  averageKnownSize,
  carryForwardSeries,
  isFunnelStage,
  isStale,
  pressure,
  stageLabel,
  stalenessDays,
  type AudienceDay,
  type AudienceSnapshot,
  type FunnelStage,
} from "@/lib/audience";
import { HorizonNote, platformLabel } from "@/components/budget/budget-shared";
import { AudienceRecordDialog } from "@/components/budget/audience-record-dialog";
import { AudienceCorrections } from "@/components/budget/audience-corrections";
import type {
  AudienceCorrectionRow,
  AudienceSeries,
  AudienceSnapshotRow,
} from "@/db/queries/audience";
import type { BudgetPacingDaySpend } from "@/db/queries/budget";

/** How many trailing days the glance matrix's pressure reads. */
const GLANCE_WINDOW = 7;

interface PairStats {
  platform: (typeof ALL_PLATFORMS)[number];
  stage: FunnelStage;
  days: AudienceDay[];
  avgSize: number | null;
  knownDays: number;
  spend: number;
  pressure: number | null;
  snapshots: number;
  lastMeasured: string | null;
  lastAge: number | null;
}

/**
 * The Audience surface: a glance matrix of the latest sizes, a trend chart per
 * stage, a comparison table, and the two dialogs that write (record and
 * correct).
 *
 * Everything reads off ONE carried-forward series per (platform, stage) and one
 * spend map — both built here, so the matrix, the chart and the table can never
 * disagree about what a number means.
 */
export function AudienceBoard({
  from,
  to,
  today,
  stage: stageParam,
  audience,
  latest,
  recent,
  spend,
  horizon,
  canManage,
}: {
  from: string;
  to: string;
  today: string;
  stage?: string;
  audience: AudienceSeries;
  latest: AudienceSnapshotRow[];
  recent: AudienceCorrectionRow[];
  spend: BudgetPacingDaySpend[];
  horizon: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const [recordOpen, setRecordOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const stage: FunnelStage =
    stageParam && isFunnelStage(stageParam) ? stageParam : FUNNEL_STAGES[0];

  const setParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("stage", stage);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    startNav(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };
  const setRange = (nextFrom: string | null, nextTo: string | null) => {
    if (!nextFrom || !nextTo) return; // an unbounded range has nothing to compare
    setParams({ from: nextFrom, to: nextTo });
  };

  // Nothing is measured in the future, and ad data stops at its own horizon —
  // so the audience window ends today at the latest, and the SPEND window ends
  // at the horizon. Days past either are unknown, never zero.
  const windowEnd = to < today ? to : today;
  const spendEnd = horizon && horizon < windowEnd ? horizon : windowEnd;
  const days = useMemo(
    () => (windowEnd < from ? [] : isoDaysBetween(from, windowEnd)),
    [from, windowEnd],
  );

  /** Per (platform, stage): the carried-forward size for every day in view. */
  const seriesByPair = useMemo(() => {
    const snaps = new Map<string, AudienceSnapshot[]>();
    for (const row of [...audience.seed, ...audience.inRange]) {
      const key = audienceKey(row.platform, row.stage);
      const list = snaps.get(key);
      if (list) list.push({ date: row.date, size: row.size });
      else snaps.set(key, [{ date: row.date, size: row.size }]);
    }
    const out = new Map<string, AudienceDay[]>();
    for (const platform of ALL_PLATFORMS) {
      for (const funnelStage of FUNNEL_STAGES) {
        const key = audienceKey(platform, funnelStage);
        out.set(key, carryForwardSeries(from, windowEnd, snaps.get(key) ?? []));
      }
    }
    return out;
  }, [audience, from, windowEnd]);

  /** Per (platform, stage): spend per day, known days only. */
  const spendByPair = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const row of spend) {
      if (!isFunnelStage(row.objective) || row.date > spendEnd) continue;
      const key = audienceKey(row.platform, row.objective);
      const byDate = out.get(key) ?? new Map<string, number>();
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.spend);
      out.set(key, byDate);
    }
    return out;
  }, [spend, spendEnd]);

  /** Pressure over the last `window` days of the view for one pair. */
  const pressureOver = (platform: string, funnelStage: FunnelStage, window?: number) => {
    const key = audienceKey(platform, funnelStage);
    const all = (seriesByPair.get(key) ?? []).filter((d) => d.date <= spendEnd);
    const slice = window ? all.slice(-window) : all;
    const byDate = spendByPair.get(key);
    return pressure(slice.map((d) => ({ size: d.size, spend: byDate?.get(d.date) ?? 0 })));
  };

  const rows: PairStats[] = useMemo(() => {
    const out: PairStats[] = [];
    for (const funnelStage of FUNNEL_STAGES) {
      for (const platform of ALL_PLATFORMS) {
        const key = audienceKey(platform, funnelStage);
        const pairDays = seriesByPair.get(key) ?? [];
        const byDate = spendByPair.get(key);
        const spendDays = pairDays.filter((d) => d.date <= spendEnd);
        const last = pairDays.at(-1) ?? null;
        out.push({
          platform,
          stage: funnelStage,
          days: pairDays,
          avgSize: averageKnownSize(pairDays),
          knownDays: pairDays.reduce((n, d) => n + (d.size === null ? 0 : 1), 0),
          spend: spendDays.reduce((s, d) => s + (byDate?.get(d.date) ?? 0), 0),
          pressure: pressure(
            spendDays.map((d) => ({ size: d.size, spend: byDate?.get(d.date) ?? 0 })),
          ),
          snapshots: audience.inRange.filter(
            (r) => r.platform === platform && r.stage === funnelStage,
          ).length,
          lastMeasured: last?.asOf ?? null,
          lastAge: last?.asOf ? stalenessDays(last.asOf, today) : null,
        });
      }
    }
    return out;
  }, [seriesByPair, spendByPair, audience, spendEnd, today]);

  // ── Chart ─────────────────────────────────────────────────────────────────
  const seriesDefs = ALL_PLATFORMS.map((p) => ({
    key: p,
    label: PLATFORM_LABEL[p],
    color: PLATFORM_COLOR[p],
  }));
  const shown = new Set(seriesDefs.map((d) => d.key).filter((k) => !hidden.has(k)));
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chartData = useMemo(
    () =>
      days.map((date) => {
        const point: Record<string, string | number | null> = {
          label: monthDay(date),
          date,
        };
        let stageSpend = 0;
        for (const platform of ALL_PLATFORMS) {
          const key = audienceKey(platform, stage);
          const day = (seriesByPair.get(key) ?? []).find((d) => d.date === date);
          point[platform] = day?.size ?? null;
          stageSpend += spendByPair.get(key)?.get(date) ?? 0;
        }
        // Past the ad-data horizon spend is unknown, so the bar stops rather
        // than dropping to zero.
        point.spend = date <= spendEnd ? stageSpend : null;
        return point;
      }),
    [days, seriesByPair, spendByPair, stage, spendEnd],
  );

  const hasAnySnapshot = latest.length > 0;

  // ── Comparison table ──────────────────────────────────────────────────────
  const columns: DataColumn<PairStats>[] = [
    {
      key: "stage",
      label: "Stage",
      pinned: true,
      sortable: true,
      render: (r) => (
        <span className="text-ink">
          {r.stage} <span className="text-[11px] text-ink-3">{STAGE_SHORT[r.stage]}</span>
        </span>
      ),
      sortValue: (r) => FUNNEL_STAGES.indexOf(r.stage),
      csv: (r) => stageLabel(r.stage),
      defaultSortDir: "asc",
    },
    {
      key: "platform",
      label: "Platform",
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <PlatformDot platform={r.platform} size="sm" />
          {platformLabel(r.platform)}
        </span>
      ),
      sortValue: (r) => platformLabel(r.platform),
      csv: (r) => platformLabel(r.platform),
      defaultSortDir: "asc",
    },
    {
      key: "avgSize",
      label: "Avg audience",
      align: "right",
      sortable: true,
      render: (r) => (
        <span className="num">{r.avgSize === null ? "—" : int(r.avgSize)}</span>
      ),
      sortValue: (r) => r.avgSize,
      csv: (r) => r.avgSize,
    },
    {
      key: "knownDays",
      label: "Days known",
      align: "right",
      sortable: true,
      render: (r) => (
        <span className="num text-ink-2">
          {r.knownDays} <span className="text-ink-3">of {days.length}</span>
        </span>
      ),
      sortValue: (r) => r.knownDays,
      csv: (r) => r.knownDays,
    },
    {
      key: "spend",
      label: "Spend",
      align: "right",
      sortable: true,
      render: (r) => <span className="num">{usd(r.spend)}</span>,
      sortValue: (r) => r.spend,
      csv: (r) => r.spend.toFixed(2),
      total: () => (
        <span className="num">{usd(rows.reduce((s, r) => s + r.spend, 0))}</span>
      ),
    },
    {
      key: "pressure",
      label: "Pressure ($/1k)",
      align: "right",
      sortable: true,
      render: (r) => (
        <span className="num">{r.pressure === null ? "—" : usd(r.pressure)}</span>
      ),
      sortValue: (r) => r.pressure,
      csv: (r) => r.pressure?.toFixed(2) ?? "",
    },
    {
      key: "snapshots",
      label: "Measurements",
      align: "right",
      sortable: true,
      render: (r) => <span className="num text-ink-2">{r.snapshots}</span>,
      sortValue: (r) => r.snapshots,
      csv: (r) => r.snapshots,
      total: () => (
        <span className="num">{rows.reduce((s, r) => s + r.snapshots, 0)}</span>
      ),
    },
    {
      key: "lastMeasured",
      label: "Last measured",
      align: "right",
      sortable: true,
      render: (r) =>
        r.lastMeasured === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <span
            className={cn("num text-xs", isStale(r.lastAge) ? "text-warn" : "text-ink-2")}
          >
            {r.lastMeasured}
            <span className="ml-1 text-ink-3">{r.lastAge}d</span>
          </span>
        ),
      sortValue: (r) => r.lastMeasured,
      csv: (r) => r.lastMeasured ?? "",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <DateRangePicker from={from} to={to} onChange={setRange} hidePresets={["lifetime"]} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCorrectionsOpen(true)}
          >
            <History className="h-3.5 w-3.5" />
            Recent
          </Button>
          {canManage && (
            <Button type="button" size="sm" onClick={() => setRecordOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Record sizes
            </Button>
          )}
        </div>
      </div>

      {!hasAnySnapshot ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h3 className="text-sm font-medium text-ink">No audience sizes yet</h3>
          <p className="mx-auto mt-1 max-w-prose text-xs text-ink-3">
            Record how many people each funnel audience holds — Awareness,
            Activation and Retargeting, per platform — whenever you measure it,
            daily or weekly. Each number carries forward with its age until the
            next measurement, so you can see spend per 1,000 people without
            pretending you measured a day you didn&rsquo;t.
          </p>
          {canManage ? (
            <Button type="button" size="sm" className="mt-4" onClick={() => setRecordOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Record sizes
            </Button>
          ) : (
            <p className="mt-4 text-[11px] text-ink-3">
              Recording sizes needs the audience permission.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Glance matrix */}
          <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-ink">Latest sizes</h3>
              <p className="text-[11px] text-ink-3">
                Each cell: the last measurement and its age, then pressure over the
                last {GLANCE_WINDOW} days of the range. Amber = measured more than a
                week ago.
              </p>
            </div>
            {/* The matrix shape is the mental model, so on a phone it scrolls
                sideways with the stage column pinned rather than reflowing. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[40rem] border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-surface py-1 pr-3 text-left text-label text-ink-3">
                      Stage
                    </th>
                    {ALL_PLATFORMS.map((p) => (
                      <th
                        key={p}
                        className="border-l border-line px-3 py-1 text-left text-label text-ink-3"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformDot platform={p} size="sm" />
                          {PLATFORM_LABEL[p]}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FUNNEL_STAGES.map((funnelStage) => (
                    <tr key={funnelStage} className="border-t border-line">
                      <th className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left text-sm font-medium text-ink">
                        {funnelStage}{" "}
                        <span className="text-[11px] font-normal text-ink-3">
                          {STAGE_SHORT[funnelStage]}
                        </span>
                      </th>
                      {ALL_PLATFORMS.map((platform) => {
                        const known =
                          latest.find(
                            (r) => r.platform === platform && r.stage === funnelStage,
                          ) ?? null;
                        const age = known ? stalenessDays(known.date, today) : null;
                        const press = pressureOver(platform, funnelStage, GLANCE_WINDOW);
                        return (
                          <td
                            key={platform}
                            className="border-l border-t border-line px-3 py-2 align-top"
                          >
                            <div className="num text-sm text-ink">
                              {known ? intCompact(known.size) : "—"}
                            </div>
                            {/* The micro-label token is uppercase and tracked,
                                so the cell carries the short form and hover
                                carries the sentence. */}
                            <div
                              className={cn(
                                "text-label",
                                isStale(age) ? "text-warn" : "text-ink-3",
                              )}
                              title={known ? asOfLabel(known.date, age) : "Never measured"}
                            >
                              {known ? `${monthDay(known.date)} · ${age}d` : "never measured"}
                            </div>
                            <div className="num mt-1 text-[11px] text-ink-2">
                              {press === null ? "—" : `${usd(press)} / 1k`}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Trend */}
          <ChartShell
            ariaLabel="Audience size over time — expanded"
            legend={
              <div className="space-y-1">
                <SeriesLegend
                  items={seriesDefs}
                  shown={shown}
                  onToggle={toggleSeries}
                  onShowAll={() => setHidden(new Set())}
                />
                <p className="text-[11px] text-ink-3">
                  Each line steps on the day it was measured and holds until the next
                  one — the flat stretches are days nobody measured, not days nothing
                  changed.
                </p>
              </div>
            }
          >
            {({ inFull, toggleExpand }) => (
              <div className={inFull ? "flex flex-col h-full" : undefined}>
                <ChartHeader
                  title={`${stageLabel(stage)} audience`}
                  picker={
                    <MetricPicker<FunnelStage>
                      options={FUNNEL_STAGES.map((s) => ({
                        value: s,
                        label: `${s} · ${STAGE_SHORT[s]}`,
                      }))}
                      value={stage}
                      onChange={(s) => setParams({ stage: s })}
                    />
                  }
                  controls={
                    <>
                      <SegmentedControl<string>
                        ariaLabel="Spend overlay"
                        value={overlay ? "on" : "off"}
                        onChange={(v) => setOverlay(v === "on")}
                        options={[
                          { value: "off", label: "Audience" },
                          { value: "on", label: "+ spend" },
                        ]}
                      />
                      <ExpandButton inFull={inFull} onClick={toggleExpand} />
                    </>
                  }
                />
                <div className={inFull ? "flex-1 min-h-0" : "h-64"}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                        stroke="var(--line-2)"
                        tickMargin={6}
                        interval="preserveStartEnd"
                        minTickGap={16}
                      />
                      <YAxis
                        yAxisId="size"
                        tickFormatter={(v: number) => intCompact(v)}
                        tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                        stroke="var(--line-2)"
                        width={56}
                      />
                      {/* Spend rides its own axis: the two quantities share no
                          unit, and forcing them onto one hides whichever is
                          smaller. */}
                      {overlay && (
                        <YAxis
                          yAxisId="spend"
                          orientation="right"
                          tickFormatter={(v: number) => usdCompact(v)}
                          tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                          stroke="var(--line-2)"
                          width={56}
                        />
                      )}
                      <Tooltip
                        content={(p: TooltipProps<number, string>) => {
                          if (!p.active || !p.payload?.length) return null;
                          return (
                            <ChartTooltip>
                              <div className="font-medium text-ink mb-1">{p.label}</div>
                              {p.payload.map((entry) => {
                                const key = String(entry.dataKey);
                                const def = seriesDefs.find((s) => s.key === key);
                                return (
                                  <div key={key} className="flex items-center gap-2">
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ background: entry.color }}
                                    />
                                    <span className="text-ink-3">
                                      {def?.label ?? "Stage spend"}
                                    </span>
                                    <span className="num tabular-nums text-ink ml-auto">
                                      {typeof entry.value !== "number"
                                        ? "—"
                                        : key === "spend"
                                          ? usd(entry.value)
                                          : int(entry.value)}
                                    </span>
                                  </div>
                                );
                              })}
                            </ChartTooltip>
                          );
                        }}
                      />
                      {overlay && (
                        <Bar
                          yAxisId="spend"
                          dataKey="spend"
                          fill="var(--ink-3)"
                          fillOpacity={0.25}
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={false}
                        />
                      )}
                      {seriesDefs
                        .filter((def) => shown.has(def.key))
                        .map((def) => (
                          <Line
                            key={def.key}
                            yAxisId="size"
                            // A step, never a ramp: the size held until it was
                            // measured again.
                            type="stepAfter"
                            dataKey={def.key}
                            stroke={def.color}
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                            connectNulls={false}
                            isAnimationActive={false}
                          />
                        ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </ChartShell>

          {/* Comparison */}
          <DataTable<PairStats>
            columns={columns}
            rows={rows}
            rowKey={(r) => audienceKey(r.platform, r.stage)}
            showTotals={rows.length > 0}
            minWidthClass="min-w-[860px]"
            csvFileName={`audience-${from}-to-${to}`}
            rowClassName={(r) => cn(r.knownDays === 0 && "opacity-60")}
          />

          <HorizonNote horizon={horizon} />
        </>
      )}

      <AudienceRecordDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        latest={latest}
        today={today}
      />
      <AudienceCorrections
        open={correctionsOpen}
        onOpenChange={setCorrectionsOpen}
        rows={recent}
        canManage={canManage}
      />
    </div>
  );
}
