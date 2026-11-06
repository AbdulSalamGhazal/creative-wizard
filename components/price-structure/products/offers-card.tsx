"use client";

import { useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { newId } from "@/price-structure/engine/ids";
import { baseOffer, OFFER_TEMPLATES } from "@/price-structure/engine/sample";
import type { Offer, Product, VersionData } from "@/price-structure/engine/types";
import { SectionCard } from "../section-card";
import { OfferEditor } from "./offer-editor";

/**
 * The offers card (brief §6.2): a template select + "+ Add offer", the
 * numbered order strip (drag a pill, or use the ↑ ↓ in each block), and one
 * editor block per offer. The order is saved and used on every page.
 */
export function OffersCard({
  product,
  data,
  selectedOfferId,
  onSelect,
  onChangeOffers,
  onDeleteOffer,
  readOnly = false,
}: {
  product: Product;
  data: VersionData;
  selectedOfferId: string | null;
  onSelect: (offerId: string) => void;
  onChangeOffers: (fn: (offers: Offer[]) => Offer[]) => void;
  onDeleteOffer: (offerId: string) => void;
  readOnly?: boolean;
}) {
  const [template, setTemplate] = useState(OFFER_TEMPLATES[0]!.key);
  const [dragging, setDragging] = useState<string | null>(null);

  const add = () => {
    const t = OFFER_TEMPLATES.find((x) => x.key === template) ?? OFFER_TEMPLATES[0]!;
    const first = product.offers[0];
    const offer = baseOffer({
      name: t.name,
      mechanic: t.mechanic,
      cpaUsd: first?.cpaUsd ?? 20,
      platformRoas: first?.platformRoas ?? 4,
      adMode: first?.adMode ?? "cpa",
    });
    onChangeOffers((offers) => [...offers, offer]);
    onSelect(offer.id);
  };

  const move = (id: string, delta: number) =>
    onChangeOffers((offers) => {
      const i = offers.findIndex((o) => o.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= offers.length) return offers;
      const next = [...offers];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      return next;
    });

  const dropOn = (targetId: string) => {
    const from = dragging;
    setDragging(null);
    if (!from || from === targetId) return;
    onChangeOffers((offers) => {
      const keys = offers.map((o) => o.id);
      const fi = keys.indexOf(from);
      const ti = keys.indexOf(targetId);
      if (fi < 0 || ti < 0) return offers;
      const next = [...offers];
      const [item] = next.splice(fi, 1);
      next.splice(ti, 0, item!);
      return next;
    });
  };

  const duplicate = (id: string) =>
    onChangeOffers((offers) => {
      const i = offers.findIndex((o) => o.id === id);
      const src = offers[i];
      if (!src) return offers;
      const copy: Offer = { ...src, id: newId(), name: `${src.name} (copy)` };
      const next = [...offers];
      next.splice(i + 1, 0, copy);
      queueMicrotask(() => onSelect(copy.id));
      return next;
    });

  const patch = (id: string, fn: (o: Offer) => Offer) => onChangeOffers((offers) => offers.map((o) => (o.id === id ? fn(o) : o)));

  const scrollTo = (id: string) => {
    onSelect(id);
    const el = document.getElementById(`offer-${id}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96, behavior: "smooth" });
  };

  return (
    <SectionCard
      title="Offers"
      subtitle="Money is per delivered order."
      actions={
        readOnly ? undefined : (
        <>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Offer template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {OFFER_TEMPLATES.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="h-8 text-xs" onClick={add}>
            <Plus aria-hidden /> Add offer
          </Button>
        </>
        )
      }
      contentClassName="space-y-3"
    >
      {product.offers.length >= 2 && (
        <ol aria-label="Offer order — drag a pill to reorder" className="flex flex-wrap gap-1.5">
          {product.offers.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                draggable
                onDragStart={() => setDragging(o.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(o.id)}
                onDragEnd={() => setDragging(null)}
                onClick={() => scrollTo(o.id)}
                title="Drag to reorder · click to open"
                className={cn(
                  "inline-flex h-7 max-w-[14rem] items-center gap-1 rounded-full border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                  o.id === selectedOfferId ? "border-brand/60 bg-brand-soft text-ink" : "border-line text-ink-2 hover:text-ink",
                  dragging === o.id && "opacity-50",
                )}
              >
                <GripVertical className="size-3 text-ink-3" aria-hidden />
                <span className="num tabular-nums text-ink-3">{i + 1}</span>
                <span dir="auto" className="truncate">
                  {o.name || "Offer"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {product.offers.length === 0 ? (
        <p className="text-xs text-ink-3">No offers yet: add one from a template above.</p>
      ) : (
        <div className="space-y-3">
          {product.offers.map((o, i) => (
            <OfferEditor
              key={o.id}
              index={i}
              count={product.offers.length}
              product={product}
              offer={o}
              data={data}
              selected={o.id === selectedOfferId}
              onSelect={() => onSelect(o.id)}
              onChange={(fn) => patch(o.id, fn)}
              onMove={(delta) => move(o.id, delta)}
              onDuplicate={() => duplicate(o.id)}
              onDelete={() => onDeleteOffer(o.id)}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
