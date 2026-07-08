"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { withDateRange } from "@/lib/url";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, pct, roas, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import {
  RATING_META,
  rateBlock,
  rulesForScope,
  type RatingConfig,
  type RatingRules,
} from "@/lib/rating";
import type {
  PlatformMetricBlock,
  SummaryRow,
} from "@/db/queries/summary";
import {
  type IdentityColumnKey,
  type MetricColumnKey,
  type SortDir,
} from "@/validators/summary";
import { StatusSquare } from "@/components/creative/status-badge";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";
import type { PlatformStatus } from "@/lib/creative-status";

interface Props {
  rows: SummaryRow[];
  platforms: string[];
  /** Current effective sort, post-server-validation. */
  sort: { key: string; dir: SortDir };
  /** Path the column headers should link to with updated sort params. */
  pathname: string;
  /** Current query string (minus nothing) to preserve when toggling sort. */
  baseParams: string;
  /** Identity columns to suppress (Creative name is always shown). */
  hiddenIdentity?: Set<IdentityColumnKey>;
  /** Metric columns to suppress — applies to every platform + total group. */
  hiddenMetrics?: Set<MetricColumnKey>;
  /** Rating config (default + per-platform overrides) driving the Rate column. */
  ratingConfig: RatingConfig;
  /** Whether to render the Rate column (first in each group). Default true. */
  showRate?: boolean;
  /** Show the Blended Total column group. Defaults to "2+ platforms" when undefined. */
  showBlended?: boolean;
}

/** Text identity columns the user can drag to resize. Numeric columns stay auto-sized. */
const RESIZABLE_IDENTITY = new Set(["name", "product", "creator"]);
const COL_WIDTHS_KEY = "summary-col-widths";
const PLATFORM_ORDER_KEY = "summary-platform-order";
const MIN_COL_WIDTH = 80;

/** A small colored pill for a creative's rating, centered in the cell. */
function RateBadge({ block, rules }: { block: PlatformMetricBlock | undefined; rules: RatingRules }) {
  const rating = rateBlock(block, rules);
  const meta = RATING_META[rating];
  return (
    <span
      className={
        "inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] border whitespace-nowrap " +
        meta.badgeClass
      }
    >
      {meta.label}
    </span>
  );
}

// Metric column definitions: key suffix, label, formatter, alignment.
// These are reused for every platform block AND for the total/blended
// block at the right — so the column shape is consistent across the table.
type MetricFormatter = (v: number | null) => string;

const METRIC_COLUMNS: Array<{
  key: string;
  label: string;
  format: MetricFormatter;
}> = [
  { key: "spend", label: "Spend", format: (v) => usd(v) },
  { key: "impressions", label: METRIC_LABEL.impressions, format: (v) => int(v) },
  { key: "clicks", label: "Clicks", format: (v) => int(v) },
  { key: "conversions", label: METRIC_LABEL.conversions, format: (v) => int(v) },
  { key: "ctr", label: "CTR", format: (v) => pct(v) },
  { key: "cpm", label: "CPM", format: (v) => usd(v) },
  { key: "cpc", label: "CPC", format: (v) => usd(v) },
  { key: "cpa", label: "CPA", format: (v) => usd(v) },
  { key: "roas", label: "ROAS", format: (v) => roas(v) },
  { key: "hook_rate", label: "Hook", format: (v) => pct(v) },
  { key: "hold_rate", label: "Hold", format: (v) => pct(v) },
  { key: "complete_rate", label: "Complete", format: (v) => pct(v) },
  { key: "landing_page_views", label: "LP views", format: (v) => int(v) },
  { key: "voc", label: "VOC", format: (v) => pct(v) },
  { key: "cvr", label: "CvR", format: (v) => pct(v) },
];

/** Picks the right field from a metric block given the column key. */
function pickMetric(block: PlatformMetricBlock, key: string): number | null {
  switch (key) {
    case "spend":
      return block.spend;
    case "impressions":
      return block.impressions;
    case "clicks":
      return block.clicks;
    case "conversions":
      return block.conversions;
    case "ctr":
      return block.ctr;
    case "cpm":
      return block.cpm;
    case "cpc":
      return block.cpc;
    case "cpa":
      return block.cpa;
    case "roas":
      return block.roas;
    case "hook_rate":
      return block.hookRate;
    case "hold_rate":
      return block.holdRate;
    case "complete_rate":
      return block.completeRate;
    case "landing_page_views":
      return block.landingPageViews;
    case "voc":
      return block.voc;
    case "cvr":
      return block.cvr;
  }
  return null;
}

