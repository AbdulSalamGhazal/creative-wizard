"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformDot } from "@/components/ui/platform-dot";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterPill } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Layers } from "lucide-react";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { sar, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  PACING_WARN_THRESHOLD,
  REVENUE_COVERAGE_KEY,
  buildTrackerRows,
  filterTrackerPlatforms,
  monthLabel,
  pacingTone,
  rowProjection,
  sortTrackerPlatforms,
  trackerCounts,
  type PlatformCoverage,
  type TrackerBar,
  type TrackerCounts,
  type TrackerPlatform,
} from "@/lib/budget";
import type { TrackerFiltersInput } from "@/validators/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  HorizonNote,
  formatSpend,
  platformLabel,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

/**
 * Budget → Tracker: the daily pace board. One question — who's ahead, who's
 * behind, by how much — answered in bars, or in a table when you want to sort
 * and export it.
 *
 * **THE BARE PAGE IS THE PRODUCT.** It still answers the question with nothing
 * configured, and that is its identity (Pacing is the tool you reach for when
 * you want to slice something). The 2026-10 controls — platform, bucket,
 * off-pace-only, the view and the row order — are therefore OPT-IN and
 * REMEMBERED per user per brand: nobody is asked to make a decision to read
 * the page, and nobody is asked twice.
 *
 * Every number comes from `buildTrackerRows` (pure, unit-tested) which in turn
 * composes the module's one set of conventions — the plan series, the
 * magnitude-based pacing tone, the projection. BOTH VIEWS READ THE SAME ROWS;
 * nothing here re-derives pacing.
 */
