"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Circle,
  Clock,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { ratio, roas, usd } from "@/lib/format";
import {
  FATIGUE_TIER_ORDER,
  FATIGUE_WINDOWS,
  windowState,
  type FatigueAssessment,
  type FatigueTier,
  type FatigueWindowKey,
  type FatigueWindowMetrics,
} from "@/lib/launch-fatigue";
import { EmptyState } from "@/components/ui/empty-state";

export interface LaunchFatigueViewRow {
  creativeId: string;
  name: string;
  productName: string;
  type: string;
  launchDate: string;
  derived: boolean;
  daysSinceLaunch: number;
  href: string;
  assessment: FatigueAssessment;
}

const TIER_META: Record<
  FatigueTier,
  { row: string; badge: string; icon: React.ComponentType<{ className?: string }> }
> = {
  fatigued: {
    row: "bg-neg/[0.04]",
    badge: "border-neg/40 bg-neg/10 text-neg",
    icon: TrendingDown,
  },
  improving: {
    row: "bg-pos/[0.03]",
    badge: "border-pos/40 bg-pos/10 text-pos",
    icon: TrendingUp,
  },
  holding: {
    row: "",
    badge: "border-line bg-surface-2 text-ink-2",
    icon: Minus,
  },
  new: {
    row: "",
    badge: "border-brand/40 bg-[var(--brand-soft)] text-ink",
    icon: Sparkles,
  },
  low: {
    row: "",
    badge: "border-line bg-surface-2 text-ink-3",
    icon: Minus,
  },
};

function tierLabel(tier: FatigueTier, daysSinceLaunch: number): string {
  switch (tier) {
    case "fatigued":
      return "Fatigued";
    case "improving":
      return "Improving";
    case "holding":
      return "Holding";
    case "low":
      return "Low spend";
    case "new":
      return daysSinceLaunch < 8 ? "Too new" : "Launch only";
  }
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;
}

/** Total spend across the three windows. */
function totalSpend(a: FatigueAssessment): number {
  return a.w1.spend + a.w2.spend + a.w3.spend;
}

/** A launch's fatigue TREND (Fatigued / Improving / Holding / New / Low) — not
 *  a creative's Status (New / Active / Pause / Terminated), so not that name
 *  either (D28). */
