"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useNavTransition } from "@/lib/nav-progress";
import { int, isoDate, pct, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import type { PortfolioCampaignRow } from "@/db/queries/portfolio";

type Align = "left" | "right";

const COLS_META: Array<{
  key: string;
  label: string;
  align: Align;
  sortable: boolean;
  pinned?: boolean;
  defaultSortDir?: "asc" | "desc";
}> = [
  { key: "campaign", label: "Campaign", align: "left", sortable: true, pinned: true, defaultSortDir: "asc" },
  { key: "objective", label: "Objective", align: "left", sortable: true, defaultSortDir: "asc" },
  { key: "platforms", label: "Platform", align: "left", sortable: false },
  { key: "creatives", label: "Creatives", align: "right", sortable: true },
  { key: "spend", label: "Spend", align: "right", sortable: true },
  { key: "impressions", label: "Impr", align: "right", sortable: true },
  { key: "clicks", label: "Clicks", align: "right", sortable: true },
  { key: "orders", label: "Orders", align: "right", sortable: true },
  { key: "revenue", label: "Revenue", align: "right", sortable: true },
  { key: "cpa", label: "CPA", align: "right", sortable: true },
  { key: "roas", label: "ROAS", align: "right", sortable: true },
  { key: "aov", label: "AOV", align: "right", sortable: true },
  { key: "ctr", label: "CTR", align: "right", sortable: true },
  { key: "cpm", label: "CPM", align: "right", sortable: true },
  { key: "cvr", label: "CvR", align: "right", sortable: true },
  { key: "lastDate", label: "Last", align: "right", sortable: true },
];

/** Hideable columns (everything but the identity column) — for a Columns control. */
export const CAMPAIGN_TABLE_COLUMNS = COLS_META.filter((c) => !c.pinned).map((c) => ({
  key: c.key,
  label: c.label,
}));

const DASH = "—";
const fUsd = (v: number | null) => (v === null ? DASH : usd(v));
const fRatio = (v: number | null) => (v === null ? DASH : `${ratio(v)}×`);

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

  const [, startNav] = useNavTransition();
  const pushParams = (mut: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mut(next);
    startNav(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };

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
        case "platforms":
          return (
            <span className="inline-flex items-center gap-2">
              {r.platforms.map((p) => (
                <span key={p} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: PLATFORM_COLOR[p] }}
                  />
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
      if (key === "lastDate") return r.lastDate ?? "";
      return (r[key as keyof PortfolioCampaignRow] as number | null) ?? null;
    };

    return COLS_META.map((m) => ({
      key: m.key,
      label: m.label,
      align: m.align,
      sortable: m.sortable,
      pinned: m.pinned,
      defaultSortDir: m.defaultSortDir,
      render: (r) => renderCell(r, m.key),
      total: () => renderTotal(m.key),
      sortValue: m.sortable ? (r) => sortVal(r, m.key) : undefined,
      csv:
        m.key === "platforms"
          ? (r: PortfolioCampaignRow) => r.platforms.join(" | ")
          : undefined,
    }));
  }, [totals]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.campaign}
      sort={sort}
      dir={dir}
      hidden={hidden}
      order={order}
      onSort={(key, d) =>
        pushParams((p) => {
          p.set("sort", key);
          p.set("dir", d);
        })
      }
      onReorder={(o) => pushParams((p) => p.set("order", o.join(",")))}
      onRowClick={(r) => router.push(`/campaigns/${encodeURIComponent(r.campaign)}`)}
      showTotals
      csvFileName="campaigns"
      minWidthClass="min-w-[1320px]"
      empty={
        <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
          No campaigns match these filters.
        </div>
      }
    />
  );
}
