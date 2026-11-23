"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, isoDate, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { funnelTotals } from "@/lib/funnel-totals";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import type { CampaignFunnelRow } from "@/db/queries/funnel";
import { EmptyState } from "@/components/ui/empty-state";
import { withDateRange } from "@/lib/url";
import { adSetPath, campaignPath } from "@/lib/campaign";
import type { BreakdownLevel } from "@/lib/breakdown-level";
import { TotalLabel } from "@/components/ui/total-label";

export type SortKey =
  | "campaign"
  | "platform"
  | "spend"
  | "cpm"
  | "ctr"
  | "voc"
  | "atcRate"
  | "apRate"
  | "purchaseRate"
  | "cvr"
  | "conversions"
  | "addToCart"
  | "addPayment"
  | "roas"
  | "impressions"
  // Offered, hidden by default — the counts the rates are built from.
  | "clicks"
  | "landingPageViews"
  | "conversionValue"
  // Offered, hidden by default (2026-11) — free at this grain: the campaign's
  // objective (PK join), CPA/CPC (same scan), the prior window's spend (the
  // delta's own baseline) and the last day with a record.
  | "objective"
  | "cpa"
  | "cpc"
  | "priorSpend"
  | "lastDate";
type Dir = "asc" | "desc";

/** The two text columns ascend on first click; every number descends. */
export const TEXT_KEYS = new Set<SortKey>(["campaign", "platform", "objective"]);

/** The one place that decides a column's first-click direction. */
export const firstDir = (key: SortKey): Dir => (TEXT_KEYS.has(key) ? "asc" : "desc");

/** The table's default: biggest spender first. The third click returns here. */
export const DEFAULT_SORT: { key: SortKey; dir: Dir } = { key: "spend", dir: "desc" };

/**
 * EXPORTED for the unit test, which pins the order this table has always had —
 * the migration to `DataTable` must not move a single row.
 *
 * Campaign sorts by name; platform sorts by LABEL with the campaign name as
 * the tiebreak (so a platform's rows read alphabetically inside it); every
 * other column is numeric, and **a null rate sorts as 0** — not last. That is
 * this table's long-standing behaviour and it is deliberately NOT the
 * primitive's "nulls sink" rule, so no column carries a `sortValue` and the
 * wrapper owns the sort (the Library / launch-fatigue precedent).
 */
export function compareRows(
  a: CampaignFunnelRow,
  b: CampaignFunnelRow,
  key: SortKey,
): number {
  if (key === "campaign") return a.campaign.localeCompare(b.campaign);
  if (key === "objective") {
    return a.objective.localeCompare(b.objective) || a.campaign.localeCompare(b.campaign);
  }
  // ISO dates compare as text; a row with no date sorts where "" would.
  if (key === "lastDate") return (a.lastDate ?? "").localeCompare(b.lastDate ?? "");
  if (key === "platform") {
    return (
      PLATFORM_LABEL[a.platform].localeCompare(PLATFORM_LABEL[b.platform]) ||
      a.campaign.localeCompare(b.campaign)
    );
  }
  return (a[key] ?? 0) - (b[key] ?? 0);
}

/**
 * The THREE-STATE header cycle, as a pure function of what the header click
 * proposes: desc → asc → back to the table's default (spend desc). DataTable
 * proposes a direction; this consumer decides what the table actually does —
 * the same deal the Library's server-sorted header makes.
 */
export function nextSort(
  current: { key: SortKey; dir: Dir },
  clicked: SortKey,
): { key: SortKey; dir: Dir } {
  if (current.key !== clicked) return { key: clicked, dir: firstDir(clicked) };
  if (current.dir === "desc") return { key: clicked, dir: "asc" };
  return { ...DEFAULT_SORT };
}

/** Columns a first visit does not show: every rate's own denominator, plus
 *  revenue. The query has always returned them. */
const DEFAULT_HIDDEN: SortKey[] = [
  "clicks",
  "landingPageViews",
  "conversionValue",
  "objective",
  "cpa",
  "cpc",
  "priorSpend",
  "lastDate",
];

/**
 * Per-campaign funnel table. One row per (platform, campaign_name), on the
 * shared `DataTable`: sort, resize, reorder and the columns control all come
 * from the primitive. Column widths are ephemeral now (the old
 * `funnel-col-widths` localStorage key is retired, its values not migrated —
 * the Library's and Store orders' were not either).
 *
 * THE TOTALS ROW IS UNTOUCHED MATH: `funnelTotals` is the JS mirror of the SQL
 * ratio guard — additive columns sum, rate columns recombine from component
 * sums, and a row that never reported a step joins NEITHER side of that
 * ratio, so a column nobody reported renders "—" rather than a fabricated 0%.
 */
