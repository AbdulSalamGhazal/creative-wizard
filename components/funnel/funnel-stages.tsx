"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight, TriangleAlert } from "lucide-react";
import { int, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FunnelOverview } from "@/db/queries/funnel";

/**
 * The funnel's job (the KPI tiles above show each rate; the line chart below
 * shows each rate over time) is the thing neither can: the JOURNEY — where you
 * leak the most people, and which step is the actionable bottleneck.
 *
 * Two views:
 *  - Drop-off: each bar's height is the step's retention (to/from), so a weak
 *    step is visibly tiny; the connector chips show the absolute people lost.
 *  - Bottleneck: the step that regressed most vs the previous period (proven,
 *    recoverable headroom) is flagged, with the conversions you'd win back by
 *    restoring it. If nothing regressed, the largest structural drop is named.
 */

type View = "dropoff" | "bottleneck";

type VolKey =
  | "impressions"
  | "clicks"
  | "landingPageViews"
  | "addToCart"
  | "addPayment"
  | "conversions";
type StepKey = "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate";

const STAGES: Array<{
  volKey: VolKey;
  label: string;
  short: string;
  color: string;
  stepKey?: StepKey;
}> = [
  { volKey: "impressions", label: "Impressions", short: "Impr", color: "#60A5FA" },
  { volKey: "clicks", label: "Clicks", short: "Clicks", color: "#34D399", stepKey: "ctr" },
  { volKey: "landingPageViews", label: "LP views", short: "LP", color: "#FBBF24", stepKey: "voc" },
  { volKey: "addToCart", label: "Add to cart", short: "ATC", color: "#22D3EE", stepKey: "atcRate" },
  { volKey: "addPayment", label: "Add payment", short: "AP", color: "#F472B6", stepKey: "apRate" },
  { volKey: "conversions", label: "Conversions", short: "Conv", color: "#A78BFA", stepKey: "purchaseRate" },
];

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

interface Step {
  i: number;
  to: number;
  from: number;
  lost: number;
  lostPct: number | null;
  retention: number | null;
  /** Relative change of this step's rate vs the prior period (null = n/a). */
  deltaPct: number | null;
}

const transition = (i: number) => `${STAGES[i - 1]!.short} → ${STAGES[i]!.short}`;

