"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Banknote, Coins, Megaphone, Package, Percent, Receipt } from "lucide-react";
import Link from "@/components/nav/link";
import { MetricCard } from "@/components/overview/metric-card";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { FilterShell } from "@/components/filters/filter-shell";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { useNavTransition } from "@/lib/nav-progress";
import { useRouter } from "@/lib/brand-nav";
import type { DateRangeValue } from "@/lib/date-presets";
import { computeActual, type ActualResult, type BridgeStep, type RateSource } from "@/price-structure/actual/engine";
import type { ActualFacts, ActualMappings } from "@/price-structure/actual/facts";
import { int0, money0, pct1 } from "@/price-structure/format";
import { Num } from "../num";
import { PART_COLOR, productColor } from "../palette";
import { PsPageHeader } from "../ps-page-header";
import { SectionCard } from "../section-card";
import { useVersion } from "../version-provider";
import { StepBars, type StepBar } from "./step-bars";

const BRIDGE_LABEL: Record<BridgeStep["key"], string> = {
  plan: "Plan CML, same days",
  volume: "Orders",
  mix: "Product mix",
  delivery: "Delivery rate",
  price: "Prices sold",
  cogs: "Unit costs",
  ads: "Ad spend",
  notInPlan: "Not in the plan",
  actual: "Actual CML",
};
const BRIDGE_TIP: Partial<Record<BridgeStep["key"], string>> = {
  volume: "More or fewer mapped orders than the plan, at the plan's mix and prices.",
  mix: "A different share of offers than the plan.",
  delivery: "More or fewer of those orders delivered than the plan assumed.",
  price: "What each delivered order really brought in (sale prices, coupons, offers) against the plan's price.",
  cogs: "The real unit costs on each order's day against the version's unit costs.",
  ads: "Real ad spend against the plan's CPA or ROAS.",
  notInPlan: "Shipping and COD fees, unmapped SKUs, quantities with no offer, and orders without products.",
};
const RATE_SOURCE: Record<RateSource, string> = {
  method: "its own closed orders",
  brand: "the brand's closed orders (too few of its own)",
  version: "the version's delivery rate (no closed orders yet)",
};

export function ActualView({
  facts,
  mappings,
  from,
  to,
  resolvedRange,
}: {
  facts: ActualFacts;
  mappings: ActualMappings;
  /** Raw URL range (null when absent) and what it resolved to. */
  from: string | null;
  to: string | null;
  resolvedRange: DateRangeValue;
}) {
  const { open } = useVersion();
  const router = useRouter();
  const sp = useSearchParams();
  const [, startNav] = useNavTransition();
  const v = sp.get("v");
  const q = v ? `?v=${encodeURIComponent(v)}` : "";

  const data = open?.data ?? null;
  const plan = data ? (data.plans.find((p) => p.id === data.activePlanId) ?? null) : null;
  const r = useMemo(() => (data ? computeActual(facts, mappings, data, plan) : null), [facts, mappings, data, plan]);

  function setRange(nf: string | null, nt: string | null) {
    const p = new URLSearchParams(sp.toString());
    if (nf) p.set("from", nf);
    else p.delete("from");
    if (nt) p.set("to", nt);
    else p.delete("to");
    startNav(() => router.push(`?${p.toString()}`, { scroll: false }));
  }

  return (
    <div className="space-y-4">
      <PsPageHeader
        title="Actual"
        info="Real money from the store: delivered orders, plus open orders at their payment method's real delivery rate, minus COGS on each order's day and every platform's ad spend. Shipping and COD fees count as revenue; the shipping cost is outside CML."
      />
      <FilterShell
        filters={[]}
        tier1={({ fullWidth }) => (
          <DateRangePicker from={from} to={to} onChange={setRange} remember fullWidth={fullWidth} fallback={resolvedRange} />
        )}
        toolbar={() => (
          <Button asChild variant="outline" size="sm">
            <Link href={`/price-structure/actual/mapping${q}`}>SKU mapping</Link>
          </Button>
        )}
      />
      {!data || !r ? null : facts.orders.length === 0 ? (
        <Callout tone="info" size="md">
          No store orders in this range.
        </Callout>
      ) : (
        <ActualBody r={r} q={q} hasPlan={plan !== null} planName={plan?.name ?? ""} />
      )}
    </div>
  );
}

