"use client";

import { useMemo, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { DataTable, compareSortValues, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import { TABLE_KEYS } from "@/lib/table-columns";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { int, pct, plural, roas, usd } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { NO_PRODUCT_LABEL, landingPageLabel } from "@/lib/landing-code";
import type { LandingPageRollupRow } from "@/db/queries/landing-page-performance";

type Num = number | null;

/** The numbers every row carries — a page's from the query, a product's and
 *  the totals row's re-blended from its pages' component sums. */
interface Metrics {
  creatives: Num;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  landingPageViews: number;
  ctr: Num;
  cpc: Num;
  cpm: Num;
  cpa: Num;
  roas: Num;
  cvr: Num;
}
type MetricKey = keyof Metrics;

interface MetricCol {
  key: MetricKey;
  label: string;
  fmt: (v: Num) => string;
  /** A count — rendered in the quieter ink. */
  quiet?: boolean;
}

/**
 * Every number the query carries at the row's grain (the catalog rule). The
 * eight the user asked for are visible; the rest are offered `defaultHidden`.
 */
const METRICS: MetricCol[] = [
  { key: "creatives", label: "Creatives", fmt: int, quiet: true },
  { key: "spend", label: METRIC_LABEL.spend, fmt: usd },
  { key: "impressions", label: METRIC_LABEL.impressions, fmt: int, quiet: true },
  { key: "clicks", label: METRIC_LABEL.clicks, fmt: int, quiet: true },
  { key: "ctr", label: METRIC_LABEL.ctr, fmt: pct },
  { key: "cpc", label: METRIC_LABEL.cpc, fmt: usd },
  { key: "cpm", label: METRIC_LABEL.cpm, fmt: usd },
  { key: "landingPageViews", label: METRIC_LABEL.landingPageViews, fmt: int, quiet: true },
  { key: "conversions", label: METRIC_LABEL.conversions, fmt: int, quiet: true },
  { key: "cvr", label: METRIC_LABEL.cvr, fmt: pct },
  { key: "cpa", label: METRIC_LABEL.cpa, fmt: usd },
  { key: "conversionValue", label: METRIC_LABEL.revenue, fmt: usd },
  { key: "roas", label: METRIC_LABEL.roas, fmt: roas },
];
const COLUMN_KEYS = ["url", ...METRICS.map((m) => m.key as string)];
/** Offered, not shown: the table opens on the eight metrics the user named. */
const DEFAULT_HIDDEN = ["url", "creatives", "cpc", "cpm", "landingPageViews", "cvr"];

const ratio = (n: number, d: number): Num => (d > 0 ? n / d : null);

/**
 * Many pages as one row: component sums, and every ratio from those sums —
 * never an average of the pages' ratios. Creatives stays a dash: a creative
 * can run to several pages, so the distinct count across rows is unknown.
 */
function blend(rows: readonly LandingPageRollupRow[]): Metrics {
  const t = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    landingPageViews: 0,
  };
  for (const r of rows) {
    t.spend += r.spend;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.conversions += r.conversions;
    t.conversionValue += r.conversionValue;
    t.landingPageViews += r.landingPageViews;
  }
  return {
    ...t,
    creatives: null,
    ctr: ratio(t.clicks, t.impressions),
    cpc: ratio(t.spend, t.clicks),
    cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
    cpa: ratio(t.spend, t.conversions),
    roas: ratio(t.conversionValue, t.spend),
    cvr: ratio(t.conversions, t.landingPageViews),
  };
}

/** A page row's identity, for the pinned cell and the CSV. */
export function pageLabel(r: LandingPageRollupRow): string {
  const page = r.code ? `${landingPageLabel(r.name)} @${r.code}` : landingPageLabel(r.name);
  return r.platform ? `${PLATFORM_LABEL[r.platform]} · ${page}` : page;
}

const productKey = (productId: string | null) => productId ?? "none";
const productLabel = (name: string | null) => name ?? NO_PRODUCT_LABEL;

/** One table row: a product, or one of its pages under it. */
type Row =
  | ({ kind: "product"; key: string; productId: string | null; productName: string | null; pages: number } & Metrics)
  | ({ kind: "page"; key: string; productId: string | null; productName: string | null; page: LandingPageRollupRow } & Metrics);

/**
 * Trends → LPs, on the shared `DataTable`: one row per PRODUCT, open by
 * default on its pages — the product's own page first (the baseline), then
 * its landing pages — so a page is always read against the product it sells
 * (user decision, 2026-10-29). The split mode puts one row per (page,
 * platform) under the product. The WRAPPER owns the sort, like the Funnel
 * platform table, so a product's pages stay under it sorted the same way;
 * the product row and the totals row re-blend every ratio from component
 * sums.
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
  // Products are OPEN by default — the comparison is the point — so the
  // state is the ones a person closed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sortKey, setSortKey] = useState<string>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totals = useMemo(() => blend(rows), [rows]);

  const tableRows = useMemo<Row[]>(() => {
    const byProduct = new Map<string, LandingPageRollupRow[]>();
    for (const r of rows) {
      const k = productKey(r.productId);
      const list = byProduct.get(k);
      if (list) list.push(r);
      else byProduct.set(k, [r]);
    }
    const value = (r: Row): number | string | null =>
      sortKey === "page"
        ? r.kind === "product"
          ? productLabel(r.productName).toLowerCase()
          : pageLabel(r.page).toLowerCase()
        : (r[sortKey as MetricKey] as Num);
    const byKey = (a: Row, b: Row) => compareSortValues(value(a), value(b), dir);

    const parents: Row[] = [...byProduct.entries()].map(([key, pages]) => ({
      kind: "product",
      key,
      productId: pages[0]!.productId,
      productName: pages[0]!.productName,
      pages: new Set(pages.map((p) => p.landingPageId ?? "product")).size,
      ...blend(pages),
    }));
    const out: Row[] = [];
    for (const parent of parents.sort(byKey)) {
      out.push(parent);
      if (collapsed.has(parent.key)) continue;
      const children: Row[] = (byProduct.get(parent.key) ?? []).map((page) => ({
        kind: "page",
        key: `${parent.key}::${page.landingPageId ?? "product"}::${page.platform ?? "all"}`,
        page,
        ...page,
      }));
      // The product's own page leads its group whatever the sort — it is the
      // baseline every landing page is read against; within each half the
      // sort applies (so the platform split orders the product-page rows too).
      const own = children.filter((c) => c.kind === "page" && c.page.landingPageId === null).sort(byKey);
      const lps = children.filter((c) => c.kind === "page" && c.page.landingPageId !== null).sort(byKey);
      out.push(...own, ...lps);
    }
    return out;
  }, [rows, collapsed, sortKey, dir]);

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        key: "page",
        label: "Product · Page",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        total: () => <span className="text-ink-2">Total</span>,
        csv: (r) => (r.kind === "product" ? productLabel(r.productName) : `  ${pageLabel(r.page)}`),
        render: (r) => {
          if (r.kind === "product") {
            const isOpen = !collapsed.has(r.key);
            return (
              <button
                type="button"
                onClick={() => toggle(r.key)}
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Collapse" : "Expand"} ${productLabel(r.productName)} pages`}
                className="inline-flex max-w-[11rem] items-center gap-2 whitespace-nowrap text-ink transition-colors hover:text-brand sm:max-w-[20rem]"
                title={productLabel(r.productName)}
              >
                <ChevronRight
                  className={cn("h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform", isOpen && "rotate-90")}
                />
                <span className={cn("min-w-0 truncate", r.productId === null && "text-ink-2")}>
                  {productLabel(r.productName)}
                </span>
                <span className="shrink-0 text-[10px] text-ink-3">{plural(r.pages, "page")}</span>
              </button>
            );
          }
          const p = r.page;
          // A registered name can run to 255 characters: capped at every
          // width (phone 11rem, desktop 20rem) and truncated, so the pinned
          // cell always fits the frame and the metrics stay in view.
          return (
            <span
              className="inline-flex max-w-[11rem] items-center gap-2 whitespace-nowrap pl-6 text-xs sm:max-w-[20rem]"
              title={pageLabel(p)}
            >
              {p.platform && (
                <>
                  <PlatformDot platform={p.platform} size="sm" />
                  <span className="text-ink-2">{PLATFORM_LABEL[p.platform]}</span>
                  <span className="text-ink-3">·</span>
                </>
              )}
              {/* `min-w-0` lets the name shrink inside the capped cell so `truncate` bites. */}
              <span className={p.code ? "min-w-0 truncate text-ink" : "min-w-0 truncate text-ink-2"}>
                {landingPageLabel(p.name)}
              </span>
              {p.code && <span className="shrink-0 text-[11px] text-ink-3">@{p.code}</span>}
            </span>
          );
        },
      },
      {
        key: "url",
        label: "Link",
        sortable: false,
        csv: (r) => (r.kind === "page" ? (r.page.url ?? "") : ""),
        render: (r) =>
          r.kind === "page" && r.page.url ? (
            <a
              href={r.page.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-ink-2 transition-colors hover:text-brand"
              title={r.page.url}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Open {landingPageLabel(r.page.name)}</span>
              <span aria-hidden className="max-w-[12rem] truncate text-[11px]">
                {r.page.url.replace(/^https?:\/\//, "")}
              </span>
            </a>
          ) : r.kind === "page" ? (
            <span className="text-ink-3">—</span>
          ) : null,
      },
      ...METRICS.map(
        (m): DataColumn<Row> => ({
          key: m.key,
          label: m.label,
          align: "right",
          sortable: true,
          csv: (r) => r[m.key],
          total: () => <span className="text-ink">{m.fmt(totals[m.key])}</span>,
          render: (r) => (
            <span
              className={cn(
                r.kind === "page" ? "text-xs" : undefined,
                m.quiet || r.kind === "page" ? "text-ink-2" : "text-ink",
              )}
            >
              {m.fmt(r[m.key])}
            </span>
          ),
        }),
      ),
    ],
    [collapsed, totals],
  );

  return (
    <DataTable
      columns={columns}
      rows={tableRows}
      rowKey={(r) => r.key}
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
