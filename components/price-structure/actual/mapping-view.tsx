"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Callout } from "@/components/ui/callout";
import { Chip } from "@/components/ui/chip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useNavTransition } from "@/lib/nav-progress";
import { saveMapping } from "@/app/actions/price-structure-actual";
import type { MappingChange } from "@/validators/price-structure";
import type { AdSpendFact, ActualMappings } from "@/price-structure/actual/facts";
import { skuOfferKey } from "@/price-structure/actual/facts";
import type { Product } from "@/price-structure/engine/types";
import { mechanicText } from "@/price-structure/engine/mechanics";
import { int0, usd0 } from "@/price-structure/format";
import { productColor } from "../palette";
import { SectionCard } from "../section-card";
import { useVersion } from "../version-provider";
import { VersionBar } from "../version-bar";

interface Sku {
  productKey: string;
  sku: string | null;
  name: string | null;
  units: number;
  quantities: number[];
}

const NONE = "__none__";

/**
 * Pricing · Actual → SKU mapping. Two lists, both per BRAND: Salla SKUs
 * (product, then an offer per quantity the SKU sold in) and Library products
 * (whose ad spend counts against which Pricing product). Each select saves on
 * change through `saveMapping`; its response re-renders the page (one render
 * per action). A viewer sees every select disabled.
 */
