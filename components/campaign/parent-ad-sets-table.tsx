"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/lib/brand-nav";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { withDateRange } from "@/lib/url";
import { PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { adSetPath } from "@/lib/campaign";
import type { ParentAdSetRow } from "@/db/queries/parent-campaign";
import { useNavTransition } from "@/lib/nav-progress";
import { PlatformDot } from "@/components/ui/platform-dot";
import { CampaignStatusBadge } from "@/components/campaign/campaign-status-badge";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_ORDER } from "@/lib/campaign-status";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A campaign's AD SETS, side by side (2026-11) — the comparison the two
 * levels exist for. EVERY registered ad set is a row, including one with
 * nothing in the range (all "—") and one added a minute ago. Each ad set is
 * dotted with the colour its line has in the chart above (ranked by spend,
 * the order the page hands both). Sorting is local; a row opens the ad set.
 */

const DASH = "—";
const fPct = (v: number | null) => (v === null ? DASH : pct(v));

type SortDir = "asc" | "desc";
type SortVal = string | number | null;

interface ColMeta {
  key: string;
  label: string;
  align: "left" | "right";
  defaultSortDir?: SortDir;
  defaultHidden?: boolean;
}

const COLS: readonly ColMeta[] = [
  { key: "platform", label: "Platform", align: "left", defaultSortDir: "asc" },
  { key: "objective", label: "Objective", align: "left", defaultSortDir: "asc" },
  { key: "status", label: "Status", align: "left", defaultSortDir: "asc" },
  { key: "creatives", label: "Creatives", align: "right" },
  { key: "spend", label: "Spend", align: "right" },
  { key: "impressions", label: METRIC_LABEL.impressions, align: "right", defaultHidden: true },
  { key: "clicks", label: "Clicks", align: "right", defaultHidden: true },
  { key: "orders", label: METRIC_LABEL.conversions, align: "right" },
  { key: "revenue", label: METRIC_LABEL.revenue, align: "right" },
  { key: "roas", label: "ROAS", align: "right" },
  { key: "cpa", label: "CPA", align: "right" },
  { key: "ctr", label: "CTR", align: "right" },
  { key: "cpm", label: "CPM", align: "right" },
  { key: "cvr", label: "CvR", align: "right" },
  { key: "cpc", label: METRIC_LABEL.cpc, align: "right", defaultHidden: true },
  { key: "voc", label: METRIC_LABEL.voc, align: "right", defaultHidden: true },
  { key: "lpv", label: METRIC_LABEL.landingPageViews, align: "right", defaultHidden: true },
  { key: "lastDate", label: "Last", align: "right" },
];
const COLUMN_KEYS = COLS.map((c) => c.key);
const DEFAULT_HIDDEN = COLS.filter((c) => c.defaultHidden).map((c) => c.key);

export function ParentAdSetsTable({ adSets }: { adSets: ParentAdSetRow[] }) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState("spend");
  const [dir, setDir] = useState<SortDir>("desc");

  // The chart's colours: rank in the order the page hands us (spend, desc).
  const colorById = useMemo(
    () => new Map(adSets.map((a, i) => [a.id, seriesColor(i)])),
    [adSets],
  );

  const sortVal = (r: ParentAdSetRow, key: string): SortVal => {
    if (key === "adsetName") return r.adsetName;
    if (key === "platform") return PLATFORM_LABEL[r.platform];
    if (key === "objective") return r.objective;
    if (key === "status") return CAMPAIGN_STATUS_ORDER[r.status];
    if (key === "lastDate") return r.lastDate;
    return (r[key as keyof ParentAdSetRow] as number | null) ?? null;
  };

  const sorted = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...adSets].sort((a, b) => {
      const av = sortVal(a, sort);
      const bv = sortVal(b, sort);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last, both directions
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return av < bv ? -d : av > bv ? d : 0;
      }
      return ((av as number) - (bv as number)) * d;
    });
  }, [adSets, sort, dir]);

  const href = (r: ParentAdSetRow) =>
    withDateRange(adSetPath(r.name), searchParams.get("from"), searchParams.get("to"));

  const cell = (r: ParentAdSetRow, key: string): React.ReactNode => {
    switch (key) {
      case "platform":
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <PlatformDot platform={r.platform} />
            <span className="text-ink-2">{PLATFORM_LABEL[r.platform]}</span>
          </span>
        );
      case "objective":
        return <span className="text-ink-2">{r.objective}</span>;
      case "status":
        return <CampaignStatusBadge status={r.status} />;
      case "creatives":
        return r.spend === null ? DASH : int(r.creatives);
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
      case "roas":
        return roas(r.roas);
      case "cpa":
        return usd(r.cpa);
      case "ctr":
        return fPct(r.ctr);
      case "cpm":
        return usd(r.cpm);
      case "cvr":
        return fPct(r.cvr);
      case "cpc":
        return usd(r.cpc);
      case "voc":
        return fPct(r.voc);
      case "lpv":
        return int(r.lpv);
      case "lastDate":
        return r.lastDate ? isoDate(r.lastDate) : DASH;
      default:
        return null;
    }
  };

  const columns: DataColumn<ParentAdSetRow>[] = [
    {
      key: "adsetName",
      label: "Ad set",
      align: "left",
      sortable: true,
      pinned: true,
      defaultSortDir: "asc",
      href,
      sortValue: (r) => r.adsetName,
      render: (r) => (
        <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-2 sm:max-w-none">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: colorById.get(r.id) }}
          />
          <span className="truncate text-ink" dir="auto" title={r.adsetName}>
            {r.adsetName}
          </span>
        </span>
      ),
    },
    ...COLS.map(
      (c): DataColumn<ParentAdSetRow> => ({
        key: c.key,
        label: c.label,
        align: c.align,
        sortable: true,
        defaultSortDir: c.defaultSortDir,
        render: (r) => cell(r, c.key),
        sortValue: (r) => sortVal(r, c.key),
        csv:
          c.key === "status"
            ? (r) => CAMPAIGN_STATUS_LABEL[r.status]
            : c.key === "platform"
              ? (r) => PLATFORM_LABEL[r.platform]
              : undefined,
      }),
    ),
  ];

  const cols = useTableColumns({
    tableKey: TABLE_KEYS.PARENT_CAMPAIGN_AD_SETS,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });

  if (adSets.length === 0) {
    return <EmptyState title="No ad sets yet." hint="Add this campaign’s first ad set." />;
  }

  return (
    <DataTable
      columns={columns}
      rows={sorted}
      rowKey={(r) => r.id}
      sort={sort}
      dir={dir}
      onSort={(key, d) => {
        setSort(key);
        setDir(d);
      }}
      {...cols.tableProps}
      onRowClick={(r) => startNav(() => router.push(href(r)))}
      csvFileName="ad-sets"
      minWidthClass="min-w-[980px]"
    />
  );
}
