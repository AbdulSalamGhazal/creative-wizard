"use client";

import { useMemo, useState } from "react";
import Link from "@/components/nav/link";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { Download, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS, type TableColumnPref } from "@/lib/table-columns";
import { Button } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { dateTimeLabel, isoDate, int, num, sarBare } from "@/lib/format";
import { downloadCsv, todayStamp } from "@/lib/csv-export";
import { useNavTransition } from "@/lib/nav-progress";
import { exportStoreOrders } from "@/app/actions/store-export";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { StoreOrderRow } from "@/db/queries/store";
import type { StoreField } from "@/store/fields";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip } from "@/components/ui/chip";
import {
  ORDER_SOURCE_COLUMN_KEY,
  ORDER_STATUS_FIELD_KEY,
  orderSourceLabel,
  orderStatusLabel,
  orderStatusTone,
} from "@/store/order-status";

const CORE_SORT = new Set(["order_id", "order_date", "total_amount"]);

// Row bookkeeping columns (defaultHidden). The `_` prefix keeps them clear of
// any custom field key, which the field admin derives from a label.
const SYNCED_AT_KEY = "_synced_at";
const UPLOAD_FILE_KEY = "_upload_file";
const CREATED_AT_KEY = "_created_at";
const UPDATED_AT_KEY = "_updated_at";
const BOOKKEEPING_KEYS = [UPLOAD_FILE_KEY, CREATED_AT_KEY, UPDATED_AT_KEY] as const;