function TrendBadge({
  tier,
  daysSinceLaunch,
}: {
  tier: FatigueTier;
  daysSinceLaunch: number;
}) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 px-1.5 rounded text-[10px] border whitespace-nowrap",
        meta.badge,
      )}
    >
      <Icon className="w-3 h-3" />
      {tierLabel(tier, daysSinceLaunch)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** Portfolio summary across every launch in view: the blended ROAS decay curve,
 *  the net fatigue, and a verdict tally. */
export function LaunchFatigueSummary({
  count,
  totalSpend: spend,
  estimatedCount,
  counts,
  w1,
  w2,
  w3,
  drop,
}: {
  count: number;
  totalSpend: number;
  estimatedCount: number;
  counts: Record<FatigueTier, number>;
  w1: FatigueWindowMetrics;
  w2: FatigueWindowMetrics;
  w3: FatigueWindowMetrics;
  drop: number | null;
}) {
  const chipOrder: FatigueTier[] = [
    "fatigued",
    "holding",
    "improving",
    "new",
    "low",
  ];
  const metricsByKey: Record<FatigueWindowKey, FatigueWindowMetrics> = {
    w1,
    w2,
    w3,
  };
  const bars = FATIGUE_WINDOWS.map((w) => {
    const metrics = metricsByKey[w.key];
    return {
      label: w.short,
      metrics,
      // The launch week is the anchor, so it has no delta of its own.
      delta: w.key === "w1" ? null : deltaVs(metrics.roas, w1.roas),
    };
  });
  const maxRoas = Math.max(0, ...bars.map((b) => b.metrics.roas ?? 0));

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.5fr)_minmax(0,0.75fr)] divide-y divide-line lg:divide-y-0 lg:divide-x">
        {/* Portfolio headline + verdict tally */}
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-eyebrow text-ink-3">
              Launches in view
            </div>
            <div className="font-display text-3xl text-ink leading-none mt-1.5">
              {count}
            </div>
            <div className="text-[11px] text-ink-3 mt-1.5">
              {usd(spend)} total spend
            </div>
            {estimatedCount > 0 && (
              <div
                className="text-[11px] text-warn/90 mt-1 inline-flex items-center gap-1"
                title="These creatives have no manual launch date, so their launch is estimated from the first day they spent."
              >
                <Clock className="w-3 h-3" />
                {estimatedCount} of {count} launch date
                {count === 1 ? "" : "s"} estimated
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {chipOrder
              .filter((t) => counts[t] > 0)
              .map((t) => {
                const Icon = TIER_META[t].icon;
                return (
                  <span
                    key={t}
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 px-2 rounded-md border text-[11px]",
                      TIER_META[t].badge,
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {tierLabel(t, 99)}
                    <span className="font-semibold tabular-nums">{counts[t]}</span>
                  </span>
                );
              })}
          </div>
        </div>

        {/* Blended ROAS decay — the centerpiece, as a mini bar chart */}
        <div className="p-5">
          <div className="text-eyebrow text-ink-3">
            Blended ROAS by window
          </div>
          <div className="mt-4 flex items-end gap-5">
            {bars.map((b) => (
              <DecayBar
                key={b.label}
                label={b.label}
                metrics={b.metrics}
                delta={b.delta}
                maxRoas={maxRoas}
              />
            ))}
          </div>
        </div>

        {/* Net fatigue */}
        <div className="p-5 flex flex-col justify-center">
          <div className="text-eyebrow text-ink-3">
            Net fatigue
          </div>
          {drop === null ? (
            <div className="font-display text-3xl text-ink-3 leading-none mt-2">—</div>
          ) : (
            <div
              className={cn(
                "font-display text-4xl leading-none mt-2 tabular-nums",
                drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink",
              )}
            >
              {fmtPct(-drop)}
            </div>
          )}
          <div className="text-[11px] text-ink-3 mt-2 leading-snug">
            launch week → latest window, weighted across all spend
          </div>
        </div>
      </div>
    </div>
  );
}

function deltaVs(roas: number | null, baseRoas: number | null): number | null {
  return baseRoas !== null && baseRoas > 0 && roas !== null
    ? (roas - baseRoas) / baseRoas
    : null;
}

/** One bar in the blended-ROAS decay chart. Height ∝ ROAS; the delta vs the
 *  launch week is colored by direction. */
