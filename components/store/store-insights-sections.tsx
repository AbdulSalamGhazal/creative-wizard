"use client";

import { useMemo, type ReactNode } from "react";
import Link from "@/components/nav/link";
import { Chip } from "@/components/ui/chip";
import { InfoTip } from "@/components/ui/info-tip";
import { panelClass } from "@/components/ui/panel";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { cn } from "@/lib/utils";
import { int, num, pct1, sar0, sarBare } from "@/lib/format";
import {
  OTHER_VALUE,
  aov,
  avgDeliveryDays,
  foldSection,
  grossProfit,
  rate,
  share,
  type LensSums,
  type LensValue,
  type SectionLens,
  type SectionRow,
} from "@/lib/store-insights";
import { orderStatusLabel, orderStatusTone } from "@/store/order-status";
import { paymentMethodLabel } from "@/store/payment-methods";
import type {
  StoreInsightsKpis,
  StoreInsightsProduct,
  StoreInsightsProducts,
} from "@/db/queries/store-insights";

/**
 * Store → Insights, the decision sections (2026-11-27, user-chosen): Products
 * and margin · Payment and outcome · Customers and cities · Discounts and
 * offers. Presentational only — every figure is a sum the server scanned over
 * the SAME filtered orders as the KPI tiles, and every list folds its tail
 * into "Other" so its rows add up to the range. No verdict colours: a rate is
 * a figure, the reader judges it (ux-standards: show, don't label).
 */

// ── The ranked list: one row per value, a share bar, a few figures ─────────

interface ListColumn {
  label: string;
  /** Hidden below `sm` — the phone keeps the label, the share and one figure. */
  wide?: boolean;
  render: (r: SectionRow) => ReactNode;
}

