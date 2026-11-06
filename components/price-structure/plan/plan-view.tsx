"use client";

import { useCallback, useMemo, useState } from "react";
import { Coins, DollarSign, Gauge, Package, Receipt, Target as TargetIcon } from "lucide-react";
import { MetricCard } from "@/components/overview/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { blend, planLines, roasFor } from "@/price-structure/engine/blend";
import { newId } from "@/price-structure/engine/ids";
import { METRICS } from "@/price-structure/engine/metrics";
import { evenPlan } from "@/price-structure/engine/sample";
import { isRoasTargetMetric, resolveRoasTarget } from "@/price-structure/engine/targets";
import type { ActualPeriod, Plan } from "@/price-structure/engine/types";
import { formatMetric, money0, num2, pct2, roas2, usd0, usd2 } from "@/price-structure/format";
import { LADDER_COLOR, productColor } from "../palette";
import { PsPageHeader } from "../ps-page-header";
import { RiyalBars, type RiyalRow } from "../riyal-bars";
import { RoasTargetPicker } from "../roas-target-picker";
import { SectionCard } from "../section-card";
import { useVersion } from "../version-provider";
import { useViewPref } from "../view-prefs";
import { ActualPeriodsCard } from "./actual-periods-card";
import { ActualView } from "./actual-view";
import { CostShares } from "./cost-shares";
import { OfferRoasChart } from "./offer-roas-chart";
import { PlanBreakdown } from "./plan-breakdown";
import { PERIOD_LABEL, PERIOD_MULT, PlanToolbar, type Period } from "./plan-toolbar";
import { RoasLadder, type LadderMark } from "./roas-ladder";
import { SalesMix } from "./sales-mix";

type Mode = "plan" | "actual";

const INTRO =
  "Split your daily orders across products and offers to see the baked-in ROAS: the account-level ROAS your price structure needs from that mix. Then load a past month to see how far actual ROAS was from it.";