function DecayBar({
  label,
  metrics,
  delta,
  maxRoas,
}: {
  label: string;
  metrics: FatigueWindowMetrics;
  delta: number | null;
  maxRoas: number;
}) {
  const hasData = metrics.roas !== null;
  const heightPct =
    hasData && maxRoas > 0
      ? Math.max(8, Math.round((metrics.roas! / maxRoas) * 100))
      : 0;
  const tone =
    delta === null
      ? "bg-ink-2/40"
      : delta < -0.001
        ? "bg-neg/70"
        : delta > 0.001
          ? "bg-pos/70"
          : "bg-ink-2/40";
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
      <div className="text-sm tabular-nums text-ink font-medium leading-none">
        {hasData ? (
          <>
            {ratio(metrics.roas)}
            <span className="text-ink-3">×</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </div>
      <div className="w-full h-12 flex items-end justify-center">
        <div
          className={cn("w-8 rounded-t-sm transition-all", tone)}
          style={{ height: `${heightPct}%` }}
        />
      </div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3 text-center leading-tight">
        {label}
      </div>
      {delta !== null && (
        <div
          className={cn(
            "text-[11px] tabular-nums leading-none",
            delta < -0.001 ? "text-neg" : delta > 0.001 ? "text-pos" : "text-ink-3",
          )}
        >
          {fmtPct(delta)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table — on the shared DataTable primitive (2026-10)                  */
/* ------------------------------------------------------------------ */

export type SortKey =
  | "status"
  | "creative"
  | "launched"
  | "spend"
  | FatigueWindowKey
  /** Per-window spend: `w1Spend` … — the opt-in columns. */
  | `${FatigueWindowKey}Spend`
  | "fatigue";
type Dir = "asc" | "desc";

/**
 * Columns whose first click sorts ASCENDING (the rest sort descending first).
 * Carried over verbatim — it is now each column's `defaultSortDir`, which is
 * how DataTable asks the same question.
 */
export const ASC_FIRST = new Set<SortKey>(["status", "creative", "launched"]);

/** The one place that decides a column's first-click direction. */
export const firstDir = (key: SortKey): Dir => (ASC_FIRST.has(key) ? "asc" : "desc");

/**
 * The column set. The WINDOW columns derive from `FATIGUE_WINDOWS` — never
 * hand-listed, so adding a fourth window is a one-line change in
 * `lib/launch-fatigue.ts`.
 */
const COLUMN_KEYS: SortKey[] = [
  "status",
  "launched",
  "spend",
  ...FATIGUE_WINDOWS.map((w) => w.key as SortKey),
  "fatigue",
  ...FATIGUE_WINDOWS.map((w) => spendKey(w.key)),
];

/**
 * Per-window SPEND, offered and hidden by default (2026-10): the assessment
 * already carries each window's spend — the total Spend column is its sum —
 * and "the ROAS halved" reads differently when the second window carried $200
 * than when it carried $12,000. Derived from `FATIGUE_WINDOWS` like every
 * other window column, so a fourth window brings its own.
 */
function spendKey(key: FatigueWindowKey): SortKey {
  return `${key}Spend` as SortKey;
}
const SPEND_KEYS: SortKey[] = FATIGUE_WINDOWS.map((w) => spendKey(w.key));

export function LaunchFatigueTable({ rows }: { rows: LaunchFatigueViewRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [dir, setDir] = useState<Dir>("asc");

  /**
   * THE WRAPPER OWNS THE SORT, like the Library and the campaign-records
   * table. `compareRows` is a ROW comparator — status is a composite (tier,
   * then biggest drop, then newest launch) that no single `sortValue` scalar
   * can express — so no column carries one and DataTable never re-sorts
   * locally; it renders the rows already in order and drives the header
   * clicks. That keeps this migration behaviour-identical, nulls and all
   * (a window with no ROAS still sorts as 0, exactly as before).
   */
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const c = compareRows(a, b, sortKey);
      return dir === "asc" ? c : -c;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const columns = useMemo<DataColumn<LaunchFatigueViewRow>[]>(() => {
    const windowCols: DataColumn<LaunchFatigueViewRow>[] = FATIGUE_WINDOWS.map((w) => ({
      key: w.key,
      label: w.label,
      align: "right" as const,
      sortable: true,
      defaultSortDir: firstDir(w.key as SortKey),
      render: (r) => (
        <WindowCell
          label={w.label}
          metrics={r.assessment[w.key]}
          state={windowState(r.daysSinceLaunch, w.startDay, w.endDay)}
          daysSinceLaunch={r.daysSinceLaunch}
          w1Roas={w.key === "w1" ? null : r.assessment.w1.roas}
        />
      ),
    }));

    const spendCols: DataColumn<LaunchFatigueViewRow>[] = FATIGUE_WINDOWS.map((w) => ({
      key: spendKey(w.key),
      label: `${w.short} spend`,
      align: "right" as const,
      sortable: true,
      defaultSortDir: "desc" as const,
      render: (r) => <span className="text-ink-2">{usd(r.assessment[w.key].spend)}</span>,
      csv: (r) => r.assessment[w.key].spend,
    }));

    return [
      {
        // The identity column, and therefore the PINNED one: this table is
        // wide (three windows plus fatigue), and scrolling right without the
        // creative's name in view makes every other cell unreadable. Pinning
        // moves it first — DataTable always renders the pinned column there.
        key: "creative",
        label: "Creative",
        align: "left",
        sortable: true,
        pinned: true,
        defaultSortDir: firstDir("creative"),
        render: (r) => (
          // Responsive cap: the column is PINNED, and a sticky cell wider than
          // the visible frame stops pinning — on a phone the name would scroll
          // off the left edge. Desktop is unchanged.
          <div className="max-w-[12rem] sm:max-w-[20rem]">
            <Link
              href={r.href}
              title={r.name}
              className="block truncate font-medium text-ink transition-colors hover:text-brand"
            >
              {r.name}
            </Link>
            <div className="truncate text-[11px] text-ink-3">
              {r.productName} · {r.type}
            </div>
          </div>
        ),
        csv: (r) => r.name,
      },
      {
        // The KEY stays "status": it is stored in remembered column prefs
        // (trends-launches), and renaming it would orphan them. The LABEL is
        // "Trend" (D28) — "Status" is the creative's New/Active/Pause/
        // Terminated, a different thing on the next page over.
        key: "status",
        label: "Trend",
        align: "left",
        sortable: true,
        defaultSortDir: firstDir("status"),
        render: (r) => (
          <TrendBadge tier={r.assessment.tier} daysSinceLaunch={r.daysSinceLaunch} />
        ),
        csv: (r) => r.assessment.tier,
      },
      {
        key: "launched",
        label: "Launched",
        align: "left",
        sortable: true,
        defaultSortDir: firstDir("launched"),
        render: (r) => (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className="tabular-nums text-ink-2"
                title={r.derived ? undefined : "Manual launch date set on the creative."}
              >
                {r.derived ? "≈ " : ""}
                {r.launchDate}
              </span>
              {r.derived && (
                <span
                  className="rounded border border-warn/30 bg-warn/5 px-1 py-0.5 text-[9px] leading-none text-warn/90"
                  title="Estimated from the first day with spend — no manual launch date is set on this creative."
                >
                  est.
                </span>
              )}
            </div>
            <div className="text-[11px] text-ink-3">{r.daysSinceLaunch}d ago</div>
          </>
        ),
        csv: (r) => r.launchDate,
      },
      {
        key: "spend",
        label: "Spend",
        align: "right",
        sortable: true,
        defaultSortDir: firstDir("spend"),
        render: (r) => <span className="text-ink-2">{usd(totalSpend(r.assessment))}</span>,
        csv: (r) => totalSpend(r.assessment),
      },
      ...windowCols,
      {
        key: "fatigue",
        label: "Fatigue",
        align: "right",
        sortable: true,
        defaultSortDir: firstDir("fatigue"),
        render: (r) => {
          const drop = r.assessment.drop;
          if (drop === null) {
            return (
              <span className="text-ink-3" title="Not enough history yet to measure decay.">
                —
              </span>
            );
          }
          return (
            <span
              className={cn(
                "font-medium",
                drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink-2",
              )}
            >
              {fmtPct(-drop)}
            </span>
          );
        },
        csv: (r) => r.assessment.drop,
      },
      ...spendCols,
    ];
  }, []);

  // The columns control, free from the primitive (phase 2): the layout already
  // serves this user's preference, so there is no page change to make.
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.TRENDS_LAUNCHES,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: SPEND_KEYS,
  });

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(r) => r.creativeId}
        sort={sortKey}
        dir={dir}
        onSort={(key, d) => {
          setSortKey(key as SortKey);
          setDir(d);
        }}
        {...cols.tableProps}
        rowClassName={(r) =>
          cn(TIER_META[r.assessment.tier].row, r.assessment.tier === "low" && "opacity-60")
        }
        minWidthClass="min-w-max"
        empty={
          <EmptyState size="lg" title="No launched creatives match these filters." kind="filtered" />
        }
      />

      <FatigueLegend />
    </div>
  );
}

/**
 * A window cell's CONTENT. Distinguishes "window hasn't started yet" from "ran
 * but spent nothing here" from "window still in progress" — see point 2. The
 * `<td>` is DataTable's now; the three states and their wording are unchanged.
 */
function WindowCell({
  label,
  metrics,
  state,
  daysSinceLaunch,
  w1Roas,
}: {
  label: string;
  metrics: FatigueWindowMetrics;
  state: "not_started" | "in_progress" | "complete";
  daysSinceLaunch: number;
  w1Roas: number | null;
}) {
  if (state === "not_started") {
    return (
      <span
        className="text-ink-3/40"
        title={`${label} haven’t elapsed yet — launched ${daysSinceLaunch}d ago.`}
      >
        –
      </span>
    );
  }

  if (metrics.roas === null) {
    // The window has begun (in progress or complete) but there was no spend.
    const title =
      state === "in_progress"
        ? `${label}: no spend yet — window still in progress.`
        : `${label}: no spend — paused or off during this window.`;
    return (
      <span title={title}>
        <Circle className="inline h-3 w-3 text-ink-3/70" aria-hidden />
      </span>
    );
  }

  const delta = deltaVs(metrics.roas, w1Roas);
  return (
    <span className="inline-flex items-center justify-end gap-1 text-ink">
      {state === "in_progress" && (
        <span
          title={`${label} still in progress — ROAS so far, through day ${daysSinceLaunch + 1}.`}
          className="inline-flex"
        >
          <Clock className="h-3 w-3 text-ink-3/70" aria-hidden />
        </span>
      )}
      <span>
        {roas(metrics.roas)}
        {delta !== null && (
          <span
            className={cn(
              "ml-1 text-[11px]",
              delta < -0.001 ? "text-neg" : delta > 0.001 ? "text-pos" : "text-ink-3",
            )}
          >
            {fmtPct(delta)}
          </span>
        )}
      </span>
    </span>
  );
}

function FatigueLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-ink-3/40">–</span> window not started
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Circle className="w-3 h-3 text-ink-3/70" /> no spend in window
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock className="w-3 h-3 text-ink-3/70" /> window in progress (partial ROAS)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[9px] px-1 py-0.5 rounded border border-warn/30 text-warn/90 bg-warn/5">
          est.
        </span>
        launch estimated from first spend day
      </span>
    </div>
  );
}

/**
 * EXPORTED for the unit test, which pins the order this table has always had —
 * the migration to `DataTable` must not change a single row's position.
 *
 * Comparator for the table. `status` reproduces the default tiered order
 *  (worst-first, biggest drop first, then newest launch). */
export function compareRows(
  a: LaunchFatigueViewRow,
  b: LaunchFatigueViewRow,
  key: SortKey,
): number {
  const aa = a.assessment;
  const bb = b.assessment;
  switch (key) {
    case "creative":
      return a.name.localeCompare(b.name);
    case "launched":
      return a.launchDate.localeCompare(b.launchDate);
    case "spend":
      return totalSpend(aa) - totalSpend(bb);
    case "w1":
    case "w2":
    case "w3":
      return (aa[key].roas ?? 0) - (bb[key].roas ?? 0);
    case "w1Spend":
    case "w2Spend":
    case "w3Spend": {
      const w = key.slice(0, 2) as FatigueWindowKey;
      return aa[w].spend - bb[w].spend;
    }
    case "fatigue":
      return (aa.drop ?? 0) - (bb.drop ?? 0);
    case "status": {
      const r = FATIGUE_TIER_ORDER[aa.tier] - FATIGUE_TIER_ORDER[bb.tier];
      if (r !== 0) return r;
      // Within a tier: biggest drop first (nulls last), then newest launch.
      const av = aa.drop ?? -Infinity;
      const bv = bb.drop ?? -Infinity;
      if (av !== bv) return bv - av;
      return b.launchDate.localeCompare(a.launchDate);
    }
  }
}
