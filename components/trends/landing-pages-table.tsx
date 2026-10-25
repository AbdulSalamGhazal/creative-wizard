"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import { TABLE_KEYS } from "@/lib/table-columns";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { int, pct, roas, usd } from "@/lib/format";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { landingPageLabel } from "@/lib/landing-code";
import type { LandingPageRollupRow } from "@/db/queries/landing-page-performance";

type Num = number | null;

interface MetricCol {
  key: keyof LandingPageRollupRow;
  label: string;
  fmt: (v: Num) => string;
  /** A count — rendered in the quieter ink. */
  quiet?: boolean;
  /** How the totals row combines it: a sum, or a weighted ratio of two sums. */
  total: (t: Totals) => Num;
}

interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  creatives: number | null;
}

const ratio = (n: number, d: number): Num => (d > 0 ? n / d : null);

/**
 * Every number the query carries at the row's grain (the catalog rule). The
 * eight the user asked for are visible; the rest are offered `defaultHidden`.
 */
const METRICS: MetricCol[] = [
  { key: "creatives", label: "Creatives", fmt: int, quiet: true, total: (t) => t.creatives },
  { key: "spend", label: METRIC_LABEL.spend, fmt: usd, total: (t) => t.spend },
  { key: "impressions", label: METRIC_LABEL.impressions, fmt: int, quiet: true, total: (t) => t.impressions },
  { key: "clicks", label: METRIC_LABEL.clicks, fmt: int, quiet: true, total: (t) => t.clicks },
  { key: "ctr", label: METRIC_LABEL.ctr, fmt: pct, total: (t) => ratio(t.clicks, t.impressions) },
  { key: "cpc", label: METRIC_LABEL.cpc, fmt: usd, total: (t) => ratio(t.spend, t.clicks) },
  { key: "cpm", label: METRIC_LABEL.cpm, fmt: usd, total: (t) => (t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null) },
  { key: "landingPageViews", label: METRIC_LABEL.landingPageViews, fmt: int, quiet: true, total: (t) => t.landingPageViews },
  { key: "conversions", label: METRIC_LABEL.conversions, fmt: int, quiet: true, total: (t) => t.conversions },
  { key: "cvr", label: METRIC_LABEL.cvr, fmt: pct, total: (t) => ratio(t.conversions, t.landingPageViews) },
  { key: "cpa", label: METRIC_LABEL.cpa, fmt: usd, total: (t) => ratio(t.spend, t.conversions) },
  { key: "conversionValue", label: METRIC_LABEL.revenue, fmt: usd, total: (t) => t.conversionValue },
  { key: "roas", label: METRIC_LABEL.roas, fmt: roas, total: (t) => ratio(t.conversionValue, t.spend) },
];
const COLUMN_KEYS = ["url", ...METRICS.map((m) => m.key as string)];
/** Offered, not shown: the table opens on the eight metrics the user named. */
const DEFAULT_HIDDEN = ["url", "creatives", "cpc", "cpm", "landingPageViews", "cvr"];

/** A row's identity, for the pinned cell and the CSV. */
export function rowLabel(r: LandingPageRollupRow): string {
  const page = r.code ? `${landingPageLabel(r.name)} @${r.code}` : landingPageLabel(r.name);
  return r.platform ? `${PLATFORM_LABEL[r.platform]} · ${page}` : page;
}

/**
 * Trends → LPs, the per-landing-page table on the shared `DataTable`: one row
 * per landing page, or per (landing page, platform) in the split mode — the
 * same columns and the same remembered column choice in both. The product
 * page (records with no landing page) is a row like any other, in the
 * quieter ink; the totals row re-blends every ratio from the component sums.
 */
export function LandingPagesTable({
  rows,
  empty,
}: {
  rows: LandingPageRollupRow[];
  /** What the table shows with no rows (the page's empty state). */
  empty?: React.ReactNode;
}) {
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.TRENDS_LANDING_PAGES,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });
  const [sortKey, setSortKey] = useState("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const totals = useMemo<Totals>(() => {
    const t: Totals = {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValue: 0,
      landingPageViews: 0,
      // A creative can run to several pages, so the distinct count across
      // rows is unknown here — a dash, never a fabricated sum.
      creatives: null,
    };
    for (const r of rows) {
      t.spend += r.spend;
      t.impressions += r.impressions;
      t.clicks += r.clicks;
      t.conversions += r.conversions;
      t.conversionValue += r.conversionValue;
      t.landingPageViews += r.landingPageViews;
    }
    return t;
  }, [rows]);

  const columns = useMemo<DataColumn<LandingPageRollupRow>[]>(
    () => [
      {
        key: "page",
        label: "Landing page",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) =>
          `${r.platform ? ALL_PLATFORMS.indexOf(r.platform) : 0}-${r.code ?? ""}-${rowLabel(r)}`,
        csv: rowLabel,
        total: () => <span className="text-ink-2">Total</span>,
        render: (r) => (
          // A registered name can run to 255 characters: capped at every
          // width (phone 11rem, desktop 20rem) and truncated, so the pinned
          // cell always fits the frame and the metrics stay in view.
          <span
            className="inline-flex max-w-[11rem] items-center gap-2 whitespace-nowrap sm:max-w-[20rem]"
            title={rowLabel(r)}
          >
            {r.platform && (
              <>
                <PlatformDot platform={r.platform} />
                <span className="text-ink-2">{PLATFORM_LABEL[r.platform]}</span>
                <span className="text-ink-3">·</span>
              </>
            )}
            {/* `min-w-0` lets the name shrink inside the capped cell so `truncate` bites. */}
            <span className={r.code ? "min-w-0 truncate text-ink" : "min-w-0 truncate text-ink-2"}>
              {landingPageLabel(r.name)}
            </span>
            {r.code && <span className="shrink-0 text-[11px] text-ink-3">@{r.code}</span>}
          </span>
        ),
      },
      {
        key: "url",
        label: "Link",
        sortable: false,
        csv: (r) => r.url ?? "",
        render: (r) =>
          r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-ink-2 transition-colors hover:text-brand"
              title={r.url}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Open {landingPageLabel(r.name)}</span>
              <span aria-hidden className="max-w-[12rem] truncate text-[11px]">
                {r.url.replace(/^https?:\/\//, "")}
              </span>
            </a>
          ) : (
            <span className="text-ink-3">—</span>
          ),
      },
      ...METRICS.map(
        (m): DataColumn<LandingPageRollupRow> => ({
          key: m.key,
          label: m.label,
          align: "right",
          sortable: true,
          sortValue: (r) => (r[m.key] as Num) ?? null,
          total: () => <span className="text-ink">{m.fmt(m.total(totals))}</span>,
          render: (r) => (
            <span className={m.quiet ? "text-ink-2" : "text-ink"}>{m.fmt(r[m.key] as Num)}</span>
          ),
        }),
      ),
    ],
    [totals],
  );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.landingPageId ?? "product"}-${r.platform ?? "all"}`}
      sort={sortKey}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) => {
        setSortKey(key);
        setDir(d);
      }}
      showTotals={rows.length > 1}
      csvFileName="trends-landing-pages"
      minWidthClass="min-w-[880px]"
      empty={empty}
    />
  );
}