function SectionFrame({
  id,
  title,
  info,
  aside,
  children,
}: {
  id: string;
  title: string;
  info?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={panelClass({ padding: "none" })} aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="inline-flex items-center gap-1">
          <h2 id={`${id}-title`} className="text-sm font-medium text-ink">
            {title}
          </h2>
          {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
        </span>
        {aside}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function RankedList({
  rows,
  total,
  labelOf,
  columns,
  empty,
  heading,
}: {
  rows: readonly SectionRow[];
  total: number;
  labelOf: (r: SectionRow) => ReactNode;
  columns: readonly ListColumn[];
  empty: string;
  /** The first column's header — needed when a section holds two lists. */
  heading?: string;
}) {
  if (total === 0) return <p className="py-2 text-sm text-ink-3">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.orders));
  const grid = cn(
    "grid items-center gap-x-3",
    // label · share · figures (the wide ones only from sm)
    columns.length === 1 && "grid-cols-[minmax(0,1fr)_7rem_4.5rem]",
    columns.length === 2 &&
      "grid-cols-[minmax(0,1fr)_7rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_7rem_4.5rem_4.5rem]",
    columns.length === 3 &&
      "grid-cols-[minmax(0,1fr)_7rem_4.5rem] sm:grid-cols-[minmax(0,1fr)_7rem_4.5rem_4.5rem_4.5rem]",
  );
  return (
    <div role="table" className="text-xs">
      <div role="row" className={cn(grid, "pb-1.5 text-[11px] text-ink-2")}>
        <span role="columnheader">{heading}</span>
        <span role="columnheader" className="text-right">
          Orders
        </span>
        {columns.map((c) => (
          <span
            key={c.label}
            role="columnheader"
            className={cn("text-right", c.wide && "hidden sm:block")}
          >
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const muted = r.value === null || r.value === OTHER_VALUE;
        return (
          <div
            key={r.value ?? "__blank__"}
            role="row"
            className={cn(grid, "border-t border-line/60 py-1.5")}
          >
            <span
              role="cell"
              dir="auto"
              // `dir="auto"` shapes an Arabic value right; the column still
              // reads from the left like every other label in it.
              className={cn("truncate text-left", muted ? "text-ink-2" : "text-ink")}
            >
              {labelOf(r)}
            </span>
            <span role="cell" className="flex items-center justify-end gap-2">
              <span className="relative h-1.5 w-10 shrink-0 rounded-full bg-surface-2" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand"
                  style={{ width: `${(r.orders / max) * 100}%` }}
                />
              </span>
              <span className="tabular-nums" title={`${int(r.orders)} orders`}>
                {pct1(share(r.orders, total))}
              </span>
            </span>
            {columns.map((c) => (
              <span
                key={c.label}
                role="cell"
                className={cn("text-right tabular-nums", c.wide && "hidden sm:block")}
              >
                {c.render(r)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** How an "Other" or blank row reads in every section. */
function rowLabel(r: SectionRow, word: (v: string) => string, blank = "Not reported"): string {
  if (r.value === OTHER_VALUE) return `Other (${int(r.foldedCount)})`;
  if (r.value === null) return blank;
  return word(r.value);
}

const lostRate = (r: Pick<LensValue, "lost" | "orders">) => pct1(rate(r.lost, r.orders));
const aovOf = (r: Pick<LensValue, "revenue" | "orders">) => sar0(aov(r.revenue, r.orders));

// ── Sections ───────────────────────────────────────────────────────────────

export function StoreInsightsSections({
  lenses,
  total,
  kpis,
  products,
}: {
  lenses: Record<SectionLens, LensValue[]>;
  total: LensSums;
  kpis: StoreInsightsKpis;
  products: StoreInsightsProducts;
}) {
  const fold = useMemo(
    () => ({
      payment: foldSection(lenses.payment, total),
      status: foldSection(lenses.status, total),
      city: foldSection(lenses.city, total),
      coupon: foldSection(lenses.coupon, total, 6),
      offer: foldSection(lenses.offer, total, 4),
      shipping: foldSection(lenses.shipping, total, 5),
    }),
    [lenses, total],
  );
  const lostCol: ListColumn = { label: "Lost", render: lostRate };

  return (
    <div className="space-y-4">
      <ProductsSection products={products} />

      <div className="grid gap-4 @4xl/main:grid-cols-2">
        <SectionFrame
          id="ins-payment"
          title="How customers pay"
          info="Each payment method's share of the orders, its average order and how many of its orders were cancelled, deleted or refunded (Lost). Every order counts in the totals whatever its status."
        >
          <RankedList
            rows={fold.payment}
            total={total.orders}
            labelOf={(r) => rowLabel(r, paymentMethodLabel)}
            columns={[{ label: "AOV", wide: true, render: aovOf }, lostCol]}
            empty="No orders in this range."
          />
        </SectionFrame>

        <StatusSection rows={fold.status} total={total.orders} />

        <CustomersSection kpis={kpis} />

        <SectionFrame
          id="ins-city"
          title="Cities"
          info="Where the orders ship to, by the city Salla reports. Lost = cancelled, deleted or refunded."
        >
          <RankedList
            rows={fold.city}
            total={total.orders}
            labelOf={(r) => rowLabel(r, (v) => v)}
            columns={[{ label: "AOV", wide: true, render: aovOf }, lostCol]}
            empty="No orders in this range."
          />
        </SectionFrame>

        <DiscountsSection kpis={kpis} products={products} coupons={fold.coupon} offers={fold.offer} total={total.orders} />

        <SectionFrame
          id="ins-shipping"
          title="Shipping companies"
          info="Days to deliver = from the order day to the day Salla marked it delivered, averaged over the delivered orders only."
        >
          <RankedList
            rows={fold.shipping}
            total={total.orders}
            labelOf={(r) => rowLabel(r, (v) => v)}
            columns={[
              {
                label: "Days",
                wide: true,
                render: (r) => {
                  const d = avgDeliveryDays(r);
                  return d === null ? "—" : num(Math.round(d * 10) / 10);
                },
              },
              lostCol,
            ]}
            empty="No orders in this range."
          />
        </SectionFrame>
      </div>
    </div>
  );
}

// ── Where orders end up ────────────────────────────────────────────────────

const STAGE_FILL: Record<ReturnType<typeof orderStatusTone>, string> = {
  pos: "bg-pos",
  info: "bg-ahead",
  neutral: "bg-ink-3",
  warn: "bg-warn",
  neg: "bg-neg",
};

function StatusSection({ rows, total }: { rows: readonly SectionRow[]; total: number }) {
  const named = rows.filter((r) => r.value !== null && r.value !== OTHER_VALUE);
  return (
    <SectionFrame
      id="ins-status"
      title="Where orders end up"
      info="Each order's current Salla status. A status is a flag, never a filter: cancelled and refunded orders still count in every total."
    >
      {total === 0 ? (
        <p className="py-2 text-sm text-ink-3">No orders in this range.</p>
      ) : (
        <>
          <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {named.map((r) => (
              <span
                key={r.value}
                className={STAGE_FILL[orderStatusTone(r.value!)]}
                style={{ width: `${(r.orders / total) * 100}%` }}
              />
            ))}
          </div>
          <RankedList
            rows={rows}
            total={total}
            labelOf={(r) =>
              r.value === null || r.value === OTHER_VALUE ? (
                rowLabel(r, (v) => v)
              ) : (
                <Chip tone={orderStatusTone(r.value)}>{orderStatusLabel(r.value)}</Chip>
              )
            }
            columns={[{ label: "Revenue", wide: true, render: (r) => sar0(r.revenue) }]}
            empty="No orders in this range."
          />
        </>
      )}
    </SectionFrame>
  );
}

// ── New vs returning ───────────────────────────────────────────────────────

function CustomersSection({ kpis }: { kpis: StoreInsightsKpis }) {
  const known = kpis.newOrders + kpis.returningOrders;
  const parts = [
    { key: "new", label: "New", orders: kpis.newOrders, revenue: kpis.newRevenue, fill: "bg-brand" },
    {
      key: "returning",
      label: "Returning",
      orders: kpis.returningOrders,
      revenue: kpis.returningRevenue,
      fill: "bg-ahead",
    },
  ];
  return (
    <SectionFrame
      id="ins-customers"
      title="New and returning customers"
      info={
        <>
          A customer is their phone number, or their Salla customer ID when there is no phone; it
          is never shown. An order is returning when that customer had ordered with this brand
          before{kpis.historyFrom ? `, as far back as the orders go (${kpis.historyFrom})` : ""}.
        </>
      }
    >
      {known === 0 ? (
        <p className="py-2 text-sm text-ink-3">
          {kpis.orders === 0
            ? "No orders in this range."
            : "No order in this range carries a phone or a Salla customer ID."}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {parts.map((p) => (
              <span key={p.key} className={p.fill} style={{ width: `${(p.orders / known) * 100}%` }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {parts.map((p) => (
              <div key={p.key} className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs text-ink-2">
                  <span className={cn("h-2 w-2 rounded-full", p.fill)} aria-hidden />
                  {p.label}
                </div>
                <div className="text-lg font-medium tabular-nums text-ink">
                  {pct1(share(p.orders, known))}
                </div>
                <div className="text-xs tabular-nums text-ink-2">
                  {int(p.orders)} orders · AOV {sar0(aov(p.revenue, p.orders))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs tabular-nums text-ink-2">
            {int(kpis.customers)} customers · {int(kpis.repeatCustomers)} ordered more than once in
            this range
            {kpis.unknownCustomerOrders > 0 &&
              ` · ${int(kpis.unknownCustomerOrders)} orders with no customer`}
          </p>
        </div>
      )}
    </SectionFrame>
  );
}

// ── Discounts and offers ───────────────────────────────────────────────────

function DiscountsSection({
  kpis,
  products,
  coupons,
  offers,
  total,
}: {
  kpis: StoreInsightsKpis;
  products: StoreInsightsProducts;
  coupons: readonly SectionRow[];
  offers: readonly SectionRow[];
  total: number;
}) {
  const stats = [
    {
      key: "coupon",
      label: "Coupons",
      value: sar0(kpis.couponDiscount),
      sub: `${pct1(share(kpis.couponOrders, kpis.orders))} of orders`,
    },
    {
      key: "offer",
      label: "Offers",
      value: sar0(kpis.offerDiscount),
      sub: `${int(kpis.offerOrders)} orders`,
    },
    {
      key: "sale",
      label: "Sale prices",
      value: sar0(products.total.markdown),
      sub: "markdown on units sold",
    },
  ];
  const usedCoupons = coupons.filter((r) => r.value !== null);
  const usedOffers = offers.filter((r) => r.value !== null);
  return (
    <SectionFrame
      id="ins-discounts"
      title="Discounts and offers"
      info="What promotions gave away, before VAT: coupon codes, Salla special offers (buy two, get one) and sale prices (the regular price minus what the item sold for). Offers before 2026-11-23 arrived as coupons."
    >
      {total === 0 ? (
        <p className="py-2 text-sm text-ink-3">No orders in this range.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.key} className="min-w-0 space-y-0.5">
                <div className="text-xs text-ink-2">{s.label}</div>
                <div className="truncate text-base font-medium tabular-nums text-ink">{s.value}</div>
                <div className="truncate text-[11px] tabular-nums text-ink-2">{s.sub}</div>
              </div>
            ))}
          </div>
          {usedCoupons.length > 0 && (
            <RankedList
              heading="Coupon"
              rows={usedCoupons}
              total={total}
              labelOf={(r) => rowLabel(r, (v) => v)}
              columns={[
                {
                  label: "Avg off",
                  wide: true,
                  render: (r) => sar0(r.orders > 0 ? r.couponDiscount / r.orders : null),
                },
                { label: "AOV", render: aovOf },
              ]}
              empty=""
            />
          )}
          {usedOffers.length > 0 && (
            <RankedList
              heading="Offer"
              rows={usedOffers}
              total={total}
              labelOf={(r) => rowLabel(r, (v) => v)}
              columns={[{ label: "AOV", render: aovOf }]}
              empty=""
            />
          )}
        </div>
      )}
    </SectionFrame>
  );
}

// ── Products and margin ────────────────────────────────────────────────────

const PRODUCT_DEFAULT_HIDDEN = ["orders", "lostUnits", "markdown"] as const;

function ProductsSection({ products }: { products: StoreInsightsProducts }) {
  const { rows, total, ordersWithoutProducts } = products;
  const gp = grossProfit(total);
  const noCosts = total.units > 0 && gp.profit === null;

  const columns = useMemo((): DataColumn<StoreInsightsProduct>[] => {
    const margin = (r: StoreInsightsProduct) => grossProfit(r);
    return [
      {
        key: "product",
        label: "Product",
        pinned: true,
        sortable: true,
        sortValue: (r) => r.name ?? r.key,
        defaultSortDir: "asc",
        csv: (r) => r.name ?? r.key,
        render: (r) => (
          <span className="block max-w-[11rem] sm:max-w-[18rem]">
            <span dir="auto" className="block truncate text-left text-ink" title={r.name ?? r.key}>
              {r.name ?? r.key}
            </span>
            {r.sku && r.name && (
              <span className="block truncate text-[11px] text-ink-2" title={r.sku}>
                {r.sku}
              </span>
            )}
          </span>
        ),
      },
      {
        key: "units",
        label: "Units",
        align: "right",
        sortable: true,
        sortValue: (r) => r.units,
        render: (r) => <span className="tabular-nums">{int(r.units)}</span>,
        total: () => <span className="tabular-nums">{int(total.units)}</span>,
      },
      {
        key: "orders",
        label: "Orders",
        align: "right",
        sortable: true,
        sortValue: (r) => r.orders,
        render: (r) => <span className="tabular-nums">{int(r.orders)}</span>,
      },
      {
        key: "sales",
        label: "Sales (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.sales,
        render: (r) => <span className="tabular-nums">{sarBare(r.sales)}</span>,
        total: () => <span className="tabular-nums">{sarBare(total.sales)}</span>,
      },
      {
        key: "profit",
        label: "Gross profit (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => margin(r).profit,
        csv: (r) => margin(r).profit,
        render: (r) => <span className="tabular-nums">{sarBare(margin(r).profit)}</span>,
        total: () => <span className="tabular-nums">{sarBare(gp.profit)}</span>,
      },
      {
        key: "margin",
        label: "Margin",
        align: "right",
        sortable: true,
        sortValue: (r) => margin(r).margin,
        csv: (r) => margin(r).margin,
        render: (r) => (
          <span
            className="tabular-nums"
            title={r.unitsWithoutCost > 0 ? `${int(r.unitsWithoutCost)} units have no cost` : undefined}
          >
            {pct1(margin(r).margin)}
          </span>
        ),
        total: () => <span className="tabular-nums">{pct1(gp.margin)}</span>,
      },
      {
        key: "lostUnits",
        label: "Lost units",
        align: "right",
        sortable: true,
        sortValue: (r) => r.lostUnits,
        render: (r) => <span className="tabular-nums">{int(r.lostUnits)}</span>,
      },
      {
        key: "markdown",
        label: "Sale markdown (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.markdown,
        render: (r) => <span className="tabular-nums">{sarBare(r.markdown)}</span>,
        total: () => <span className="tabular-nums">{sarBare(total.markdown)}</span>,
      },
    ];
  }, [total, gp.profit, gp.margin]);

  const hideable = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_INSIGHTS_PRODUCTS,
    hideable,
    defaults: hideable,
    defaultHidden: PRODUCT_DEFAULT_HIDDEN,
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <h2 className="text-sm font-medium text-ink">Products and margin</h2>
          <InfoTip label="About products and margin">
            Sales are what customers paid for each product, incl. VAT. Gross profit = sales before
            VAT minus the unit cost in force on each order&apos;s day (Store → Product costs), over
            the units that have a cost. Shipping and fees are not in it. The top 20 products by
            units; the totals cover every product.
          </InfoTip>
        </span>
        {total.unitsWithoutCost > 0 && !noCosts && (
          <span className="text-xs tabular-nums text-ink-2">
            {int(total.unitsWithoutCost)} units without a cost ·{" "}
            <Link href="/store/costs" className="text-brand hover:underline">
              Add costs
            </Link>
          </span>
        )}
        {ordersWithoutProducts > 0 && (
          <span className="text-xs tabular-nums text-ink-2">
            {int(ordersWithoutProducts)} uploaded orders carry no products
          </span>
        )}
      </div>
      <DataTable
        columns={columns}
        {...cols.tableProps}
        rows={rows}
        rowKey={(r) => r.key}
        sort="units"
        dir="desc"
        showTotals={rows.length > 0}
        minWidthClass="min-w-[560px]"
        empty={
          <p className="p-6 text-sm text-ink-3">
            No products in this range. Products come with orders from the Salla feed.
          </p>
        }
      />
      {noCosts && (
        <p className="text-xs text-ink-2">
          No product here has a cost yet, so gross profit is blank.{" "}
          <Link href="/store/costs" className="text-brand hover:underline">
            Add product costs
          </Link>
        </p>
      )}
    </div>
  );
}
