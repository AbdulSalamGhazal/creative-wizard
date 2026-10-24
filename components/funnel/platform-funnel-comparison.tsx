"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { DataTable, compareSortValues, type DataColumn } from "@/components/ui/data-table";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { PlatformDot } from "@/components/ui/platform-dot";
import { EmptyState } from "@/components/ui/empty-state";
import { TABLE_KEYS } from "@/lib/table-columns";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, pct, plural, roas, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlatformFunnelRow, PlatformCampaignRow } from "@/db/queries/funnel";

type RateKey = "cpm" | "ctr" | "voc" | "atcRate" | "apRate" | "purchaseRate" | "cvr";

const RATES: Array<{
  key: RateKey;
  label: string;
  fmt: (v: number | null) => string;
  /** CPM is a cost — the leader is the LOWEST, the rest are the highest. */
  lowerBetter: boolean;
  hint: string;
}> = [
  { key: "cpm", label: "CPM", fmt: (v) => usd(v), lowerBetter: true, hint: "cost / 1k impressions" },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v), lowerBetter: false, hint: "clicks / impressions" },
  { key: "voc", label: "VOC", fmt: (v) => pct(v), lowerBetter: false, hint: "LP views / clicks" },
  { key: "atcRate", label: "ATC%", fmt: (v) => pct(v), lowerBetter: false, hint: "add-to-cart / LP views" },
  { key: "apRate", label: "AP%", fmt: (v) => pct(v), lowerBetter: false, hint: "add-payment / add-to-cart" },
  { key: "purchaseRate", label: "CvR (AP)", fmt: (v) => pct(v), lowerBetter: false, hint: "conversions / add-payment" },
  { key: "cvr", label: "CvR (LP)", fmt: (v) => pct(v), lowerBetter: false, hint: "conversions / LP views" },
];

type Metrics = Omit<PlatformFunnelRow, "platform">;
type MetricKey = keyof Metrics;

/** The plain numbers, in display order. The four volumes after Spend/Conv.
 *  are the counts behind the rates — offered, hidden by default (the
 *  catalog rule: the query already carries them at this grain). */
const NUMBERS: Array<{ key: MetricKey; label: string; fmt: (v: number | null) => string; quiet?: boolean }> = [
  { key: "spend", label: METRIC_LABEL.spend, fmt: usd },
  { key: "conversions", label: METRIC_LABEL.conversions, fmt: int, quiet: true },
  { key: "cpa", label: METRIC_LABEL.cpa, fmt: usd },
  { key: "roas", label: METRIC_LABEL.roas, fmt: roas },
  { key: "impressions", label: METRIC_LABEL.impressions, fmt: int, quiet: true },
  { key: "clicks", label: METRIC_LABEL.clicks, fmt: int, quiet: true },
  { key: "landingPageViews", label: METRIC_LABEL.landingPageViews, fmt: int, quiet: true },
  { key: "addToCart", label: METRIC_LABEL.addToCart, fmt: int, quiet: true },
  { key: "addPayment", label: METRIC_LABEL.addPayment, fmt: int, quiet: true },
];
const DEFAULT_HIDDEN = ["impressions", "clicks", "landingPageViews", "addToCart", "addPayment"];
const COLUMN_KEYS = [...NUMBERS.map((n) => n.key as string), ...RATES.map((r) => r.key)];

/** One table row: a platform, or (while it is expanded) one of its campaigns. */
type Row =
  | ({ kind: "platform"; key: string; platform: PlatformFunnelRow["platform"]; campaigns: number } & Metrics)
  | ({ kind: "campaign"; key: string; platform: PlatformFunnelRow["platform"]; campaign: string } & Metrics)
  | { kind: "none"; key: string; platform: PlatformFunnelRow["platform"] };

const metricOf = (r: Row, k: MetricKey): number | null =>
  r.kind === "none" ? null : (r[k] as number | null);

/**
 * Platforms side-by-side across the funnel, on the shared `DataTable` (D22,
 * 2026-10): the columns control, sort and a pinned identity like the By
 * campaign table under it. A platform's chevron still expands its campaigns
 * in place; the WRAPPER owns the sort (no column carries a `sortValue`) so a
 * platform's campaigns stay under it, sorted the same way. Volumes are plain
 * numbers; the funnel rates keep their magnitude bar and leader highlight.
 */
