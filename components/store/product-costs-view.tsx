"use client";

import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS, type TableColumnPref } from "@/lib/table-columns";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { int, isoDate, sarBare } from "@/lib/format";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { deleteStoreProductCostAction, setStoreProductCost } from "@/app/actions/store-costs";
import type { StoreCostRow, StoreProductRow } from "@/db/queries/store-costs";

/**
 * Store → Product costs: every product the brand's Salla orders carried, with
 * the unit cost in force today. A row (or its name, by keyboard) opens the
 * product's panel: set a cost from a day, and see / remove its history.
 * Editing needs `config.store`; everyone else reads.
 */
export function ProductCostsView({
  products,
  costs,
  today,
  canEdit,
  columnPref,
}: {
  products: StoreProductRow[];
  costs: StoreCostRow[];
  today: string;
  canEdit: boolean;
  columnPref?: TableColumnPref;
}) {
  const [open, setOpen] = useState<StoreProductRow | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const historyOf = useMemo(() => {
    const m = new Map<string, StoreCostRow[]>();
    for (const c of costs) (m.get(c.productKey) ?? m.set(c.productKey, []).get(c.productKey)!).push(c);
    return m;
  }, [costs]);

  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_PRODUCT_COSTS,
    hideable: ["unit_cost", "from", "units30", "sales30"],
    defaults: ["unit_cost", "from", "units30", "sales30"],
    initial: columnPref,
  });

  const columns: DataColumn<StoreProductRow>[] = useMemo(
    () => [
      {
        key: "product",
        label: "Product",
        pinned: true,
        sortable: true,
        sortValue: (r) => r.name ?? r.productKey,
        render: (r) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              returnFocus.current = e.currentTarget;
              setOpen(r);
            }}
            className="block max-w-[14rem] rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand sm:max-w-[22rem]"
            aria-label={`${r.name ?? r.productKey}: ${canEdit ? "set cost" : "show costs"}`}
          >
            <span dir="auto" className="block truncate text-ink" title={r.name ?? undefined}>
              {r.name ?? r.productKey}
            </span>
            {r.sku && <span className="block truncate font-mono text-xs text-ink-2">{r.sku}</span>}
          </button>
        ),
      },
      {
        key: "unit_cost",
        label: "Unit cost (SAR)",
        align: "right",
        sortable: true,
        sortValue: (r) => r.currentCost,
        render: (r) =>
          r.currentCost !== null ? (
            <span className="tabular-nums">{sarBare(r.currentCost)}</span>
          ) : canEdit ? (
            <span className="text-brand">Add cost</span>
          ) : (
            "—"
          ),
      },
      {
        key: "from",
        label: "Since",
        sortable: true,
        sortValue: (r) => r.currentFrom,
        render: (r) => (r.currentFrom ? <span className="tabular-nums">{isoDate(r.currentFrom)}</span> : "—"),
      },
      {
        key: "units30",
        label: "Sold (30 days)",
        align: "right",
        sortable: true,
        defaultSortDir: "desc",
        sortValue: (r) => r.units30,
        render: (r) => <span className="tabular-nums">{int(r.units30)}</span>,
      },
      {
        key: "sales30",
        label: "Sales before VAT (30 days)",
        align: "right",
        sortable: true,
        defaultSortDir: "desc",
        sortValue: (r) => r.salesBeforeVat30,
        render: (r) => <span className="tabular-nums">{sarBare(r.salesBeforeVat30)}</span>,
      },
    ],
    [canEdit],
  );

  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "units30", dir: "desc" });
  const rows = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const sv = col?.sortValue;
    if (!sv) return products;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...products].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av < bv ? -mult : av > bv ? mult : 0;
    });
  }, [products, columns, sort]);

  const missing = products.filter((p) => p.currentCost === null).length;

  return (
    <div className="space-y-2">
      {products.length > 0 && missing > 0 && (
        <p className="text-sm text-ink-2 tabular-nums">
          {int(missing)} of {int(products.length)} products have no cost yet
        </p>
      )}
      <DataTable<StoreProductRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.productKey}
        sort={sort.key}
        dir={sort.dir}
        {...cols.tableProps}
        onSort={(key, dir) => setSort({ key, dir })}
        onRowClick={(r) => setOpen(r)}
        minWidthClass="min-w-[640px]"
        empty={
          <EmptyState
            size="lg"
            title="No products yet"
            hint="Products appear here once Salla orders with products arrive."
          />
        }
      />
      <CostSheet
        product={open}
        history={open ? (historyOf.get(open.productKey) ?? []) : []}
        today={today}
        canEdit={canEdit}
        onClose={() => setOpen(null)}
        returnFocus={returnFocus}
      />
    </div>
  );
}

