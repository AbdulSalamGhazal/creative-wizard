"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import { TABLE_KEYS } from "@/lib/table-columns";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { int, pct, roas, usd } from "@/lib/format";
import {
  ALL_PLATFORMS,
  PLATFORM_LABEL,
  TYPE_COLOR,
  TYPE_LABEL,
  TYPE_ORDER,
} from "@/lib/palette";
import type { TypeRollupRow } from "@/db/queries/trends";

type Num = number | null;

interface MetricCol {
  key: keyof TypeRollupRow;
  label: string;
  fmt: (v: Num) => string;
  /** A count — rendered in the quieter ink like the old table. */
  quiet?: boolean;
}

/** Every number the query carries at this grain (the catalog rule). */
const METRICS: MetricCol[] = [
  { key: "creatives", label: "Creatives", fmt: int, quiet: true },
  { key: "spend", label: METRIC_LABEL.spend, fmt: usd },
  { key: "impressions", label: METRIC_LABEL.impressions, fmt: int, quiet: true },
  { key: "clicks", label: METRIC_LABEL.clicks, fmt: int, quiet: true },
  { key: "ctr", label: METRIC_LABEL.ctr, fmt: pct },
  { key: "cpc", label: METRIC_LABEL.cpc, fmt: usd },
  { key: "cpa", label: METRIC_LABEL.cpa, fmt: usd },
  { key: "roas", label: METRIC_LABEL.roas, fmt: roas },
  { key: "cvr", label: METRIC_LABEL.cvr, fmt: pct },
];
const COLUMN_KEYS = METRICS.map((m) => m.key as string);
/** `clicks` is offered, not shown: the table looks as it did until opted in. */
const DEFAULT_HIDDEN = ["clicks"];

/** The canonical order — platform, then type — as one sortable number. */
const canonicalRank = (r: TypeRollupRow) =>
  (r.platform ? ALL_PLATFORMS.indexOf(r.platform) : -1) * 10 + TYPE_ORDER.indexOf(r.type);

/**
 * Trends → Types, the platform → type breakdown, on the shared `DataTable`
 * (D22, 2026-10): the columns control, sort and a pinned identity like its
 * sibling Trends tables. Each row is one (platform, type) pair — the old
 * platform group headers are folded into the pinned cell — and it opens on
 * the canonical order (platform, then type); any metric re-sorts it.
 */
export function TypeRollupTable({
  rows,
  empty,
}: {
  rows: TypeRollupRow[];
  /** What the table shows with no rows (the page's empty state). */
  empty?: React.ReactNode;
}) {
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.TRENDS_TYPES,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });
  const [sortKey, setSortKey] = useState("row");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const columns = useMemo<DataColumn<TypeRollupRow>[]>(
    () => [
      {
        key: "row",
        label: "Platform · Type",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: canonicalRank,
        csv: (r) =>
          `${r.platform ? `${PLATFORM_LABEL[r.platform]} · ` : ""}${TYPE_LABEL[r.type]}`,
        render: (r) => (
          <Link
            href={`/library?types=${r.type}${r.platform ? `&platforms=${r.platform}` : ""}`}
            className="inline-flex items-center gap-2 whitespace-nowrap text-ink transition-colors hover:text-brand"
          >
            {r.platform && (
              <>
                <PlatformDot platform={r.platform} />
                <span className="text-ink-2">{PLATFORM_LABEL[r.platform]}</span>
                <span className="text-ink-3">·</span>
              </>
            )}
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: TYPE_COLOR[r.type] }} />
            {TYPE_LABEL[r.type]}
          </Link>
        ),
      },
      ...METRICS.map(
        (m): DataColumn<TypeRollupRow> => ({
          key: m.key,
          label: m.label,
          align: "right",
          sortable: true,
          sortValue: (r) => (r[m.key] as Num) ?? null,
          render: (r) => (
            <span className={m.quiet ? "text-ink-2" : "text-ink"}>{m.fmt(r[m.key] as Num)}</span>
          ),
        }),
      ),
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.platform ?? "all"}-${r.type}`}
      sort={sortKey}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) => {
        setSortKey(key);
        setDir(d);
      }}
      csvFileName="trends-types"
      minWidthClass="min-w-[760px]"
      empty={empty}
    />
  );
}