export function MappingView({
  skus,
  adProducts,
  adSpend,
  mappings,
  windowDays,
}: {
  skus: Sku[];
  adProducts: Array<{ id: string; name: string; status: string }>;
  adSpend: AdSpendFact[];
  mappings: ActualMappings;
  windowDays: number;
}) {
  const { open, access } = useVersion();
  const v = useSearchParams().get("v");
  const q = v ? `?v=${encodeURIComponent(v)}` : "";
  const products = useMemo(() => open?.data.products ?? [], [open]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [show, setShow] = useState<"all" | "unmapped">("all");

  // Every SKU the window sold, plus any already mapped that it didn't.
  const rows = useMemo(() => {
    const seen = new Set(skus.map((s) => s.productKey));
    const extra: Sku[] = Object.keys(mappings.skuProduct)
      .filter((k) => !seen.has(k))
      .map((k) => ({ productKey: k, sku: k, name: null, units: 0, quantities: quantitiesMapped(mappings, k) }));
    return [...skus, ...extra].map((s) => ({
      ...s,
      // A quantity already mapped stays editable even if the window didn't sell it.
      quantities: [...new Set([...s.quantities, ...quantitiesMapped(mappings, s.productKey)])].sort((a, b) => a - b),
      mapped: !!byId.get(mappings.skuProduct[s.productKey] ?? ""),
    }));
  }, [skus, mappings, byId]);
  const unmapped = rows.filter((r) => !r.mapped).length;
  const visible = show === "unmapped" ? rows.filter((r) => !r.mapped) : rows;

  const spendBy = new Map(adSpend.map((a) => [a.productId, a.spendUsd]));
  const ads = [...adProducts].sort((a, b) => (spendBy.get(b.id) ?? 0) - (spendBy.get(a.id) ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Pricing"
        title="SKU mapping"
        backLink={{ href: `/price-structure/actual${q}`, label: "Actual" }}
        info="One mapping for the brand, whichever version is open. A SKU points to a Pricing product; each quantity it sells in points to an offer (1 unit → the single offer, 2 → the 2-unit offer). Anything not mapped still counts in every total."
        rightSlot={<VersionBar />}
      />
      {products.length === 0 && (
        <Callout tone="info" size="md">
          This version has no products yet. Add them on Products &amp; offers, then map the SKUs here.
        </Callout>
      )}
      <fieldset disabled={!access.edit} className="min-w-0 space-y-4">
        <SectionCard
          title="Salla SKUs"
          subtitle={`Sold in the last ${windowDays} days`}
          actions={
            <SegmentedControl
              ariaLabel="Which SKUs"
              value={show}
              onChange={setShow}
              options={[
                { value: "all", label: `All ${rows.length}` },
                { value: "unmapped", label: `Not mapped ${unmapped}` },
              ]}
            />
          }
        >
          {visible.length === 0 ? (
            <p className="text-sm text-ink-2">{show === "unmapped" ? "Every SKU is mapped." : `No SKU sold in the last ${windowDays} days.`}</p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((s) => (
                <SkuItem key={s.productKey} sku={s} products={products} byId={byId} mappings={mappings} />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Ad spend by Library product"
          subtitle={`Spend over the last ${windowDays} days`}
          info="Ad spend follows each creative's Library product. Point every Library product that advertises a Pricing product at it; spend left unmapped stays its own row on Actual."
        >
          {ads.length === 0 ? (
            <p className="text-sm text-ink-2">No Library products yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {ads.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      <bdi>{a.name}</bdi>
                    </div>
                    <div className="text-xs text-ink-2 tabular-nums">
                      {usd0(spendBy.get(a.id) ?? 0)}
                      {a.status !== "active" ? " · archived" : ""}
                    </div>
                  </div>
                  <ProductSelect
                    label={`Pricing product for ads of ${a.name}`}
                    products={products}
                    current={mappings.adProduct[a.id] ?? null}
                    byId={byId}
                    change={(psProductId) => ({ what: "ads", productId: a.id, psProductId })}
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </fieldset>
    </div>
  );
}

function quantitiesMapped(m: ActualMappings, key: string): number[] {
  const prefix = skuOfferKey(key, 0).slice(0, -1);
  return Object.keys(m.skuOffer)
    .filter((k) => k.startsWith(prefix))
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function SkuItem({
  sku,
  products,
  byId,
  mappings,
}: {
  sku: Sku & { mapped: boolean };
  products: readonly Product[];
  byId: Map<string, Product>;
  mappings: ActualMappings;
}) {
  const psId = mappings.skuProduct[sku.productKey] ?? null;
  const product = psId ? byId.get(psId) : undefined;
  return (
    <li className="flex flex-col gap-2 py-2.5 @3xl/main:flex-row @3xl/main:items-start @3xl/main:gap-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          <bdi>{sku.name ?? sku.productKey}</bdi>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
          <span className="truncate font-mono">{sku.sku ?? sku.productKey}</span>
          <span className="tabular-nums">{int0(sku.units)} units</span>
          {!sku.mapped && <Chip tone={psId ? "warn" : "neutral"}>{psId ? "Not in this version" : "Not mapped"}</Chip>}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 @3xl/main:w-[26rem]">
        <ProductSelect
          label={`Pricing product for ${sku.sku ?? sku.productKey}`}
          products={products}
          current={psId}
          byId={byId}
          change={(psProductId) => ({ what: "sku", productKey: sku.productKey, psProductId })}
        />
        {product &&
          sku.quantities.map((qty) => (
            <OfferSelect key={qty} productKey={sku.productKey} quantity={qty} product={product} current={mappings.skuOffer[skuOfferKey(sku.productKey, qty)] ?? null} />
          ))}
      </div>
    </li>
  );
}

function useSave() {
  const [pending, start] = useNavTransition();
  return {
    pending,
    save(change: MappingChange) {
      start(async () => {
        const res = await safeAction(() => saveMapping(change));
        if (!res.ok) toastActionFailure(res, "Couldn't save the mapping");
      });
    },
  };
}

function ProductSelect({
  label,
  products,
  current,
  byId,
  change,
}: {
  label: string;
  products: readonly Product[];
  current: string | null;
  byId: Map<string, Product>;
  change: (psProductId: string | null) => MappingChange;
}) {
  const { pending, save } = useSave();
  const known = current !== null && byId.has(current);
  return (
    <Select value={known ? current! : NONE} onValueChange={(v) => save(change(v === NONE ? null : v))} disabled={pending}>
      <SelectTrigger className="h-8 w-full text-sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{current && !known ? "Not in this version" : "Not mapped"}</SelectItem>
        {products.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: productColor(p.colorSlot) }} aria-hidden />
              {p.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OfferSelect({ productKey, quantity, product, current }: { productKey: string; quantity: number; product: Product; current: string | null }) {
  const { pending, save } = useSave();
  const known = current !== null && product.offers.some((o) => o.id === current);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-ink-2 tabular-nums">× {quantity}</span>
      <Select
        value={known ? current! : NONE}
        onValueChange={(v) => save({ what: "offer", productKey, quantity, psOfferId: v === NONE ? null : v })}
        disabled={pending}
      >
        <SelectTrigger className="h-8 min-w-0 flex-1 text-sm" aria-label={`Offer for ${productKey} × ${quantity}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No offer</SelectItem>
          {product.offers.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name === mechanicText(o.mechanic) ? o.name : `${o.name} · ${mechanicText(o.mechanic)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