export function PlatformFunnelComparison({
  platforms,
  campaigns,
}: {
  platforms: PlatformFunnelRow[];
  campaigns: PlatformCampaignRow[];
}) {
  const cols = useTableColumns({
    tableKey: TABLE_KEYS.FUNNEL_PLATFORMS,
    hideable: COLUMN_KEYS,
    defaults: COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const campaignsByPlatform = useMemo(() => {
    const m = new Map<string, PlatformCampaignRow[]>();
    for (const c of campaigns) {
      const list = m.get(c.platform) ?? [];
      list.push(c);
      m.set(c.platform, list);
    }
    return m;
  }, [campaigns]);

  // Per rate: which platform leads, and the max magnitude (for bar scaling).
  const { best, maxAbs } = useMemo(() => {
    const best: Partial<Record<RateKey, string>> = {};
    const maxAbs = {} as Record<RateKey, number>;
    for (const r of RATES) {
      let bestPlat: string | null = null;
      let bestVal: number | null = null;
      let max = 0;
      for (const row of platforms) {
        const v = row[r.key];
        if (v === null) continue;
        if (v > max) max = v;
        if (bestVal === null || (r.lowerBetter ? v < bestVal : v > bestVal)) {
          bestVal = v;
          bestPlat = row.platform;
        }
      }
      if (bestPlat) best[r.key] = bestPlat;
      maxAbs[r.key] = max;
    }
    return { best, maxAbs };
  }, [platforms]);

  const toggle = (platform: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  // Sort platforms; each expanded platform's campaigns follow it, sorted alike.
  const rows = useMemo<Row[]>(() => {
    const value = (r: Row) =>
      sortKey === "platform"
        ? r.kind === "campaign"
          ? r.campaign.toLowerCase()
          : PLATFORM_LABEL[r.platform]
        : metricOf(r, sortKey as MetricKey);
    const byKey = (a: Row, b: Row) => compareSortValues(value(a), value(b), dir);
    const out: Row[] = [];
    const parents: Row[] = platforms.map((p) => ({
      kind: "platform",
      key: p.platform,
      campaigns: campaignsByPlatform.get(p.platform)?.length ?? 0,
      ...p,
    }));
    for (const parent of [...parents].sort(byKey)) {
      out.push(parent);
      if (!expanded.has(parent.platform)) continue;
      const camps = campaignsByPlatform.get(parent.platform) ?? [];
      if (camps.length === 0) {
        out.push({ kind: "none", key: `${parent.platform}::none`, platform: parent.platform });
        continue;
      }
      const children: Row[] = camps.map((c) => ({
        kind: "campaign",
        key: `${c.platform}::${c.campaign}`,
        ...c,
      }));
      out.push(...children.sort(byKey));
    }
    return out;
  }, [platforms, campaignsByPlatform, expanded, sortKey, dir]);

  const columns = useMemo<DataColumn<Row>[]>(() => {
    const identity: DataColumn<Row> = {
      key: "platform",
      label: "Platform",
      pinned: true,
      sortable: true,
      defaultSortDir: "asc",
      csv: (r) => (r.kind === "campaign" ? `  ${r.campaign}` : r.kind === "platform" ? PLATFORM_LABEL[r.platform] : ""),
      render: (r) => {
        if (r.kind === "none")
          return <span className="pl-7 text-[11px] text-ink-3">No campaigns in this window.</span>;
        if (r.kind === "campaign")
          return (
            <span
              className="block max-w-[10rem] truncate pl-7 text-xs text-ink-2 sm:max-w-[22rem]"
              title={r.campaign}
            >
              {r.campaign}
            </span>
          );
        const isOpen = expanded.has(r.platform);
        return (
          <button
            type="button"
            onClick={() => toggle(r.platform)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${PLATFORM_LABEL[r.platform]} campaigns`}
            className="inline-flex items-center gap-2 whitespace-nowrap text-ink transition-colors hover:text-brand"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 text-ink-3 transition-transform", isOpen && "rotate-90")}
            />
            <PlatformDot platform={r.platform} />
            <span>{PLATFORM_LABEL[r.platform]}</span>
            <span className="text-[10px] text-ink-3">{plural(r.campaigns, "campaign")}</span>
          </button>
        );
      },
    };
    const numbers = NUMBERS.map(
      (n): DataColumn<Row> => ({
        key: n.key,
        label: n.label,
        align: "right",
        sortable: true,
        csv: (r) => metricOf(r, n.key),
        render: (r) =>
          r.kind === "none" ? null : (
            <span
              className={cn(
                r.kind === "campaign" ? "text-xs text-ink-2" : n.quiet ? "text-ink-2" : "text-ink",
              )}
            >
              {n.fmt(metricOf(r, n.key))}
            </span>
          ),
      }),
    );
    const rates = RATES.map(
      (rate): DataColumn<Row> => ({
        key: rate.key,
        label: rate.label,
        align: "right",
        sortable: true,
        csv: (r) => metricOf(r, rate.key),
        render: (r) => {
          if (r.kind === "none") return null;
          const v = metricOf(r, rate.key);
          if (r.kind === "campaign")
            return <span className="text-xs text-ink-2">{rate.fmt(v)}</span>;
          const isBest = best[rate.key] === r.platform;
          const widthPct =
            v !== null && maxAbs[rate.key] > 0 ? Math.max((v / maxAbs[rate.key]) * 100, 4) : 0;
          return (
            <div className="flex flex-col items-end gap-1" title={rate.hint}>
              <span
                className={cn(isBest ? "font-semibold text-pos" : "text-ink")}
                title={isBest ? `Best ${rate.label} across platforms` : undefined}
              >
                {rate.fmt(v)}
              </span>
              <span className="block h-1 w-14 overflow-hidden rounded bg-surface-2">
                <span
                  className="block h-full rounded"
                  style={{
                    width: `${widthPct}%`,
                    background: PLATFORM_COLOR[r.platform],
                    opacity: isBest ? 1 : 0.5,
                  }}
                />
              </span>
            </div>
          );
        },
      }),
    );
    return [identity, ...numbers, ...rates];
  }, [expanded, best, maxAbs]);

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      sort={sortKey}
      dir={dir}
      {...cols.tableProps}
      onSort={(key, d) => {
        setSortKey(key);
        setDir(d);
      }}
      rowClassName={(r) => (r.kind === "platform" ? "" : "bg-surface-2/25")}
      csvFileName="funnel-platforms"
      minWidthClass="min-w-[1040px]"
      empty={<EmptyState title="No platform activity in this window." kind="filtered" />}
    />
  );
}
