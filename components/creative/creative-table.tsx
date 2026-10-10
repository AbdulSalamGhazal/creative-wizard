"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import type { CreativeListRow } from "@/db/queries/creatives";
import type { CreativeSort } from "@/validators/creative";
import { StatusBadge } from "@/components/creative/status-badge";
import { PriorityStars } from "@/components/creative/priority-stars";
import { StageChips } from "@/components/creative/stage-chips";
import { AngleChips } from "@/components/creative/angle-chips";
import { STATUS_LABEL } from "@/lib/creative-status";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";
import { isoDate, usd } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";

const TYPE_LABEL: Record<CreativeListRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

/**
 * The Library export carries the creative's FULL data (the on-screen table
 * still renders its usual subset). Angles stay in ONE cell, comma-separated —
 * never one column per angle. Fields that can contain commas / quotes / newlines
 * (angles, notes, links) are quoted by `rowsToCsv` (RFC 4180).
 *
 * DELIBERATELY independent of the on-screen columns and of the Columns menu:
 * the export is the whole record, whatever the viewer has chosen to look at.
 * Its shape is pinned by creative-csv.test.ts.
 */
export const CSV_COLUMNS: CsvColumn<CreativeListRow>[] = [
  { key: "name", label: "Creative", value: (r) => r.name },
  { key: "product", label: "Product", value: (r) => r.productName },
  { key: "type", label: "Type", value: (r) => TYPE_LABEL[r.type] },
  { key: "status", label: "Status", value: (r) => STATUS_LABEL[r.status] },
  // Unrated stays an EMPTY cell — never 0.
  { key: "priority", label: "Priority", value: (r) => r.priority ?? "" },
  // Full names, comma-joined; unassigned is an empty cell.
  { key: "stages", label: "Stage", value: (r) => r.stages.join(", ") },
  { key: "launchDate", label: "Launch date", value: (r) => r.launchDate ?? "" },
  { key: "angles", label: "Angles", value: (r) => r.angles.join(", ") },
  { key: "sourceLink", label: "Source link", value: (r) => r.sourceLink ?? "" },
  { key: "notes", label: "Notes", value: (r) => r.notes ?? "" },
  { key: "spend7d", label: "7d spend (USD)", value: (r) => r.spend7d },
  { key: "spend30d", label: "30d spend (USD)", value: (r) => r.spend30d },
  { key: "createdBy", label: "Created by", value: (r) => r.createdByName ?? "" },
  { key: "createdAt", label: "Created at", value: (r) => isoDate(r.createdAt) },
  {
    key: "thumbnailUrl",
    label: "Thumbnail URL",
    value: (r) => r.thumbnailUrl ?? "",
  },
];

// Column key → its asc/desc URL sort values (validated in
// validators/creative.ts). Sorting stays SERVER-side: the query layer owns the
// derived-status order, the priority "unrated last" and the stage "earliest
// stage, unassigned last" rules. DataTable only reflects the URL's state —
// none of these columns carries a `sortValue`, so it never re-sorts locally.
const DEFAULT_SORT: CreativeSort = "launched-desc";
const SORTS = {
  name: { asc: "name-asc", desc: "name-desc" },
  product: { asc: "product-asc", desc: "product-desc" },
  type: { asc: "type-asc", desc: "type-desc" },
  status: { asc: "status-asc", desc: "status-desc" },
  angles: { asc: "angle-asc", desc: "angle-desc" },
  launchDate: { asc: "launched-asc", desc: "launched-desc" },
  priority: { asc: "priority-asc", desc: "priority-desc" },
  stages: { asc: "stage-asc", desc: "stage-desc" },
  spend7d: { asc: "spend7-asc", desc: "spend-desc" },
  spend30d: { asc: "spend-asc", desc: "spend-desc" },
} satisfies Record<string, { asc: CreativeSort; desc: CreativeSort }>;
type SortKey = keyof typeof SORTS;

/**
 * Hidden on a FIRST VISIT — the declutter the table needed. They are ordinary
 * columns otherwise: the corner control restores them, the choice is remembered
 * per user per brand (2026-10 — it used to be this browser's localStorage, and
 * those values are NOT migrated), and **the CSV carries every column
 * regardless of what the menu hides** (pinned by creative-csv.test.ts).
 */
const DEFAULT_HIDDEN = [
  "notes",
  "sourceLink",
  "thumbnailUrl",
  "createdBy",
  "createdAt",
] as const;

