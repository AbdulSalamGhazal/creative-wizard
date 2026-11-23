"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS, encodeHiddenColumns } from "@/lib/table-columns";
import { useNavTransition } from "@/lib/nav-progress";
import { shallowParams } from "@/lib/shallow-url";
import { withDateRange } from "@/lib/url";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { CampaignStatusBadge } from "@/components/campaign/campaign-status-badge";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_ORDER } from "@/lib/campaign-status";
import {
  PORTFOLIO_LEVELS,
  type PortfolioLevel,
} from "@/components/portfolio/portfolio-columns";
import type { PortfolioCampaignRow, PortfolioParentRow } from "@/db/queries/portfolio";
import { AD_NETWORK_LABEL, adSetPath, campaignPath } from "@/lib/campaign";
import { EmptyState } from "@/components/ui/empty-state";
import { TotalLabel } from "@/components/ui/total-label";

/**
 * The column META lives in a NON-client module (`portfolio-columns.ts`) because
 * the server page needs it too, and a server component cannot read a value out
 * of a `"use client"` module — it gets a client-reference proxy and throws at
 * request time. Re-exported here for the callers that already import it from
 * the table.
 */
export {
  CAMPAIGN_TABLE_COLUMNS,
  CAMPAIGN_COLUMN_KEYS,
} from "@/components/portfolio/portfolio-columns";

const DASH = "—";
const fRatio = (v: number | null) => roas(v);

/** A CAMPAIGN-level row carries its network (the ad-set rows don't). */
const isParentRow = (r: PortfolioCampaignRow): r is PortfolioParentRow => "network" in r;

/** Where a row's page is: an ad set by its stored name, a campaign by network + name. */
const rowPath = (r: PortfolioCampaignRow): string =>
  isParentRow(r) ? campaignPath(r.network, r.campaign) : adSetPath(r.campaign);

/**
 * ONE table, two levels (2026-11): `level="adset"` is one row per AD SET (a
 * `campaigns` row — the list this table has always been), `level="campaign"`
 * one row per CAMPAIGN (`PortfolioParentRow`: its ad sets rolled up). Same
 * columns, sort, totals and column control; the campaign level adds "Ad sets"
 * and lists every objective its ad sets carry.
 */
