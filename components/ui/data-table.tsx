"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { rowsToCsv, type CsvColumn } from "@/lib/csv-export";

/**
 * The canonical data table. One sort/resize/reorder/visibility behaviour for
 * every table in the app — flat columns, click-to-sort, drag a grip to reorder,
 * drag the right edge to resize, hide columns from the outside, Summary-style
 * borders, sticky header/footer + sticky pinned first column, optional totals.
 *
 * State is CONTROLLED: the consumer owns `sort`/`dir`/`order`/`hidden` (so it
 * can back them with the URL for saved views, or with local state) and gets
 * `onSort`/`onReorder` callbacks. Column widths are ephemeral (internal).
 */
export interface DataColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** The identity column: pinned sticky-left, never hidden or reordered. */
  pinned?: boolean;
  /** Body cell. */
  render: (row: T) => React.ReactNode;
  /** Footer (totals) cell; omit → blank footer cell. */
  total?: () => React.ReactNode;
  /** Comparable value for client-side sort (null sinks to the bottom). */
  sortValue?: (row: T) => number | string | null;
  /** Direction on first click of THIS column (default "desc"). */
  defaultSortDir?: "asc" | "desc";
  /** Raw value for CSV export. Falls back to `sortValue` when omitted. */
  csv?: (row: T) => string | number | null;
}

