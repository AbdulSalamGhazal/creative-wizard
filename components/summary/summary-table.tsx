import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { int, pct, ratio, usd } from "@/lib/format";
import type {
  PlatformMetricBlock,
  SummaryRow,
} from "@/db/queries/summary";
import {
  type IdentityColumnKey,
  type MetricColumnKey,
  type SortDir,
} from "@/validators/summary";

interface Props {
  rows: SummaryRow[];
  platforms: string[];
  /** Current effective sort, post-server-validation. */
  sort: { key: string; dir: SortDir };
  /** Path the column headers should link to with updated sort params. */
  pathname: string;
  /** Other URL params we want to preserve when toggling sort. */
  baseParams: URLSearchParams;
  /** Identity columns to suppress (Creative name is always shown). */
  hiddenIdentity?: Set<IdentityColumnKey>;
  /** Metric columns to suppress — applies to every platform + total group. */
  hiddenMetrics?: Set<MetricColumnKey>;
}

const STATUS_CLASS: Record<SummaryRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

// Metric column definitions: key suffix, label, formatter, alignment.
// These are reused for every platform block AND for the total/blended
// block at the right — so the column shape is consistent across the table.
type MetricFormatter = (v: number | null) => string;

const METRIC_COLUMNS: Array<{
  key: string;
  label: string;
  format: MetricFormatter;
}> = [
  { key: "spend", label: "Spend", format: (v) => (v && v > 0 ? usd(v) : "—") },
  { key: "impressions", label: "Imp.", format: (v) => (v && v > 0 ? int(v) : "—") },
  { key: "clicks", label: "Clicks", format: (v) => (v && v > 0 ? int(v) : "—") },
  { key: "conversions", label: "Conv.", format: (v) => (v && v > 0 ? int(v) : "—") },
  { key: "ctr", label: "CTR", format: (v) => pct(v) },
  { key: "cpm", label: "CPM", format: (v) => usd(v) },
  { key: "cpc", label: "CPC", format: (v) => usd(v) },
  { key: "cpa", label: "CPA", format: (v) => usd(v) },
  { key: "roas", label: "ROAS", format: (v) => (v === null ? "—" : `${ratio(v)}×`) },
  { key: "hook_rate", label: "Hook", format: (v) => pct(v) },
  { key: "hold_rate", label: "Hold", format: (v) => pct(v) },
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
  }
  return null;
}

/**
 * The dense Summary table. Sticky first column (creative name), platform
 * group headers, every metric repeated per platform side-by-side, plus a
 * blended total block when 2+ platforms are selected.
 *
 * Every metric column header is a Link that toggles the URL sort param —
 * one click = sort by this column descending, click again = ascending,
 * third click = restore default.
 */
