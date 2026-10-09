"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { useNavTransition } from "@/lib/nav-progress";
import { withDateRange } from "@/lib/url";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { CampaignStatusBadge } from "@/components/campaign/campaign-status-badge";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_ORDER } from "@/lib/campaign-status";
import {
  CAMPAIGN_COLS_META,
  CAMPAIGN_COLUMN_KEYS,
} from "@/components/portfolio/portfolio-columns";
import type { PortfolioCampaignRow } from "@/db/queries/portfolio";

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
const fUsd = (v: number | null) => (v === null ? DASH : usd(v));
const fRatio = (v: number | null) => roas(v);

export function PortfolioTable({
  rows,
  sort = "spend",
  dir = "desc",
  hidden = [],
  order = [],
}: {
  rows: PortfolioCampaignRow[];
  sort?: string;
  dir?: "asc" | "desc";
  hidden?: string[];
  order?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rangeFrom = searchParams.get("from");
  const rangeTo = searchParams.get("to");

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
    tableKey: TABLE_KEYS.CAMPAIGNS,
    hideable: CAMPAIGN_COLUMN_KEYS,
    defaults: CAMPAIGN_COLUMN_KEYS,
    value: { hidden, order },
    onChange: (next) =>
      pushParams((p) => {
        if (next.hidden.length === 0) p.delete("hide");
        else p.set("hide", next.hidden.join(","));
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
        acc.lpv += r.lpv;
        acc.orders += r.orders;
        acc.revenue += r.revenue;
        acc.creatives += r.creatives;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, lpv: 0, orders: 0, revenue: 0, creatives: 0 },
    );
    return {
      ...t,
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
      switch (key) {
        case "campaign":
          // No width cap — the (resizable) column governs how much shows, so the
          // full name is visible by default and widening reveals the rest.
          return <span className="text-ink">{r.campaign}</span>;
        case "objective":
          return (
            <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2 whitespace-nowrap">
              {r.objective}
            </span>
          );
        case "status":
          return <CampaignStatusBadge status={r.status} />;
        case "platforms":
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
          return fUsd(r.cpa);
        case "roas":
          return fRatio(r.roas);
        case "aov":
          return fUsd(r.aov);
        case "ctr":
          return r.ctr === null ? DASH : pct(r.ctr);
        case "cpm":
          return fUsd(r.cpm);
        case "cvr":
          return r.cvr === null ? DASH : pct(r.cvr);
        case "lastDate":
          return r.lastDate ? isoDate(r.lastDate) : DASH;
        default:
          return null;
      }
    };
    const renderTotal = (key: string): React.ReactNode => {
      switch (key) {
        case "campaign":
          return <span className="text-ink-2 font-medium">Totals · weighted</span>;
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
          return fUsd(totals.cpa);
        case "roas":
          return fRatio(totals.roas);
        case "aov":
          return fUsd(totals.aov);
        case "ctr":
          return totals.ctr === null ? DASH : pct(totals.ctr);
        case "cpm":
          return fUsd(totals.cpm);
        case "cvr":
          return totals.cvr === null ? DASH : pct(totals.cvr);
        default:
          return null;
      }
    };
    const sortVal = (r: PortfolioCampaignRow, key: string): number | string | null => {
      if (key === "campaign") return r.campaign;
      if (key === "objective") return r.objective;
      if (key === "status") return CAMPAIGN_STATUS_ORDER[r.status];
      if (key === "lastDate") return r.lastDate ?? "";
      return (r[key as keyof PortfolioCampaignRow] as number | null) ?? null;
    };

    return CAMPAIGN_COLS_META.map((m) => ({
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
          ? (r: PortfolioCampaignRow) =>
              withDateRange(
                `/campaigns/${encodeURIComponent(r.campaign)}`,
                rangeFrom,
                rangeTo,
              )
          : undefined,
      csv:
        m.key === "platforms"
          ? (r: PortfolioCampaignRow) => r.platforms.join(" | ")
          : m.key === "status"
            ? (r: PortfolioCampaignRow) => CAMPAIGN_STATUS_LABEL[r.status]
            : undefined,
    }));
  }, [totals, rangeFrom, rangeTo]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.campaign}
      sort={sort}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) =>
        pushParams((p) => {
          p.set("sort", key);
          p.set("dir", d);
        })
      }
      onRowClick={(r) =>
        startNav(() => router.push(
          withDateRange(
            `/campaigns/${encodeURIComponent(r.campaign)}`,
            searchParams.get("from"),
            searchParams.get("to"),
          ),
        ))
      }
      showTotals
      csvFileName="campaigns"
      minWidthClass="min-w-[1440px]"
      empty={
        <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No campaigns match these filters.
        </div>
      }
    />
  );
}
