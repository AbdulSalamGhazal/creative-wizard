"use client";

import { useMemo, useState } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { funnelTotals } from "@/lib/funnel-totals";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import type { CampaignFunnelRow } from "@/db/queries/funnel";

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
  | "conversionValue";
type Dir = "asc" | "desc";

/** The two text columns ascend on first click; every number descends. */
export const TEXT_KEYS = new Set<SortKey>(["campaign", "platform"]);

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
const DEFAULT_HIDDEN: SortKey[] = ["clicks", "landingPageViews", "conversionValue"];

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
export function CampaignFunnelTable({ rows }: { rows: CampaignFunnelRow[] }) {
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
        label: "Campaign",
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
        total: () => <span className="text-ink">Total · {rows.length}</span>,
        csv: (r) => r.campaign,
      },
      {
        key: "platform",
        label: "Platform",
        align: "left",
        sortable: true,
        defaultSortDir: firstDir("platform"),
        render: (r) => (
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <PlatformDot platform={r.platform} />
            {PLATFORM_LABEL[r.platform]}
          </span>
        ),
        csv: (r) => PLATFORM_LABEL[r.platform],
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
    ];
  }, [rows.length, totals]);

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
      rowKey={(r) => `${r.platform}::${r.campaign}`}
      sort={sort.key}
      dir={sort.dir}
      onSort={(key) => setSort((prev) => nextSort(prev, key as SortKey))}
      {...cols.tableProps}
      showTotals
      minWidthClass="min-w-max"
      empty={
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-ink-2 text-sm">No campaign activity in this window.</p>
        </div>
      }
    />
  );
}
