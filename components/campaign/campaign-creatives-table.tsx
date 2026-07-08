"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { withDateRange } from "@/lib/url";
import { seriesColor } from "@/lib/palette";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import type { CampaignCreativeRow } from "@/db/queries/campaign";

/**
 * Per-creative summary for one campaign — the chart's series, tabulated. Each
 * creative is dotted with the SAME color it has in the line chart / KPI cards
 * (ranked by spend), so the table and the chart read as one. Sorting is local.
 */

const DASH = "—";
const fUsd = (v: number | null) => (v === null ? DASH : usd(v));
const fRatio = (v: number | null) => roas(v);
const fPct = (v: number | null) => (v === null ? DASH : pct(v));

type SortDir = "asc" | "desc";
type SortVal = string | number | null;

export function CampaignCreativesTable({
  creatives,
}: {
  creatives: CampaignCreativeRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState("spend");
  const [dir, setDir] = useState<SortDir>("desc");
  const [order, setOrder] = useState<string[]>([]);

  // Color by rank in the spend-sorted list — the chart/KPIs use the same map,
  // so a creative is the same color everywhere. Keyed off the original order.
  const colorById = useMemo(
    () => new Map(creatives.map((c, i) => [c.creativeId, seriesColor(i)])),
    [creatives],
  );

  const sortVal = (r: CampaignCreativeRow, key: string): SortVal => {
    if (key === "name") return r.name;
    if (key === "lastDate") return r.lastDate ?? "";
    return (r[key as keyof CampaignCreativeRow] as number | null) ?? null;
  };

  const sorted = useMemo(() => {
    const d = dir === "asc" ? 1 : -1;
    return [...creatives].sort((a, b) => {
      const av = sortVal(a, sort);
      const bv = sortVal(b, sort);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return av < bv ? -d : av > bv ? d : 0;
      }
      return ((av as number) - (bv as number)) * d;
    });
  }, [creatives, sort, dir]);

  const columns: DataColumn<CampaignCreativeRow>[] = [
    {
      key: "name",
      label: "Creative",
      align: "left",
      sortable: true,
      pinned: true,
      defaultSortDir: "asc",
      href: (r) =>
        withDateRange(
          `/creatives/${encodeURIComponent(r.name)}`,
          searchParams.get("from"),
          searchParams.get("to"),
        ),
      render: (r) => (
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: colorById.get(r.creativeId) }}
          />
          <span className="truncate font-mono text-xs" title={r.name}>
            {r.name}
          </span>
        </span>
      ),
    },
    { key: "spend", label: "Spend", align: "right", sortable: true, render: (r) => usd(r.spend) },
    { key: "impressions", label: METRIC_LABEL.impressions, align: "right", sortable: true, render: (r) => int(r.impressions) },
    { key: "clicks", label: "Clicks", align: "right", sortable: true, render: (r) => int(r.clicks) },
    { key: "conversions", label: "Orders", align: "right", sortable: true, render: (r) => int(r.conversions) },
    { key: "conversionValue", label: METRIC_LABEL.revenue, align: "right", sortable: true, render: (r) => usd(r.conversionValue) },
    { key: "ctr", label: "CTR", align: "right", sortable: true, render: (r) => fPct(r.ctr) },
    { key: "cvr", label: "CvR", align: "right", sortable: true, render: (r) => fPct(r.cvr) },
    { key: "cpa", label: "CPA", align: "right", sortable: true, render: (r) => fUsd(r.cpa) },
    { key: "roas", label: "ROAS", align: "right", sortable: true, render: (r) => fRatio(r.roas) },
    {
      key: "lastDate",
      label: "Last",
      align: "right",
      sortable: true,
      render: (r) => (r.lastDate ? <span className="tabular-nums">{r.lastDate}</span> : DASH),
    },
  ];

  if (creatives.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-8 text-center text-ink-3 text-sm">
        No creatives ran in this window.
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      rows={sorted}
      rowKey={(r) => r.creativeId}
      sort={sort}
      dir={dir}
      onSort={(key, d) => {
        setSort(key);
        setDir(d);
      }}
      order={order}
      onReorder={setOrder}
      onRowClick={(r) =>
        router.push(
          withDateRange(
            `/creatives/${encodeURIComponent(r.name)}`,
            searchParams.get("from"),
            searchParams.get("to"),
          ),
        )
      }
      minWidthClass="min-w-[920px]"
    />
  );
}
