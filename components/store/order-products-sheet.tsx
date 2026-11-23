"use client";

import type { RefObject } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chip } from "@/components/ui/chip";
import { isoDate, sarBare } from "@/lib/format";
import type { StoreOrderItem, StoreOrderRow } from "@/db/queries/store";
import {
  ORDER_STATUS_FIELD_KEY,
  orderStatusLabel,
  orderStatusTone,
} from "@/store/order-status";

/** "Ultra 3 ×1" + how many more lines — the Orders table's Products cell. */
export function productsSummary(items: StoreOrderItem[] | undefined): {
  first: string;
  more: number;
} | null {
  const head = items?.[0];
  if (!items || !head) return null;
  return { first: `${head.name ?? head.sku ?? "Product"} ×${head.quantity}`, more: items.length - 1 };
}

/**
 * One order's products — the panel a row of the Orders table opens. Lines as
 * the Salla feed last sent them (incl. VAT, SAR); what the lines don't cover
 * (shipping, COD fee, discounts) is the difference to the total paid, shown
 * only when there is one. An uploaded order carries no lines and says so.
 */
export function OrderProductsSheet({
  order,
  items,
  onClose,
  returnFocus,
}: {
  order: StoreOrderRow | null;
  items: StoreOrderItem[];
  onClose: () => void;
  /** Where focus goes on close (the control that opened it); else Radix's default. */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const status = order?.attributes[ORDER_STATUS_FIELD_KEY];
  const statusSlug = typeof status === "string" && status !== "" ? status : null;
  const linesKnown = items.every((l) => l.lineTotal !== null);
  const linesSum = items.reduce((a, l) => a + (l.lineTotal ?? 0), 0);
  const other = order && linesKnown ? Math.round((order.totalAmount - linesSum) * 100) / 100 : 0;

  return (
    <Sheet open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(32rem,100vw)] gap-0 overflow-y-auto sm:max-w-none"
        onCloseAutoFocus={(e) => {
          const el = returnFocus?.current;
          if (!el) return;
          e.preventDefault();
          el.focus();
          returnFocus.current = null;
        }}
      >
        {order && (
          <>
            <SheetHeader className="border-b border-line pr-12">
              <SheetTitle className="font-mono">Order {order.orderId}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 tabular-nums">
                <span>{isoDate(order.orderDate)}</span>
                {statusSlug && <Chip tone={orderStatusTone(statusSlug)}>{orderStatusLabel(statusSlug)}</Chip>}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 py-3">
              {items.length === 0 ? (
                <p className="text-sm text-ink-2">
                  {order.fromFeed
                    ? "Salla sent no products for this order."
                    : "Uploaded orders don’t carry their products."}
                </p>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-ink-2">
                      <th className="py-1 text-left font-normal">Product</th>
                      <th className="py-1 text-right font-normal">Qty</th>
                      <th className="py-1 text-right font-normal">Total (SAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((l, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="py-2 pr-3">
                          <div dir="auto" className="break-words">
                            {l.name ?? l.sku ?? "—"}
                          </div>
                          {l.sku && l.name && (
                            <div className="font-mono text-xs text-ink-2">{l.sku}</div>
                          )}
                        </td>
                        <td className="py-2 text-right">{l.quantity}</td>
                        <td className="py-2 text-right">
                          {l.lineTotal === null ? "—" : sarBare(l.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {other !== 0 && (
                      <tr className="border-t border-line-2 text-ink-2">
                        <td className="py-2" colSpan={2}>
                          Shipping, fees and discounts
                        </td>
                        <td className="py-2 text-right">{sarBare(other)}</td>
                      </tr>
                    )}
                    <tr className={other !== 0 ? "" : "border-t border-line-2"}>
                      <td className="py-2 font-semibold" colSpan={2}>
                        Total paid
                      </td>
                      <td className="py-2 text-right font-semibold">{sarBare(order.totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