export function PortfolioTable({
  rows,
  level = "adset",
  sort: serverSort = "spend",
  dir: serverDir = "desc",
  hidden = [],
  order = [],
}: {
  rows: PortfolioCampaignRow[];
  level?: PortfolioLevel;
  sort?: string;
  dir?: "asc" | "desc";
  hidden?: string[];
  order?: string[];
}) {
  const meta = PORTFOLIO_LEVELS[level];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeFrom = searchParams.get("from");
  const rangeTo = searchParams.get("to");
  // The sort the URL states, read live: a sort click is SHALLOW (D12,
  // 2026-10) — DataTable re-sorts the rows it holds with the columns'
  // `sortValue`s, the same comparator the server render used, so the click
  // needs no server render (it used to re-run the page's queries).
  const sort = searchParams.get("sort") ?? serverSort;
  const urlDir = searchParams.get("dir");
  const dir: "asc" | "desc" =
    urlDir === "asc" || urlDir === "desc" ? urlDir : searchParams.has("sort") ? "desc" : serverDir;

  const [, startNav] = useNavTransition();
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mut(next);
    startNav(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  /**
   * THE URL-BACKED SHAPE. Saved views snapshot the query string, so `hide` and
   * `order` must keep living there — a column change writes the URL (views stay
   * comparable, unchanged) AND the preference, which is what a later BARE visit
   * starts from. The hook holds no state here; the server already resolved
   * URL → view → preference → default and handed the answer in as `hidden`/
   * `order`.
   */
  const cols = useTableColumns({
    tableKey: level === "campaign" ? TABLE_KEYS.PARENT_CAMPAIGNS : TABLE_KEYS.CAMPAIGNS,
    hideable: meta.columnKeys,
    defaults: meta.columnKeys,
    // `hidden` arrives DECODED (the server resolved it with this set), so the
    // hook sees plain keys; the URL gets the encoded form below.
    defaultHidden: meta.defaultHidden,
    value: { hidden, order },
    onChange: (next) =>
      pushParams((p) => {
        // ENCODE for the URL: a hidden key as itself, an opened default-hidden
        // column as `!key` — so a view that never mentions it keeps it shut.
        // A CLOSED default-hidden column is implied, so it is not written.
        const hide = encodeHiddenColumns(
          next.hidden,
          meta.columnKeys,
          meta.defaultHidden,
        ).filter((k) => !meta.defaultHidden.includes(k));
        if (hide.length === 0) p.delete("hide");
        else p.set("hide", hide.join(","));
        if (next.order.length === 0) p.delete("order");
        else p.set("order", next.order.join(","));
      }),
  });

  // Weighted totals from the visible rows.
  const totals = useMemo(() => {
    const t = rows.reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.impressions += r.impressions;
        acc.clicks += r.clicks;
        acc.lpv += r.lpv ?? 0;
        acc.orders += r.orders;
        acc.revenue += r.revenue;
        acc.creatives += r.creatives;
        if (isParentRow(r)) acc.adSets += r.adSets;
        // NULL ≠ 0: a step only sums over the rows that report it, and VOC's
        // clicks only over rows that report LP views (the SQL guard's mirror).
        if (r.lpv !== null) {
          acc.lpvReported = (acc.lpvReported ?? 0) + r.lpv;
          acc.lpvClicks += r.clicks;
        }
        if (r.addToCart !== null) acc.addToCart = (acc.addToCart ?? 0) + r.addToCart;
        if (r.addPayment !== null) acc.addPayment = (acc.addPayment ?? 0) + r.addPayment;
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        lpv: 0,
        orders: 0,
        revenue: 0,
        creatives: 0,
        adSets: 0,
        lpvReported: null as number | null,
        lpvClicks: 0,
        addToCart: null as number | null,
        addPayment: null as number | null,
      },
    );
    return {
      ...t,
      voc: t.lpvReported !== null && t.lpvClicks > 0 ? t.lpvReported / t.lpvClicks : null,
      cpc: t.clicks > 0 ? t.spend / t.clicks : null,
      cpa: t.orders > 0 ? t.spend / t.orders : null,
      roas: t.spend > 0 ? t.revenue / t.spend : null,
      aov: t.orders > 0 ? t.revenue / t.orders : null,
      ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
      cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null,
      cvr: t.lpv > 0 ? t.orders / t.lpv : null,
    };
  }, [rows]);

  const columns = useMemo<DataColumn<PortfolioCampaignRow>[]>(() => {
    const renderCell = (r: PortfolioCampaignRow, key: string): React.ReactNode => {
      // A campaign that has never run has no numbers to show — "—", never 0.
      const noData = isParentRow(r) && !r.hasData;
      if (noData && meta.numericKeys.has(key)) return DASH;
      switch (key) {
        case "campaign":
          // No width cap — the (resizable) column governs how much shows, so the
          // full name is visible by default and widening reveals the rest.
          return <span className="text-ink">{r.campaign}</span>;
        case "objective":
          return (
            <span className="inline-flex items-center gap-1">
              {(isParentRow(r) ? r.objectives : [r.objective]).map((o) => (
                <span
                  key={o}
                  className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2 whitespace-nowrap"
                >
                  {o}
                </span>
              ))}
            </span>
          );
        case "status":
          return <CampaignStatusBadge status={r.status} />;
        case "adSets":
          return isParentRow(r) ? int(r.adSets) : null;
        case "platforms":
          // A campaign with no ad set yet still says where it lives.
          if (isParentRow(r) && r.platforms.length === 0) {
            return <span className="text-ink-2">{AD_NETWORK_LABEL[r.network]}</span>;
          }
          return (
            <span className="inline-flex items-center gap-2">
              {r.platforms.map((p) => (
                <span key={p} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <PlatformDot platform={p} />
                  <span className="text-ink-2">{PLATFORM_LABEL[p]}</span>
                </span>
              ))}
            </span>
          );
        case "creatives":
          return int(r.creatives);
        case "spend":
          return usd(r.spend);
        case "impressions":
          return int(r.impressions);
        case "clicks":
          return int(r.clicks);
        case "orders":
          return int(r.orders);
        case "revenue":
          return usd(r.revenue);
        case "cpa":
          return usd(r.cpa);
        case "roas":
          return fRatio(r.roas);
        case "aov":
          return usd(r.aov);
        case "ctr":
          return r.ctr === null ? DASH : pct(r.ctr);
        case "cpm":
          return usd(r.cpm);
        case "cvr":
          return r.cvr === null ? DASH : pct(r.cvr);
        case "lastDate":
          return r.lastDate ? isoDate(r.lastDate) : DASH;
        case "lpv":
          return int(r.lpv);
        case "addToCart":
          return int(r.addToCart);
        case "addPayment":
          return int(r.addPayment);
        case "voc":
          return pct(r.voc);
        case "cpc":
          return usd(r.cpc);
        case "firstDate":
          return isoDate(r.firstDate);
        case "createdAt":
          return isoDate(r.createdAt);
        default:
          return null;
      }
    };
    const renderTotal = (key: string): React.ReactNode => {
      switch (key) {
        case "campaign":
          return <TotalLabel className="text-ink-2 font-medium" />;
        case "adSets":
          return <span className="text-ink-3">{int(totals.adSets)}</span>;
        case "creatives":
          return <span className="text-ink-3">{int(totals.creatives)}</span>;
        case "spend":
          return usd(totals.spend);
        case "impressions":
          return int(totals.impressions);
        case "clicks":
          return int(totals.clicks);
        case "orders":
          return int(totals.orders);
        case "revenue":
          return usd(totals.revenue);
        case "cpa":
          return usd(totals.cpa);
        case "roas":
          return fRatio(totals.roas);
        case "aov":
          return usd(totals.aov);
        case "ctr":
          return totals.ctr === null ? DASH : pct(totals.ctr);
        case "cpm":
          return usd(totals.cpm);
        case "cvr":
          return totals.cvr === null ? DASH : pct(totals.cvr);
        case "lpv":
          return int(totals.lpvReported);
        case "addToCart":
          return int(totals.addToCart);
        case "addPayment":
          return int(totals.addPayment);
        case "voc":
          return pct(totals.voc);
        case "cpc":
          return usd(totals.cpc);
        default:
          return null;
      }
    };
    const sortVal = (r: PortfolioCampaignRow, key: string): number | string | null => {
      if (key === "campaign") return r.campaign;
      if (key === "objective") return r.objective;
      if (key === "adSets") return isParentRow(r) ? r.adSets : null;
      if (key === "status") return CAMPAIGN_STATUS_ORDER[r.status];
      if (key === "lastDate") return r.lastDate ?? "";
      if (key === "firstDate") return r.firstDate ?? "";
      if (key === "createdAt") return r.createdAt;
      return (r[key as keyof PortfolioCampaignRow] as number | null) ?? null;
    };

    return meta.cols.map((m) => ({
      key: m.key,
      label: m.label,
      align: m.align,
      sortable: m.sortable,
      pinned: m.pinned,
      defaultSortDir: m.defaultSortDir,
      render: (r) => renderCell(r, m.key),
      total: () => renderTotal(m.key),
      sortValue: m.sortable ? (r) => sortVal(r, m.key) : undefined,
      href:
        m.key === "campaign"
          ? (r: PortfolioCampaignRow) => withDateRange(rowPath(r), rangeFrom, rangeTo)
          : undefined,
      csv:
        m.key === "platforms"
          ? (r: PortfolioCampaignRow) => r.platforms.join(" | ")
          : m.key === "status"
            ? (r: PortfolioCampaignRow) => CAMPAIGN_STATUS_LABEL[r.status]
            : undefined,
    }));
  }, [totals, rangeFrom, rangeTo, meta]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.campaignId}
      sort={sort}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) =>
        // A history entry, as the old navigation was — Back undoes a sort.
        shallowParams((p) => {
          p.set("sort", key);
          p.set("dir", d);
        }, "push")
      }
      onRowClick={(r) =>
        startNav(() => router.push(
          withDateRange(rowPath(r), searchParams.get("from"), searchParams.get("to")),
        ))
      }
      showTotals
      csvFileName={meta.csvFileName}
      minWidthClass="min-w-[1440px]"
      empty={
        <EmptyState title={meta.emptyTitle} kind="filtered" />
      }
    />
  );
}