/** A timestamp cell: the business day, the exact time on hover. */
function Stamp({ iso }: { iso: string | null }) {
  if (iso === null) return <>—</>;
  return (
    <span className="tabular-nums" title={dateTimeLabel(iso)}>
      {isoDate(iso)}
    </span>
  );
}

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
  firstUse = false,
  showSource = false,
  columnPref,
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
  /** The brand has no orders at all — the first-use state (R-059). */
  firstUse?: boolean;
  /** The brand is linked to a Salla store: offer the Source column. */
  showSource?: boolean;
  /** Remembered columns for this user in this brand, resolved server-side. */
  columnPref?: TableColumnPref;
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
    () => [
      "order_date",
      "total_amount",
      ...customCols.map((c) => c.key),
      ...(showSource ? [ORDER_SOURCE_COLUMN_KEY, SYNCED_AT_KEY] : []),
      ...BOOKKEEPING_KEYS,
    ],
    [customCols, showSource],
  );
  const defaultHidden = useMemo(
    () => [...(showSource ? [SYNCED_AT_KEY] : []), ...BOOKKEEPING_KEYS],
    [showSource],
  );
  /**
   * Still HIDDEN-key semantics — a field added in Order fields is not in the
   * stored set, so it appears for everyone until they hide it — but the store
   * moved (2026-10) from this browser's localStorage to the user's account,
   * per brand, like the remembered filters. Old localStorage values are NOT
   * migrated: a viewer re-hides once.
   */
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.STORE_ORDERS,
    hideable: hideableKeys,
    defaults: hideableKeys,
    defaultHidden,
    initial: columnPref,
  });

  // Core columns sort server-side (URL); custom columns sort client-side over
  // the current page (acceptable v1). `clientSort` overrides the URL sort.
  const [clientSort, setClientSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );
  // R-078: a page-local sort over a MULTI-page result would read as the top of
  // all orders and be the top of 50. So while the orders span several pages a
  // custom column doesn't sort, and its header says why.
  const multiPage = total > pageSize;
  const customSort = useMemo<Pick<DataColumn<StoreOrderRow>, "sortable" | "info">>(
    () =>
      multiPage
        ? {
            sortable: false,
            info: "Sorting by this field would sort only the orders on this page, so it’s off while they span several pages.",
          }
        : { sortable: true },
    [multiPage],
  );

  const columns: DataColumn<StoreOrderRow>[] = useMemo(() => {
    const cols: DataColumn<StoreOrderRow>[] = [
      {
        key: "order_id",
        label: "Order ID",
        pinned: true,
        sortable: true,
        render: (r) => (
          // Short in practice, unbounded by type — and this cell is pinned.
          <span className="block max-w-[12rem] truncate font-mono text-xs sm:max-w-none">
            {r.orderId}
          </span>
        ),
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
        render: (r) => <span className="tabular-nums">{isoDate(r.orderDate)}</span>,
        sortValue: (r) => r.orderDate,
        defaultSortDir: "desc",
      },
      {
        key: "total_amount",
        label: "Total (SAR)",
        align: "right",
        sortable: true,
        render: (r) => <span className="tabular-nums">{sarBare(r.totalAmount)}</span>,
        sortValue: (r) => r.totalAmount,
        defaultSortDir: "desc",
        total: () => (
          <span className="tabular-nums font-semibold">{sarBare(sumTotal)}</span>
        ),
      },
      ...customCols.map((f): DataColumn<StoreOrderRow> => {
        const get = (r: StoreOrderRow) => r.attributes[f.key];
        if (f.type === "number") {
          return {
            key: f.key,
            label: f.label,
            align: "right",
            ...customSort,
            render: (r) => {
              const v = get(r);
              return v === undefined || v === null ? (
                "—"
              ) : (
                <span className="tabular-nums">{num(Number(v))}</span>
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
            ...customSort,
            render: (r) => {
              const v = get(r);
              return v ? <span className="tabular-nums">{isoDate(String(v))}</span> : "—";
            },
            sortValue: (r) => (get(r) ? String(get(r)) : null),
          };
        }
        if (f.key === ORDER_STATUS_FIELD_KEY) {
          // The Salla feed's status slug: Cancelled / Refunded carry a tone,
          // every other status is plain text.
          return {
            key: f.key,
            label: f.label,
            ...customSort,
            render: (r) => {
              const v = get(r);
              if (v === undefined || v === null || v === "") return "—";
              const label = orderStatusLabel(String(v));
              const tone = orderStatusTone(String(v));
              return tone ? <Chip tone={tone}>{label}</Chip> : label;
            },
            sortValue: (r) => (get(r) == null ? null : String(get(r))),
          };
        }
        return {
          key: f.key,
          label: f.label,
          ...customSort,
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
    if (showSource) {
      // Salla = the feed holds the order; Upload = it came from a file only.
      cols.push({
        key: ORDER_SOURCE_COLUMN_KEY,
        label: "Source",
        ...customSort,
        render: (r) => orderSourceLabel(r.fromFeed),
        sortValue: (r) => orderSourceLabel(r.fromFeed),
      });
      cols.push({
        key: SYNCED_AT_KEY,
        label: "Synced at",
        ...customSort,
        render: (r) => <Stamp iso={r.connectorUpdatedAt} />,
        sortValue: (r) => r.connectorUpdatedAt,
      });
    }
    // Row bookkeeping the query already carries — offered, collapsed.
    cols.push(
      {
        key: UPLOAD_FILE_KEY,
        label: "Upload file",
        ...customSort,
        render: (r) =>
          r.uploadFileName === null ? (
            "—"
          ) : (
            <span className="block max-w-[16rem] truncate" title={r.uploadFileName}>
              {r.uploadFileName}
            </span>
          ),
        sortValue: (r) => r.uploadFileName,
      },
      {
        key: CREATED_AT_KEY,
        label: "Created at",
        ...customSort,
        render: (r) => <Stamp iso={r.createdAt} />,
        sortValue: (r) => r.createdAt,
      },
      {
        key: UPDATED_AT_KEY,
        label: "Updated at",
        ...customSort,
        render: (r) => <Stamp iso={r.updatedAt} />,
        sortValue: (r) => r.updatedAt,
      },
    );
    return cols;
  }, [customCols, total, sumTotal, customSort, showSource]);

  const displayRows = useMemo(() => {
    if (!clientSort || multiPage) return rows;
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
  }, [rows, clientSort, columns, multiPage]);

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

  const liveClientSort = multiPage ? null : clientSort;
  const activeSort = liveClientSort?.key ?? sort;
  const activeDir = liveClientSort?.dir ?? dir;

  return (
    <div className="space-y-2">
      {/* The Columns dropdown that used to live here is GONE — the control
          belongs to the table now (its corner button, above the header). */}
      <div className="flex items-center justify-end gap-2">
        <ExportButton searchParams={searchParams} />
      </div>

      <DataTable<StoreOrderRow>
        columns={columns}
        rows={displayRows}
        rowKey={(r) => r.id}
        sort={activeSort}
        dir={activeDir}
        {...cols.tableProps}
        onSort={onSort}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[720px]"
        empty={
          // The ONE EmptyState (R-059): first use offers the upload as the
          // house action button; otherwise the range or search hid them.
          firstUse ? (
            <EmptyState
              size="lg"
              icon={<ShoppingBag className="h-5 w-5" />}
              title="No orders yet"
              hint={
                canUpload
                  ? "Upload a Salla export to see orders."
                  : "Ask an admin to upload orders."
              }
              action={
                canUpload ? (
                  <Button asChild size="sm">
                    <Link href="/store/uploads/new">Upload orders</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState size="lg" title="No orders match these filters." kind="filtered" />
          )
        }
      />

      <Pager page={page} total={total} pageSize={pageSize} onPage={(p) => goToPage(p)} />
    </div>
  );
}

function ExportButton({ searchParams }: { searchParams: URLSearchParams }) {
  const [pending, setPending] = useState(false);
  async function run() {
    setPending(true);
    try {
      const res = await safeAction(() =>
        exportStoreOrders({
          from: searchParams.get("from") ?? undefined,
          to: searchParams.get("to") ?? undefined,
          q: searchParams.get("q") ?? undefined,
          sort: searchParams.get("sort") ?? undefined,
          dir: searchParams.get("dir") ?? undefined,
        }),
      );
      if (!res.ok || !("csv" in res) || !res.csv) {
        toastActionFailure(res, "Export failed");
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