/**
 * The dense Summary table. Identity columns on the left, platform group
 * headers, every metric repeated per platform side-by-side, plus a blended
 * total block when 2+ platforms are selected.
 *
 * Metric column headers are sort Links (cycle desc → asc → reset). The text
 * identity columns (Creative / Product / Creator) are drag-resizable via a
 * handle on the right edge of each header; widths persist to localStorage.
 * Numeric columns stay content-sized.
 */
export function SummaryTable({
  rows,
  platforms,
  sort,
  pathname,
  baseParams,
  hiddenIdentity,
  hiddenMetrics,
  ratingConfig,
  showRate = true,
  showBlended,
}: Props) {
  // Carry the active date range (when explicit in the URL) into each creative
  // link so the detail page opens on the same window instead of its default.
  const rangeParams = new URLSearchParams(baseParams);
  const rangeFrom = rangeParams.get("from");
  const rangeTo = rangeParams.get("to");

  const showTotal =
    showBlended === undefined ? platforms.length >= 2 : showBlended;
  const visibleMetrics = METRIC_COLUMNS.filter(
    (m) => !hiddenMetrics?.has(m.key as MetricColumnKey),
  );
  const visibleMetricCount = visibleMetrics.length;
  // Each platform/total group leads with a thin Status column then the Rate
  // column (both shown together under `showRate`), then its visible metrics.
  const rateCols = showRate ? 1 : 0;
  const statusCols = showRate ? 1 : 0;
  const groupColSpan = visibleMetricCount + rateCols + statusCols;

  // ---- Resizable text columns -------------------------------------------
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [platformOrder, setPlatformOrder] = useState<string[]>([]);
  const thRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        if (parsed && typeof parsed === "object") setWidths(parsed);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // User-defined platform column order (persisted to localStorage). Platforms
  // not yet in the saved order (new selections) append at the end. Kept above
  // any early return so the Rules of Hooks hold (hooks run every render).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLATFORM_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setPlatformOrder(parsed.filter((x): x is string => typeof x === "string"));
        }
      }
    } catch {
      /* ignore malformed value */
    }
  }, []);

  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const measured = thRefs.current[key]?.getBoundingClientRect().width ?? 160;
      const startW = widths[key] ?? measured;

      const onMove = (ev: MouseEvent) => {
        const w = Math.max(MIN_COL_WIDTH, Math.round(startW + (ev.clientX - startX)));
        setWidths((prev) => ({ ...prev, [key]: w }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        setWidths((prev) => {
          try {
            localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev));
          } catch {
            /* ignore */
          }
          return prev;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
    },
    [widths],
  );

  const widthStyle = (key: string): React.CSSProperties | undefined => {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  // First-click direction per column. Status ranks active→pause→new→terminated
  // ascending (STATUS_ORDER), so asc-first surfaces the most-relevant (active)
  // creatives; every other column is biggest-first (desc). Covers both the
  // general "status" key and the per-platform "<platform>.status" keys.
  const firstDir = (key: string): SortDir =>
    key === "status" || key.endsWith(".status") ? "asc" : "desc";

  const sortHref = (key: string): string => {
    const next = new URLSearchParams(baseParams);
    const dflt = firstDir(key);
    if (sort.key === key) {
      // Cycle: <first> → <other> → reset
      if (sort.dir === dflt) {
        next.set("sort", key);
        next.set("dir", dflt === "desc" ? "asc" : "desc");
      } else {
        next.delete("sort");
        next.delete("dir");
      }
    } else {
      next.set("sort", key);
      next.set("dir", dflt);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => {
    if (!active)
      return <ArrowUpDown className="w-3 h-3 text-ink-3 opacity-60" aria-hidden />;
    return dir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-brand" aria-hidden />
    ) : (
      <ArrowDown className="w-3 h-3 text-brand" aria-hidden />
    );
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No creatives match these filters.</p>
        <p className="text-ink-3 text-xs mt-1">
          Try widening the date range or removing filters.
        </p>
      </div>
    );
  }

  // The Creative name column is mandatory — it's the row identity. Every
  // other identity column can be hidden via the URL.
  const ALL_IDENTITY_COLS: Array<{
    key: string;
    label: string;
    hideKey?: IdentityColumnKey;
  }> = [
    { key: "name", label: "Creative" },
    { key: "product", label: "Product", hideKey: "product" },
    { key: "type", label: "Type", hideKey: "type" },
    { key: "launch", label: "Launch date", hideKey: "launch" },
    { key: "creator", label: "Creator", hideKey: "creator" },
  ];
  const identityCols = ALL_IDENTITY_COLS.filter(
    (c) => !c.hideKey || !hiddenIdentity?.has(c.hideKey),
  );

  // Reorderable column groups: each selected platform PLUS (when shown) the
  // blended "total" group. The ◀▶ controls move any of them — total included.
  const allGroups: string[] = [...(platforms as string[])];
  if (showTotal) allGroups.push("total");
  const orderedGroups: string[] = [
    ...platformOrder.filter((g) => allGroups.includes(g)),
    ...allGroups.filter((g) => !platformOrder.includes(g)),
  ];
  const moveGroup = (g: string, dir: -1 | 1) => {
    const cur = [...orderedGroups];
    const i = cur.indexOf(g);
    const a = cur[i];
    const b = cur[i + dir];
    if (a === undefined || b === undefined) return;
    cur[i] = b;
    cur[i + dir] = a;
    setPlatformOrder(cur);
    try {
      localStorage.setItem(PLATFORM_ORDER_KEY, JSON.stringify(cur));
    } catch {
      /* ignore */
    }
  };

  // Totals / weighted-average footer over the currently visible (filtered)
  // rows. Additive metrics sum; ratio metrics recombine via component sums.
  // Hook/Hold need video-view component sums not carried in the block → "—".
  const footerByPlatform: Partial<Record<string, PlatformMetricBlock>> = {};
  for (const pf of platforms) {
    footerByPlatform[pf] = aggregateBlocks(
      rows.map((r) => r.perPlatform[pf as keyof typeof r.perPlatform]),
    );
  }
  const footerTotal = aggregateBlocks(rows.map((r) => r.total));

  // CSV export: flatten the grouped per-platform columns into `<Group> <Metric>`
  // headers (raw numeric values). Respects the current filters/sort (rows are
  // already sorted), the visible identity + metric columns, and the visible
  // platform groups + Blended total in their display order.
  const csvColumns: CsvColumn<SummaryRow>[] = [
    { key: "name", label: "Creative", value: (r) => r.name },
    ...identityCols
      .filter((c) => c.key !== "name")
      .map((c) => ({
        key: c.key,
        label: c.label,
        value: (r: SummaryRow) =>
          c.key === "product"
            ? r.productName
            : c.key === "type"
              ? r.type
              : c.key === "launch"
                ? r.launchDate
                : c.key === "creator"
                  ? r.creatorName
                  : null,
      })),
    { key: "status", label: "Status", value: (r: SummaryRow) => r.generalStatus },
    { key: "tags", label: "Tags", value: (r: SummaryRow) => r.tags.join(" | ") },
    ...orderedGroups.flatMap((g) => {
      const groupLabel =
        g === "total"
          ? "Blended"
          : (PLATFORM_LABEL[g as keyof typeof PLATFORM_LABEL] ?? g);
      return visibleMetrics.map((m) => ({
        key: `${g}:${m.key}`,
        label: `${groupLabel} ${m.label}`,
        value: (r: SummaryRow) => {
          const block =
            g === "total"
              ? r.total
              : r.perPlatform[g as keyof typeof r.perPlatform];
          return block ? pickMetric(block, m.key) : null;
        },
      }));
    }),
  ];
  const csvContent = rowsToCsv(rows, csvColumns);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <DownloadCsvButton
          csvContent={csvContent}
          filename={`summary-${todayStamp()}.csv`}
        />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
      <table className="text-xs num min-w-max">
        {/* Two-row header: top row = group banners; bottom = column labels.
            The whole <thead> is sticky so it stays frozen while the body
            scrolls; an opaque background keeps rows from showing through. */}
        <thead className="sticky top-0 z-20 bg-surface">
          <tr className="border-b border-line bg-surface-2/40">
            {/* The Creative (name) banner pins left; the remaining identity
                columns share a blank banner so the per-column labels in the
                next row still align under it. */}
            <th
              style={widthStyle("name")}
              className="sticky left-0 z-30 bg-surface-2 px-3 py-1.5 text-eyebrow text-ink-3 text-left"
            >
              Creative
            </th>
            {identityCols.length > 1 && (
              <th
                colSpan={identityCols.length - 1}
                className="px-3 py-1.5 text-eyebrow text-ink-3 text-left"
              />
            )}
            {groupColSpan > 0 &&
              orderedGroups.map((g, idx) => {
                const isTotal = g === "total";
                const groupLabel = isTotal
                  ? "Blended total"
                  : PLATFORM_LABEL[g as keyof typeof PLATFORM_LABEL];
                return (
                  <th
                    key={g}
                    colSpan={groupColSpan}
                    className={
                      "px-3 py-1.5 text-eyebrow border-l border-line text-left " +
                      (isTotal ? "text-ink-2" : "")
                    }
                    style={
                      isTotal
                        ? undefined
                        : { color: PLATFORM_COLOR[g as keyof typeof PLATFORM_COLOR] }
                    }
                    title={
                      isTotal
                        ? "Weighted aggregate across the selected platforms."
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveGroup(g, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${groupLabel} left`}
                        className="text-ink-3 hover:text-ink disabled:opacity-20 disabled:cursor-default leading-none"
                      >
                        ◀
                      </button>
                      {groupLabel}
                      <button
                        type="button"
                        onClick={() => moveGroup(g, 1)}
                        disabled={idx === orderedGroups.length - 1}
                        aria-label={`Move ${groupLabel} right`}
                        className="text-ink-3 hover:text-ink disabled:opacity-20 disabled:cursor-default leading-none"
                      >
                        ▶
                      </button>
                    </span>
                  </th>
                );
              })}
          </tr>
          <tr className="border-b border-line text-left text-label text-ink-3">
            {identityCols.map((c) => {
              const resizable = RESIZABLE_IDENTITY.has(c.key);
              return (
                <IdentityTh
                  key={c.key}
                  label={c.label}
                  active={sort.key === c.key}
                  dir={sort.dir}
                  href={sortHref(c.key)}
                  icon={SortIcon}
                  width={widths[c.key]}
                  style={widthStyle(c.key)}
                  resizable={resizable}
                  pinned={c.key === "name"}
                  onResizeStart={(e) => startResize(c.key, e)}
                  thRef={(el) => {
                    thRefs.current[c.key] = el;
                  }}
                />
              );
            })}
            {orderedGroups.map((g) => (
              <RateAndMetricsHead
                key={`head-${g}`}
                scope={g}
                showRate={showRate}
                visibleMetrics={visibleMetrics}
                sort={sort}
                sortHref={sortHref}
                SortIcon={SortIcon}
              />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr
              key={r.creativeId}
              className="group hover:bg-surface-3 transition-colors"
            >
              {/* Identity — render only the visible columns */}
              {identityCols.map((c) => {
                const w = RESIZABLE_IDENTITY.has(c.key) ? widths[c.key] : undefined;
                const style = w ? { width: w, minWidth: w, maxWidth: w } : undefined;
                const nowrap = w ? "" : "whitespace-nowrap";
                switch (c.key) {
                  case "name":
                    return (
                      <td
                        key="name"
                        style={style}
                        className={cn(
                          "px-3 py-2 sticky left-0 z-10 bg-surface group-hover:bg-surface-3 group-hover:[box-shadow:inset_3px_0_0_var(--brand)]",
                          nowrap,
                        )}
                      >
                        <span className="inline-flex items-center gap-2 max-w-full">
                          {/* Dynamic general status — a square letter chip
                              (label in its title); sits before the name and
                              pins with it so the live state stays visible while
                              scrolling the metrics horizontally. */}
                          <StatusSquare
                            status={r.generalStatus}
                            className="shrink-0"
                          />
                          <Link
                            href={withDateRange(
                              `/creatives/${encodeURIComponent(r.name)}`,
                              rangeFrom,
                              rangeTo,
                            )}
                            title={r.name}
                            className={
                              "font-mono text-ink text-xs hover:text-brand transition-colors " +
                              (w ? "block truncate" : "")
                            }
                          >
                            {r.name}
                          </Link>
                        </span>
                      </td>
                    );
                  case "product":
                    return (
                      <td
                        key="product"
                        style={style}
                        title={w ? r.productName : undefined}
                        className={`px-3 py-2 text-ink-2 ${w ? "truncate" : "whitespace-nowrap"}`}
                      >
                        {r.productName}
                      </td>
                    );
                  case "type":
                    return (
                      <td
                        key="type"
                        className="px-3 py-2 text-ink-2 whitespace-nowrap capitalize"
                      >
                        {r.type}
                      </td>
                    );
                  case "launch":
                    return (
                      <td
                        key="launch"
                        className="px-3 py-2 text-ink-2 whitespace-nowrap tabular-nums"
                      >
                        {r.launchDate ?? <span className="text-ink-3">—</span>}
                      </td>
                    );
                  case "creator":
                    return (
                      <td
                        key="creator"
                        style={style}
                        title={w ? (r.creatorName ?? "—") : undefined}
                        className={`px-3 py-2 text-ink-3 ${w ? "truncate" : "whitespace-nowrap"}`}
                      >
                        {r.creatorName ?? "—"}
                      </td>
                    );
                  default:
                    return null;
                }
              })}

              {/* Per platform */}
              {orderedGroups.map((g) => (
                <RateAndMetricsCells
                  key={`${r.creativeId}.${g}`}
                  scope={g}
                  block={
                    g === "total"
                      ? r.total
                      : r.perPlatform[g as keyof typeof r.perPlatform]
                  }
                  // Per-platform status. Undefined for "total" (blended) → no dot.
                  // Undefined for a selected platform → creative never ran there → New.
                  platformStatus={
                    g === "total"
                      ? undefined
                      : (r.perPlatformStatus[g as keyof typeof r.perPlatformStatus] ?? "new")
                  }
                  showRate={showRate}
                  ratingConfig={ratingConfig}
                  visibleMetrics={visibleMetrics}
                  muted={g === "total"}
                />
              ))}
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-line">
              {identityCols.map((c, i) => (
                <td
                  key={`foot-${c.key}`}
                  className={cn(
                    "sticky bottom-0 z-10 bg-surface-2 px-3 py-2 text-ink font-semibold whitespace-nowrap",
                    // The name (Totals) cell pins left too, so it stays in the
                    // bottom-left corner during horizontal scroll.
                    i === 0 && "left-0 z-20",
                  )}
                >
                  {i === 0 ? "Totals" : ""}
                </td>
              ))}
              {orderedGroups.map((g) => (
                <FooterCells
                  key={`foot-${g}`}
                  scope={g}
                  block={g === "total" ? footerTotal : footerByPlatform[g]}
                  showRate={showRate}
                  visibleMetrics={visibleMetrics}
                  muted={g === "total"}
                />
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      </div>
    </div>
  );
}

/**
 * A sortable identity-column header with an optional drag-to-resize handle.
 * When a width is pinned, the label truncates within it.
 */
function IdentityTh({
  label,
  active,
  dir,
  href,
  icon: SortIcon,
  width,
  style,
  resizable,
  pinned = false,
  onResizeStart,
  thRef,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  href: string;
  icon: (props: { active: boolean; dir: SortDir }) => React.ReactElement;
  width?: number;
  style?: React.CSSProperties;
  resizable: boolean;
  /** Freeze this header to the left edge during horizontal scroll. */
  pinned?: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  thRef: (el: HTMLTableCellElement | null) => void;
}) {
  return (
    <th
      ref={thRef}
      style={style}
      className={cn(
        "relative font-medium px-3 py-2 text-left",
        !width && "whitespace-nowrap",
        pinned && "sticky left-0 z-30 bg-surface",
      )}
    >
      <Link
        href={href}
        scroll={false}
        className={
          "inline-flex items-center gap-1 max-w-full hover:text-ink transition-colors " +
          (active ? "text-brand" : "")
        }
      >
        <span className={width ? "truncate" : ""}>{label}</span>
        <SortIcon active={active} dir={dir} />
      </Link>
      {resizable && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
          onMouseDown={onResizeStart}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/40 active:bg-brand/60"
        />
      )}
    </th>
  );
}

type MetricColumn = (typeof METRIC_COLUMNS)[number];

/**
 * One group's header cells: a non-sortable "Rate" column (when shown) leading
 * the group, then its sortable metric headers. The leading column owns the
 * group's left border so the divider lands between platform groups.
 */
function RateAndMetricsHead({
  scope,
  showRate,
  visibleMetrics,
  sort,
  sortHref,
  SortIcon,
}: {
  scope: string;
  showRate: boolean;
  visibleMetrics: MetricColumn[];
  sort: { key: string; dir: SortDir };
  sortHref: (key: string) => string;
  SortIcon: (props: { active: boolean; dir: SortDir }) => React.ReactElement;
}) {
  return (
    <>
      {showRate && (
        <>
          {/* Thin Status column leads the group (owns the divider). Sortable
              per platform (by that platform's status); the blended total has no
              per-platform status, so its header is plain text. */}
          {scope === "total" ? (
            <th className="font-medium px-2 py-2 text-center border-l border-line text-ink-3">
              St.
            </th>
          ) : (
            <th
              className="font-medium px-2 py-2 text-center border-l border-line"
              title="Status on this platform — N: new · A: active · P: pause · T: terminated"
            >
              <Link
                href={sortHref(`${scope}.status`)}
                scroll={false}
                className={
                  "inline-flex items-center gap-1 hover:text-ink transition-colors " +
                  (sort.key === `${scope}.status` ? "text-brand" : "")
                }
              >
                St.
                <SortIcon active={sort.key === `${scope}.status`} dir={sort.dir} />
              </Link>
            </th>
          )}
          <th
            className="font-medium px-3 py-2 whitespace-nowrap text-center"
            title="Derived from ROAS and the spend gate in Configuration → Rate rules."
          >
            <Link
              href={sortHref(`${scope}.rate`)}
              scroll={false}
              className={
                "inline-flex items-center gap-1 hover:text-ink transition-colors " +
                (sort.key === `${scope}.rate` ? "text-brand" : "")
              }
            >
              Rate
              <SortIcon active={sort.key === `${scope}.rate`} dir={sort.dir} />
            </Link>
          </th>
        </>
      )}
      {visibleMetrics.map((m, i) => (
        <SortableTh
          key={`${scope}.${m.key}`}
          label={m.label}
          active={sort.key === `${scope}.${m.key}`}
          dir={sort.dir}
          href={sortHref(`${scope}.${m.key}`)}
          icon={SortIcon}
          groupBorder={i === 0 && !showRate}
        />
      ))}
    </>
  );
}

/** A right-aligned, sortable numeric metric header. */
function SortableTh({
  label,
  active,
  dir,
  href,
  icon: SortIcon,
  groupBorder = false,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  href: string;
  icon: (props: { active: boolean; dir: SortDir }) => React.ReactElement;
  groupBorder?: boolean;
}) {
  return (
    <th
      className={
        "font-medium px-3 py-2 whitespace-nowrap text-right " +
        (groupBorder ? "border-l border-line " : "")
      }
    >
      <Link
        href={href}
        scroll={false}
        className={
          "inline-flex items-center gap-1 hover:text-ink transition-colors " +
          (active ? "text-brand" : "")
        }
      >
        {label}
        <SortIcon active={active} dir={dir} />
      </Link>
    </th>
  );
}

/**
 * One group's body cells for a single creative: the Rate badge (when shown)
 * then the metric values. `muted` dims the blended-total group.
 */
function RateAndMetricsCells({
  scope,
  block,
  platformStatus,
  showRate,
  ratingConfig,
  visibleMetrics,
  muted = false,
}: {
  scope: string;
  block: PlatformMetricBlock | undefined;
  /** This creative's status on this platform.
   *  undefined → "total" group (no dot); "new" → never ran on this platform. */
  platformStatus?: PlatformStatus | "new";
  showRate: boolean;
  ratingConfig: RatingConfig;
  visibleMetrics: MetricColumn[];
  muted?: boolean;
}) {
  // The per-platform status square: a letter chip (state in its title),
  // including "new" (grey "N"). Undefined for the blended "total" group.
  const statusSquare = platformStatus ? (
    <StatusSquare status={platformStatus} />
  ) : null;
  return (
    <>
      {showRate && (
        <>
          {/* Thin Status column leads the group (owns the divider). */}
          <td className="px-2 py-2 text-center whitespace-nowrap border-l border-line">
            {statusSquare}
          </td>
          <td className="px-3 py-2 text-center whitespace-nowrap">
            <RateBadge block={block} rules={rulesForScope(ratingConfig, scope)} />
          </td>
        </>
      )}
      {visibleMetrics.map((m, mi) => {
        const v = block ? pickMetric(block, m.key) : null;
        // When the Rate (and Status) columns are hidden, the status chip rides
        // along in the first metric cell so it never fully disappears.
        const leadsGroup = mi === 0 && !showRate;
        return (
          <td
            key={`${scope}.${m.key}`}
            className={
              "px-3 py-2 text-right whitespace-nowrap tabular-nums " +
              (muted ? "text-ink-2 " : "text-ink ") +
              (leadsGroup ? "border-l border-line" : "")
            }
          >
            {leadsGroup && statusSquare ? (
              <span className="inline-flex items-center justify-end gap-1.5">
                {statusSquare}
                {m.format(v)}
              </span>
            ) : (
              m.format(v)
            )}
          </td>
        );
      })}
    </>
  );
}

/**
 * Sum component metrics across a set of blocks and recompute the weighted
 * ratios (per the aggregation rules — never an average of per-row ratios).
 * Hook/Hold rates need video-view component sums that the block doesn't carry,
 * so they're returned null (render as "—").
 */
function aggregateBlocks(
  blocks: Array<PlatformMetricBlock | undefined>,
): PlatformMetricBlock {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let hasConv = false;
  let conversionValue = 0;
  let hasConvVal = false;
  let landingPageViews = 0;
  for (const b of blocks) {
    if (!b) continue;
    spend += b.spend ?? 0;
    impressions += b.impressions ?? 0;
    clicks += b.clicks ?? 0;
    landingPageViews += b.landingPageViews ?? 0;
    if (b.conversions !== null && b.conversions !== undefined) {
      conversions += b.conversions;
      hasConv = true;
    }
    if (b.conversionValue !== null && b.conversionValue !== undefined) {
      conversionValue += b.conversionValue;
      hasConvVal = true;
    }
  }
  return {
    spend,
    impressions,
    clicks,
    conversions: hasConv ? conversions : null,
    conversionValue: hasConvVal ? conversionValue : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpa: hasConv && conversions > 0 ? spend / conversions : null,
    roas: hasConvVal && spend > 0 ? conversionValue / spend : null,
    hookRate: null,
    holdRate: null,
    completeRate: null,
    landingPageViews,
    voc: clicks > 0 ? landingPageViews / clicks : null,
    cvr: hasConv && landingPageViews > 0 ? conversions / landingPageViews : null,
  };
}

/** Footer (totals) cells for one group — mirrors RateAndMetricsCells column-for-column. */
function FooterCells({
  scope,
  block,
  showRate,
  visibleMetrics,
  muted = false,
}: {
  scope: string;
  block: PlatformMetricBlock | undefined;
  showRate: boolean;
  visibleMetrics: MetricColumn[];
  muted?: boolean;
}) {
  return (
    <>
      {showRate && (
        <>
          <td className="sticky bottom-0 z-10 bg-surface-2 px-2 py-2 text-center border-l border-line text-ink-3">
            —
          </td>
          <td className="sticky bottom-0 z-10 bg-surface-2 px-3 py-2 text-center whitespace-nowrap text-ink-3">
            —
          </td>
        </>
      )}
      {visibleMetrics.map((m, mi) => {
        const v = block ? pickMetric(block, m.key) : null;
        return (
          <td
            key={`foot.${scope}.${m.key}`}
            className={
              "sticky bottom-0 z-10 bg-surface-2 px-3 py-2 text-right whitespace-nowrap tabular-nums font-semibold " +
              (muted ? "text-ink-2 " : "text-ink ") +
              (mi === 0 && !showRate ? "border-l border-line" : "")
            }
          >
            {m.format(v)}
          </td>
        );
      })}
    </>
  );
}
