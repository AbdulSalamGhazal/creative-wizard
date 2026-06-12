import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  Sparkles,
} from "lucide-react";
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
  {
    label: string;
    row: string;
    badge: string;
    icon: React.ComponentType<{ className?: string }> | null;
  }
> = {
  drop: {
    label: "Big drop",
    row: "border-neg/50 bg-neg/[0.04]",
    badge: "border-neg/40 bg-neg/10 text-neg",
    icon: AlertTriangle,
  },
  watch: {
    label: "Watch",
    row: "border-warn/40 bg-warn/[0.03]",
    badge: "border-warn/40 bg-warn/10 text-warn",
    icon: Eye,
  },
  gone: {
    label: "Gone",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-2",
    icon: ArrowDownRight,
  },
  new: {
    label: "New",
    row: "border-brand/30",
    badge: "border-brand/40 bg-[var(--brand-soft)] text-ink",
    icon: Sparkles,
  },
  stable: {
    label: "Stable",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-3",
    icon: null,
  },
  low: {
    label: "Low spend",
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-3",
    icon: null,
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

function fmtChange(change: number): string {
  return `${change >= 0 ? "+" : "−"}${Math.round(Math.abs(change) * 100)}%`;
}

/**
 * One sorted, severity-tinted list — the page IS the warning system. Each row:
 * entity identity + the metric that drove the change (left), every key metric
 * with its direction-aware delta vs the prior window (right).
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
        const TierIcon = meta.icon;
        const isGone = r.assessment.tier === "gone";
        const warned =
          r.assessment.tier === "drop" || r.assessment.tier === "watch";
        const worst = r.assessment.worst;
        return (
          <div
            key={r.key}
            className={cn(
              "rounded-lg border bg-surface p-3.5 flex flex-wrap items-center gap-x-6 gap-y-2.5 transition-colors",
              meta.row,
              r.assessment.tier === "low" && "opacity-60",
            )}
          >
            <div className="min-w-[240px] flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={cn(
                    "inline-flex h-5 items-center gap-1 px-1.5 rounded text-[10px] border whitespace-nowrap shrink-0",
                    meta.badge,
                  )}
                >
                  {TierIcon && <TierIcon className="w-3 h-3" />}
                  {meta.label}
                </span>
                <Link
                  href={r.href}
                  title={r.label}
                  className="text-sm font-medium text-ink hover:text-brand transition-colors truncate"
                >
                  {r.label}
                </Link>
                {/* What drove the warning — the single loudest deterioration. */}
                {warned && worst && worst.change !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px] tabular-nums whitespace-nowrap shrink-0",
                      r.assessment.tier === "drop" ? "text-neg" : "text-warn",
                    )}
                  >
                    {worst.change >= 0 ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {METRIC_LABEL[worst.key]} {fmtChange(worst.change)}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-3 mt-1.5">
                {isGone
                  ? `had ${usd(r.prevSpend)} in the prior window · nothing in this one`
                  : `${usd(r.curSpend)} spend${
                      r.share !== null ? ` · ${pct(r.share)} of total` : ""
                    }`}
                {r.assessment.tier === "new" && " · no data in the prior window"}
                {r.sub && ` · ${r.sub}`}
              </div>
              {/* Spend-share bar — anchors each row's weight at a glance. */}
              {!isGone && r.share !== null && (
                <div className="mt-1.5 h-1 max-w-[240px] rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand/60"
                    style={{ width: `${Math.max(r.share * 100, 1.5)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {r.assessment.metrics.map((m) => (
                <MetricChip
                  key={m.key}
                  metric={m}
                  showPrevValue={isGone}
                  isWorst={warned && worst?.key === m.key}
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
  const d = metric.deterioration;
  const severity =
    d !== null && d >= CHANGE_DROP
      ? "drop"
      : d !== null && d >= CHANGE_WATCH
        ? "watch"
        : "none";

  // Delta coloring: the ARROW shows the value's direction, the COLOR shows
  // whether that direction is good (CPA falling = green ↓, ROAS falling =
  // red ↓). Spend stays informational (muted); tiny moves stay muted too.
  const change = metric.change;
  let deltaClass = "text-ink-3";
  if (severity === "none" && d !== null && Math.abs(d) >= 0.05) {
    deltaClass = d < 0 ? "text-pos" : "text-neg/80";
  }

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] whitespace-nowrap tabular-nums",
        severity === "drop"
          ? "border-neg/50 bg-neg/10"
          : severity === "watch"
            ? "border-warn/40 bg-warn/10"
            : "border-line bg-surface-2/40",
      )}
    >
      <span className="text-[9px] uppercase tracking-[0.1em] text-ink-3">
        {METRIC_LABEL[metric.key]}
      </span>
      <span
        className={cn(
          "font-semibold",
          severity === "drop"
            ? "text-neg"
            : severity === "watch"
              ? "text-warn"
              : "text-ink",
        )}
      >
        {fmtValue(metric.key, showPrevValue ? metric.prev : metric.cur)}
      </span>
      {change !== null && !showPrevValue && (
        <span
          className={cn(
            "inline-flex items-center gap-0.5",
            severity === "drop"
              ? "text-neg"
              : severity === "watch"
                ? "text-warn"
                : deltaClass,
          )}
        >
          {change >= 0 ? (
            <ArrowUpRight className="w-2.5 h-2.5 self-center" />
          ) : (
            <ArrowDownRight className="w-2.5 h-2.5 self-center" />
          )}
          {fmtChange(change)}
        </span>
      )}
      {isWorst && (
        <AlertTriangle className="w-3 h-3 self-center text-neg shrink-0" />
      )}
    </span>
  );
}
