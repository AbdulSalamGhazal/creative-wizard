import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { pct, ratio, usd } from "@/lib/format";
import {
  type FatigueAssessment,
  type FatigueTier,
  type FatigueWindowMetrics,
} from "@/lib/launch-fatigue";

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
    row: "border-neg/50 bg-neg/[0.04]",
    badge: "border-neg/40 bg-neg/10 text-neg",
    icon: TrendingDown,
  },
  improving: {
    row: "border-pos/40 bg-pos/[0.03]",
    badge: "border-pos/40 bg-pos/10 text-pos",
    icon: TrendingUp,
  },
  holding: {
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-2",
    icon: Minus,
  },
  new: {
    row: "border-brand/30",
    badge: "border-brand/40 bg-[var(--brand-soft)] text-ink",
    icon: Sparkles,
  },
  low: {
    row: "border-line",
    badge: "border-line bg-surface-2 text-ink-3",
    icon: Minus,
  },
};

const WINDOWS = [
  { key: "w1" as const, label: "Days 1–7", note: "launch week", startsAt: 0 },
  { key: "w2" as const, label: "Days 8–30", note: null, startsAt: 7 },
  { key: "w3" as const, label: "Days 31–90", note: null, startsAt: 30 },
];

function tierLabel(r: LaunchFatigueViewRow): string {
  switch (r.assessment.tier) {
    case "fatigued":
      return "Fatigued";
    case "improving":
      return "Improving";
    case "holding":
      return "Holding";
    case "low":
      return "Low spend";
    case "new":
      // Too young to judge vs only its launch week ran.
      return r.daysSinceLaunch < 8 ? "Too new" : "Launch only";
  }
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;
}

export function LaunchFatigue({ rows }: { rows: LaunchFatigueViewRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No launched creatives match these filters.</p>
        <p className="text-ink-3 text-xs mt-1">
          Widen the launch-date range or clear filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const meta = TIER_META[r.assessment.tier];
        const Icon = meta.icon;
        const drop = r.assessment.drop;
        const w1Roas = r.assessment.w1.roas;
        return (
          <div
            key={r.creativeId}
            className={cn(
              "rounded-lg border bg-surface p-3.5",
              meta.row,
              r.assessment.tier === "low" && "opacity-60",
            )}
          >
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span
                className={cn(
                  "inline-flex h-5 items-center gap-1 px-1.5 rounded text-[10px] border whitespace-nowrap",
                  meta.badge,
                )}
              >
                <Icon className="w-3 h-3" />
                {tierLabel(r)}
              </span>
              <Link
                href={r.href}
                title={r.name}
                className="text-sm font-medium text-ink hover:text-brand transition-colors truncate max-w-[260px]"
              >
                {r.name}
              </Link>
              <span className="text-[11px] text-ink-3">
                {r.productName} · {r.type} · launched {r.launchDate} ·{" "}
                {r.daysSinceLaunch}d
                {r.derived && (
                  <span
                    className="ml-1 text-ink-3"
                    title="No manual launch date — using the first day with spend."
                  >
                    (est.)
                  </span>
                )}
              </span>
              {drop !== null && (
                <span
                  className={cn(
                    "ml-auto inline-flex items-center gap-0.5 text-[11px] tabular-nums whitespace-nowrap",
                    r.assessment.tier === "fatigued"
                      ? "text-neg"
                      : r.assessment.tier === "improving"
                        ? "text-pos"
                        : "text-ink-3",
                  )}
                >
                  {drop > 0 ? (
                    <ArrowDownRight className="w-3 h-3" />
                  ) : (
                    <ArrowUpRight className="w-3 h-3" />
                  )}
                  ROAS {fmtPct(-drop)} since launch week
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {WINDOWS.map((w) => (
                <WindowBlock
                  key={w.key}
                  label={w.label}
                  note={w.note}
                  metrics={r.assessment[w.key]}
                  notStarted={r.daysSinceLaunch < w.startsAt}
                  w1Roas={w.key === "w1" ? null : w1Roas}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WindowBlock({
  label,
  note,
  metrics,
  notStarted,
  w1Roas,
}: {
  label: string;
  note: string | null;
  metrics: FatigueWindowMetrics;
  /** The creative isn't old enough to have reached this window yet. */
  notStarted: boolean;
  /** Launch-week ROAS to delta against (null for the launch-week block itself). */
  w1Roas: number | null;
}) {
  const delta =
    w1Roas !== null && w1Roas > 0 && metrics.roas !== null
      ? (metrics.roas - w1Roas) / w1Roas
      : null;

  return (
    <div className="rounded-md bg-surface-2/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
        {note && <span className="ml-1 lowercase tracking-normal">· {note}</span>}
      </div>
      {notStarted ? (
        <div className="text-[12px] text-ink-3 mt-1.5">not reached yet</div>
      ) : (
        <>
          <div className="text-lg font-medium text-ink leading-tight mt-0.5">
            {metrics.roas === null ? (
              <span className="text-ink-3">—</span>
            ) : (
              <>
                {ratio(metrics.roas)}×
                {delta !== null && (
                  <span
                    className={cn(
                      "ml-1.5 text-[12px]",
                      delta < -0.001
                        ? "text-neg"
                        : delta > 0.001
                          ? "text-pos"
                          : "text-ink-3",
                    )}
                  >
                    {fmtPct(delta)}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="text-[11px] text-ink-3 mt-0.5 tabular-nums">
            {metrics.spend > 0 ? usd(metrics.spend) : "no spend"}
            {metrics.spend > 0 && (
              <>
                {" · CTR "}
                {pct(metrics.ctr)}
                {" · CPA "}
                {metrics.cpa === null ? "—" : usd(metrics.cpa)}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