export function BudgetTracker({
  month,
  today,
  data,
  horizon,
  storeHorizon,
  coverage,
  filters,
  resolvedFilters,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  horizon: string | null;
  /** The STORE horizon — the revenue bar's side of the picture. */
  storeHorizon: string | null;
  /**
   * Latest uploaded day per platform (plus the store horizon under
   * `REVENUE_COVERAGE_KEY`). Every comparison on this page anchors to it —
   * see `makeCoverageDay`.
   */
  coverage: PlatformCoverage;
  /** The view state, already resolved server-side (URL → preference → default). */
  filters: TrackerFiltersInput;
  /** What the server resolved, for the shell's write-through (0049). */
  resolvedFilters: Record<string, string | undefined>;
  canManage: boolean;
}) {
  const [currency, pickCurrency] = useBudgetCurrency();
  const { update } = useFilterParams(resolvedFilters);
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const t = buildTrackerRows(data, month, today, coverage);
  /**
   * What a bar measured THROUGH, in words — per row, because with coverage
   * diverging the brand bar and a lagging platform's bar stop through
   * different days. A screen reader must not hear the calendar claim the
   * coverage anchor just removed.
   */
  const anchorFor = (key?: string): string => {
    if (!t.coverage) return "by today";
    const date = key === undefined ? t.coverage.through : (coverage[key] ?? null);
    return date ? `by ${date} (the last day of data)` : "— no data for it yet";
  };

  // ── The view's own rows: filtered, then ordered. Same data, same math. ──
  const shown = useMemo(
    () =>
      sortTrackerPlatforms(
        filterTrackerPlatforms(t.platforms, {
          platforms: filters.platforms,
          buckets: filters.buckets,
          offPaceOnly: filters.offpace,
        }),
        filters.rank,
      ),
    [t.platforms, filters.platforms, filters.buckets, filters.offpace, filters.rank],
  );
  // The triage counts the platform/bucket selection but IGNORES the off-pace
  // toggle — otherwise the chip you clicked to get here would read 0 and you
  // could not find your way back.
  const counts = useMemo(
    () =>
      trackerCounts(
        filterTrackerPlatforms(t.platforms, {
          platforms: filters.platforms,
          buckets: filters.buckets,
        }),
      ),
    [t.platforms, filters.platforms, filters.buckets],
  );
  const hiddenCards = t.platforms.length - shown.length;

  const writeMulti = (key: string, values: readonly string[]) =>
    update((p) => {
      if (values.length === 0) p.delete(key);
      else p.set(key, values.join(","));
    });
  const writeFlag = (key: string, on: boolean) =>
    update((p) => {
      if (on) p.set(key, "1");
      else p.delete(key);
    });
  const writeOne = (key: string, value: string, fallback: string) =>
    update((p) => {
      if (value === fallback) p.delete(key);
      else p.set(key, value);
    });

  // Tier 2: the bucket slice, and the one toggle that makes a long board short.
  const defs: FilterDef[] = [
    {
      key: "buckets",
      label: "Bucket",
      type: "multi",
      options: BUDGET_OBJECTIVES.map((o) => ({ value: o, label: o })),
      values: filters.buckets,
      onChange: (next) => writeMulti("buckets", next),
    },
    {
      key: "offpace",
      label: "Off-pace only",
      type: "multi",
      // ONE option, deliberately: the shell's multi gives it a chip, a count
      // and a Clear for free, and the label says exactly what it hides —
      // "off-pace" is both directions, not just the bad news.
      options: [
        {
          value: "1",
          label: `Hide rows within ${Math.round(PACING_WARN_THRESHOLD * 100)}% of pace`,
        },
      ],
      values: filters.offpace ? ["1"] : [],
      onChange: (next) => writeFlag("offpace", next.length > 0),
      chipFormat: () => "On",
    },
  ];

  return (
    <div className="space-y-4">
      {/* The house filter bar. The month arrows and the currency keep their
          places in tier 1 — the controls that were always here stay where
          they were, and the new ones join them rather than replacing them. */}
      <FilterShell
        filters={defs}
        persistKeys={["board", "rank"]}
        tier1={() => (
          <>
            <BudgetMonthBar
              month={month}
              today={today}
              // Through the shell's writer, so stepping a month keeps the view
              // you are in (the bare `?month=` push would drop it).
              onMonthChange={(m) => update((p) => p.set("month", m))}
            />
            {/* The tier-1 platform control every shell page shares — same
                key, so the selection follows you here from Ads or Pacing. */}
            <FilterPill
              icon={Layers}
              label="Platforms"
              value={
                filters.platforms.length === 0
                  ? "All"
                  : filters.platforms.length === 1
                    ? (PLATFORM_LABEL[
                        filters.platforms[0] as keyof typeof PLATFORM_LABEL
                      ] ?? filters.platforms[0]!)
                    : `${filters.platforms.length} selected`
              }
              active={filters.platforms.length > 0}
            >
              {() => (
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>Platforms</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {ALL_PLATFORMS.map((p) => (
                    <DropdownMenuCheckboxItem
                      key={p}
                      checked={filters.platforms.includes(p)}
                      onCheckedChange={() =>
                        writeMulti(
                          "platforms",
                          filters.platforms.includes(p)
                            ? filters.platforms.filter((v) => v !== p)
                            : [...filters.platforms, p],
                        )
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {PLATFORM_LABEL[p]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              )}
            </FilterPill>
          </>
        )}
        toolbar={() => (
          <>
            <SegmentedControl
              ariaLabel="View"
              value={filters.board}
              onChange={(v) => writeOne("board", v, "bars")}
              options={[
                { value: "bars", label: "Bars" },
                { value: "table", label: "Table" },
              ]}
            />
            {filters.board === "bars" && (
              <SegmentedControl
                ariaLabel="Row order"
                value={filters.rank}
                onChange={(v) => writeOne("rank", v, "plan")}
                options={[
                  { value: "plan", label: "By plan size" },
                  { value: "offpace", label: "Most off-pace" },
                ]}
              />
            )}
            <CurrencyToggle currency={currency} onChange={pickCurrency} />
          </>
        )}
      />

      {!t.hasPlan ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink-2">
            Nothing to track — {monthLabel(month)} has no plan yet.
          </p>
          <p className="mt-1 text-xs text-ink-3">
            The Tracker paces spend against a plan; set one and this page fills
            itself in.
          </p>
          {canManage && (
            <Button asChild size="sm" className="mt-3">
              <Link href={`/budget/plan?month=${month}`}>
                Plan {monthLabel(month)}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* ── Header strip: where the month is, and where it's heading ── */}
          <section className="rounded-lg border border-line bg-surface px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-ink">
                {t.isFutureMonth ? (
                  <>Not started — {monthLabel(month)} is ahead of us</>
                ) : (
                  <>
                    Day{" "}
                    <span className="num tabular-nums">{t.elapsedDays}</span> of{" "}
                    <span className="num tabular-nums">{t.totalDays}</span>
                    {/* What the comparisons below actually counted through —
                        the last uploaded day, not today. */}
                    {t.coverage?.through && (
                      <span className="text-ink-3">
                        {" · data through "}
                        <span className="num tabular-nums">
                          {t.coverage.through}
                        </span>
                      </span>
                    )}
                    <span className="text-ink-3">
                      {" · plan expects "}
                      <span className="num tabular-nums">
                        {Math.round(t.curveElapsed * 100)}%
                      </span>
                      {" spent"}
                    </span>
                  </>
                )}
              </p>
              <Verdict bar={t.total} fmt={fmtSpend} />
            </div>

            <div className="mt-3">
              <PaceBar bar={t.total} fmt={fmtSpend} name="Total" anchor={anchorFor()} />
            </div>

            <p className="mt-2 text-xs text-ink-3">
              <span className="num tabular-nums text-ink-2">
                {fmtSpend(t.total.actual)}
              </span>{" "}
              of{" "}
              <span className="num tabular-nums text-ink-2">
                {fmtSpend(t.total.plan)}
              </span>
              {t.isPastMonth ? (
                // The month is over: final vs plan, no extrapolation.
                <> — final for {monthLabel(month)}</>
              ) : (
                t.projectedSpend !== null && (
                  <>
                    {" — on this pace the month ends at "}
                    <span
                      className={cn(
                        "num tabular-nums",
                        pacingTone(t.projectedPctOfPlan === null ? null : t.projectedPctOfPlan - 1) ===
                          "warn"
                          ? "text-warn"
                          : "text-ink-2",
                      )}
                    >
                      {fmtSpend(t.projectedSpend)}
                    </span>
                    {t.total.plan > 0 && (
                      <>
                        {" of "}
                        <span className="num tabular-nums text-ink-2">
                          {fmtSpend(t.total.plan)}
                        </span>
                        {" ("}
                        <span className="num tabular-nums">
                          {Math.round((t.projectedPctOfPlan ?? 0) * 100)}%
                        </span>
                        {")"}
                      </>
                    )}
                  </>
                )
              )}
            </p>

            {/* One platform's data lagging the rest changes what its row is
                compared against, so the page says which one rather than
                leaving a quietly different yardstick unexplained. */}
            {t.coverage && t.coverage.laggards.length > 0 && (
              <p className="mt-1 text-[11px] text-ink-3">
                {t.coverage.laggards
                  .map(
                    (l) =>
                      `${platformLabel(l.platform)} data ${
                        l.date ? `ends ${l.date}` : "hasn't arrived"
                      }`,
                  )
                  .join(" · ")}
                {" — paced against what each one covers"}
              </p>
            )}
          </section>

          {/* ── Triage: how many rows are where, and one click to the ones
                 that need a look. Counts are BUCKET rows — the grain somebody
                 can act on. ── */}
          <SummaryStrip
            counts={counts}
            offPace={filters.offpace}
            onBehind={() => writeFlag("offpace", !filters.offpace)}
          />

          {hiddenCards > 0 && (
            <p className="text-[11px] text-ink-3">
              Showing{" "}
              <span className="num tabular-nums">{shown.length}</span> of{" "}
              <span className="num tabular-nums">{t.platforms.length}</span>{" "}
              platforms — the total above is the whole month.
            </p>
          )}

          {filters.board === "table" ? (
            <TrackerTable
              platforms={shown}
              month={month}
              currency={currency}
              fmt={fmtSpend}
              isCurrentMonth={t.isCurrentMonth}
            />
          ) : (
          /* ── Platform cards: the plan editor's 2×2 grid, stacked on a phone ── */
          shown.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {shown.map((p) => (
                <li
                  key={p.key}
                  className="rounded-lg border border-line bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                      <PlatformDot platform={p.key as never} size="sm" />
                      {PLATFORM_LABEL[p.key as keyof typeof PLATFORM_LABEL] ??
                        platformLabel(p.key)}
                    </span>
                    <Verdict bar={p} fmt={fmtSpend} />
                  </div>

                  {p.plan > 0 && (
                    <div className="mt-2">
                      <PaceBar
                        bar={p}
                        fmt={fmtSpend}
                        name={platformLabel(p.key)}
                        anchor={anchorFor(p.key)}
                      />
                      <Amounts bar={p} fmt={fmtSpend} />
                      {/* The card's own "on this pace" line — the same
                          question the header answers for the brand. */}
                      {t.isCurrentMonth && rowProjection(p) !== null && (
                        <p className="mt-0.5 text-[11px] text-ink-3">
                          on pace for{" "}
                          <span className="num tabular-nums">
                            {fmtSpend(rowProjection(p)!)}
                          </span>{" "}
                          of{" "}
                          <span className="num tabular-nums">
                            {fmtSpend(p.plan)}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {p.buckets.length > 0 && (
                    <ul className="mt-3 space-y-2.5 border-t border-line pt-3">
                      {p.buckets.map((b) => (
                        <li key={b.key}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="text-xs text-ink-2">{b.label}</span>
                            <Verdict bar={b} fmt={fmtSpend} small />
                          </div>
                          <div className="mt-1">
                            <PaceBar
                              bar={b}
                              fmt={fmtSpend}
                              name={b.label}
                              small
                              anchor={anchorFor(p.key)}
                            />
                            <Amounts bar={b} fmt={fmtSpend} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {p.unplanned > 0 && (
                    // No bar: there is no plan to bar against. The words carry
                    // the meaning — this money comes out of the reserve.
                    <p className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
                      Unplanned{" "}
                      <span className="num tabular-nums text-ink-2">
                        {fmtSpend(p.unplanned)}
                      </span>{" "}
                      — draws down the reserve
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
          )}

          {/* ── Footer: the reserve, and the one revenue bar ── */}
          <section className="space-y-3 rounded-lg border border-line bg-surface px-4 py-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
              <span className="text-ink-2">
                Reserve{" "}
                <span className="num tabular-nums text-ink">
                  {fmtSpend(t.reserveRemaining)}
                </span>{" "}
                left of{" "}
                <span className="num tabular-nums">{fmtSpend(t.reserve)}</span>
                <span className="text-ink-3"> — carved out of the total</span>
              </span>
              <span
                className={cn(
                  "num tabular-nums",
                  t.unplannedTotal > t.reserve ? "text-warn" : "text-ink-3",
                )}
              >
                Unplanned spend {fmtSpend(t.unplannedTotal)}
                {t.unplannedTotal > t.reserve && " — past the reserve"}
              </span>
            </p>

            {t.revenue.target !== null && (
              <div className="border-t border-line pt-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-xs text-ink-2">Revenue (SAR)</span>
                  <Verdict bar={t.revenue} fmt={sar} small />
                </div>
                <div className="mt-1">
                  <PaceBar
                    bar={t.revenue}
                    fmt={sar}
                    name="Revenue"
                    anchor={anchorFor(REVENUE_COVERAGE_KEY)}
                  />
                  <Amounts bar={t.revenue} fmt={sar} />
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Ads and store data arrive on separate schedules, and this page reads
          both — a later day is not a zero, just not uploaded yet. */}
      <HorizonNote horizon={horizon} storeHorizon={storeHorizon} />
    </div>
  );
}

/** Share of the track a value occupies, clamped to [0, 100]. */
function pctOfPlan(value: number, plan: number): number {
  if (plan <= 0) return 0;
  return Math.max(0, Math.min(100, (value / plan) * 100));
}

/**
 * THE BAR. Pure CSS, no chart library: the track is the row's FULL month plan,
 * the fill is the actual so far, and the tick is where the plan curve says we
 * should be today. Warn-tinted by |deviation| through the shared threshold —
 * ahead and behind are both deviations, never good/bad green/red.
 *
 * The aria-label says the whole thing in words, because a bar a screen reader
 * can't read is decoration.
 */
function PaceBar({
  bar,
  fmt,
  name,
  small = false,
  anchor = "by today",
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  name: string;
  small?: boolean;
  /** What the expectation is measured THROUGH — coverage, not the calendar. */
  anchor?: string;
}) {
  const fill = pctOfPlan(bar.actual, bar.plan);
  const tick = pctOfPlan(bar.planToDate, bar.plan);
  const warn = pacingTone(bar.deviation) === "warn";
  const words = `${name}: ${fmt(bar.actual)} of ${fmt(bar.plan)}, should be ${fmt(
    bar.planToDate,
  )} ${anchor}${
    bar.deviation === null
      ? ""
      : bar.delta === 0
        ? " — on track"
        : ` — ${bar.delta > 0 ? "ahead" : "behind"} ${fmt(Math.abs(bar.delta))}`
  }`;
  return (
    <div
      role="img"
      aria-label={words}
      title={words}
      className={cn(
        "relative w-full rounded-full bg-surface-2",
        small ? "h-1.5" : "h-2",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width]",
          warn ? "bg-warn" : "bg-brand",
        )}
        style={{ width: `${fill}%` }}
      />
      {/* The curve's mark for today — the whole point of the bar, so it stands
          slightly PROUD of the track (and is 2px wide) instead of vanishing
          under the fill when the two coincide. Hidden at 0: a future month
          expects nothing, and a mark at the origin would read as a sliver. */}
      {tick > 0 && (
        <div
          className="absolute -inset-y-1 w-0.5 -translate-x-px rounded-full bg-ink-3"
          style={{ left: `${tick}%` }}
        />
      )}
    </div>
  );
}

/** "$8,140 of $18,000" — wraps as a pair on a phone. */
function Amounts({ bar, fmt }: { bar: TrackerBar; fmt: (v: number) => string }) {
  return (
    <p className="mt-1 text-[11px] text-ink-3">
      <span className="num tabular-nums text-ink-2">{fmt(bar.actual)}</span> of{" "}
      <span className="num tabular-nums">{fmt(bar.plan)}</span>
    </p>
  );
}

/**
 * "▲ ahead $1,860 (+31%)" / "▼ behind …" / "on track" / "—". Warn-tinted by
 * MAGNITUDE (the shared `pacingTone`), so neither direction reads as good news.
 */
function Verdict({
  bar,
  fmt,
  small = false,
}: {
  bar: TrackerBar;
  fmt: (v: number) => string;
  small?: boolean;
}) {
  const warn = pacingTone(bar.deviation) === "warn";
  const cls = cn(
    "num tabular-nums",
    small ? "text-[11px]" : "text-xs",
    warn ? "text-warn" : "text-ink-3",
  );
  // No expectation yet (future month, or nothing planned) → no verdict at all.
  if (bar.deviation === null) return <span className={cls}>—</span>;
  if (Math.round(bar.delta) === 0) return <span className={cls}>on track</span>;
  // The percentage IS the deviation — one source, not a second derivation.
  const pct = bar.deviation;
  const ahead = bar.delta > 0;
  return (
    <span className={cls}>
      {ahead ? "▲" : "▼"} {ahead ? "ahead" : "behind"} {fmt(Math.abs(bar.delta))}
      {pct !== null && ` (${signedPct(pct, 0)})`}
    </span>
  );
}

/**
 * The triage strip: how many bucket rows are ahead, on track and behind. Three
 * counts, not a chart — the question is "is there anything to look at", and a
 * number answers it faster than a shape.
 *
 * The behind chip is the one shortcut on the page: clicking it applies the
 * off-pace filter (the same filter the bar's chip shows and clears), rather
 * than inventing a second mechanism for "show me the problems".
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
      <span className={cn(chip, "border-line text-ink-2")}>
        <span className="num tabular-nums text-ink">{counts.ahead}</span> ahead
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
          counts.behind > 0 ? "border-warn/50 text-warn" : "border-line text-ink-2",
          offPace && "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "num tabular-nums",
            counts.behind > 0 ? "text-warn" : "text-ink",
          )}
        >
          {counts.behind}
        </span>{" "}
        behind
      </button>
    </div>
  );
}

/** One table row: a platform subtotal, or one of its buckets. */
interface TrackerTableRow {
  key: string;
  kind: "platform" | "bucket";
  platform: string;
  label: string;
  bar: TrackerBar;
}

function tableRows(platforms: readonly TrackerPlatform[]): TrackerTableRow[] {
  const out: TrackerTableRow[] = [];
  for (const p of platforms) {
    out.push({
      key: p.key,
      kind: "platform",
      platform: p.key,
      label: platformLabel(p.key),
      bar: p,
    });
    for (const b of p.buckets) {
      out.push({
        key: `${p.key}|${b.key}`,
        kind: "bucket",
        platform: p.key,
        label: b.label,
        bar: b,
      });
    }
  }
  return out;
}

/**
 * The TABLE view: the same rows the bars draw, in the shape you can sort and
 * export. The bars answer "how is it going" at a glance; this answers "which
 * line is worst" and "give me the numbers" — neither re-derives anything,
 * both read `buildTrackerRows`.
 *
 * Platform subtotals are styled like the allocation check's objective rows
 * (the module's existing grammar for "this row is the sum of the ones under
 * it"), and they sort with their buckets rather than above them.
 */
function TrackerTable({
  platforms,
  month,
  currency,
  fmt,
  isCurrentMonth,
}: {
  platforms: readonly TrackerPlatform[];
  month: string;
  currency: string;
  fmt: (v: number) => string;
  isCurrentMonth: boolean;
}) {
  const rows = useMemo(() => tableRows(platforms), [platforms]);

  const columns: DataColumn<TrackerTableRow>[] = useMemo(() => {
    const num = (v: number) => <span className="num tabular-nums">{fmt(v)}</span>;
    const totals = rows.filter((r) => r.kind === "platform");
    const sum = (pick: (b: TrackerBar) => number) =>
      totals.reduce((s, r) => s + pick(r.bar), 0);
    return [
      {
        key: "item",
        label: "Platform / bucket",
        pinned: true,
        sortable: true,
        sortValue: (r) => `${r.platform}${r.kind === "platform" ? "" : `|${r.label}`}`,
        defaultSortDir: "asc",
        csv: (r) => (r.kind === "platform" ? r.label : `  ${r.label}`),
        render: (r) =>
          r.kind === "platform" ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <PlatformDot platform={r.platform as never} size="sm" />
              {r.label}
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
        render: (r) => num(r.bar.plan),
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
            className={cn(
              "num tabular-nums",
              pacingTone(r.bar.deviation) === "warn" ? "text-warn" : "text-ink-2",
            )}
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
          <span
            className={cn(
              "num tabular-nums",
              pacingTone(r.bar.deviation) === "warn" ? "text-warn" : "text-ink-3",
            )}
          >
            {r.bar.deviation === null ? "—" : signedPct(r.bar.deviation, 0)}
          </span>
        ),
      },
      {
        key: "projection",
        label: "Projection",
        align: "right",
        sortable: true,
        sortValue: (r) => (isCurrentMonth ? rowProjection(r.bar) : null),
        csv: (r) => (isCurrentMonth ? rowProjection(r.bar) : null),
        render: (r) => {
          const p = isCurrentMonth ? rowProjection(r.bar) : null;
          return (
            <span className="num tabular-nums text-ink-3">
              {p === null ? "—" : fmt(p)}
            </span>
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, currency, isCurrentMonth]);

  return (
    <DataTable<TrackerTableRow>
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      // Worst pace first: the table exists to be ranked, and this is the
      // ranking somebody opens it for.
      sort="deviation"
      dir="desc"
      showTotals={rows.length > 0}
      minWidthClass="min-w-[760px]"
      rowClassName={(r) => (r.kind === "platform" ? "bg-surface-2/40" : "")}
      csvFileName={`budget-tracker-${month}-${currency.toLowerCase()}`}
      empty={
        <p className="text-sm text-ink-3">
          Nothing matches these filters — clear one to see the board again.
        </p>
      }
    />
  );
}