export function CampaignFunnelTable({
  rows,
  from,
  to,
  level = "adset",
}: {
  rows: CampaignFunnelRow[];
  /** The range the table ran — carried into each campaign's link (R-015). */
  from?: string;
  to?: string;
  /**
   * What a row IS (2026-11): an ad set on one platform, or a whole campaign —
   * every ad set under it, on every platform it ran. Same columns, same
   * totals math; only the first column's word, its link and the platform /
   * objective cells (a campaign may carry several) differ.
   */
  level?: BreakdownLevel;
}) {
  const byCampaign = level === "campaign";
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>(DEFAULT_SORT);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const c = compareRows(a, b, sort.key);
      return sort.dir === "asc" ? c : -c;
    });
    return arr;
  }, [rows, sort]);

  const totals = useMemo(() => funnelTotals(rows), [rows]);
  /** The prior window's spend summed over the rows that had one — NULL (a
   *  dash) when none did, never a fabricated $0. */
  const priorSpendTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const r of rows) {
      if (r.priorSpend === null) continue;
      sum += r.priorSpend;
      any = true;
    }
    return any ? sum : null;
  }, [rows]);

  const columns = useMemo<DataColumn<CampaignFunnelRow>[]>(() => {
    /** Every numeric column is the same cell with a different formatter. */
    const num = (
      key: SortKey,
      label: string,
      render: (r: CampaignFunnelRow) => React.ReactNode,
      total: () => React.ReactNode,
      csv: (r: CampaignFunnelRow) => number | null,
    ): DataColumn<CampaignFunnelRow> => ({
      key,
      label,
      align: "right",
      sortable: true,
      defaultSortDir: firstDir(key),
      render,
      total,
      csv,
    });

    return [
      {
        key: "campaign",
        label: byCampaign ? "Campaign" : "Ad set",
        align: "left",
        sortable: true,
        pinned: true,
        defaultSortDir: firstDir("campaign"),
        render: (r) => (
          // The cap is RESPONSIVE because this column is PINNED: a sticky cell
          // wider than the visible frame cannot stay pinned, so on a phone the
          // name's first characters scroll off the left edge. Desktop keeps
          // the full 22rem.
          <span
            className="block max-w-[12rem] truncate text-ink sm:max-w-[22rem]"
            title={r.campaign}
          >
            {r.campaign}
          </span>
        ),
        total: () => <TotalLabel className="text-ink" />,
        csv: (r) => r.campaign,
        // Drill-down to the row's own page with this range (R-015).
        href: (r) =>
          withDateRange(
            r.network ? campaignPath(r.network, r.campaign) : adSetPath(r.campaign),
            from,
            to,
          ),
      },
      {
        key: "platform",
        label: "Platform",
        align: "left",
        sortable: true,
        defaultSortDir: firstDir("platform"),
        // A campaign can run on two platforms (Meta): each gets its dot + name.
        render: (r) => (
          <span className="inline-flex items-center gap-x-2.5 gap-y-0.5 whitespace-nowrap text-ink-2">
            {(r.platforms ?? [r.platform]).map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <PlatformDot platform={p} />
                {PLATFORM_LABEL[p]}
              </span>
            ))}
          </span>
        ),
        csv: (r) => (r.platforms ?? [r.platform]).map((p) => PLATFORM_LABEL[p]).join(" + "),
      },
      num(
        "spend",
        "Spend",
        (r) => (
          <span className="inline-flex items-center justify-end gap-1.5 text-ink">
            {usd(r.spend)}
            <DeltaBadge delta={r.spendDelta} />
          </span>
        ),
        () => <span className="text-ink">{usd(totals.spend)}</span>,
        (r) => r.spend,
      ),
      num("cpm", "CPM", (r) => <span className="text-ink">{usd(r.cpm)}</span>, () => usd(totals.cpm), (r) => r.cpm),
      num("ctr", "CTR", (r) => <span className="text-ink">{pct(r.ctr)}</span>, () => pct(totals.ctr), (r) => r.ctr),
      num("voc", "VOC", (r) => <span className="text-ink">{pct(r.voc)}</span>, () => pct(totals.voc), (r) => r.voc),
      num("atcRate", "ATC%", (r) => <span className="text-ink">{pct(r.atcRate)}</span>, () => pct(totals.atcRate), (r) => r.atcRate),
      num("apRate", "AP%", (r) => <span className="text-ink">{pct(r.apRate)}</span>, () => pct(totals.apRate), (r) => r.apRate),
      num(
        "purchaseRate",
        "CvR (AP)",
        (r) => <span className="text-ink">{pct(r.purchaseRate)}</span>,
        () => pct(totals.purchaseRate),
        (r) => r.purchaseRate,
      ),
      num("cvr", "CvR (LP)", (r) => <span className="text-ink">{pct(r.cvr)}</span>, () => pct(totals.cvr), (r) => r.cvr),
      num(
        "conversions",
        METRIC_LABEL.conversions,
        (r) => <span className="text-ink-2">{int(r.conversions)}</span>,
        () => int(totals.conversions),
        (r) => r.conversions,
      ),
      num("addToCart", "ATC", (r) => <span className="text-ink-2">{int(r.addToCart)}</span>, () => int(totals.addToCart), (r) => r.addToCart),
      num("addPayment", "AP", (r) => <span className="text-ink-2">{int(r.addPayment)}</span>, () => int(totals.addPayment), (r) => r.addPayment),
      num("roas", "ROAS", (r) => <span className="text-ink">{roas(r.roas)}</span>, () => roas(totals.roas), (r) => r.roas),
      num(
        "impressions",
        METRIC_LABEL.impressions,
        (r) => <span className="text-ink-2">{int(r.impressions)}</span>,
        () => int(totals.impressions),
        (r) => r.impressions,
      ),
      // ── Offered, hidden by default: the denominators behind the rates ──
      num("clicks", "Clicks", (r) => <span className="text-ink-2">{int(r.clicks)}</span>, () => int(totals.clicks), (r) => r.clicks),
      num(
        "landingPageViews",
        "LP views",
        (r) => <span className="text-ink-2">{int(r.landingPageViews)}</span>,
        () => int(totals.landingPageViews),
        (r) => r.landingPageViews,
      ),
      num(
        "conversionValue",
        METRIC_LABEL.revenue,
        (r) => <span className="text-ink">{usd(r.conversionValue)}</span>,
        () => usd(totals.conversionValue),
        (r) => r.conversionValue,
      ),
      {
        key: "objective",
        label: "Objective",
        align: "left",
        sortable: true,
        defaultSortDir: firstDir("objective"),
        render: (r) => (
          <span className="whitespace-nowrap text-ink-2">
            {(r.objectives ?? [r.objective]).join(" · ")}
          </span>
        ),
        csv: (r) => (r.objectives ?? [r.objective]).join(" · "),
      },
      num("cpa", METRIC_LABEL.cpa, (r) => <span className="text-ink">{usd(r.cpa)}</span>, () => usd(totals.cpa), (r) => r.cpa),
      num("cpc", METRIC_LABEL.cpc, (r) => <span className="text-ink">{usd(r.cpc)}</span>, () => usd(totals.cpc), (r) => r.cpc),
      num(
        "priorSpend",
        "Prior spend",
        (r) => <span className="text-ink-2">{usd(r.priorSpend)}</span>,
        () => usd(priorSpendTotal),
        (r) => r.priorSpend,
      ),
      {
        key: "lastDate",
        label: "Last",
        align: "right",
        sortable: true,
        defaultSortDir: firstDir("lastDate"),
        render: (r) => <span className="whitespace-nowrap text-ink-2">{isoDate(r.lastDate)}</span>,
        csv: (r) => r.lastDate,
      },
    ];
  }, [totals, priorSpendTotal, from, to, byCampaign]);

  const columnKeys = columns.filter((c) => !c.pinned).map((c) => c.key);
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.FUNNEL_CAMPAIGNS,
    hideable: columnKeys,
    defaults: columnKeys,
    defaultHidden: DEFAULT_HIDDEN,
  });

  return (
    <DataTable
      columns={columns}
      rows={sorted}
      // A campaign's id (its name is unique only per network); an ad set's
      // platform + stored name.
      rowKey={(r) => r.parentId ?? `${r.platform}::${r.campaign}`}
      sort={sort.key}
      dir={sort.dir}
      onSort={(key) => setSort((prev) => nextSort(prev, key as SortKey))}
      {...cols.tableProps}
      showTotals
      minWidthClass="min-w-max"
      empty={
        <EmptyState
          title={`No ${byCampaign ? "campaign" : "ad set"} activity in this window.`}
          kind="filtered"
        />
      }
    />
  );
}
