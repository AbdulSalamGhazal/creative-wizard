"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformDot } from "@/components/ui/platform-dot";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { Sparkline } from "@/components/charts/sparkline";
import { signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  MUTED_TONE,
  clipThrough,
  daysLeftAfter,
  groupTrackerByObjective,
  monthLabel,
  neededPerDay,
  pacingTone,
  rangeProjection,
  type PlatformCoverage,
  type RangeBar,
  type RangePlatform,
  type TrackerBar,
  type TrackerCounts,
} from "@/lib/budget";
import type { PacingBoard as BoardMode, PacingGroup, PacingRank } from "@/validators/budget";
import {
  AHEAD_STRONG,
  Amounts,
  BEHIND_STRONG,
  PaceBar,
  ReserveAmounts,
  ReserveVerdict,
  Verdict,
  anchorWords,
  platformLabel,
  toneText,
} from "@/components/budget/budget-shared";

/**
 * The Pacing BOARD (2026-10-19, user decision — the Tracker merged into
 * Pacing): one row per platform in scope for the RANGE, biggest plan first,
 * each with its stage rows beneath, in the Overview's grid grammar — label ·
 * bar · sparkline · figures, every bar starting at one x and every figure
 * right-aligned in one fixed column at both levels. Richer than the
 * Overview's board by two readings: the range's daily actual against its
 * daily plan (the sparkline), and what each remaining day needs to land on
 * the plan. Every number is `buildRangeBoard`'s — the same per-day maps the
 * chart and the period table are summed from; nothing here re-derives pacing.
 *
 * Two readings of the same rows (`board`): the bars, or a table for sorting
 * and export (platform → buckets, or objective → platforms, the allocation
 * check). "Show, don't label": the header is the title and the triage chips;
 * the row words live in aria-labels and titles.
 */
