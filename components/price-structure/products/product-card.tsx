"use client";

import { useId, useState } from "react";
import { Check, CopyPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Product, Settings } from "@/price-structure/engine/types";
import { ConfirmDialog } from "../confirm-dialog";
import { Field, NumberField, TextField } from "../fields";
import { PRODUCT_SLOTS, productColor } from "../palette";
import { SectionCard } from "../section-card";

/** The product card (brief §6.2): name, cost, price, SKU, colour, markup, Duplicate / Delete. */
export function ProductCard({
  product,
  settings,
  onChange,
  onDuplicate,
  onDelete,
  readOnly = false,
}: {
  product: Product;
  settings: Settings;
  onChange: (fn: (p: Product) => Product) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** A viewer: no Duplicate / Delete (the fields are disabled by the page's fieldset). */
  readOnly?: boolean;
}) {
  const ids = { name: useId(), cost: useId(), price: useId(), sku: useId() };
  const [confirm, setConfirm] = useState(false);
  const exVat = settings.pricesIncludeVat ? product.price / (1 + settings.vatRate) : product.price;
  const markup = exVat / Math.max(product.unitCost, 0.01);
  const set = <K extends keyof Product>(key: K, value: Product[K]) => onChange((p) => ({ ...p, [key]: value }));

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: productColor(product.colorSlot) }} aria-hidden />
          <span dir="auto">{product.name || "Product"}</span>
        </span>
      }
      actions={
        readOnly ? undefined : (
        <>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onDuplicate}>
            <CopyPlus aria-hidden /> Duplicate
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-neg hover:text-neg" onClick={() => setConfirm(true)}>
            <Trash2 aria-hidden /> Delete
          </Button>
        </>
        )
      }
    >
      <div className="grid gap-3 @md/editor:grid-cols-2 @2xl/editor:grid-cols-4">
        <Field label="Name" htmlFor={ids.name} className="@md/editor:col-span-2">
          <TextField id={ids.name} value={product.name} onChange={(v) => set("name", v)} placeholder="Product name" />
        </Field>
        <Field label="Unit cost" hint="What one unit costs you" htmlFor={ids.cost}>
          <NumberField id={ids.cost} value={product.unitCost} unit="SAR" min={0} onChange={(v) => set("unitCost", v)} />
        </Field>
        <Field
          label="Unit price"
          hint={settings.pricesIncludeVat ? "Incl. VAT, before discounts" : "Excl. VAT, before discounts"}
          htmlFor={ids.price}
        >
          <NumberField id={ids.price} value={product.price} unit="SAR" min={0} onChange={(v) => set("price", v)} />
        </Field>
        <Field label="SKU / code" hint="Optional" htmlFor={ids.sku} className="@md/editor:col-span-2">
          <TextField id={ids.sku} value={product.sku} onChange={(v) => set("sku", v)} dir="ltr" />
        </Field>
        <div className="space-y-1 @md/editor:col-span-2">
          <span className="block text-xs text-ink-2">Colour</span>
          <div role="radiogroup" aria-label="Product colour" className="flex flex-wrap gap-1.5">
            {PRODUCT_SLOTS.map((slot) => {
              const active = slot === product.colorSlot;
              return (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Colour ${slot + 1}`}
                  onClick={() => set("colorSlot", slot)}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                    active ? "border-ink scale-110" : "border-transparent hover:scale-105",
                  )}
                  style={{ background: productColor(slot) }}
                >
                  {active && <Check className="size-3 text-on-fill" aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-3 tabular-nums">
        Gross markup {Number.isFinite(markup) ? markup.toFixed(2) : "—"}× on cost (ex VAT)
      </p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={
          <>
            Delete &ldquo;<span dir="auto">{product.name}</span>&rdquo; and its {product.offers.length} offer
            {product.offers.length === 1 ? "" : "s"}?
          </>
        }
        description="Its shares in every plan and its orders in every actual period go with it. The version's other products stay as they are."
        confirmLabel="Delete product"
        onConfirm={onDelete}
      />
    </SectionCard>
  );
}