export function SummaryTable({
  rows,
  platforms,
  sort,
  pathname,
  baseParams,
  hiddenIdentity,
  hiddenMetrics,
}: Props) {
  const showTotal = platforms.length >= 2;
  const visibleMetrics = METRIC_COLUMNS.filter(
    (m) => !hiddenMetrics?.has(m.key as MetricColumnKey),
  );
  const visibleMetricCount = visibleMetrics.length;

  const sortHref = (key: string): string => {
    const next = new URLSearchParams(baseParams);
    if (sort.key === key) {
      // Cycle: desc → asc → reset
      if (sort.dir === "desc") {
        next.set("sort", key);
        next.set("dir", "asc");
      } else {
        next.delete("sort");
        next.delete("dir");
      }
    } else {
      next.set("sort", key);
      next.set("dir", "desc");
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
          Try widening the date range, removing filters, or selecting more
          platforms.
        </p>
      </div>
    );
  }

  // Identity columns shown as the sticky-ish left pane. We render them as
  // ordinary cells (not sticky CSS) because mixing position:sticky with
  // sortable headers across horizontal scroll can flicker — the table is
  // wide enough that the user scrolls horizontally anyway.
  //
  // The Creative name column is mandatory — it's the row identity. Every
  // other identity column can be hidden via the URL.
  const ALL_IDENTITY_COLS: Array<{
    key: string;
    label: string;
    /** When set, hiding controlled by hiddenIdentity. */
    hideKey?: IdentityColumnKey;
  }> = [
    { key: "name", label: "Creative" },
    { key: "product", label: "Product", hideKey: "product" },
    { key: "type", label: "Type", hideKey: "type" },
    { key: "status", label: "Status", hideKey: "status" },
    { key: "creator", label: "Creator", hideKey: "creator" },
  ];
  const identityCols = ALL_IDENTITY_COLS.filter(
    (c) => !c.hideKey || !hiddenIdentity?.has(c.hideKey),
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="text-[12px] num min-w-max">
        {/* Two-row header: top row = group banners; bottom = column labels */}
        <thead>
          <tr className="border-b border-line bg-surface-2/40">
            {/* Identity group spans 5 cols + has no group label */}
            <th
              colSpan={identityCols.length}
              className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-3 text-left"
            >
              Creative
            </th>
            {visibleMetricCount > 0 &&
              platforms.map((pf) => (
                <th
                  key={pf}
                  colSpan={visibleMetricCount}
                  className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] border-l border-line text-left"
                  style={{
                    color: PLATFORM_COLOR[pf as keyof typeof PLATFORM_COLOR],
                  }}
                >
                  {PLATFORM_LABEL[pf as keyof typeof PLATFORM_LABEL]}
                </th>
              ))}
            {showTotal && visibleMetricCount > 0 && (
              <th
                colSpan={visibleMetricCount}
                className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-2 border-l border-line text-left"
                title="Weighted aggregate across the selected platforms."
              >
                Blended total
              </th>
            )}
          </tr>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.14em] text-ink-3">
            {identityCols.map((c) => (
              <SortableTh
                key={c.key}
                label={c.label}
                active={sort.key === c.key}
                dir={sort.dir}
                href={sortHref(c.key)}
                icon={SortIcon}
              />
            ))}
            {platforms.map((pf) =>
              visibleMetrics.map((m, i) => (
                <SortableTh
                  key={`${pf}.${m.key}`}
                  label={m.label}
                  numeric
                  active={sort.key === `${pf}.${m.key}`}
                  dir={sort.dir}
                  href={sortHref(`${pf}.${m.key}`)}
                  icon={SortIcon}
                  groupBorder={i === 0}
                  groupIndex={i}
                />
              )),
            )}
            {showTotal &&
              visibleMetrics.map((m, i) => (
                <SortableTh
                  key={`total.${m.key}`}
                  label={m.label}
                  numeric
                  active={sort.key === `total.${m.key}`}
                  dir={sort.dir}
                  href={sortHref(`total.${m.key}`)}
                  icon={SortIcon}
                  groupBorder={i === 0}
                  groupIndex={i}
                />
              ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr
              key={r.creativeId}
              className="hover:bg-surface-2/40 transition-colors"
            >
              {/* Identity — render only the visible columns */}
              {identityCols.map((c) => {
                switch (c.key) {
                  case "name":
                    return (
                      <td key="name" className="px-3 py-2 whitespace-nowrap">
                        <Link
                          href={`/creatives/${encodeURIComponent(r.name)}`}
                          className="font-mono text-ink text-[12px] hover:text-brand transition-colors"
                        >
                          {r.name}
                        </Link>
                      </td>
                    );
                  case "product":
                    return (
                      <td
                        key="product"
                        className="px-3 py-2 text-ink-2 whitespace-nowrap"
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
                  case "status":
                    return (
                      <td key="status" className="px-3 py-2 whitespace-nowrap">
                        <Badge
                          variant="outline"
                          className={STATUS_CLASS[r.status]}
                        >
                          {r.status}
                        </Badge>
                      </td>
                    );
                  case "creator":
                    return (
                      <td
                        key="creator"
                        className="px-3 py-2 text-ink-3 whitespace-nowrap"
                      >
                        {r.creatorName ?? "—"}
                      </td>
                    );
                  default:
                    return null;
                }
              })}

              {/* Per platform */}
              {platforms.map((pf) => {
                const block = r.perPlatform[pf as keyof typeof r.perPlatform];
                return visibleMetrics.map((m, mi) => {
                  const v = block ? pickMetric(block, m.key) : null;
                  return (
                    <td
                      key={`${pf}.${m.key}`}
                      className={
                        "px-3 py-2 text-right text-ink whitespace-nowrap tabular-nums " +
                        (mi === 0 ? "border-l border-line" : "")
                      }
                    >
                      {m.format(v)}
                    </td>
                  );
                });
              })}

              {/* Blended total */}
              {showTotal &&
                visibleMetrics.map((m, mi) => {
                  const v = pickMetric(r.total, m.key);
                  return (
                    <td
                      key={`total.${m.key}`}
                      className={
                        "px-3 py-2 text-right text-ink-2 whitespace-nowrap tabular-nums " +
                        (mi === 0 ? "border-l border-line" : "")
                      }
                    >
                      {m.format(v)}
                    </td>
                  );
                })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  numeric = false,
  active,
  dir,
  href,
  icon: SortIcon,
  groupBorder = false,
  groupIndex = 0,
}: {
  label: string;
  numeric?: boolean;
  active: boolean;
  dir: SortDir;
  href: string;
  icon: (props: { active: boolean; dir: SortDir }) => React.ReactElement;
  groupBorder?: boolean;
  groupIndex?: number;
}) {
  return (
    <th
      className={
        "font-medium px-3 py-2 whitespace-nowrap " +
        (numeric ? "text-right " : "text-left ") +
        (groupBorder && groupIndex === 0 ? "border-l border-line " : "")
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