export function PacingBoard({
  from,
  to,
  title,
  rows,
  totalRows,
  counts,
  coverage,
  board,
  rank,
  group,
  offPace,
  onBoard,
  onRank,
  onGroup,
  onBehind,
  reserve,
  fmt,
  currency,
  planMonth,
  canManage,
}: {
  from: string;
  to: string;
  /** "Sep 1 – Sep 30" — the range card's title, for the empty state's words. */
  title: string;
  /** Filtered and ordered — the rows to draw. */
  rows: readonly RangePlatform[];
  /** How many platforms the range has before the tier-2 filters. */
  totalRows: number;
  counts: TrackerCounts;
  coverage: PlatformCoverage;
  board: BoardMode;
  rank: PacingRank;
  group: PacingGroup;
  offPace: boolean;
  onBoard: (v: BoardMode) => void;
  onRank: (v: PacingRank) => void;
  onGroup: (v: PacingGroup) => void;
  onBehind: () => void;
  /**
   * The reserve row: a month's figure (`month`) when the range sits inside
   * one planned month, otherwise `none` — a dash with the reason on hover.
   */
  reserve: { kind: "month"; used: number; reserve: number } | { kind: "none" };
  /** Whole dollars — a reading, never a fact (the shared `whole` formatter). */
  fmt: (v: number) => string;
  currency: string;
  /** The single month the range sits in, for the empty state's Plan link. */
  planMonth: string | null;
  canManage: boolean;
}) {
  const hidden = totalRows - rows.length;
  const grid =
    "grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_6.5rem_11rem] sm:items-center";

  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-sm font-medium text-ink">Pace board</h2>
          {totalRows > 0 && (
            <SummaryStrip counts={counts} offPace={offPace} onBehind={onBehind} />
          )}
          {hidden > 0 && (
            <span
              className="num tabular-nums text-[11px] text-ink-3"
              title="A filter is hiding rows — the range card above is the whole range"
            >
              {rows.length} of {totalRows} platforms
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {board === "bars" ? (
            <SegmentedControl<PacingRank>
              ariaLabel="Row order"
              value={rank}
              onChange={onRank}
              options={[
                { value: "plan", label: "By plan size" },
                { value: "offpace", label: "Most off-pace" },
              ]}
            />
          ) : (
            <SegmentedControl<PacingGroup>
              ariaLabel="Group rows by"
              value={group}
              onChange={onGroup}
              options={[
                { value: "platform", label: "By platform" },
                { value: "objective", label: "By objective" },
              ]}
            />
          )}
          <SegmentedControl<BoardMode>
            ariaLabel="Board view"
            value={board}
            onChange={onBoard}
            options={[
              { value: "bars", label: "Board" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>
      </header>

      {totalRows === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-ink-2">Nothing planned or spent for {title}.</p>
          {planMonth && canManage && (
            <Button asChild size="sm" variant="outline" className="mt-3">
              <Link href={`/budget/plan?month=${planMonth}`}>Plan {monthLabel(planMonth)}</Link>
            </Button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-3">
          Nothing matches these filters — clear one to see the board again.
        </p>
      ) : board === "table" ? (
        <div className="p-3">
          <BoardTable
            rows={rows}
            group={group}
            from={from}
            to={to}
            coverage={coverage}
            fmt={fmt}
            currency={currency}
          />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((p) => (
            <li key={p.key} className="px-4 py-3">
              <div className={grid}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-ink-2">
                    <PlatformDot platform={p.key as never} size="sm" />
                    <span className="truncate">{platformLabel(p.key)}</span>
                  </span>
                  <span className="sm:hidden">
                    <Verdict bar={p} fmt={fmt} />
                  </span>
                </div>
                <div>
                  {p.plan > 0 ? (
                    <>
                      <PaceBar
                        bar={p}
                        fmt={fmt}
                        name={platformLabel(p.key)}
                        anchor={anchorWords(p.through)}
                        projection={p.projection}
                      />
                      <Amounts bar={p} fmt={fmt} className="sm:hidden" />
                      <Needed row={p} from={from} to={to} fmt={fmt} className="sm:hidden" />
                    </>
                  ) : (
                    // No plan → no track to draw against; the amount carries it.
                    <p
                      className="text-[11px] text-ink-3"
                      title="No plan for this platform in the range — its spend draws on the reserve"
                    >
                      <span className="num tabular-nums text-ink">{fmt(p.actual)}</span> spent ·
                      no plan
                    </p>
                  )}
                </div>
                <div className="hidden sm:block">{p.plan > 0 && <DailySpark row={p} />}</div>
                <div className="hidden text-right sm:block">
                  <Verdict bar={p} fmt={fmt} />
                  {p.plan > 0 && (
                    <>
                      <Amounts bar={p} fmt={fmt} className="mt-0.5" />
                      <Needed row={p} from={from} to={to} fmt={fmt} />
                    </>
                  )}
                </div>
              </div>
              {p.buckets.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {p.buckets.map((b) => (
                    <li key={b.key} className={grid}>
                      {/* Only the LABEL indents, so the bucket's track lines up
                          under its platform's and the eye compares the two. */}
                      <div className="flex items-center justify-between gap-2 pl-5">
                        <span className="truncate text-xs text-ink-3">{b.label}</span>
                        <span className="sm:hidden">
                          <Verdict bar={b} fmt={fmt} small />
                        </span>
                      </div>
                      <div>
                        <PaceBar
                          bar={b}
                          fmt={fmt}
                          name={b.label}
                          small
                          anchor={anchorWords(b.through)}
                          projection={b.projection}
                        />
                        <Amounts bar={b} fmt={fmt} className="sm:hidden" />
                        <Needed row={b} from={from} to={to} fmt={fmt} small className="sm:hidden" />
                      </div>
                      <div className="hidden sm:block">
                        <DailySpark row={b} small />
                      </div>
                      <div className="hidden text-right sm:block">
                        <Verdict bar={b} fmt={fmt} small />
                        <Amounts bar={b} fmt={fmt} className="mt-0.5" />
                        <Needed row={b} from={from} to={to} fmt={fmt} small />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {p.unplanned > 0 && p.plan > 0 && (
                <p
                  className="mt-1.5 pl-5 text-[11px] text-ink-3"
                  title={`No allocation for ${p.unplannedBuckets.map((u) => u.label).join(", ")} — spend in a bucket the plan has no line for`}
                >
                  Unplanned <span className="num tabular-nums text-ink">{fmt(p.unplanned)}</span>
                  {` · ${p.unplannedBuckets.map((u) => u.label).join(", ")}`}
                </p>
              )}
            </li>
          ))}
          <li className="px-4 py-3">
            <div className={grid}>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm font-medium text-ink-2"
                  title={
                    reserve.kind === "month"
                      ? "Spend beyond a platform’s whole plan draws on the reserve"
                      : "The reserve is a month’s figure — pick a range inside one planned month to read it"
                  }
                >
                  Reserve
                </span>
                <span className="sm:hidden">
                  {reserve.kind === "month" ? (
                    <ReserveVerdict used={reserve.used} reserve={reserve.reserve} fmt={fmt} />
                  ) : (
                    <span className="num text-xs text-ink-3">—</span>
                  )}
                </span>
              </div>
              <div>
                {reserve.kind === "month" && reserve.reserve > 0 && (
                  <PaceBar
                    bar={{
                      key: "reserve",
                      label: "Reserve",
                      plan: reserve.reserve,
                      actual: reserve.used,
                      planToDate: 0,
                      delta: 0,
                      deviation: null,
                    }}
                    fmt={fmt}
                    name="Reserve"
                    tone={reserve.used > reserve.reserve ? BEHIND_STRONG : MUTED_TONE}
                    words={`Reserve: ${fmt(reserve.used)} used of ${fmt(reserve.reserve)}${
                      reserve.used > reserve.reserve ? " — past the reserve" : ""
                    }`}
                  />
                )}
                {reserve.kind === "month" && (
                  <ReserveAmounts
                    used={reserve.used}
                    reserve={reserve.reserve}
                    fmt={fmt}
                    className="sm:hidden"
                  />
                )}
              </div>
              <div className="hidden sm:block" />
              <div className="hidden text-right sm:block">
                {reserve.kind === "month" ? (
                  <>
                    <ReserveVerdict used={reserve.used} reserve={reserve.reserve} fmt={fmt} />
                    <ReserveAmounts
                      used={reserve.used}
                      reserve={reserve.reserve}
                      fmt={fmt}
                      className="mt-0.5"
                    />
                  </>
                ) : (
                  <span className="num text-xs text-ink-3">—</span>
                )}
              </div>
            </div>
          </li>
        </ul>
      )}
    </section>
  );
}

/**
 * The range's daily actual (solid, through coverage) over its daily plan
 * (dashed, the whole range) on one scale — a day over plan reads above the
 * dashed line. Hidden below `sm`: beside a phone-width bar it has no room,
 * and the bar already carries the verdict.
 */
function DailySpark({ row, small = false }: { row: RangeBar; small?: boolean }) {
  return (
    <span
      className="block"
      title="Daily actual (solid) over the daily plan (dashed), through the last day of data"
    >
      <Sparkline
        values={row.daily.actual}
        compare={row.daily.plan}
        width={100}
        height={small ? 16 : 22}
        filled={false}
        color="var(--brand)"
        responsive
      />
    </span>
  );
}

/**
 * "needs $700/day" — what each day left after coverage must spend to land on
 * the plan; "—" once the range is covered or nothing is left. The title says
 * the whole sentence; the figure says the number.
 */
function Needed({
  row,
  from,
  to,
  fmt,
  small = false,
  className,
}: {
  row: RangeBar;
  from: string;
  to: string;
  fmt: (v: number) => string;
  small?: boolean;
  className?: string;
}) {
  const days = daysLeftAfter(row.through, from, to);
  const value = row.neededPerDay;
  const title =
    value === null
      ? days <= 0
        ? "The range is covered — nothing left to pace"
        : row.plan <= 0
          ? "No plan to land on"
          : "Already at or past the plan"
      : `Needs ${fmt(value)} a day for the ${days} day${days === 1 ? "" : "s"} left to land on ${fmt(row.plan)}`;
  return (
    <p
      className={cn("num tabular-nums text-ink-3", small ? "text-[10px]" : "text-[11px]", className)}
      title={title}
    >
      {value === null ? "—" : `needs ${fmt(value)}/day`}
    </p>
  );
}

/**
 * The triage strip: how many bucket rows are ahead, on track and behind. Three
 * counts, not a chart — the question is "is there anything to look at", and a
 * number answers it faster than a shape. The behind chip is the one shortcut:
 * it applies the off-pace filter (the same filter the bar's chip shows and
 * clears) rather than inventing a second mechanism for "show me the problems".
 */
function SummaryStrip({
  counts,
  offPace,
  onBehind,
}: {
  counts: TrackerCounts;
  offPace: boolean;
  onBehind: () => void;
}) {
  const chip = "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Each chip reads in its direction colour once it counts anything —
          the same tokens the verdicts use, so the strip and the rows agree. */}
      <span className={cn(chip, counts.ahead > 0 ? "border-ahead/50 text-ahead" : "border-line text-ink-2")}>
        <span className={cn("num tabular-nums", counts.ahead > 0 ? toneText(AHEAD_STRONG) : "text-ink")}>
          {counts.ahead}
        </span>{" "}
        ahead
      </span>
      <span className={cn(chip, "border-line text-ink-2")}>
        <span className="num tabular-nums text-ink">{counts.onTrack}</span> on track
      </span>
      <button
        type="button"
        onClick={onBehind}
        aria-pressed={offPace}
        title={
          offPace
            ? "Showing off-pace rows only — click to show everything"
            : "Show only rows that are off pace (either direction)"
        }
        className={cn(
          chip,
          "transition-colors",
          counts.behind > 0 ? "border-behind/50 text-behind" : "border-line text-ink-2",
          offPace && "bg-surface-2",
        )}
      >
        <span
          className={cn("num tabular-nums", counts.behind > 0 ? toneText(BEHIND_STRONG) : "text-ink")}
        >
          {counts.behind}
        </span>{" "}
        behind
      </button>
    </div>
  );
}

/** One table row: a subtotal (a platform, or an objective), or a line under it. */
interface BoardTableRow {
  key: string;
  kind: "subtotal" | "row";
  /** The platform behind the dot — null on an objective subtotal. */
  platform: string | null;
  label: string;
  /** Keeps a subtotal and its lines together when the identity column sorts. */
  sortKey: string;
  bar: TrackerBar;
  /** The row's anchor — its platform's coverage; a group's latest. */
  through: string | null;
  /** An objective-grouped line with no plan row for this combo. */
  unplanned: boolean;
}

/** platform → its bucket bars. */
function rowsByPlatform(platforms: readonly RangePlatform[]): BoardTableRow[] {
  const out: BoardTableRow[] = [];
  for (const p of platforms) {
    out.push({
      key: p.key,
      kind: "subtotal",
      platform: p.key,
      label: platformLabel(p.key),
      sortKey: p.key,
      bar: p,
      through: p.through,
      unplanned: false,
    });
    for (const b of p.buckets) {
      out.push({
        key: `${p.key}|${b.key}`,
        kind: "row",
        platform: p.key,
        label: b.label,
        sortKey: `${p.key}|${b.label}`,
        bar: b,
        through: b.through,
        unplanned: false,
      });
    }
  }
  return out;
}

/**
 * objective → its platforms, unplanned combos badged: the allocation check.
 * The sort keys carry the FUNNEL position (groups come out of
 * `groupTrackerByObjective` in `BUDGET_OBJECTIVES` order), so sorting the
 * identity column keeps every objective's rows under it in funnel order —
 * subtotal first, then its platforms, planned before unplanned. A group's
 * anchor is the LATEST of its platforms' (the fewest days left — the
 * conservative reading of what it still needs).
 */
function rowsByObjective(
  platforms: readonly RangePlatform[],
  coverage: PlatformCoverage,
  from: string,
  to: string,
): BoardTableRow[] {
  const out: BoardTableRow[] = [];
  groupTrackerByObjective(platforms).forEach((g, i) => {
    const order = String(i).padStart(2, "0");
    const throughOf = (platform: string) => clipThrough(coverage[platform], from, to);
    const latest = g.rows.reduce<string | null>((acc, r) => {
      const t = throughOf(r.platform);
      return t !== null && (acc === null || t > acc) ? t : acc;
    }, null);
    out.push({
      key: g.key,
      kind: "subtotal",
      platform: null,
      label: g.label,
      sortKey: order,
      bar: g,
      through: latest,
      // An objective nobody planned for reads "—" like its rows, not a $0 plan.
      unplanned: g.rows.every((r) => r.unplanned),
    });
    for (const r of g.rows) {
      out.push({
        key: r.key,
        kind: "row",
        platform: r.platform,
        label: platformLabel(r.platform),
        sortKey: `${order}|${r.platform}|${r.unplanned ? 1 : 0}`,
        bar: r,
        through: throughOf(r.platform),
        unplanned: r.unplanned,
      });
    }
  });
  return out;
}

/**
 * The TABLE view: the same rows the bars draw, in the shape you can sort and
 * export — Plan · Actual · Expected · Δ · Δ% · Projection · Needed/day. Two
 * groupings of ONE set of rows (`group`): by platform (subtotal → its
 * buckets) or by objective (subtotal → its platforms, an "unplanned" badge on
 * a combo that spent without a plan row). Subtotals are styled as "this row
 * is the sum of the ones under it", and the totals row sums the subtotals,
 * so both groupings foot to the same range.
 *
 * Default sort differs by grouping ON PURPOSE: by platform the table exists
 * to be ranked, so it opens Δ% desc; by objective the GROUPING is the reading
 * (an unplanned row has no Δ% and would sink out of its objective), so it
 * opens on the identity column, funnel order.
 */
function BoardTable({
  rows: platforms,
  group,
  from,
  to,
  coverage,
  fmt,
  currency,
}: {
  rows: readonly RangePlatform[];
  group: PacingGroup;
  from: string;
  to: string;
  coverage: PlatformCoverage;
  fmt: (v: number) => string;
  currency: string;
}) {
  const rows = useMemo(
    () =>
      group === "objective"
        ? rowsByObjective(platforms, coverage, from, to)
        : rowsByPlatform(platforms),
    [platforms, group, coverage, from, to],
  );

  const columns: DataColumn<BoardTableRow>[] = useMemo(() => {
    const num = (v: number) => <span className="num tabular-nums">{fmt(v)}</span>;
    // The footer sums the SUBTOTALS — platforms or objectives — and the two
    // groupings foot to the same range (a regroup moves money, never loses it).
    const totals = rows.filter((r) => r.kind === "subtotal");
    const sum = (pick: (b: TrackerBar) => number) =>
      totals.reduce((s, r) => s + pick(r.bar), 0);
    const unplannedBadge = (
      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-eyebrow text-ink-3">
        unplanned
      </span>
    );
    const projectionOf = (r: BoardTableRow) =>
      r.unplanned ? null : rangeProjection(r.bar, r.through, to);
    const neededOf = (r: BoardTableRow) =>
      r.unplanned ? null : neededPerDay(r.bar, r.through, from, to);
    return [
      {
        key: "item",
        label: group === "objective" ? "Objective / platform" : "Platform / bucket",
        pinned: true,
        sortable: true,
        sortValue: (r) => r.sortKey,
        defaultSortDir: "asc",
        csv: (r) =>
          r.kind === "subtotal" ? r.label : `  ${r.label}${r.unplanned ? " (unplanned)" : ""}`,
        render: (r) =>
          r.kind === "subtotal" ? (
            <span className="inline-flex items-center gap-2 font-medium">
              {r.platform !== null && <PlatformDot platform={r.platform as never} size="sm" />}
              {r.label}
            </span>
          ) : group === "objective" ? (
            <span className="inline-flex items-center gap-2 pl-6 text-ink-2">
              <PlatformDot platform={r.platform as never} size="sm" />
              {r.label}
              {r.unplanned && unplannedBadge}
            </span>
          ) : (
            <span className="pl-6 text-ink-2">{r.label}</span>
          ),
      },
      {
        key: "plan",
        label: "Plan",
        align: "right",
        sortable: true,
        sortValue: (r) => r.bar.plan,
        // An unplanned combo has no plan at all — a dash, never a fabricated $0.
        render: (r) => (r.unplanned ? <span className="num text-ink-3">—</span> : num(r.bar.plan)),
        csv: (r) => (r.unplanned ? null : r.bar.plan),
        total: () => num(sum((b) => b.plan)),
      },
      {
        key: "actual",
        label: "Actual",
        align: "right",
        sortable: true,
        sortValue: (r) => r.bar.actual,
        render: (r) => num(r.bar.actual),
        total: () => num(sum((b) => b.actual)),
      },
      {
        key: "expected",
        label: "Expected",
        align: "right",
        sortable: true,
        sortValue: (r) => r.bar.planToDate,
        render: (r) => num(r.bar.planToDate),
        total: () => num(sum((b) => b.planToDate)),
      },
      {
        key: "delta",
        label: "Δ",
        align: "right",
        sortable: true,
        sortValue: (r) => r.bar.delta,
        render: (r) => (
          <span
            className={cn("num tabular-nums", toneText(pacingTone(r.bar.deviation), "text-ink-2"))}
          >
            {r.bar.delta > 0 ? "+" : ""}
            {fmt(r.bar.delta)}
          </span>
        ),
        total: () => num(sum((b) => b.delta)),
      },
      {
        key: "deviation",
        label: "Δ%",
        align: "right",
        sortable: true,
        sortValue: (r) => r.bar.deviation,
        csv: (r) => r.bar.deviation,
        render: (r) => (
          <span className={cn("num tabular-nums", toneText(pacingTone(r.bar.deviation)))}>
            {r.bar.deviation === null ? "—" : signedPct(r.bar.deviation, 0)}
          </span>
        ),
      },
      {
        key: "projection",
        label: "Projection",
        align: "right",
        sortable: true,
        sortValue: projectionOf,
        csv: projectionOf,
        render: (r) => {
          const p = projectionOf(r);
          return <span className="num tabular-nums text-ink-3">{p === null ? "—" : fmt(p)}</span>;
        },
      },
      {
        key: "needed",
        label: "Needed/day",
        align: "right",
        sortable: true,
        sortValue: neededOf,
        csv: neededOf,
        render: (r) => {
          const n = neededOf(r);
          return <span className="num tabular-nums text-ink-3">{n === null ? "—" : fmt(n)}</span>;
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, group, currency, from, to]);
  // The table's own columns control, remembered per user per brand. The key
  // is the Tracker's — stored, so renaming it would orphan every saved choice.
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.BUDGET_TRACKER,
    hideable: columnKeys,
    defaults: columnKeys,
  });

  return (
    <DataTable<BoardTableRow>
      columns={columns}
      {...cols.tableProps}
      rows={rows}
      rowKey={(r) => r.key}
      // By platform: worst pace first — the ranking somebody opens it for.
      // By objective: the groups themselves, or an unplanned row (no Δ%)
      // sinks to the bottom and reads as another objective's money.
      sort={group === "objective" ? "item" : "deviation"}
      dir={group === "objective" ? "asc" : "desc"}
      showTotals={rows.length > 0}
      minWidthClass="min-w-[860px]"
      rowClassName={(r) =>
        cn(
          r.kind === "subtotal" && "bg-surface-2/40",
          r.kind === "row" && r.unplanned && "opacity-70",
        )
      }
      csvFileName={`budget-pacing-board-${from}-to-${to}-${group}-${currency.toLowerCase()}`}
      empty={
        <p className="text-sm text-ink-3">
          Nothing matches these filters — clear one to see the board again.
        </p>
      }
    />
  );
}
