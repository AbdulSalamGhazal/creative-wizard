"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { money0 } from "@/price-structure/format";
import type { Product } from "@/price-structure/engine/types";
import { productColor } from "../palette";

/**
 * The product list (brief §6.2): a colour dot, the name, "{n} offers ·
 * {price} SAR". A vertical list beside the editor on wide screens; a select
 * above it on a phone, where a list would push the editor below the fold.
 */
export function ProductList({
  products,
  selectedId,
  onSelect,
  onAdd,
}: {
  products: readonly Product[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const summary = (p: Product) => `${p.offers.length} offer${p.offers.length === 1 ? "" : "s"} · ${money0(p.price)} SAR`;
  return (
    <>
      <div className="flex items-center gap-2 lg:hidden">
        <Select value={selectedId ?? ""} onValueChange={onSelect}>
          <SelectTrigger size="sm" className="h-8 flex-1 text-xs" aria-label="Product">
            <SelectValue placeholder="Product…" />
          </SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: productColor(p.colorSlot) }} aria-hidden />
                  <span dir="auto">{p.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onAdd}>
          <Plus aria-hidden /> Add
        </Button>
      </div>
      <nav aria-label="Products" className="hidden self-start rounded-lg border border-line bg-surface lg:block">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-label text-ink-3">Products</span>
          <Button type="button" size="xs" variant="ghost" onClick={onAdd}>
            <Plus aria-hidden /> Add
          </Button>
        </div>
        <ul className="max-h-[70vh] overflow-y-auto py-1">
          {products.map((p) => {
            const active = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                    active && "bg-surface-2",
                  )}
                >
                  <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: productColor(p.colorSlot) }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className={cn("block truncate", active ? "text-ink" : "text-ink-2")} title={p.name}>
                      {p.name}
                    </span>
                    <span className="block text-[11px] text-ink-3 num tabular-nums">{summary(p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