function ActualBody({ r, q, hasPlan, planName }: { r: ActualResult; q: string; hasPlan: boolean; planName: string }) {
  const withheld = !r.complete;
  const unmappedCount = r.unmapped.length;
  return (
    <>
      {withheld && (
        <Callout tone="warn" size="md">
          CML is withheld until every sold product has a cost:{" "}
          {r.uncostedUnits > 0 && (
            <>
              {int0(r.uncostedUnits)} {r.uncostedUnits === 1 ? "unit" : "units"} of {r.uncostedSkus.length}{" "}
              {r.uncostedSkus.length === 1 ? "product" : "products"} ({r.uncostedSkus.slice(0, 3).join(", ")}
              {r.uncostedSkus.length > 3 ? ", …" : ""}) have no cost on their order&rsquo;s day.{" "}
              <Link href="/store/costs" className="text-brand hover:underline">
                Add the costs
              </Link>
              {r.ordersWithoutProducts > 0 ? " · " : ""}
            </>
          )}
          {r.ordersWithoutProducts > 0 && (
            <>
              {int0(r.ordersWithoutProducts)} uploaded {r.ordersWithoutProducts === 1 ? "order has" : "orders have"} no products
              to cost. Choose a range inside the Salla feed.
            </>
          )}
        </Callout>
      )}
      {unmappedCount > 0 && (
        <Callout tone="info">
          {unmappedCount} {unmappedCount === 1 ? "SKU isn't" : "SKUs aren't"} mapped to a product of this version; their
          money counts in every total.{" "}
          <Link href={`/price-structure/actual/mapping${q}`} className="text-brand hover:underline">
            Map them
          </Link>
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-3 @5xl/main:grid-cols-6">
        <MetricCard
          label="CML"
          icon={Coins}
          value={withheld ? "Incomplete" : money0(r.cml)}
          caption={
            withheld ? undefined : (
              <span className="tabular-nums">
                {money0(r.settledCml)} settled · {money0(r.expectedCml)} expected
              </span>
            )
          }
          hideBreakdown
        />
        <MetricCard label="CML %" icon={Percent} value={withheld ? "—" : pct1(r.cmlPct)} hideBreakdown />
        <MetricCard label="Net revenue" icon={Banknote} value={money0(r.netRevenue)} caption="before VAT" hideBreakdown />
        <MetricCard
          label="COGS"
          icon={Package}
          value={withheld ? "—" : money0(r.cogs)}
          caption={withheld ? undefined : <span className="tabular-nums">{pct1(r.cogsPct)}</span>}
          hideBreakdown
        />
        <MetricCard
          label="Ad spend"
          icon={Megaphone}
          value={money0(r.adSpend)}
          caption={<span className="tabular-nums">{pct1(r.adPct)}</span>}
          hideBreakdown
        />
        <MetricCard
          label="Orders"
          icon={Receipt}
          value={int0(r.counts.all)}
          caption={
            <span className="tabular-nums">
              {int0(r.counts.delivered)} delivered · {int0(r.counts.open)} open · {int0(r.counts.lost)} lost
              {r.counts.uploaded > 0 ? ` · ${int0(r.counts.uploaded)} uploaded` : ""}
            </span>
          }
          hideBreakdown
        />
      </div>

      <div className="grid gap-4 @5xl/main:grid-cols-2">
        <Waterfall r={r} withheld={withheld} />
        <Bridge r={r} hasPlan={hasPlan} planName={planName} />
      </div>
      <OpenOrders r={r} />
      <ProductTable r={r} withheld={withheld} />
    </>
  );
}

function Waterfall({ r, withheld }: { r: ActualResult; withheld: boolean }) {
  const bars: StepBar[] = [
    { key: "total", label: "Store total", value: r.storeTotalInclVat, kind: "total" },
    { key: "vat", label: "VAT", value: -r.vat, kind: "step", color: "var(--ink-3)" },
    { key: "lost", label: "Lost orders", value: -r.lostNet, kind: "step", color: "var(--neg)" },
    { key: "fail", label: "Open, expected to fail", value: -r.openFailNet, kind: "step", color: "var(--neg)" },
    ...(r.uploadedNet !== 0
      ? ([{ key: "upfail", label: "Uploaded, expected to fail", value: -r.uploadedFailNet, kind: "step", color: "var(--neg)" }] satisfies StepBar[])
      : []),
    { key: "net", label: "Net revenue", value: r.netRevenue, kind: "total" },
    ...(withheld
      ? []
      : ([
          { key: "cogs", label: "COGS", value: -r.cogs, kind: "step", color: PART_COLOR.cogs },
          { key: "ads", label: "Ad spend", value: -r.adSpend, kind: "step", color: PART_COLOR.marketing },
          { key: "cml", label: "CML", value: r.cml, kind: "total", color: PART_COLOR.cml, strong: true },
        ] satisfies StepBar[])),
  ];
  return (
    <SectionCard
      title="From the store total to CML"
      subtitle="SAR"
      info="The store total is every order in the range, as Store · Insights counts it. Lost = cancelled, deleted or refunded; open orders count at their payment method's delivery rate."
    >
      <StepBars bars={bars} />
      <p className="mt-3 border-t border-line pt-2 text-xs text-ink-2 tabular-nums">
        Includes {money0(r.fees)} of shipping and COD fees
      </p>
    </SectionCard>
  );
}

function Bridge({ r, hasPlan, planName }: { r: ActualResult; hasPlan: boolean; planName: string }) {
  const reason =
    r.bridgeUnavailable === "incomplete"
      ? "Shown once CML is complete."
      : r.bridgeUnavailable === "no-plan" || !hasPlan
        ? "The open version's active plan has no orders."
        : r.bridgeUnavailable === "no-mapped-orders"
          ? "No order in this range is mapped to an offer yet."
          : null;
  const bars: StepBar[] = (r.bridge ?? []).map((s) => ({
    key: s.key,
    label: BRIDGE_LABEL[s.key],
    title: BRIDGE_TIP[s.key],
    value: s.value,
    kind: s.key === "plan" || s.key === "actual" ? "total" : "step",
    color: s.key === "actual" ? PART_COLOR.cml : s.key === "plan" ? undefined : s.value >= 0 ? "var(--ahead)" : "var(--behind)",
    strong: s.key === "actual",
  }));
  return (
    <SectionCard
      title="Plan → actual"
      subtitle={planName ? `${planName}, SAR` : "SAR"}
      info="The gap between the active plan's CML over the same days and the real CML, step by step. Blue = better than plan, amber = worse."
    >
      {reason ? <p className="text-sm text-ink-2">{reason}</p> : <StepBars bars={bars} signed />}
    </SectionCard>
  );
}

function OpenOrders({ r }: { r: ActualResult }) {
  type Row = ActualResult["open"][number];
  const columns: DataColumn<Row>[] = useMemo(
    () => [
      { key: "pm", label: "Payment method", pinned: true, render: (o) => o.paymentMethod, total: () => "Total" },
      { key: "open", label: "Open", align: "right", render: (o) => <span className="tabular-nums">{int0(o.open)}</span>, total: () => <span className="tabular-nums">{int0(r.counts.open)}</span> },
      {
        key: "rate",
        label: "Delivered when closed",
        align: "right",
        render: (o) => (
          <span className="tabular-nums" title={`From ${RATE_SOURCE[o.rateSource]}`}>
            {pct1(o.rate)}
            {o.rateSource !== "method" ? "*" : ""}
          </span>
        ),
        total: () => <span className="tabular-nums">{pct1(r.openNet === 0 ? 0 : r.openExpectedNet / r.openNet)}</span>,
      },
      { key: "openNet", label: "Net revenue", align: "right", render: (o) => <span className="tabular-nums">{money0(o.openNet)}</span>, total: () => <span className="tabular-nums">{money0(r.openNet)}</span> },
      { key: "expected", label: "Expected", align: "right", render: (o) => <span className="tabular-nums">{money0(o.expectedNet)}</span>, total: () => <span className="tabular-nums">{money0(r.openExpectedNet)}</span> },
    ],
    [r],
  );
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_ACTUAL_OPEN, hideable, defaults: hideable });
  return (
    <SectionCard
      title="Open orders"
      subtitle="SAR, before VAT"
      info="Each open order counts at the share of its payment method's orders that ended delivered, over the closed orders of the last 90 days. * = too few closed orders of its own: the brand's rate is used."
      contentClassName="px-0"
    >
      <DataTable<Row>
        columns={columns}
        rows={r.open}
        rowKey={(o) => o.paymentMethod}
        showTotals={r.open.length > 0}
        empty={<span className="text-xs text-ink-2">Every order in this range is closed.</span>}
        {...cols.tableProps}
      />
    </SectionCard>
  );
}