/** Plan (brief §6.4): the sales mix → baked-in ROAS, and actual vs plan. */
export function PlanView() {
  const { open: version, updateData, access } = useVersion();
  const v = useSearchParams().get("v");
  // A viewer may look at any plan; the choice stays in this tab, not on the version.
  const [viewPlanId, setViewPlanId] = useState<string | null>(null);
  const [mode, setMode] = useViewPref<Mode>("plan.mode", "plan", ["plan", "actual"]);
  const [period, setPeriod] = useViewPref<Period>("plan.period", "day", ["day", "week", "month"]);
  const [selectedPeriodId, setSelectedPeriodId] = useViewPref<string>("plan.selectedPeriod", "");
  const [compareIdRaw, setCompareId] = useViewPref<string>("plan.comparePlan", "");
  const data = version?.data;

  const plan = useMemo(() => {
    const wanted = access.edit ? data?.activePlanId : (viewPlanId ?? data?.activePlanId);
    return data?.plans.find((p) => p.id === wanted) ?? data?.plans[0] ?? null;
  }, [data, access.edit, viewPlanId]);
  const setPlan = useCallback(
    (id: string, fn: (p: Plan) => Plan) => updateData(`data.plans.${id}`, (d) => ({ ...d, plans: d.plans.map((p) => (p.id === id ? fn(p) : p)) })),
    [updateData],
  );
  const selectPlan = useCallback(
    (id: string) => (access.edit ? updateData("data.activePlanId", (d) => ({ ...d, activePlanId: id })) : setViewPlanId(id)),
    [updateData, access.edit],
  );
  const addPlan = useCallback(
    (next: Plan) => updateData([`data.plans.${next.id}`, "data.activePlanId"], (d) => ({ ...d, plans: [...d.plans, next], activePlanId: next.id })),
    [updateData],
  );
  const deletePlan = useCallback(
    (id: string) =>
      updateData([`data.plans.${id}`, "data.activePlanId"], (d) => {
        const plans = d.plans.filter((p) => p.id !== id);
        return { ...d, plans, activePlanId: plans[0]?.id ?? d.activePlanId };
      }),
    [updateData],
  );
  const setActual = useCallback(
    (id: string, fn: (p: ActualPeriod) => ActualPeriod) => updateData(`data.actuals.${id}`, (d) => ({ ...d, actuals: d.actuals.map((a) => (a.id === id ? fn(a) : a)) })),
    [updateData],
  );
  const addActual = useCallback(
    (p: ActualPeriod) => {
      updateData(`data.actuals.${p.id}`, (d) => ({ ...d, actuals: [...d.actuals, p] }));
      setSelectedPeriodId(p.id);
    },
    [updateData, setSelectedPeriodId],
  );
  const deleteActual = useCallback(
    (id: string) => updateData(`data.actuals.${id}`, (d) => ({ ...d, actuals: d.actuals.filter((a) => a.id !== id) })),
    [updateData],
  );

  if (!version || !data || !plan) return <PsPageHeader title="Plan" info={INTRO} />;
  const s = data.settings;
  const products = data.products;
  const mult = PERIOD_MULT[period];
  const per = PERIOD_LABEL[period];

  const header = (
    <>
      <PsPageHeader title="Plan" info={INTRO} />
      <div className="flex justify-end">
        <SegmentedControl<Mode>
          ariaLabel="Plan page mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "plan", label: "Plan" },
            { value: "actual", label: "Actual vs plan" },
          ]}
        />
      </div>
    </>
  );

  if (products.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="No products yet"
          hint="A plan splits daily orders across products and offers; add some first."
          action={
            <Button asChild size="sm">
              <Link href={`/price-structure/products${v ? `?v=${v}` : ""}`}>Add your first product</Link>
            </Button>
          }
        />
      </>
    );
  }

  if (mode === "actual") {
    const selected = data.actuals.find((a) => a.id === selectedPeriodId) ?? data.actuals[0] ?? null;
    const compare = data.plans.find((p) => p.id === compareIdRaw) ?? plan;
    return (
      <>
        {header}
        <ActualPeriodsCard
          products={products}
          plans={data.plans}
          periods={data.actuals}
          selectedId={selected?.id ?? null}
          compareId={compare.id}
          onSelect={setSelectedPeriodId}
          onCompare={setCompareId}
          onAdd={addActual}
          onDelete={deleteActual}
          readOnly={!access.edit}
        />
        {selected && <ActualView data={data} period={selected} plan={compare} onChangePeriod={(fn) => setActual(selected.id, fn)} />}
      </>
    );
  }

  const lines = planLines(plan, products, s);
  const b = blend(lines, s);
  const roasTarget = resolveRoasTarget(data.targets, data.roasTargetId);
  const target = roasTarget && isRoasTargetMetric(roasTarget.metric) ? { ...roasTarget, metric: roasTarget.metric } : null;
  const roasA = target ? roasFor(b, target.metric, target.a) : NaN;
  const roasB = target ? roasFor(b, target.metric, target.b) : NaN;
  const short = target ? METRICS[target.metric].short : "";
  const marks: LadderMark[] = [
    ...(target
      ? [
          { key: "a", label: `Target A (${short} ${formatMetric(target.metric, target.a)})`, value: roasA, color: LADDER_COLOR.targetA },
          { key: "b", label: `Target B (${formatMetric(target.metric, target.b)})`, value: roasB, color: LADDER_COLOR.targetB },
        ]
      : []),
    { key: "baked", label: "Baked-in", value: b.platformRoas, color: LADDER_COLOR.baked },
  ];
  const riyalRows: RiyalRow[] = [
    { key: "all", label: "Whole plan", netRevenue: b.netRevenue, parts: { cml: b.profit, cogs: b.cogs, marketing: b.adSpend, undelivered: b.undelivered }, emphasis: true },
    ...products
      .map((p) => ({ p, pb: blend(lines.filter((l) => l.product.id === p.id), s) }))
      .filter(({ pb }) => pb.orders > 0)
      .map(({ p, pb }) => ({
        key: p.id,
        label: p.name,
        color: productColor(p.colorSlot),
        netRevenue: pb.netRevenue,
        parts: { cml: pb.profit, cogs: pb.cogs, marketing: pb.adSpend, undelivered: pb.undelivered },
      })),
  ];

  return (
    <>
      {header}
      <PlanToolbar
        plans={data.plans}
        plan={plan}
        period={period}
        onPeriod={setPeriod}
        onSelect={selectPlan}
        onChange={(fn) => setPlan(plan.id, fn)}
        onDuplicate={() => addPlan({ ...plan, id: newId(), name: `${plan.name} (copy)` })}
        onNew={() => addPlan(evenPlan("New plan", products))}
        onDelete={() => deletePlan(plan.id)}
        readOnly={!access.edit}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Baked-in ROAS" value={roas2(b.platformRoas)} icon={Gauge} hideBreakdown footer={`Accountant ROAS ${roas2(b.accountantRoas)}`} />
        <MetricCard
          label="ROAS for A / B"
          value={target ? `${roas2(roasA)} / ${roas2(roasB)}` : "—"}
          icon={TargetIcon}
          hideBreakdown
          footer={
            target ? (
              `For ${short} ${formatMetric(target.metric, target.a)} / ${formatMetric(target.metric, target.b)}`
            ) : (
              <Link href={`/price-structure/targets${v ? `?v=${v}` : ""}`} className="text-brand hover:underline">
                Set a CML target
              </Link>
            )
          }
        />
        <MetricCard label={`Ad budget ${per}`} value={usd0((b.adSpend / s.usdToSar) * mult)} icon={DollarSign} hideBreakdown footer={`${money0(b.adSpend * mult)} SAR · CPA ${usd2(b.cpaUsd)}`} />
        <MetricCard label={`Orders ${per}`} value={num2(b.orders * mult)} icon={Package} hideBreakdown footer={`${num2(b.delivered * mult)} delivered · ${num2(b.units * mult)} units`} />
        <MetricCard label={`Revenue ${per}`} value={`${money0(b.gross * mult)} SAR`} icon={Receipt} hideBreakdown footer={`Incl. VAT · net ${money0(b.netRevenue * mult)}`} />
        <MetricCard label={`CML ${per}`} value={`${money0(b.profit * mult)} SAR`} icon={Coins} hideBreakdown footer={`CML ${pct2(b.margin)} of net revenue`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <CostShares subtitle="The plan's blended cost structure, as a share of net revenue (ex VAT, delivered orders)." columns={[{ label: "Plan", blend: b, mult }]} sarLabel={`SAR ${per}`} />
        <RiyalCard rows={riyalRows} />
      </div>
      <RoasLadder
        title="ROAS ladder"
        subtitle="The whole-account ROAS that matters for this mix. Hit the baked-in ROAS and every offer is on its planned CPA."
        actions={<RoasTargetPicker />}
        marks={marks}
        targetA={target ? roasA : null}
      />
      <SalesMix plan={plan} products={products} settings={s} lines={lines} total={b} actuals={data.actuals} mult={mult} perLabel={per} onChange={(fn) => setPlan(plan.id, fn)} readOnly={!access.edit} />
      <OfferRoasChart lines={lines} total={b} />
      <PlanBreakdown lines={lines} total={b} products={products} settings={s} mult={mult} perLabel={per} />
    </>
  );
}

function RiyalCard({ rows }: { rows: RiyalRow[] }) {
  const [mode, setMode] = useViewPref<"pct" | "sar">("plan.riyalMode", "pct", ["pct", "sar"]);
  return (
    <SectionCard
      title="Where each riyal goes"
      subtitle="The whole plan, then each product with orders."
      actions={
        <SegmentedControl<"pct" | "sar">
          ariaLabel="Riyal bars unit"
          value={mode}
          onChange={setMode}
          options={[
            { value: "pct", label: "%" },
            { value: "sar", label: "SAR" },
          ]}
        />
      }
    >
      <RiyalBars rows={rows} mode={mode} />
    </SectionCard>
  );
}
