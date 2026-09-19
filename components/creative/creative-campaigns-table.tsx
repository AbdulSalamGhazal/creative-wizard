"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";
import { withDateRange } from "@/lib/url";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_LABEL } from "@/lib/palette";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { int, pct, roas, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CampaignMixRow, PlatformMixRow } from "@/db/queries/performance";
import { funnelTotals, type FunnelTotalsResult } from "@/lib/funnel-totals";

type Mode = "campaign" | "platform";

interface Props {
  /** One row per (platform, campaign) this creative ran in. */
  campaigns: CampaignMixRow[];
  /** One row per platform (same metrics aggregated). */
  platforms: PlatformMixRow[];
}

type Totals = FunnelTotalsResult;

/** Weighted totals from component sums — never averages the per-row ratios
 *  (CLAUDE.md aggregation rule), through the SHARED helper so the null rule is
 *  the same one the /funnel table uses: a platform that never reported LP
 *  views (google, on the system creative's page) contributes to neither side
 *  of VOC/CvR, and those render "—" rather than a fabricated 0%. Both modes'
 *  rows sum to the same creative total, so one computation drives both footers
 *  → the totals always match. */
function weightedTotals(rows: PlatformMixRow[]): Totals {
  return funnelTotals(
    rows.map((r) => ({
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions ?? 0,
      conversionValue: r.conversionValue,
      landingPageViews: r.landingPageViews,
    })),
  );
}

/** The 9 metric columns, shared by both modes. Generic over the row type so a
 *  CampaignMixRow or a PlatformMixRow both satisfy it. */
function metricColumns<T extends PlatformMixRow>(totals: Totals): DataColumn<T>[] {
  return [
    {
      key: "spend",
      label: METRIC_LABEL.spend,
      align: "right",
      sortable: true,
      defaultSortDir: "desc",
      render: (r) => <span className="text-ink">{usd(r.spend)}</span>,
      sortValue: (r) => r.spend,
      total: () => <span className="text-ink">{usd(totals.spend)}</span>,
    },
    {
      key: "conversions",
      label: METRIC_LABEL.conversions,
      align: "right",
      sortable: true,
      render: (r) => int(r.conversions),
      sortValue: (r) => r.conversions,
      total: () => int(totals.conversions),
    },
    {
      key: "conversionValue",
      label: METRIC_LABEL.revenue,
      align: "right",
      sortable: true,
      render: (r) => usd(r.conversionValue),
      sortValue: (r) => r.conversionValue,
      total: () => usd(totals.conversionValue),
    },
    {
      key: "cpa",
      label: METRIC_LABEL.cpa,
      align: "right",
      sortable: true,
      render: (r) => usd(r.cpa),
      sortValue: (r) => r.cpa,
      total: () => usd(totals.cpa),
    },
    {
      key: "roas",
      label: METRIC_LABEL.roas,
      align: "right",
      sortable: true,
      render: (r) => <span className="text-ink">{roas(r.roas)}</span>,
      sortValue: (r) => r.roas,
      total: () => <span className="text-ink">{roas(totals.roas)}</span>,
    },
    {
      key: "cpm",
      label: METRIC_LABEL.cpm,
      align: "right",
      sortable: true,
      render: (r) => usd(r.cpm),
      sortValue: (r) => r.cpm,
      total: () => usd(totals.cpm),
    },
    {
      key: "ctr",
      label: METRIC_LABEL.ctr,
      align: "right",
      sortable: true,
      render: (r) => pct(r.ctr),
      sortValue: (r) => r.ctr,
      total: () => pct(totals.ctr),
    },
    {
      key: "voc",
      label: METRIC_LABEL.voc,
      align: "right",
      sortable: true,
      render: (r) => pct(r.voc),
      sortValue: (r) => r.voc,
      total: () => pct(totals.voc),
    },
    {
      key: "cvr",
      label: METRIC_LABEL.cvr,
      align: "right",
      sortable: true,
      render: (r) => pct(r.cvr),
      sortValue: (r) => r.cvr,
      total: () => pct(totals.cvr),
    },
  ];
}

