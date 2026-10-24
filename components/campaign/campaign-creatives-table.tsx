"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { withDateRange } from "@/lib/url";
import { seriesColor, TYPE_LABEL } from "@/lib/palette";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import type { CampaignCreativeRow } from "@/db/queries/campaign";
import { useNavTransition } from "@/lib/nav-progress";
import { StatusBadge } from "@/components/creative/status-badge";
import { PriorityStars } from "@/components/creative/priority-stars";
import { StageChips } from "@/components/creative/stage-chips";
import { isoDate } from "@/lib/format";
import { STATUS_ORDER } from "@/lib/creative-status";
import { isCreativeStage, stageRank } from "@/lib/funnel-stages";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Per-creative summary for one campaign — the chart's series, tabulated. Each
 * creative is dotted with the SAME color it has in the line chart / KPI cards
 * (ranked by spend), so the table and the chart read as one. Sorting is local.
 *
 * THE CATALOG IS WIDER THAN THE DEFAULT VIEW (2026-10): the query already
 * carries each creative's identity (status, type, product, stage, priority,
 * launch date), so the Columns control OFFERS all of it, `defaultHidden` —
 * the table looks exactly as it did until somebody opts in. Cells reuse the
 * Library's renders (`StatusBadge`, `StageChips`, `PriorityStars`), because
 * one field must look the same wherever it appears.
 */

const DASH = "—";

/**
 * A creative's stage set as ONE comparable number: its EARLIEST stage in
 * funnel order, `null` when nothing is declared. That is `compareStages`'
 * rule (lib/funnel-stages) expressed as a scalar, because this table sorts by
 * value — and `null` sinks in both directions, which is the same "an absence
 * of judgment is not a late one" rule the Library follows.
 */
function earliestStageRank(stages: readonly string[]): number | null {
  const ranks = stages.filter(isCreativeStage).map(stageRank);
  return ranks.length === 0 ? null : Math.min(...ranks);
}
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
  const [, startNav] = useNavTransition();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState("spend");
  const [dir, setDir] = useState<SortDir>("desc");

  // Color by rank in the spend-sorted list — the chart/KPIs use the same map,
  // so a creative is the same color everywhere. Keyed off the original order.
  const colorById = useMemo(
    () => new Map(creatives.map((c, i) => [c.creativeId, seriesColor(i)])),
    [creatives],
  );

  const sortVal = (r: CampaignCreativeRow, key: string): SortVal => {
    if (key === "name") return r.name;
    if (key === "lastDate") return r.lastDate ?? "";
    // The identity columns: text sorts as text, and an ABSENCE sorts last in
    // both directions (the house rule for unrated priority / unassigned
    // stages), which `null` already does in the comparator below.
    if (key === "status") return STATUS_ORDER[r.status];
    if (key === "type") return TYPE_LABEL[r.type];
    if (key === "productName") return r.productName;
    if (key === "stages") return earliestStageRank(r.stages);
    if (key === "priority") return r.priority;
    if (key === "launchDate") return r.launchDate;
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
          `/library/${encodeURIComponent(r.name)}`,
          searchParams.get("from"),
          searchParams.get("to"),
        ),
      render: (r) => (
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: colorById.get(r.creativeId) }}
          />
          {/* Phone-only cap: a pinned cell wider than the frame stops pinning. */}
          <span
            className="max-w-[11rem] truncate font-mono text-xs sm:max-w-none"
            title={r.name}
          >
            {r.name}
          </span>
        </span>
      ),
    },
    { key: "spend", label: "Spend", align: "right", sortable: true, render: (r) => usd(r.spend) },
    { key: "impressions", label: METRIC_LABEL.impressions, align: "right", sortable: true, render: (r) => int(r.impressions) },
    { key: "clicks", label: "Clicks", align: "right", sortable: true, render: (r) => int(r.clicks) },
    { key: "conversions", label: METRIC_LABEL.conversions, align: "right", sortable: true, render: (r) => int(r.conversions) },
    { key: "conversionValue", label: METRIC_LABEL.revenue, align: "right", sortable: true, render: (r) => usd(r.conversionValue) },
    { key: "ctr", label: "CTR", align: "right", sortable: true, render: (r) => fPct(r.ctr) },
    { key: "cvr", label: "CvR", align: "right", sortable: true, render: (r) => fPct(r.cvr) },
    { key: "cpa", label: "CPA", align: "right", sortable: true, render: (r) => usd(r.cpa) },
    { key: "roas", label: "ROAS", align: "right", sortable: true, render: (r) => fRatio(r.roas) },
    {
      key: "lastDate",
      label: "Last",
      align: "right",
      sortable: true,
      render: (r) => (r.lastDate ? <span className="tabular-nums">{r.lastDate}</span> : DASH),
    },
    // ── Offered, hidden by default: the creative's own identity ──
    {
      key: "status",
      label: "Status",
      sortable: true,
      defaultSortDir: "asc",
      render: (r) => <StatusBadge status={r.status} />,
      csv: (r) => r.status,
    },
    {
      key: "type",
      label: "Type",
      sortable: true,
      defaultSortDir: "asc",
      render: (r) => <span className="text-ink-2">{TYPE_LABEL[r.type]}</span>,
      csv: (r) => TYPE_LABEL[r.type],
    },
    {
      key: "productName",
      label: "Product",
      sortable: true,
      defaultSortDir: "asc",
      render: (r) => (
        <span className="block truncate text-ink-2" title={r.productName}>
          {r.productName}
        </span>
      ),
      csv: (r) => r.productName,
    },
    {
      key: "stages",
      label: "Stage",
      sortable: true,
      defaultSortDir: "asc",
      render: (r) => <StageChips stages={r.stages} nowrap />,
      csv: (r) => r.stages.join(", "),
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      render: (r) => <PriorityStars value={r.priority} />,
      csv: (r) => r.priority,
    },
    {
      key: "launchDate",
      label: "Launch date",
      sortable: true,
      render: (r) => (
        <span className="num text-ink-2">{r.launchDate ? isoDate(r.launchDate) : DASH}</span>
      ),
      csv: (r) => r.launchDate,
    },
  ];

  /** Hidden until somebody asks for them — adding a column to the CATALOG
   *  must not change what the page looks like today. */
  const DEFAULT_HIDDEN = [
    "status",
    "type",
    "productName",
    "stages",
    "priority",
    "launchDate",
  ];

  // The columns control, from the live config — one key for this table.
  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.CAMPAIGN_CREATIVES,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: DEFAULT_HIDDEN,
  });

  if (creatives.length === 0) {
    return (
      <EmptyState size="sm" title="No creatives ran in this window." kind="range" />
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
      {...cols.tableProps}
      onRowClick={(r) =>
        startNav(() => router.push(
          withDateRange(
            `/library/${encodeURIComponent(r.name)}`,
            searchParams.get("from"),
            searchParams.get("to"),
          ),
        ))
      }
      minWidthClass="min-w-[920px]"
    />
  );
}