type PRow =
  | { kind: "product"; key: string; name: string; color: string; placed: number; revenue: number; cogs: number; ads: number | null; cml: number | null }
  | { kind: "offer"; key: string; name: string; placed: number; revenue: number; cogs: number }
  | { kind: "other"; key: string; name: string; placed: number | null; revenue: number | null; cogs: number | null; ads: number | null; cml: number; warn?: boolean };

function ProductTable({ r, withheld }: { r: ActualResult; withheld: boolean }) {
  const rows = useMemo<PRow[]>(() => {
    const out: PRow[] = [];
    for (const p of r.products) {
      out.push({ kind: "product", key: p.productId, name: p.name, color: productColor(p.colorSlot), placed: p.placed, revenue: p.revenue, cogs: p.cogs, ads: p.adSpend, cml: p.cml });
      for (const o of p.offers) out.push({ kind: "offer", key: `${p.productId}:${o.offerId ?? ""}`, name: o.name, placed: o.placed, revenue: o.revenue, cogs: o.cogs });
    }
    for (const u of r.unmapped)
      out.push({ kind: "other", key: `sku:${u.productKey}`, name: `${u.name ?? u.productKey} · ${u.notInVersion ? "not in this version" : "not mapped"}`, placed: u.placed, revenue: u.revenue, cogs: u.cogs, ads: null, cml: u.revenue - u.cogs, warn: true });
    if (r.fees !== 0) out.push({ kind: "other", key: "fees", name: "Shipping and COD fees", placed: null, revenue: r.fees, cogs: null, ads: null, cml: r.fees });
    if (r.withoutProductsNet !== 0) out.push({ kind: "other", key: "noproducts", name: "Orders without products", placed: null, revenue: r.withoutProductsNet, cogs: null, ads: null, cml: r.withoutProductsNet, warn: true });
    for (const a of r.adsNotMapped)
      out.push({ kind: "other", key: `ads:${a.productId}`, name: `Ads for ${a.productName} · not mapped`, placed: null, revenue: null, cogs: null, ads: a.spend, cml: -a.spend, warn: true });
    return out;
  }, [r]);

  const money = (v: number | null) => (v === null ? "" : money0(v));
  const columns: DataColumn<PRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Product · offer",
        pinned: true,
        render: (x) =>
          x.kind === "product" ? (
            <span className="inline-flex min-w-0 items-center gap-2 font-medium">
              <span className="size-2 shrink-0 rounded-full" style={{ background: x.color }} aria-hidden />
              <span className="truncate">{x.name}</span>
            </span>
          ) : x.kind === "offer" ? (
            <span className="truncate pl-4 text-ink-2">{x.name}</span>
          ) : (
            <span className={x.warn ? "truncate text-warn" : "truncate"}>{x.name}</span>
          ),
        total: () => "Total",
      },
      { key: "placed", label: "Orders", align: "right", render: (x) => <span className="tabular-nums">{x.placed === null ? "" : int0(x.placed)}</span> },
      { key: "revenue", label: "Net revenue", align: "right", render: (x) => <span className="tabular-nums">{money(x.revenue)}</span>, total: () => <span className="tabular-nums">{money0(r.netRevenue)}</span> },
      { key: "cogs", label: "COGS", align: "right", render: (x) => <span className="tabular-nums">{withheld ? "" : money(x.cogs)}</span>, total: () => <span className="tabular-nums">{withheld ? "—" : money0(r.cogs)}</span> },
      { key: "ads", label: "Ad spend", align: "right", render: (x) => <span className="tabular-nums">{x.kind === "offer" ? "" : money(x.ads)}</span>, total: () => <span className="tabular-nums">{money0(r.adSpend)}</span> },
      {
        key: "cml",
        label: "CML",
        align: "right",
        render: (x) => (x.kind === "offer" || withheld || x.cml === null ? "" : <Num value={x.cml} kind="money0" />),
        total: () => (withheld ? "—" : <Num value={r.cml} kind="money0" />),
      },
    ],
    [r, withheld],
  );
  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_ACTUAL_PRODUCTS, hideable, defaults: hideable });
  return (
    <SectionCard
      title="By product and offer"
      subtitle="SAR, before VAT"
      info="Orders = lines placed, whatever happened to them. Revenue and COGS count delivered lines plus open lines at their delivery rate. Ad spend follows each creative's Library product. The rows add up to the totals."
      contentClassName="px-0"
    >
      <DataTable<PRow>
        columns={columns}
        rows={rows}
        rowKey={(x) => x.key}
        rowClassName={(x) => (x.kind === "product" ? "bg-surface-2/40" : "")}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[720px]"
        empty={<span className="text-xs text-ink-2">No products sold in this range.</span>}
        {...cols.tableProps}
      />
    </SectionCard>
  );
}
