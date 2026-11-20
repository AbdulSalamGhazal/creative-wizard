"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import type { TableKey } from "@/lib/table-columns";
import { PLATFORM_LABEL } from "@/lib/palette";
import { int, isoDate } from "@/lib/format";
import { batchStatusLabel, ROLLBACK_WINDOW_MS } from "@/lib/upload-batches";
import { Chip } from "@/components/ui/chip";

/** Whole hours left in the rollback window, at least 1 while it is open. */
function rollbackHoursLeft(uploadedAt: string): number {
  const left = Date.parse(uploadedAt) + ROLLBACK_WINDOW_MS - Date.now();
  return Math.max(1, Math.ceil(left / 3_600_000));
}

/** How a Store batch wrote: an upsert, or new orders only. */
function modeLabel(upsert: boolean | undefined): string {
  return upsert === undefined ? "—" : upsert ? "Upsert" : "New only";
}

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
  /** Store only: the batch ran as an upsert. */
  upsert?: boolean;
  status: string;
  /** ISO timestamp of the rollback, and who did it (null = not rolled back / unknown). */
  rolledBackAt: string | null;
  rolledBackBy: string | null;
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
  rollbackInfo,
  empty,
}: {
  rows: BatchHistoryRow[];
  tableKey: TableKey;
  showPlatform: boolean;
  /** The rollback window rule, as the Status header's ⓘ (R-125). */
  rollbackInfo?: string;
  empty?: ReactNode;
}) {
  // The Store's history (the one without a platform per batch) counts
  // updated rows and records the upsert mode.
  const storeShape = !showPlatform;
  const optional = useMemo(
    () => [...(storeShape ? ["updated", "mode"] : []), "rolledBackAt", "rolledBackBy"],
    [storeShape],
  );
  const keys = useMemo(
    () => [
      "uploadedAt",
      ...(showPlatform ? ["platform"] : []),
      "uploadedBy",
      "rows",
      "status",
      ...optional,
    ],
    [showPlatform, optional],
  );
  const cols = useTableColumns({
    tableKey,
    // Status carries the rollback control now — never hideable.
    hideable: keys.filter((k) => k !== "status"),
    defaults: keys,
    defaultHidden: optional,
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
            // 16rem, not 22rem: one long file name pushed the ads history
            // (it has a Platform column) 25px past its frame at 1280px (W3).
            className="block max-w-[10rem] truncate font-mono text-xs text-ink sm:max-w-[16rem]"
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
        info: rollbackInfo,
        // R-125: the rollback control lives in the status cell while the
        // batch is inside its window — a whole column that was blank on almost
        // every row is gone. It is the only route to undoing a batch, so this
        // column can't be hidden (ux-standards).
        lockedVisible: true,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <Chip tone={r.status === "active" ? "pos" : "neutral"}>
              {batchStatusLabel(r.status)}
            </Chip>
            {r.rollback && (
              <>
                {r.rollback}
                <span className="text-[10px] tabular-nums text-ink-2" suppressHydrationWarning>
                  {rollbackHoursLeft(r.uploadedAt)} h left
                </span>
              </>
            )}
          </span>
        ),
      },
      // ── Optional (defaultHidden): what the batch row already carries. ──
      ...(storeShape
        ? [
            {
              key: "updated",
              label: "Updated",
              align: "right",
              sortable: true,
              sortValue: (r) => r.updated ?? null,
              csv: (r) => r.updated ?? "",
              render: (r) => <span className="tabular-nums text-ink-2">{int(r.updated ?? 0)}</span>,
            } satisfies DataColumn<BatchHistoryRow>,
            {
              key: "mode",
              label: "Mode",
              sortable: true,
              defaultSortDir: "asc",
              sortValue: (r) => modeLabel(r.upsert),
              csv: (r) => modeLabel(r.upsert),
              render: (r) => <span className="whitespace-nowrap text-ink-2">{modeLabel(r.upsert)}</span>,
            } satisfies DataColumn<BatchHistoryRow>,
          ]
        : []),
      {
        key: "rolledBackAt",
        label: "Rolled back",
        sortable: true,
        sortValue: (r) => r.rolledBackAt,
        csv: (r) => (r.rolledBackAt ? isoDate(r.rolledBackAt) : ""),
        render: (r) => (
          <span className="whitespace-nowrap tabular-nums text-ink-2">
            {r.rolledBackAt ? isoDate(r.rolledBackAt) : "—"}
          </span>
        ),
      },
      {
        key: "rolledBackBy",
        label: "Rolled back by",
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.rolledBackBy,
        csv: (r) => r.rolledBackBy ?? "",
        render: (r) => <span className="whitespace-nowrap text-ink-2">{r.rolledBackBy ?? "—"}</span>,
      },
    ],
    [showPlatform, rollbackInfo, storeShape],
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
