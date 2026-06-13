import Link from "next/link";
import {
  ArrowRight,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ratio, usd } from "@/lib/format";
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

const WINDOWS = [
  { key: "w1" as const, label: "Days 1–7", startsAt: 0 },
  { key: "w2" as const, label: "Days 8–30", startsAt: 7 },
  { key: "w3" as const, label: "Days 31–90", startsAt: 30 },
];

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

function StatusBadge({
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

/** Portfolio summary across every launch in view: the blended ROAS decay curve
 *  and a verdict tally. */
export function LaunchFatigueSummary({
  count,
  totalSpend,
  counts,
  w1,
  w2,
  w3,
  drop,
}: {
  count: number;
  totalSpend: number;
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
  return (
    <div className="rounded-lg border border-line bg-surface p-4 flex flex-wrap items-center gap-x-8 gap-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Launches in view
        </div>
        <div className="font-display text-2xl text-ink leading-none mt-1">
          {count}
        </div>
        <div className="text-[11px] text-ink-3 mt-1">{usd(totalSpend)} spend</div>
      </div>

      {/* Blended ROAS decay curve across all launches. */}
      <div className="flex items-center gap-3">
        <CurvePoint label="Launch wk" metrics={w1} w1Roas={null} />
        <ArrowRight className="w-4 h-4 text-ink-3 shrink-0" />
        <CurvePoint label="Days 8–30" metrics={w2} w1Roas={w1.roas} />
        <ArrowRight className="w-4 h-4 text-ink-3 shrink-0" />
        <CurvePoint label="Days 31–90" metrics={w3} w1Roas={w1.roas} />
      </div>

      {drop !== null && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
            Portfolio fatigue
          </div>
          <div
            className={cn(
              "font-display text-2xl leading-none mt-1 tabular-nums",
              drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink",
            )}
          >
            {fmtPct(-drop)}
          </div>
          <div className="text-[11px] text-ink-3 mt-1">launch wk → latest</div>
        </div>
      )}

      <div className="ml-auto flex flex-wrap gap-1.5">
        {chipOrder
          .filter((t) => counts[t] > 0)
          .map((t) => (
            <span
              key={t}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 px-2 rounded-md border text-[11px]",
                TIER_META[t].badge,
              )}
            >
              {tierLabel(t, 99)}
              <span className="font-semibold tabular-nums">{counts[t]}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function CurvePoint({
  label,
  metrics,
  w1Roas,
}: {
  label: string;
  metrics: FatigueWindowMetrics;
  w1Roas: number | null;
}) {
  const delta =
    w1Roas !== null && w1Roas > 0 && metrics.roas !== null
      ? (metrics.roas - w1Roas) / w1Roas
      : null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
      <div className="font-display text-2xl text-ink leading-none mt-1 tabular-nums">
        {metrics.roas === null ? (
          <span className="text-ink-3">—</span>
        ) : (
          <>{ratio(metrics.roas)}×</>
        )}
        {delta !== null && (
          <span
            className={cn(
              "ml-1.5 text-[12px] font-sans",
              delta < -0.001 ? "text-neg" : delta > 0.001 ? "text-pos" : "text-ink-3",
            )}
          >
            {fmtPct(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

export function LaunchFatigueTable({ rows }: { rows: LaunchFatigueViewRow[] }) {
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
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-[12px] num min-w-max">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
            <th className="font-medium px-3 py-2.5">Status</th>
            <th className="font-medium px-3 py-2.5">Creative</th>
            <th className="font-medium px-3 py-2.5">Launched</th>
            <th className="font-medium px-3 py-2.5 text-right">Spend</th>
            {WINDOWS.map((w) => (
              <th key={w.key} className="font-medium px-3 py-2.5 text-right border-l border-line">
                {w.label}
              </th>
            ))}
            <th className="font-medium px-3 py-2.5 text-right border-l border-line">
              Fatigue
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const a = r.assessment;
            const w1Roas = a.w1.roas;
            const drop = a.drop;
            return (
              <tr
                key={r.creativeId}
                className={cn(
                  "hover:bg-surface-2/40 transition-colors",
                  TIER_META[a.tier].row,
                  a.tier === "low" && "opacity-60",
                )}
              >
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <StatusBadge tier={a.tier} daysSinceLaunch={r.daysSinceLaunch} />
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={r.href}
                    title={r.name}
                    className="font-medium text-ink hover:text-brand transition-colors"
                  >
                    {r.name}
                  </Link>
                  <div className="text-[11px] text-ink-3">
                    {r.productName} · {r.type}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-ink-2">
                  {r.launchDate}
                  {r.derived && (
                    <span
                      className="ml-1 text-ink-3"
                      title="No manual launch date — using the first day with spend."
                    >
                      (est.)
                    </span>
                  )}
                  <div className="text-[11px] text-ink-3">{r.daysSinceLaunch}d ago</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-2 whitespace-nowrap">
                  {usd(a.w1.spend + a.w2.spend + a.w3.spend)}
                </td>
                {WINDOWS.map((w) => (
                  <RoasCell
                    key={w.key}
                    metrics={a[w.key]}
                    notStarted={r.daysSinceLaunch < w.startsAt}
                    w1Roas={w.key === "w1" ? null : w1Roas}
                  />
                ))}
                <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-line">
                  {drop === null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <span
                      className={cn(
                        "font-medium",
                        drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink-2",
                      )}
                    >
                      {fmtPct(-drop)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoasCell({
  metrics,
  notStarted,
  w1Roas,
}: {
  metrics: FatigueWindowMetrics;
  notStarted: boolean;
  w1Roas: number | null;
}) {
  const delta =
    w1Roas !== null && w1Roas > 0 && metrics.roas !== null
      ? (metrics.roas - w1Roas) / w1Roas
      : null;

  return (
    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-line">
      {notStarted ? (
        <span className="text-ink-3" title="The creative isn't this old yet.">
          —
        </span>
      ) : metrics.roas === null ? (
        <span className="text-ink-3" title="No spend in this window.">
          —
        </span>
      ) : (
        <span className="text-ink">
          {ratio(metrics.roas)}×
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
      )}
    </td>
  );
}