export function CreativeTable({
  rows,
  total,
  listCtx,
}: {
  rows: CreativeListRow[];
  /** Total matching across the filter (for the "Showing N of M" count). */
  total?: number;
  listCtx?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  const currentSort = (searchParams.get("sort") as CreativeSort) ?? DEFAULT_SORT;


  const detailHref = (r: CreativeListRow) =>
    `/library/${encodeURIComponent(r.name)}${listCtx ? `?${listCtx}` : ""}`;

  /** The active column + direction, read back off the URL's sort value. */
  const active = useMemo(() => {
    for (const [key, pair] of Object.entries(SORTS) as Array<
      [SortKey, { asc: CreativeSort; desc: CreativeSort }]
    >) {
      if (currentSort === pair.asc) return { key, dir: "asc" as const };
      if (currentSort === pair.desc) return { key, dir: "desc" as const };
    }
    return { key: "launchDate" as SortKey, dir: "desc" as const };
  }, [currentSort]);

  /**
   * Today's three-state header cycle, kept exactly: desc → asc → back to the
   * page default. DataTable proposes a direction; we decide what the URL says,
   * and dropping the param IS the third state.
   */
  const onSort = (key: string) => {
    const pair = SORTS[key as SortKey];
    if (!pair) return;
    const next: CreativeSort | null =
      currentSort === pair.desc ? pair.asc : currentSort === pair.asc ? null : pair.desc;
    const params = new URLSearchParams(searchParams.toString());
    if (next === null || next === DEFAULT_SORT) params.delete("sort");
    else params.set("sort", next);
    const qs = params.toString();
    startNav(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  };

  const columns: DataColumn<CreativeListRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Creative",
        pinned: true,
        sortable: true,
        href: detailHref,
        render: (r) => (
          <span className="block truncate font-mono text-xs text-ink" title={r.name}>
            {r.name}
          </span>
        ),
        csv: (r) => r.name,
      },
      {
        key: "product",
        label: "Product",
        sortable: true,
        render: (r) => (
          <span className="block truncate text-ink-2" title={r.productName}>
            {r.productName}
          </span>
        ),
      },
      {
        key: "type",
        label: "Type",
        sortable: true,
        render: (r) => <span className="text-ink-2">{TYPE_LABEL[r.type]}</span>,
      },
      {
        key: "status",
        label: "Status",
        sortable: true,
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        render: (r) => <PriorityStars value={r.priority} />,
      },
      {
        key: "stages",
        label: "Stage",
        sortable: true,
        render: (r) => <StageChips stages={r.stages} nowrap />,
      },
      {
        key: "launchDate",
        label: "Launch date",
        sortable: true,
        render: (r) => (
          <span className="num text-ink-2">
            {r.launchDate ? isoDate(r.launchDate) : "—"}
          </span>
        ),
      },
      {
        key: "spend7d",
        label: "7d spend",
        align: "right",
        sortable: true,
        render: (r) => (
          <span className="num tabular-nums text-ink">
            {r.spend7d > 0 ? usd(r.spend7d) : "—"}
          </span>
        ),
      },
      {
        key: "spend30d",
        label: "30d spend",
        align: "right",
        sortable: true,
        render: (r) => (
          <span className="num tabular-nums text-ink">
            {r.spend30d > 0 ? usd(r.spend30d) : "—"}
          </span>
        ),
      },
      {
        key: "angles",
        label: "Angles",
        sortable: true,
        render: (r) => <AngleChips angles={r.angles} />,
      },
      // ── Hidden by default (the Columns menu restores them) ──
      {
        key: "notes",
        label: "Notes",
        render: (r) =>
          r.notes ? (
            <span className="block truncate text-ink-2" title={r.notes}>
              {r.notes}
            </span>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      {
        key: "sourceLink",
        label: "Source link",
        render: (r) => <ExternalCell url={r.sourceLink} />,
      },
      {
        key: "thumbnailUrl",
        label: "Thumbnail",
        render: (r) => <ExternalCell url={r.thumbnailUrl} />,
      },
      {
        key: "createdBy",
        label: "Created by",
        render: (r) => (
          <span className="block truncate text-ink-2">
            {r.createdByName ?? "—"}
          </span>
        ),
      },
      {
        key: "createdAt",
        label: "Created at",
        render: (r) => (
          <span className="num text-ink-2">{isoDate(r.createdAt)}</span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listCtx],
  );

  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.LIBRARY,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: DEFAULT_HIDDEN,
  });
  const csvContent = rowsToCsv(rows, CSV_COLUMNS);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="num text-xs text-ink-3">
          Showing {rows.length}
          {total !== undefined ? ` of ${total}` : ""} creatives
        </p>
        <div className="flex items-center gap-2">
          <DownloadCsvButton
            csvContent={csvContent}
            filename={`creatives-${todayStamp()}.csv`}
          />
        </div>
      </div>

      <DataTable<CreativeListRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={active.key}
        dir={active.dir}
        {...cols.tableProps}
        onSort={onSort}
        onRowClick={(r) => startNav(() => router.push(detailHref(r)))}
        minWidthClass="min-w-[900px]"
        empty={
          <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
            <p className="text-sm text-ink-2">No creatives match these filters.</p>
          </div>
        }
      />
    </div>
  );
}

/** A URL cell: a short link out, never the raw URL stretching the column. */
function ExternalCell({ url }: { url: string | null }) {
  if (!url) return <span className="text-ink-3">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(e) => e.stopPropagation()}
      className="text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
    >
      Open
    </a>
  );
}
