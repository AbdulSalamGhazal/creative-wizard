"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import type { TableKey } from "@/lib/table-columns";
import { PLATFORM_LABEL } from "@/lib/palette";
import { int, isoDate } from "@/lib/format";
import { batchStatusLabel } from "@/lib/upload-batches";
import { cn } from "@/lib/utils";

/** One upload batch, as both histories show it. */
export interface BatchHistoryRow {
  id: string;
  /** ISO timestamp (a Date can't cross to a client component as-is). */
  uploadedAt: string;
  /** Ads batches only — the Store has no platform per batch. */
  platform?: string | null;
  fileName: string;
  uploadedBy: string | null;
  /** Rows the batch inserted. */
  rows: number;
  /** Rows an upsert batch updated (Store); omitted for ads. */
  updated?: number;
  status: string;
  /** The row's rollback control while it is eligible, else null. */
  rollback: ReactNode;
}

/**
 * THE upload history (D22 + W3-3, 2026-10): the ads and the Store histories
 * were two hand-built tables that disagreed — the ads one printed the stored
 * `rolled_back` identifier and each kept its own copy of the rollback window.
 * Now one `DataTable` with a columns control, sort and the file name pinned;
 * each page keeps its own key (their column universes differ: ads has a
 * platform, the Store counts updated rows).
 */
export function BatchHistoryTable({
  rows,
  tableKey,
  showPlatform,
  empty,
}: {
  rows: BatchHistoryRow[];
  tableKey: TableKey;
  showPlatform: boolean;
  empty?: ReactNode;
}) {
  const keys = useMemo(
    () => ["uploadedAt", ...(showPlatform ? ["platform"] : []), "uploadedBy", "rows", "status", "rollback"],
    [showPlatform],
  );
  const cols = useTableColumns({
    tableKey,
    hideable: keys.filter((k) => k !== "rollback"),
    defaults: keys,
  });
  const [sortKey, setSortKey] = useState("uploadedAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const columns = useMemo<DataColumn<BatchHistoryRow>[]>(
    () => [
      {
        key: "fileName",
        label: "File",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.fileName.toLowerCase(),
        csv: (r) => r.fileName,
        render: (r) => (
          <span
            className="block max-w-[10rem] truncate font-mono text-xs text-ink sm:max-w-[22rem]"
            title={r.fileName}
          >
            {r.fileName}
          </span>
        ),
      },
      {
        key: "uploadedAt",
        label: "Uploaded",
        sortable: true,
        sortValue: (r) => r.uploadedAt,
        csv: (r) => isoDate(r.uploadedAt),
        render: (r) => <span className="whitespace-nowrap text-ink-2">{isoDate(r.uploadedAt)}</span>,
      },
      ...(showPlatform
        ? [
            {
              key: "platform",
              label: "Platform",
              sortable: true,
              defaultSortDir: "asc",
              sortValue: (r) => (r.platform ? (PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform) : null),
              csv: (r) => r.platform ?? "",
              render: (r) =>
                r.platform ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                    <PlatformDot platform={r.platform} size="sm" />
                    {PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform}
                  </span>
                ) : (
                  "—"
                ),
            } satisfies DataColumn<BatchHistoryRow>,
          ]
        : []),
      {
        key: "uploadedBy",
        label: "By",
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.uploadedBy,
        csv: (r) => r.uploadedBy ?? "",
        render: (r) => <span className="whitespace-nowrap text-ink-2">{r.uploadedBy ?? "—"}</span>,
      },
      {
        key: "rows",
        label: "Rows",
        align: "right",
        sortable: true,
        sortValue: (r) => r.rows,
        csv: (r) => r.rows,
        render: (r) =>
          r.updated === undefined ? (
            <span className="text-ink">{int(r.rows)}</span>
          ) : (
            <span className="whitespace-nowrap text-ink-2">
              {int(r.rows)} new
              {r.updated > 0 && <span className="text-ink-3"> · {int(r.updated)} upd</span>}
            </span>
          ),
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.status,
        csv: (r) => batchStatusLabel(r.status),
        render: (r) => (
          <span
            className={cn(
              "inline-flex h-5 items-center whitespace-nowrap rounded border px-1.5 text-[10px]",
              r.status === "active"
                ? "border-pos/40 bg-pos/10 text-pos"
                : "border-line-2 bg-surface-2 text-ink-3",
            )}
          >
            {batchStatusLabel(r.status)}
          </span>
        ),
      },
      {
        key: "rollback",
        label: "Rollback",
        align: "right",
        // The only route to undoing a batch — never hideable (ux-standards).
        lockedVisible: true,
        render: (r) => r.rollback,
      },
    ],
    [showPlatform],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sortKey}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) => {
        setSortKey(key);
        setDir(d);
      }}
      minWidthClass="min-w-[720px]"
      empty={empty}
    />
  );
}