/**
 * This creative's performance, one row per campaign it ran in (default) or per
 * platform (toggle) — on the shared DataTable. Campaign rows click through to
 * the campaign detail; totals are weighted from sums and identical in both
 * modes. Sort/mode are local (a detail table, per CLAUDE.md).
 */
export function CreativeCampaignsTable({ campaigns, platforms }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();
  const [mode, setMode] = useState<Mode>("campaign");
  const [sort, setSort] = useState("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const totals = useMemo(() => weightedTotals(campaigns), [campaigns]);

  const campaignColumns = useMemo<DataColumn<CampaignMixRow>[]>(
    () => [
      {
        key: "campaign",
        label: "Campaign",
        align: "left",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => r.campaign,
        csv: (r) => r.campaign,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <PlatformDot platform={r.platform} size="sm" />
            <span className="shrink-0 text-eyebrow text-ink-3">
              {PLATFORM_LABEL[r.platform]}
            </span>
            <span
              className="block truncate max-w-[18rem] text-ink"
              title={r.campaign}
            >
              {r.campaign}
            </span>
          </span>
        ),
        total: () => <span className="text-ink-3">Totals</span>,
      },
      ...metricColumns<CampaignMixRow>(totals),
    ],
    [totals],
  );

  const platformColumns = useMemo<DataColumn<PlatformMixRow>[]>(
    () => [
      {
        key: "platform",
        label: "Platform",
        align: "left",
        pinned: true,
        sortable: true,
        defaultSortDir: "asc",
        sortValue: (r) => PLATFORM_LABEL[r.platform],
        csv: (r) => PLATFORM_LABEL[r.platform],
        render: (r) => (
          <span className="inline-flex items-center gap-2">
            <PlatformDot platform={r.platform} />
            <span className="whitespace-nowrap text-ink">
              {PLATFORM_LABEL[r.platform]}
            </span>
          </span>
        ),
        total: () => <span className="text-ink-3">Totals</span>,
      },
      ...metricColumns<PlatformMixRow>(totals),
    ],
    [totals],
  );

  // Switching mode: the pinned key of one mode ("campaign"/"platform") doesn't
  // exist in the other, so fall back to the default sort when it would dangle.
  const switchMode = (next: Mode) => {
    setMode(next);
    if (
      (next === "platform" && sort === "campaign") ||
      (next === "campaign" && sort === "platform")
    ) {
      setSort("spend");
      setDir("desc");
    }
  };

  const onSort = (key: string, d: "asc" | "desc") => {
    setSort(key);
    setDir(d);
  };

  const empty = (
    <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
      No campaign activity for this creative.
    </div>
  );

  if (platforms.length === 0) return empty;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[11px]">
          {(
            [
              ["campaign", "By campaign"],
              ["platform", "By platform"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => switchMode(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                mode === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-3 num">
          {mode === "campaign"
            ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`
            : `${platforms.length} platform${platforms.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {mode === "campaign" ? (
        <DataTable
          columns={campaignColumns}
          rows={campaigns}
          rowKey={(r) => `${r.platform}::${r.campaign}`}
          sort={sort}
          dir={dir}
          onSort={onSort}
          onRowClick={(r) =>
            startNav(() =>
              router.push(
                withDateRange(
                  `/campaigns/${encodeURIComponent(r.campaign)}`,
                  searchParams.get("from"),
                  searchParams.get("to"),
                ),
              ),
            )
          }
          showTotals
          csvFileName="creative-campaigns"
          empty={empty}
        />
      ) : (
        <DataTable
          columns={platformColumns}
          rows={platforms}
          rowKey={(r) => r.platform}
          sort={sort}
          dir={dir}
          onSort={onSort}
          showTotals
          empty={empty}
        />
      )}
    </div>
  );
}