function CostSheet({
  product,
  history,
  today,
  canEdit,
  onClose,
  returnFocus,
}: {
  product: StoreProductRow | null;
  history: StoreCostRow[];
  today: string;
  canEdit: boolean;
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
}) {
  const [cost, setCost] = useState("");
  const [from, setFrom] = useState(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // A different product opened: start its form fresh, prefilled with today's cost.
  if (product && product.productKey !== lastKey) {
    setLastKey(product.productKey);
    setCost(product.currentCost === null ? "" : String(product.currentCost));
    setFrom(today);
    setError(null);
  }

  const save = async () => {
    if (!product) return;
    setPending(true);
    setError(null);
    try {
      const res = await safeAction(() =>
        setStoreProductCost({ productKey: product.productKey, unitCost: cost, effectiveFrom: from }),
      );
      if (!res.ok) {
        setError(res.error ?? "Couldn't save the cost.");
        toastActionFailure(res, "Couldn't save the cost");
        return;
      }
      toast.success("Cost saved");
      // Reopening starts fresh: today's cost (the saved one, if in force) and today.
      setLastKey(null);
      onClose();
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    const res = await safeAction(() => deleteStoreProductCostAction({ id }));
    if (!res.ok) {
      toastActionFailure(res, "Couldn't remove the cost");
      return;
    }
    toast.success("Cost removed");
  };

  return (
    <Sheet
      open={product !== null}
      onOpenChange={(o) => {
        if (!o && !pending) {
          setLastKey(null);
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-[min(28rem,100vw)] gap-0 overflow-y-auto sm:max-w-none"
        onCloseAutoFocus={(e) => {
          const el = returnFocus.current;
          if (!el) return;
          e.preventDefault();
          el.focus();
          returnFocus.current = null;
        }}
      >
        {product && (
          <>
            <SheetHeader className="border-b border-line pr-12">
              <SheetTitle dir="auto">{product.name ?? product.productKey}</SheetTitle>
              <SheetDescription className="font-mono">{product.sku ?? "No SKU"}</SheetDescription>
            </SheetHeader>

            {canEdit && (
              <form
                className="space-y-3 px-4 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Unit cost (SAR)" htmlFor="cost-value">
                    <Input
                      id="cost-value"
                      inputMode="decimal"
                      value={cost}
                      onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="84.00"
                      className="tabular-nums"
                      autoFocus
                    />
                  </Field>
                  <Field label="From" htmlFor="cost-from">
                    <Input id="cost-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                </div>
                <FormError>{error}</FormError>
                <SheetFooter className="flex-row justify-end gap-2 p-0">
                  <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={pending || cost === ""}>
                    {pending ? "Saving…" : "Save cost"}
                  </Button>
                </SheetFooter>
              </form>
            )}

            <section aria-label="Cost history" className="border-t border-line px-4 py-3">
              <h3 className="mb-2 text-xs text-ink-2">History</h3>
              {history.length === 0 ? (
                <p className="text-sm text-ink-2">No cost entered yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="tabular-nums">
                        From {isoDate(h.effectiveFrom)}
                        {h.effectiveFrom > today && <span className="text-ink-2"> · upcoming</span>}
                      </span>
                      <span className="ml-auto tabular-nums">{sarBare(h.unitCost)}</span>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Remove the cost from ${isoDate(h.effectiveFrom)}`}
                          title={h.createdBy ? `Set by ${h.createdBy}` : undefined}
                          onClick={() => void remove(h.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