const MIN_W = 64;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  dir = "desc",
  hidden = [],
  order = [],
  onSort,
  onReorder,
  onRowClick,
  rowClassName,
  showTotals = false,
  minWidthClass = "min-w-[960px]",
  csvFileName,
  empty,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: string;
  dir?: "asc" | "desc";
  hidden?: string[];
  order?: string[];
  onSort?: (key: string, dir: "asc" | "desc") => void;
  onReorder?: (order: string[]) => void;
  onRowClick?: (row: T) => void;
  /** Extra classes per row (e.g. dim excluded rows). */
  rowClassName?: (row: T) => string;
  showTotals?: boolean;
  minWidthClass?: string;
  /** When set, shows a "Download CSV" button that exports the shown columns
   *  (in their current order/visibility/sort) using each column's `csv` value
   *  (or `sortValue` as a fallback). The filename gets a `.csv` suffix. */
  csvFileName?: string;
  empty?: React.ReactNode;
}) {
  const pinnedCol = columns.find((c) => c.pinned);
  const firstSortable = columns.find((c) => c.sortable);
  const sortKey = sort ?? firstSortable?.key;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  // Apply the consumer's column order to the non-pinned columns; pinned first.
  const ordered = useMemo(() => {
    const rest = columns.filter((c) => !c.pinned);
    const byKey = new Map(rest.map((c) => [c.key, c]));
    const out: DataColumn<T>[] = [];
    const seen = new Set<string>();
    for (const k of order) {
      const col = byKey.get(k);
      if (col && !seen.has(k)) {
        out.push(col);
        seen.add(k);
      }
    }
    for (const col of rest) if (!seen.has(col.key)) out.push(col);
    return pinnedCol ? [pinnedCol, ...out] : out;
  }, [columns, order, pinnedCol]);

  const cols = useMemo(
    () => ordered.filter((c) => c.pinned || !hiddenSet.has(c.key)),
    [ordered, hiddenSet],
  );

  // ── Sort (client-side, by the active column's sortValue) ──
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return (av < bv ? -1 : av > bv ? 1 : 0) * factor;
      }
      return ((av as number) - (bv as number)) * factor;
    });
  }, [rows, sortKey, dir, columns]);

  const toggleSort = (col: DataColumn<T>) => {
    if (!col.sortable || !onSort) return;
    const nextDir =
      col.key === sortKey
        ? dir === "asc"
          ? "desc"
          : "asc"
        : (col.defaultSortDir ?? "desc");
    onSort(col.key, nextDir);
  };

  // ── Reorder (drag a grip; emit the new non-pinned order) ──
  const dragKey = useRef<string | null>(null);
  const onDrop = (targetKey: string) => {
    const from = dragKey.current;
    dragKey.current = null;
    if (!from || from === targetKey || !onReorder) return;
    const keys = ordered.filter((c) => !c.pinned).map((c) => c.key);
    const fi = keys.indexOf(from);
    const ti = keys.indexOf(targetKey);
    if (fi < 0 || ti < 0) return;
    keys.splice(fi, 1);
    keys.splice(ti, 0, from);
    onReorder(keys);
  };

  // ── Resize (ephemeral widths) ──
  const [widths, setWidths] = useState<Record<string, number>>({});
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizing.current;
    if (!r) return;
    setWidths((prev) => ({
      ...prev,
      [r.key]: Math.max(MIN_W, r.startW + (e.clientX - r.startX)),
    }));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizing.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);
  const onResizeStart = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const startW = widths[key] ?? th?.getBoundingClientRect().width ?? 120;
      resizing.current = { key, startX: e.clientX, startW };
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
    },
    [widths, onResizeMove, onResizeEnd],
  );
  const styleFor = (key: string): React.CSSProperties | undefined => {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  // CSV of exactly what's shown (visible columns, in order, current sort).
  const csvContent = useMemo(() => {
    if (!csvFileName) return "";
    const csvCols: CsvColumn<T>[] = cols.map((c) => ({
      key: c.key,
      label: c.label,
      value: (r) => (c.csv ? c.csv(r) : c.sortValue ? c.sortValue(r) : null),
    }));
    return rowsToCsv(sorted, csvCols);
  }, [csvFileName, cols, sorted]);

  if (rows.length === 0) {
    return (
      <>
        {empty ?? (
          <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
            No rows.
          </div>
        )}
      </>
    );
  }

  const border = (i: number) => (i > 0 ? "border-l border-line" : "");
  const pinnedCls = (col: DataColumn<T>, extra: string) =>
    col.pinned ? `sticky left-0 ${extra}` : "";

  return (
    <div className="space-y-2">
      {csvFileName && (
        <div className="flex justify-end">
          <DownloadCsvButton csvContent={csvContent} filename={`${csvFileName}.csv`} />
        </div>
      )}
      <div className="rounded-lg border border-line bg-surface overflow-auto max-h-[70vh]">
      <table className={cn(minWidthClass, "w-full text-xs num")}>
        <thead className="sticky top-0 z-20 bg-surface">
          <tr className="text-label text-ink-3 border-b border-line bg-surface-2/40">
            {cols.map((c, i) => {
              const canReorder = !c.pinned && Boolean(onReorder);
              return (
                <th
                  key={c.key}
                  style={styleFor(c.key)}
                  onDragOver={canReorder ? (e) => e.preventDefault() : undefined}
                  onDrop={canReorder ? () => onDrop(c.key) : undefined}
                  className={cn(
                    "group/th relative font-medium px-3 py-2 whitespace-nowrap bg-surface-2/40",
                    c.align === "right" ? "text-right" : "text-left",
                    border(i),
                    pinnedCls(c, "z-30 bg-surface-2"),
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      c.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {canReorder && (
                      <span
                        draggable
                        onDragStart={() => {
                          dragKey.current = c.key;
                        }}
                        onDragEnd={() => {
                          dragKey.current = null;
                        }}
                        title="Drag to reorder"
                        className="cursor-grab active:cursor-grabbing text-ink-3/0 group-hover/th:text-ink-3 hover:!text-ink transition-colors"
                      >
                        <GripVertical className="w-3 h-3" />
                      </span>
                    )}
                    {c.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-ink transition-colors",
                          sortKey === c.key && "text-ink",
                          c.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.label}
                        {sortKey === c.key ? (
                          dir === "asc" ? (
                            <ArrowUp className="w-3 h-3 text-brand" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-brand" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-ink-3 opacity-60" />
                        )}
                      </button>
                    ) : (
                      c.label
                    )}
                  </span>
                  <span
                    onMouseDown={(e) => onResizeStart(c.key, e)}
                    title="Drag to resize"
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/40 active:bg-brand/60"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn(
                "group hover:bg-surface-2/60 transition-colors",
                onRowClick && "cursor-pointer",
                rowClassName?.(r),
              )}
            >
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  style={styleFor(c.key)}
                  className={cn(
                    "px-3 py-2 whitespace-nowrap text-ink-2 overflow-hidden text-ellipsis",
                    c.align === "right" ? "text-right tabular-nums" : "text-left",
                    border(i),
                    pinnedCls(c, "z-10 bg-surface group-hover:bg-surface-2/60"),
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot className="sticky bottom-0 z-10 bg-surface">
            <tr className="border-t-2 border-line text-ink font-medium">
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  style={styleFor(c.key)}
                  className={cn(
                    "px-3 py-2.5 whitespace-nowrap bg-surface",
                    c.align === "right" ? "text-right tabular-nums" : "text-left",
                    border(i),
                    pinnedCls(c, "z-20 bg-surface"),
                  )}
                >
                  {c.total ? c.total() : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      </div>
    </div>
  );
}
