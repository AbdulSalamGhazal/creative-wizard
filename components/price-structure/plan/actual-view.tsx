"use client";

import { useMemo } from "react";
import { Coins, DollarSign, Gauge, Percent, Scale, Target as TargetIcon } from "lucide-react";
import { MetricCard } from "@/components/overview/metric-card";
import { actualBlends, blend, planLines, roasFor, type Line } from "@/price-structure/engine/blend";
import { METRICS } from "@/price-structure/engine/metrics";
import { isRoasTargetMetric, resolveRoasTarget } from "@/price-structure/engine/targets";
import type { ActualPeriod, Plan, VersionData } from "@/price-structure/engine/types";
import { formatMetric, money0, pct2, roas2, signedPct1, usd0, usd2 } from "@/price-structure/format";
import { LADDER_COLOR } from "../palette";
import { RiyalBars, type RiyalRow } from "../riyal-bars";
import { SectionCard } from "../section-card";
import { useAccess } from "../version-provider";
import { useViewPref } from "../view-prefs";
import { CostShares } from "./cost-shares";
import { MixCompare, type MixGroup } from "./mix-compare";
import { PeriodDetails } from "./period-details";
import { PeriodOrdersTable } from "./period-orders-table";
import { RoasLadder, type LadderMark } from "./roas-ladder";
import { VerdictBox, verdictOf } from "./verdict-box";

/** Actual vs plan (brief §6.4) for one period: the verdict, tiles, cost shares, ladder, mix and the orders grid. */
export function ActualView({ data, period, plan, onChangePeriod }: { data: VersionData; period: ActualPeriod; plan: Plan; onChangePeriod: (fn: (p: ActualPeriod) => ActualPeriod) => void }) {
  const s = data.settings;
  const { edit } = useAccess();
  const [group, setGroup] = useViewPref<MixGroup>("plan.mixGroup", "product", ["product", "offer"]);
  const { lines, baked, actual, days } = useMemo(() => actualBlends(period, data.products, s), [period, data.products, s]);
  const planB = useMemo(() => blend(planLines(plan, data.products, s), s), [plan, data.products, s]);
  const planLs: Line[] = useMemo(() => planLines(plan, data.products, s), [plan, data.products, s]);
  const roasTarget = resolveRoasTarget(data.targets, data.roasTargetId);
  const target = roasTarget && isRoasTargetMetric(roasTarget.metric) ? { ...roasTarget, metric: roasTarget.metric } : null;
  const roasA = target ? roasFor(baked, target.metric, target.a) : NaN;
  const roasB = target ? roasFor(baked, target.metric, target.b) : NaN;
  const hasSpend = period.adSpendUsd > 0;
  const verdict = verdictOf(actual, baked, roasA, hasSpend, target !== null);
  const T = (x: number) => x * days;
  const short = target ? METRICS[target.metric].short : "";

  const marks: LadderMark[] = [
    ...(target
      ? [
          { key: "a", label: `Target A (${short} ${formatMetric(target.metric, target.a)})`, value: roasA, color: LADDER_COLOR.targetA },
          { key: "b", label: `Target B (${formatMetric(target.metric, target.b)})`, value: roasB, color: LADDER_COLOR.targetB },
        ]
      : []),
    { key: "baked", label: "Baked-in", value: baked.platformRoas, color: LADDER_COLOR.baked },
    { key: "plan", label: "Plan mix", value: planB.platformRoas, color: LADDER_COLOR.planMix },
    ...(hasSpend ? [{ key: "actual", label: "Actual", value: actual.platformRoas, color: LADDER_COLOR.actual }] : []),
    ...(period.metaRoas ? [{ key: "meta", label: "Meta reported", value: period.metaRoas, color: LADDER_COLOR.meta }] : []),
  ];

  const riyal = (label: string, b: typeof baked): RiyalRow => ({
    key: label,
    label,
    netRevenue: b.netRevenue,
    parts: { cml: b.profit, cogs: b.cogs, marketing: b.adSpend, undelivered: b.undelivered },
    emphasis: true,
  });

  return (
    <>
      <fieldset disabled={!edit} className="min-w-0">
        <PeriodDetails period={period} settings={s} onChange={onChangePeriod} />
      </fieldset>
      {verdict ? (
        <VerdictBox verdict={verdict} actual={actual} baked={baked} planB={planB} days={days} usdToSar={s.usdToSar} />
      ) : (
        <p className="rounded-md border border-line bg-surface-2/40 px-3 py-2 text-xs text-ink-2">
          {baked.orders === 0 ? "Enter the period's orders per offer below to compare ROAS." : "Enter the period's ad spend to compare ROAS."}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Actual ROAS" value={hasSpend ? roas2(actual.platformRoas) : "—"} icon={Gauge} hideBreakdown footer={period.metaRoas ? `Meta reported ${roas2(period.metaRoas)}` : hasSpend ? `Accountant view ${roas2(actual.accountantRoas)}` : undefined} />
        <MetricCard label="Baked-in ROAS (this mix)" value={roas2(baked.platformRoas)} icon={Scale} hideBreakdown footer={`Plan mix needed ${roas2(planB.platformRoas)}`} />
        <MetricCard
          label="Gap to baked-in"
          value={verdict ? signedPct1(verdict.gap) : "—"}
          icon={TargetIcon}
          hideBreakdown
          footer={
            <span className="flex flex-wrap items-center gap-2">
              {verdict && <span className={verdict.gap >= 0 ? "text-pos" : "text-neg"}>{verdict.gap >= 0 ? "ahead" : "behind"}</span>}
              <span>{target ? `Target A needs ${roas2(roasA)}` : `CML ${pct2(actual.margin)} of net revenue`}</span>
            </span>
          }
        />
        <MetricCard label="Ad spend" value={usd0(period.adSpendUsd)} icon={DollarSign} hideBreakdown footer={`Baked-in ${usd0(T(baked.adSpend) / s.usdToSar)}`} />
        <MetricCard label="Blended CPA" value={hasSpend ? usd2(actual.cpaUsd) : "—"} icon={Coins} hideBreakdown footer={`Baked-in ${usd2(baked.cpaUsd)}`} />
        <MetricCard label="CML" value={hasSpend ? `${money0(T(actual.profit))} SAR` : "—"} icon={Percent} hideBreakdown footer={`At baked-in ROAS ${money0(T(baked.profit))}`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <CostShares
          title="Cost shares: actual vs baked-in"
          subtitle="COGS follows what you sold. Marketing compares real ad spend with what the baked-in CPAs allow."
          columns={[...(hasSpend ? [{ label: "Actual", blend: actual, mult: days }] : []), { label: "At baked-in ROAS", blend: baked, mult: days }]}
          sarLabel={`SAR, ${period.name}`}
        />
        <SectionCard title="Where each riyal goes" subtitle={`${period.name}, whole period`}>
          <RiyalBars rows={[...(hasSpend ? [riyal("Actual", actual)] : []), riyal("At baked-in ROAS", baked)]} mode="pct" />
        </SectionCard>
      </div>
      <RoasLadder title="ROAS ladder" subtitle="Where actual ROAS landed against the levels for the mix you sold." marks={marks} targetA={target ? roasA : null} />
      <MixCompare planLines={planLs} actualLines={lines} planName={plan.name} periodName={period.name} group={group} onGroup={setGroup} />
      <fieldset disabled={!edit} className="min-w-0">
        <PeriodOrdersTable period={period} products={data.products} lines={lines} baked={baked} onChange={onChangePeriod} />
      </fieldset>
    </>
  );
}
