import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { pct, ratio, usd } from "@/lib/format";
import {
  CHANGE_DROP,
  CHANGE_WATCH,
  type ChangeAssessment,
  type ChangeMetricDelta,
  type ChangeMetricKey,
  type ChangeTier,
} from "@/lib/change-radar";

export interface ChangeRadarRow {
  key: string;
  label: string;
  sub: string | null;
  href: string;
  /** Current-window spend as a share of the account total (0..1). */
  share: number | null;
  curSpend: number;
  prevSpend: number;
  assessment: ChangeAssessment;
}

const TIER_META: Record<
  ChangeTier,
  { label: string; row: string; badge: string }
> = {
  drop: {
    label: "Big drop",
    row: "border-neg/50",
    badge: "border-neg/40 bg-neg/10 text-neg",
  },
  watch: {
    label: "Watch",
    row: "border-warn/40",
    badge: "border-warn/40 bg-warn/10 text-warn",
  },
  gone: {
    label: "Gone",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-2",
  },
  new: {
    label: "New",
    row: "border-line",
    badge: "border-brand/40 bg-[var(--brand-soft)] text-ink",
  },
  stable: {
    label: "Stable",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-3",
  },
  low: {
    label: "Low spend",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-3",
  },
};

const METRIC_LABEL: Record<ChangeMetricKey, string> = {
  spend: "Spend",
  roas: "ROAS",
  cpa: "CPA",
  ctr: "CTR",
  cvr: "CvR",
};

function fmtValue(key: ChangeMetricKey, v: number | null): string {
  if (v === null) return "—";
  switch (key) {
    case "spend":
    case "cpa":
      return usd(v);
    case "roas":
      return `${ratio(v)}×`;
    case "ctr":
    case "cvr":
      return pct(v);
  }
}

function fmtChange(change: number | null): string | null {
  if (change === null) return null;
  const p = Math.round(Math.abs(change) * 100);
  return `${change >= 0 ? "+" : "−"}${p}%`;
}

/**
 * One sorted, severity-tinted list — the page IS the warning system. Each row:
 * entity identity (left) and its key-metric deltas vs the prior window
 * (right); the worst-deteriorating metric carries the alert icon.
 */
export function ChangeRadar({ rows }: { rows: ChangeRadarRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">
          No data in this window or the one before it.
        </p>
        <p className="text-ink-3 text-xs mt-1">
          Try widening the date range or removing filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const meta = TIER_META[r.assessment.tier];
        const isGone = r.assessment.tier === "gone";
        const warned =
          r.assessment.tier === "drop" || r.assessment.tier === "watch";
        return (
          <div
            key={r.key}
            className={cn(
              "rounded-lg border bg-surface p-3.5 flex flex-wrap items-center gap-x-6 gap-y-2",
              meta.row,
              r.assessment.tier === "low" && "opacity-60",
            )}
          >
            <div className="min-w-[230px] flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "inline-flex h-5 items-center px-1.5 rounded text-[10px] border whitespace-nowrap shrink-0",
                    meta.badge,
                  )}
                >
                  {meta.label}
                </span>
                <Link
                  href={r.href}
                  title={r.label}
                  className="text-sm font-medium text-ink hover:text-brand transition-colors truncate"
                >
                  {r.label}
                </Link>
              </div>
              <div className="text-[11px] text-ink-3 mt-1">
                {isGone
                  ? `had ${usd(r.prevSpend)} in the prior window · nothing in this one`
                  : `${usd(r.curSpend)} spend${
                      r.share !== null ? ` · ${pct(r.share)} of total` : ""
                    }`}
                {r.assessment.tier === "new" && " · no data in the prior window"}
                {r.sub && ` · ${r.sub}`}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {r.assessment.metrics.map((m) => (
                <MetricChip
                  key={m.key}
                  metric={m}
                  showPrevValue={isGone}
                  isWorst={warned && r.assessment.worst?.key === m.key}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MetricChip({
  metric,
  showPrevValue,
  isWorst,
}: {
  metric: ChangeMetricDelta;
  /** "Gone" rows show the prior window's values (current is all zero). */
  showPrevValue: boolean;
  isWorst: boolean;
}) {
  const d = metric.deterioration ?? 0;
  const severity =
    metric.deterioration !== null && d >= CHANGE_DROP
      ? "drop"
      : metric.deterioration !== null && d >= CHANGE_WATCH
        ? "watch"
        : "none";
  const improved = metric.deterioration !== null && d <= -CHANGE_WATCH;
  const change = fmtChange(metric.change);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] whitespace-nowrap tabular-nums",
        severity === "drop"
          ? "border-neg/50 bg-neg/10 text-neg"
          : severity === "watch"
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-line text-ink",
      )}
    >
      <span className={severity === "none" ? "text-ink-3" : undefined}>
        {METRIC_LABEL[metric.key]}
      </span>
      <span className="font-medium">
        {fmtValue(metric.key, showPrevValue ? metric.prev : metric.cur)}
      </span>
      {change && !showPrevValue && (
        <span
          className={cn(
            severity === "none" && (improved ? "text-pos" : "text-ink-3"),
          )}
        >
          {change}
        </span>
      )}
      {isWorst && <AlertTriangle className="w-3 h-3 shrink-0" />}
    </span>
  );
}