export function FunnelStages({ overview }: { overview: FunnelOverview }) {
  const [view, setView] = useState<View>("dropoff");
  const t = overview.current;

  const steps = useMemo<Step[]>(() => {
    const counts = STAGES.map((s) => t[s.volKey]);
    return STAGES.map((s, i) => {
      const to = counts[i] ?? 0;
      const from = i === 0 ? to : counts[i - 1] ?? 0;
      const lost = Math.max(from - to, 0);
      const d = s.stepKey ? overview.deltas[s.stepKey] : null;
      return {
        i,
        to,
        from,
        lost,
        lostPct: from > 0 ? lost / from : null,
        retention: i === 0 ? 1 : from > 0 ? to / from : null,
        deltaPct: d && d.mode === "pct" ? d.pct : null,
      };
    });
  }, [t, overview.deltas]);

  const conv = t.conversions;
  const impr = t.impressions;
  const overallRate = impr > 0 ? conv / impr : null;

  // Biggest single absolute drop (for the drop-off callout + highlight).
  const biggestLoss = useMemo(
    () =>
      steps
        .filter((s) => s.i > 0)
        .reduce<Step | null>((a, b) => (a && a.lost >= b.lost ? a : b), null),
    [steps],
  );

  // Bottleneck = the step that regressed most vs the prior period (recoverable);
  // if none regressed, fall back to the largest structural drop.
  const bottleneck = useMemo(() => {
    const regressed = steps.filter(
      (s) => s.i > 0 && s.deltaPct !== null && s.deltaPct < 0,
    );
    if (regressed.length) {
      const w = regressed.reduce((a, b) => (a.deltaPct! <= b.deltaPct! ? a : b));
      const p = w.deltaPct!; // negative
      const priorRate = w.retention !== null ? w.retention / (1 + p) : null;
      // Conversions are multiplicative across steps, so restoring this one step
      // from r_now to r_prior scales the final total by r_prior/r_now = 1/(1+p).
      const uplift = conv > 0 ? Math.round(conv * (-p / (1 + p))) : 0;
      return { index: w.i, kind: "regression" as const, priorRate, uplift, step: w };
    }
    if (biggestLoss)
      return {
        index: biggestLoss.i,
        kind: "structural" as const,
        priorRate: null,
        uplift: 0,
        step: biggestLoss,
      };
    return null;
  }, [steps, conv, biggestLoss]);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm text-ink-2">Funnel journey</h3>
          <p className="text-[10px] text-ink-3 max-w-lg">
            {view === "dropoff"
              ? "Bar height is each step's retention; the chips show how many people fall out. Where does the volume leak?"
              : "The step that slipped most vs the previous period — proven, recoverable headroom — and the conversions you'd win back."}
          </p>
        </div>
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[11px] shrink-0">
          {(
            [
              ["dropoff", "Drop-off"],
              ["bottleneck", "Bottleneck"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                view === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Callout — the one-line takeaway for the active view */}
      <div className="mb-4 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-[12px] leading-relaxed">
        {view === "dropoff" ? (
          <span className="text-ink-2">
            Of <span className="text-ink num">{compact.format(impr)}</span>{" "}
            impressions,{" "}
            <span className="text-ink num">{int(conv)}</span> reached purchase (
            <span className="text-ink num">{pct(overallRate)}</span>).
            {biggestLoss && (
              <>
                {" "}
                Biggest single drop-off:{" "}
                <span className="text-ink">{transition(biggestLoss.i)}</span> —{" "}
                <span className="text-neg num">
                  −{compact.format(biggestLoss.lost)} ({pct(biggestLoss.lostPct)})
                </span>
                .
              </>
            )}
          </span>
        ) : bottleneck && bottleneck.kind === "regression" ? (
          <span className="text-ink-2">
            <TriangleAlert className="inline w-3.5 h-3.5 text-warn mb-0.5 mr-1" />
            Bottleneck:{" "}
            <span className="text-ink">{transition(bottleneck.index)}</span>{" "}
            retention{" "}
            <span className="text-ink num">{pct(bottleneck.step.retention)}</span>{" "}
            is down{" "}
            <span className="text-neg num">
              {pct(Math.abs(bottleneck.step.deltaPct ?? 0))}
            </span>{" "}
            vs the previous period. Recovering to{" "}
            <span className="text-ink num">{pct(bottleneck.priorRate)}</span> would
            add about{" "}
            <span className="text-pos num">+{int(bottleneck.uplift)}</span>{" "}
            conversions.
          </span>
        ) : bottleneck ? (
          <span className="text-ink-2">
            Every step held or improved vs the previous period. The largest
            structural drop is{" "}
            <span className="text-ink">{transition(bottleneck.index)}</span> —{" "}
            <span className="text-neg num">
              −{compact.format(bottleneck.step.lost)} (
              {pct(bottleneck.step.lostPct)})
            </span>
            .
          </span>
        ) : (
          <span className="text-ink-3">No funnel data in this window.</span>
        )}
      </div>

      <div className="flex items-stretch gap-0.5 overflow-x-auto pb-1">
        {steps.map((s) => {
          const stage = STAGES[s.i]!;
          const isBottleneck = view === "bottleneck" && bottleneck?.index === s.i;
          const isBiggestLoss = view === "dropoff" && biggestLoss?.i === s.i;
          const barH =
            s.retention !== null ? Math.max(s.retention * 100, 1.5) : 1.5;
          return (
            <Fragment key={stage.volKey}>
              {s.i > 0 && (
                <Connector
                  view={view}
                  step={s}
                  highlight={isBottleneck || isBiggestLoss}
                />
              )}
              <div className="flex-1 min-w-[80px] flex flex-col justify-end items-center">
                <div
                  className="text-[11px] text-ink tabular-nums mb-1"
                  title={int(s.to)}
                >
                  {compact.format(s.to)}
                </div>
                <div
                  className={cn(
                    "w-full h-28 flex items-end rounded bg-surface-2/40 overflow-hidden",
                    isBottleneck && "ring-2 ring-warn/70",
                  )}
                >
                  <div
                    className="w-full rounded-t transition-all"
                    style={{
                      height: `${barH}%`,
                      background: stage.color,
                      opacity: 0.85,
                    }}
                  />
                </div>
                <div className="text-[10px] text-ink-2 mt-1.5 text-center leading-tight">
                  {stage.label}
                </div>
                {view === "dropoff" && s.i > 0 && (
                  <div className="text-[10px] text-ink-3 mt-0.5">
                    kept {pct(s.retention)}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function Connector({
  view,
  step,
  highlight,
}: {
  view: View;
  step: Step;
  highlight: boolean;
}) {
  return (
    <div className="shrink-0 w-14 flex flex-col items-center justify-center text-center gap-0.5">
      <ChevronRight className="w-4 h-4 text-ink-3" />
      {view === "dropoff" ? (
        <>
          <span
            className={cn(
              "text-[11px] tabular-nums leading-none",
              highlight ? "text-neg font-semibold" : "text-ink-2",
            )}
          >
            −{compact.format(step.lost)}
          </span>
          <span
            className={cn(
              "text-[9px] tabular-nums leading-none",
              highlight ? "text-neg" : "text-ink-3",
            )}
          >
            {pct(step.lostPct)} lost
          </span>
        </>
      ) : (
        <>
          {highlight && (
            <span className="text-[8px] uppercase tracking-wide text-warn leading-none">
              bottleneck
            </span>
          )}
          <span
            className={cn(
              "text-[11px] tabular-nums leading-none",
              highlight ? "text-ink font-semibold" : "text-ink-2",
            )}
          >
            {pct(step.retention)}
          </span>
          <DeltaArrow pct={step.deltaPct} />
        </>
      )}
    </div>
  );
}

function DeltaArrow({ pct: p }: { pct: number | null }) {
  if (p === null) return <span className="text-[9px] text-ink-3 leading-none">—</span>;
  const up = p >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center text-[9px] num leading-none",
        up ? "text-pos" : "text-neg",
      )}
    >
      <Icon className="w-3 h-3" />
      {up ? "+" : ""}
      {(p * 100).toFixed(0)}%
    </span>
  );
}
