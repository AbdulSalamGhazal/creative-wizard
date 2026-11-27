import type { ActualResult, BridgeStep, Money } from "@/price-structure/actual/engine";

/**
 * The `get_actual_cml` payload (2026-11-27, user decision: the user's Claude
 * reads actual CML). A pure projection of the SAME `computeActual` result the
 * Pricing · Actual page draws — no arithmetic here beyond rounding — so the
 * tool and the page can never state two numbers. CML is WITHHELD (null, with
 * the reason) exactly when the page shows "Incomplete": a delivered or open
 * unit has no cost, or an order carries no products.
 */

const BRIDGE_KEYS: Record<BridgeStep["key"], string> = {
  plan: "plan",
  volume: "volume",
  mix: "mix",
  delivery: "delivery",
  price: "price",
  cogs: "cogs",
  ads: "ads",
  notInPlan: "not_in_plan",
  actual: "actual",
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

function money(m: Money) {
  return {
    orders_placed: r2(m.placed),
    orders_delivered_expected: r2(m.delivered),
    units: m.units,
    net_revenue: r2(m.revenue),
    cogs: r2(m.cogs),
    uncosted_units: m.uncostedUnits,
  };
}

export function actualCmlPayload(
  r: ActualResult,
  version: { id: string; name: string },
  plan: { id: string; name: string } | null,
): Record<string, unknown> {
  const withheld = !r.complete;
  return {
    currency: "SAR, before VAT (store totals marked incl_vat include it)",
    version: { id: version.id, name: version.name },
    plan: plan ? { id: plan.id, name: plan.name } : null,
    days: r.days,
    complete: r.complete,
    incomplete_because: withheld
      ? {
          uncosted_units: r.uncostedUnits,
          uncosted_skus: r.uncostedSkus,
          orders_without_products: r.ordersWithoutProducts,
        }
      : null,
    cml: withheld ? null : r2(r.cml),
    cml_settled: withheld ? null : r2(r.settledCml),
    cml_expected: withheld ? null : r2(r.expectedCml),
    cml_pct: withheld ? null : r4(r.cmlPct),
    net_revenue: r2(r.netRevenue),
    cogs: r2(r.cogs),
    ad_spend: r2(r.adSpend),
    ad_spend_usd: r2(r.adSpendUsd),
    cogs_pct: r4(r.cogsPct),
    ad_pct: r4(r.adPct),
    orders: r.counts,
    waterfall: {
      store_total_incl_vat: r2(r.storeTotalInclVat),
      vat: r2(r.vat),
      lost: r2(r.lostNet),
      open_expected_to_fail: r2(r.openFailNet),
      uploaded_expected_to_fail: r2(r.uploadedFailNet),
      net_revenue: r2(r.netRevenue),
      cogs: r2(r.cogs),
      ad_spend: r2(r.adSpend),
      cml: withheld ? null : r2(r.cml),
    },
    shipping_and_cod_fees: r2(r.fees),
    orders_without_products_net: r2(r.withoutProductsNet),
    open_orders: r.open.map((o) => ({
      payment_method: o.paymentMethod,
      open: o.open,
      delivery_rate: r4(o.rate),
      rate_from: o.rateSource,
      closed_orders_behind_rate: o.closed,
      open_net: r2(o.openNet),
      expected_net: r2(o.expectedNet),
    })),
    products: r.products.map((p) => ({
      product: p.name,
      ...money(p),
      ad_spend: r2(p.adSpend),
      cml: withheld ? null : r2(p.cml),
      offers: p.offers.map((o) => ({ offer: o.name, mapped: o.offerId !== null, ...money(o) })),
    })),
    skus_not_mapped: r.unmapped.map((u) => ({
      sku: u.productKey,
      name: u.name,
      mapped_to_a_product_this_version_lacks: u.notInVersion,
      ...money(u),
    })),
    ad_spend_not_mapped: r.adsNotMapped.map((a) => ({ library_product: a.productName, spend: r2(a.spend) })),
    plan_bridge: r.bridge ? r.bridge.map((s) => ({ step: BRIDGE_KEYS[s.key], value: r2(s.value) })) : null,
    plan_bridge_unavailable: r.bridgeUnavailable,
  };
}
