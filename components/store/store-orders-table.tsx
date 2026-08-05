"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Columns3, Download, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { usePersistentHidden } from "@/components/ui/use-persistent-hidden";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sar, isoDate, int } from "@/lib/format";
import { downloadCsv, todayStamp } from "@/lib/csv-export";
import { useNavTransition } from "@/lib/nav-progress";
import { exportStoreOrders } from "@/app/actions/store-export";
import type { StoreOrderRow } from "@/db/queries/store";
import type { StoreField } from "@/store/fields";

const CORE_SORT = new Set(["order_id", "order_date", "total_amount"]);

type SortKey = "order_id" | "order_date" | "total_amount";

export function StoreOrdersTable({
  rows,
  fields,
  total,
  sumTotal,
  page,
  pageSize,
  sort,
  dir,
  canUpload,
}: {
  rows: StoreOrderRow[];
  fields: StoreField[];
  total: number;
  sumTotal: number;
  page: number;
  pageSize: number;
  sort: SortKey;
  dir: "asc" | "desc";
  canUpload: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  // Every custom field is a column now (the "show in table" toggle was retired
  // — visibility is each viewer's per-browser choice via the Columns menu).
  const customCols = useMemo(() => fields.filter((f) => !f.core), [fields]);
  // Hideable columns (order_id is pinned identity → always visible).
  const hideableKeys = useMemo(
    () => ["order_date", "total_amount", ...customCols.map((c) => c.key)],
    [customCols],
  );
  // Persist what's HIDDEN, not what's visible: a newly-added field isn't in the
  // stored set, so it shows up by default until the viewer hides it.
  const [hiddenSet, setHiddenSet] = usePersistentHidden<string>(
    "cw-cols-hidden:store-orders",
  );
  const hidden = hideableKeys.filter((k) => hiddenSet.has(k));

  // Core columns sort server-side (URL); custom columns sort client-side over
  // the current page (acceptable v1). `clientSort` overrides the URL sort.
  const [clientSort, setClientSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );

  const columns: DataColumn<StoreOrderRow>[] = useMemo(() => {
    const cols: DataColumn<StoreOrderRow>[] = [
      {
        key: "order_id",
        label: "Order ID",
        pinned: true,
        sortable: true,
        render: (r) => <span className="font-mono text-xs">{r.orderId}</span>,
        sortValue: (r) => r.orderId,
        csv: (r) => r.orderId,
        total: () => (
          <span className="text-ink-3">
            {int(total)} order{total === 1 ? "" : "s"}
          </span>
        ),
      },
      {
        key: "order_date",
        label: "Date",
        sortable: true,
        render: (r) => <span className="num">{isoDate(r.orderDate)}</span>,
        sortValue: (r) => r.orderDate,
        defaultSortDir: "desc",
      },
      {
        key: "total_amount",
        label: "Total (SAR)",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums">{sar(r.totalAmount)}</span>,
        sortValue: (r) => r.totalAmount,
        defaultSortDir: "desc",
        total: () => (
          <span className="num tabular-nums font-semibold">{sar(sumTotal)}</span>
        ),
      },
      ...customCols.map((f): DataColumn<StoreOrderRow> => {
        const get = (r: StoreOrderRow) => r.attributes[f.key];
        if (f.type === "number") {
          return {
            key: f.key,
            label: f.label,
            align: "right",
            sortable: true,
            render: (r) => {
              const v = get(r);
              return v === undefined || v === null ? (
                "—"
              ) : (
                <span className="num tabular-nums">{int(Number(v))}</span>
              );
            },
            sortValue: (r) => {
              const v = get(r);
              return v === undefined || v === null ? null : Number(v);
            },
          };
        }
        if (f.type === "date") {
          return {
            key: f.key,
            label: f.label,
            sortable: true,
            render: (r) => {
              const v = get(r);
              return v ? <span className="num">{isoDate(String(v))}</span> : "—";
            },
            sortValue: (r) => (get(r) ? String(get(r)) : null),
          };
        }
        return {
          key: f.key,
          label: f.label,
          sortable: true,
          render: (r) => {
            const v = get(r);
            if (v === undefined || v === null || v === "") return "—";
            const s = String(v);
            return (
              <span className="block max-w-[16rem] truncate" title={s}>
                {s}
              </span>
            );
          },
          sortValue: (r) => (get(r) == null ? null : String(get(r))),
        };
      }),
    ];
    return cols;
  }, [customCols, total, sumTotal]);

  const displayRows = useMemo(() => {
    if (!clientSort) return rows;
    const col = columns.find((c) => c.key === clientSort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const mult = clientSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av === null || av === undefined) return 1; // nulls sink
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
  }, [rows, clientSort, columns]);

  const pushSort = (key: string, d: "asc" | "desc") => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("sort", key);
    next.set("dir", d);
    next.delete("page");
    startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const onSort = (key: string, d: "asc" | "desc") => {
    if (CORE_SORT.has(key)) {
      setClientSort(null);
      pushSort(key, d);
    } else {
      setClientSort({ key, dir: d });
    }
  };

  const goToPage = (p: number) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(p));
    startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeSort = clientSort?.key ?? sort;
  const activeDir = clientSort?.dir ?? dir;

  return (
    <div className="space-y-2">
      {/* Toolbar: Columns dropdown + Download CSV */}
      <div className="flex items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Show columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked disabled>
              Order ID
            </DropdownMenuCheckboxItem>
            {hideableKeys.map((k) => {
              const label =
                k === "order_date"
                  ? "Date"
                  : k === "total_amount"
                    ? "Total (SAR)"
                    : (customCols.find((c) => c.key === k)?.label ?? k);
              return (
                <DropdownMenuCheckboxItem
                  key={k}
                  checked={!hiddenSet.has(k)}
                  onCheckedChange={(on) =>
                    setHiddenSet((prev) => {
                      const nextSet = new Set(prev);
                      if (on) nextSet.delete(k);
                      else nextSet.add(k);
                      return nextSet;
                    })
                  }
                >
                  {label}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <ExportButton searchParams={searchParams} />
      </div>

      <DataTable<StoreOrderRow>
        columns={columns}
        rows={displayRows}
        rowKey={(r) => r.id}
        sort={activeSort}
        dir={activeDir}
        hidden={hidden}
        onSort={onSort}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[720px]"
        empty={
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <ShoppingBag className="h-6 w-6 text-ink-3" />
            <p className="text-sm text-ink-2">
              {total === 0 ? "No orders yet" : "No orders match your filters"}
            </p>
            {total === 0 && canUpload && (
              <p className="text-xs text-ink-3">
                Upload your first Salla export from{" "}
                <Link href="/store/uploads/new" className="text-ink-2 underline hover:text-ink">
                  Store → Upload orders
                </Link>
                .
              </p>
            )}
          </div>
        }
      />

      {/* Pager */}
      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-ink-3">
          <span className="num">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{" "}
            {int(total)}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>
            <span className="num">
              Page {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportButton({ searchParams }: { searchParams: URLSearchParams }) {
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const res = await exportStoreOrders({
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
        q: searchParams.get("q") ?? undefined,
        sort: searchParams.get("sort") ?? undefined,
        dir: searchParams.get("dir") ?? undefined,
      });
      if (!res.ok || !res.csv) {
        toast.error(res.error ?? "Export failed");
        return;
      }
      downloadCsv(`store-orders-${todayStamp()}.csv`, res.csv);
      toast.success(res.truncated ? "Exported (capped at 10,000 rows)" : "Exported");
    } finally {
      setPending(false);
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={run} disabled={pending}>
      <Download className="h-3.5 w-3.5" />
      {pending ? "Exporting…" : "CSV"}
    </Button>
  );
}
