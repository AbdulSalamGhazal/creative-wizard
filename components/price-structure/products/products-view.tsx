"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { shallowHref } from "@/lib/shallow-url";
import { newId } from "@/price-structure/engine/ids";
import { newProduct, nextColorSlot } from "@/price-structure/engine/sample";
import { orderKey, type Offer, type Product, type VersionData } from "@/price-structure/engine/types";
import { PsPageHeader } from "../ps-page-header";
import { useVersion } from "../version-provider";
import { OffersCard } from "./offers-card";
import { ProductCard } from "./product-card";
import { ProductList } from "./product-list";
import { HowCalculated } from "./how-calculated";
import { OfferWaterfall } from "./offer-waterfall";

const BASE = "/price-structure/products";

/**
 * Products & offers (brief §6.2): the product list on the left, the editor on
 * the right. The selection lives in the PATH (`/products/:productId/:offerId`)
 * so a link from the Overview lands on an offer; changing it here is a
 * presentation-only shallow push (D12) — the data is already in the tab.
 */
export function ProductsView({ productId, offerId }: { productId: string | null; offerId: string | null }) {
  const { open: version, updateData, access } = useVersion();
  const pathname = usePathname();
  const v = useSearchParams().get("v");

  // The path wins once the client is live; the server's params seed the first render.
  const segs = pathname.startsWith(BASE) ? pathname.slice(BASE.length).split("/").filter(Boolean) : [];
  const wantProduct = segs[0] ?? productId;
  const wantOffer = segs[1] ?? offerId;

  const products = useMemo(() => version?.data.products ?? [], [version]);
  const product = products.find((p) => p.id === wantProduct) ?? products[0] ?? null;
  const offer = product?.offers.find((o) => o.id === wantOffer) ?? product?.offers[0] ?? null;

  const select = useCallback(
    (pid: string, oid?: string | null) => {
      const path = `${BASE}/${pid}${oid ? `/${oid}` : ""}${v ? `?v=${v}` : ""}`;
      if (`${window.location.pathname}${window.location.search}` !== path) shallowHref(path, "push");
    },
    [v],
  );

  // A product from the Overview's row click: bring its offer into view once.
  useEffect(() => {
    if (!offerId) return;
    const el = document.getElementById(`offer-${offerId}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchProduct = useCallback(
    (pid: string, fn: (p: Product) => Product) =>
      updateData(`data.products.${pid}`, (d) => ({ ...d, products: d.products.map((p) => (p.id === pid ? fn(p) : p)) })),
    [updateData],
  );

  const addProduct = useCallback(() => {
    const p = newProduct(nextColorSlot(products));
    updateData(`data.products.${p.id}`, (d) => ({ ...d, products: [...d.products, p] }));
    select(p.id, p.offers[0]?.id);
  }, [products, updateData, select]);

  const duplicateProduct = useCallback(
    (source: Product) => {
      const copy: Product = {
        ...source,
        id: newId(),
        name: `${source.name} (copy)`,
        colorSlot: nextColorSlot(products),
        offers: source.offers.map((o) => ({ ...o, id: newId() })),
      };
      updateData(`data.products.${copy.id}`, (d) => {
        const idx = d.products.findIndex((p) => p.id === source.id);
        const next = [...d.products];
        next.splice(idx < 0 ? next.length : idx + 1, 0, copy);
        return { ...d, products: next };
      });
      select(copy.id, copy.offers[0]?.id);
    },
    [products, updateData, select],
  );

  const deleteProduct = useCallback(
    (target: Product) => {
      if (!version) return;
      const d = version.data;
      const offerIds = new Set(target.offers.map((o) => o.id));
      const plans = d.plans.filter((pl) => target.id in pl.productShare || target.offers.some((o) => o.id in pl.offerShare));
      const actuals = d.actuals.filter((a) => Object.keys(a.orders).some((k) => k.startsWith(`${target.id}:`)));
      const paths = [
        `data.products.${target.id}`,
        ...plans.map((pl) => `data.plans.${pl.id}`),
        ...actuals.map((a) => `data.actuals.${a.id}`),
      ];
      updateData(paths, (cur): VersionData => ({
        ...cur,
        products: cur.products.filter((p) => p.id !== target.id),
        plans: cur.plans.map((pl) => {
          const productShare = { ...pl.productShare };
          delete productShare[target.id];
          const offerShare = Object.fromEntries(Object.entries(pl.offerShare).filter(([k]) => !offerIds.has(k)));
          return { ...pl, productShare, offerShare };
        }),
        actuals: cur.actuals.map((a) => ({
          ...a,
          orders: Object.fromEntries(Object.entries(a.orders).filter(([k]) => !k.startsWith(`${target.id}:`))),
        })),
      }));
      const remaining = products.filter((p) => p.id !== target.id);
      const next = remaining[0];
      if (next) select(next.id, next.offers[0]?.id);
    },
    [version, products, updateData, select],
  );

  const setOffers = useCallback(
    (pid: string, fn: (offers: Offer[]) => Offer[]) => patchProduct(pid, (p) => ({ ...p, offers: fn(p.offers) })),
    [patchProduct],
  );

  const deleteOffer = useCallback(
    (pid: string, oid: string) => {
      if (!version) return;
      const d = version.data;
      const key = (a: { orders: Record<string, number> }) => Object.keys(a.orders).some((k) => k === orderKey(pid, oid));
      const plans = d.plans.filter((pl) => oid in pl.offerShare);
      const actuals = d.actuals.filter(key);
      updateData([`data.products.${pid}`, ...plans.map((pl) => `data.plans.${pl.id}`), ...actuals.map((a) => `data.actuals.${a.id}`)], (cur) => ({
        ...cur,
        products: cur.products.map((p) => (p.id === pid ? { ...p, offers: p.offers.filter((o) => o.id !== oid) } : p)),
        plans: cur.plans.map((pl) => {
          const offerShare = { ...pl.offerShare };
          delete offerShare[oid];
          return { ...pl, offerShare };
        }),
        actuals: cur.actuals.map((a) => {
          const orders = { ...a.orders };
          delete orders[orderKey(pid, oid)];
          return { ...a, orders };
        }),
      }));
      if (offer?.id === oid) {
        const rest = product?.offers.filter((o) => o.id !== oid) ?? [];
        select(pid, rest[0]?.id);
      }
    },
    [version, updateData, offer, product, select],
  );

  const settings = version?.data.settings;
  const selected = useMemo(() => ({ product, offer }), [product, offer]);

  return (
    <>
      <PsPageHeader
        title="Products & offers"
        info="Set each product's cost and price, then build its offers: % off, buy X get Y, bundles. Results update as you type."
      />
      {!version ? null : products.length === 0 ? (
        <EmptyState
          title="No products yet"
          hint={access.edit ? "A product is a unit cost and a list price; its offers are the ways you sell it." : "Someone with the Edit permission adds the first product."}
          action={
            access.edit ? (
              <Button type="button" size="sm" onClick={addProduct}>
                <Plus aria-hidden /> Add your first product
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ProductList
            products={products}
            selectedId={product?.id ?? null}
            onSelect={(pid) => select(pid, products.find((p) => p.id === pid)?.offers[0]?.id)}
            onAdd={access.edit ? addProduct : null}
          />
          {/* A viewer sees every field, disabled: the whole column is one fieldset. */}
          <fieldset disabled={!access.edit} className="min-w-0 space-y-4">
            {product && settings && (
              <>
                <ProductCard
                  product={product}
                  settings={settings}
                  onChange={(fn) => patchProduct(product.id, fn)}
                  onDuplicate={() => duplicateProduct(product)}
                  onDelete={() => deleteProduct(product)}
                  readOnly={!access.edit}
                />
                <OffersCard
                  product={product}
                  data={version.data}
                  selectedOfferId={selected.offer?.id ?? null}
                  onSelect={(oid) => select(product.id, oid)}
                  onChangeOffers={(fn) => setOffers(product.id, fn)}
                  onDeleteOffer={(oid) => deleteOffer(product.id, oid)}
                  readOnly={!access.edit}
                />
                {offer && (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <OfferWaterfall product={product} offer={offer} data={version.data} />
                    <HowCalculated product={product} offer={offer} data={version.data} />
                  </div>
                )}
              </>
            )}
          </fieldset>
        </div>
      )}
    </>
  );
}
