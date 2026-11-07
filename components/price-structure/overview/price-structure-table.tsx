"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { InfoTip } from "@/components/ui/info-tip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TABLE_KEYS } from "@/lib/table-columns";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import type { Evaluated, OfferRow } from "@/price-structure/engine/all-offers";
import { mechanicText } from "@/price-structure/engine/mechanics";
import { METRICS, metricValue, rankCompare } from "@/price-structure/engine/metrics";
import type { MetricKey, Product } from "@/price-structure/engine/types";
import { money0, targetText } from "@/price-structure/format";
import { Num } from "../num";
import { productColor } from "../palette";
import { RoasTargetPicker } from "../roas-target-picker";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

export type CostView = "pct" | "sar";

type Row =
  | { kind: "product"; key: string; product: Product }
  | { kind: "offer"; key: string; row: OfferRow };

/**
 * The "Price structure" table (brief §6.1): every offer, grouped under its
 * product or ranked by the chart metric. Costs read as % of net revenue or
 * SAR. A row click opens the offer on Products & offers.
 */
/** The offer's editor (a product row opens its first offer), keeping `?v=`. */
function offerHref(r: Row, v: string | null): string {
  const pid = r.kind === "product" ? r.product.id : r.row.product.id;
  const oid = r.kind === "product" ? r.product.offers[0]?.id : r.row.offer.id;
  return `/price-structure/products/${pid}${oid ? `/${oid}` : ""}${v ? `?v=${v}` : ""}`;
}

export function PriceStructureTable({
  evaluated,
  grouping,
  onGrouping,
  costView,
  onCostView,
  chartMetric,
}: {
  evaluated: Evaluated;
  grouping: "grouped" | "ranked";
  /** The table's order (R-077: the control sits in the table's own header,
   *  beside what it changes — it also orders the riyal bars below). */
  onGrouping: (g: "grouped" | "ranked") => void;
  costView: CostView;
  onCostView: (v: CostView) => void;
  chartMetric: MetricKey;
}) {
  const router = useRouter();
  const v = useSearchParams().get("v");
  const [, startNav] = useNavTransition();
  const { rows: offers, roasTarget } = evaluated;
  const hasUndelivered = offers.some((o) => o.r.undelivered > 0);
  const pctMode = costView === "pct";

  const rows = useMemo<Row[]>(() => {
    if (grouping === "ranked") {
      const cmp = rankCompare(chartMetric);
      return [...offers]
        .sort((a, b) => cmp(metricValue(a.r, chartMetric), metricValue(b.r, chartMetric)))
        .map((row) => ({ kind: "offer", key: row.offer.id, row }));
    }
    const out: Row[] = [];
    let last: string | null = null;
    for (const row of offers) {
      if (row.product.id !== last) {
        out.push({ kind: "product", key: `p-${row.product.id}`, product: row.product });
        last = row.product.id;
      }
      out.push({ kind: "offer", key: row.offer.id, row });
    }
    return out;
  }, [offers, grouping, chartMetric]);

  const cost = (sar: number, pct: number, title: string) =>
    pctMode ? <Num value={pct} kind="pct2" title={title} red={false} /> : <Num value={sar} kind="money2" title={title} red={false} />;

  const targetA = roasTarget ? targetText(roasTarget.metric, roasTarget.a) : null;
  const targetB = roasTarget ? targetText(roasTarget.metric, roasTarget.b) : null;

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const offerCell = (r: Row) => {
      if (r.kind === "product") {
        return (
          <span className="inline-flex max-w-full items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: productColor(r.product.colorSlot) }} aria-hidden />
            <span className="truncate font-medium text-ink" dir="auto" title={r.product.name}>
              {r.product.name}
            </span>
            <span className="hidden truncate text-ink-3 tabular-nums sm:inline">
              cost {money0(r.product.unitCost)} · price {money0(r.product.price)} SAR
            </span>
          </span>
        );
      }
      const { offer, product } = r.row;
      const text = mechanicText(offer.mechanic);
      return (
        <span className={cn("flex max-w-full items-start gap-2", grouping === "grouped" && "pl-4")}>
          {grouping === "ranked" && (
            <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: productColor(product.colorSlot) }} aria-hidden />
          )}
          <span className="min-w-0">
            <span className="block truncate text-ink" dir="auto" title={offer.name}>
              {offer.name}
            </span>
            {grouping === "ranked" ? (
              <span className="block truncate text-[10px] text-ink-2" dir="auto">{product.name}</span>
            ) : (
              text !== offer.name && <span className="block truncate text-[10px] text-ink-2">{text}</span>
            )}
          </span>
        </span>
      );
    };
    const only = (fn: (row: OfferRow) => React.ReactNode) => (r: Row) => (r.kind === "offer" ? fn(r.row) : "");
    const cols: DataColumn<Row>[] = [
      // A real link (keyboard, new tab — R-008); the row click goes there too.
      { key: "offer", label: "Offer", pinned: true, render: offerCell, href: (r) => offerHref(r, v) },
      { key: "units", label: "Units", align: "right", render: only((o) => <span className="tabular-nums">{o.r.units}</span>) },
      { key: "list", label: "List price", align: "right", render: only((o) => <Num value={o.r.listPrice} kind="money2" title="List price of the units in the order" />) },
      { key: "pays", label: "Customer pays", align: "right", render: only((o) => <Num value={o.r.paidGross} kind="money2" title="Incl. VAT, after all discounts" />) },
      { key: "discount", label: "Discount", align: "right", render: only((o) => <Num value={o.r.discount} kind="pct1" title="Effective discount off list" red={false} />) },
      { key: "cogs", label: "COGS", align: "right", render: only((o) => cost(o.r.cogs, o.r.cogsPct, "Product cost per delivered order")) },
      { key: "marketing", label: "Marketing", align: "right", render: only((o) => cost(o.r.marketing, o.r.marketingPct, "Ad spend per placed order ÷ delivery rate")) },
    ];
    if (hasUndelivered) {
      cols.push({ key: "undelivered", label: "Undelivered", align: "right", render: only((o) => cost(o.r.undelivered, o.r.undeliveredPct, "Undelivered-order cost carried by each delivered order")) });
    }
    cols.push(
      { key: "cmlPct", label: "CML %", align: "right", render: only((o) => <Num value={o.r.margin} kind="pct2" title="CML ÷ net revenue" />) },
      { key: "cml", label: "CML", align: "right", render: only((o) => <Num value={o.r.profit} kind="money2" title="Clean Money Left: net revenue − COGS − marketing" />) },
      { key: "cmlUnit", label: "CML / unit", align: "right", render: only((o) => <Num value={o.r.profitPerUnit} kind="money2" title="CML ÷ units in the order" />) },
      { key: "cpa", label: "CPA $", align: "right", render: only((o) => <Num value={o.r.cpaUsd} kind="usd2" title="Ad spend per placed order" />) },
      { key: "platformRoas", label: "Platform ROAS", align: "right", render: only((o) => <Num value={o.r.platformRoas} kind="roas" title="What the ad platform shows" />) },
      { key: "acctRoas", label: "Acct. ROAS", align: "right", render: only((o) => <Num value={o.r.accountantRoas} kind="roas" title="Net revenue ex VAT from delivered orders ÷ (ad spend + undelivered cost)" />) },
    );
    if (roasTarget) {
      cols.push(
        { key: "roasA", label: "ROAS for A", align: "right", render: only((o) => <Num value={o.roasA} kind="roas" title={`Platform ROAS needed for ${targetA}`} />) },
        { key: "roasB", label: "ROAS for B", align: "right", render: only((o) => <Num value={o.roasB} kind="roas" title={`Platform ROAS needed for ${targetB}`} />) },
      );
    }
    cols.push({
      key: "status",
      label: "Status",
      align: "right",
      render: only((o) => (o.overall ? <StatusBadge status={o.overall} compact /> : <span className="text-ink-3">—</span>)),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouping, hasUndelivered, roasTarget, pctMode, targetA, targetB, v]);

  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_OVERVIEW, hideable, defaults: hideable });

  const openOffer = (r: Row) => startNav(() => router.push(offerHref(r, v)));

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          Price structure
          <InfoTip label="Column definitions">
            <ul className="space-y-1">
              <li>Click a row to edit that offer.</li>
              <li><b>List price</b>: list price of the units in the order.</li>
              <li><b>CML</b>: Clean Money Left — net revenue − COGS − marketing.</li>
              <li><b>Platform ROAS</b>: what the ad platform shows.</li>
              <li><b>Acct. ROAS</b>: net revenue ex VAT from delivered orders ÷ (ad spend + undelivered cost).</li>
              {roasTarget && <li><b>ROAS for A / B</b>: platform ROAS needed for {targetA} / {targetB}.</li>}
            </ul>
          </InfoTip>
        </span>
      }
      actions={
        <>
          <SegmentedControl<"grouped" | "ranked">
            ariaLabel="Table order"
            value={grouping}
            onChange={onGrouping}
            options={[
              { value: "grouped", label: "Group by product" },
              { value: "ranked", label: `Rank by ${METRICS[chartMetric].short}` },
            ]}
          />
          <RoasTargetPicker />
          <SegmentedControl<CostView>
            ariaLabel="Cost columns"
            value={costView}
            onChange={onCostView}
            options={[
              { value: "pct", label: "Costs as %" },
              { value: "sar", label: "Costs in SAR" },
            ]}
          />
        </>
      }
      contentClassName="px-0"
    >
      <DataTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        onRowClick={openOffer}
        rowClassName={(r) => (r.kind === "product" ? "bg-surface-2/40" : "")}
        minWidthClass="min-w-[1100px]"
        {...cols.tableProps}
      />
    </SectionCard>
  );
}
