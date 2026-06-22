"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { int, isoDate, pct, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { PortfolioCampaignRow } from "@/db/queries/portfolio";

type Align = "left" | "right";
type SortKey =
  | "campaign"
  | "creatives"
  | "spend"
  | "impressions"
  | "clicks"
  | "orders"
  | "revenue"
  | "cpa"
  | "roas"
  | "aov"
  | "ctr"
  | "cpm"
  | "cvr"
  | "lastDate";

type ColKey = SortKey | "platforms";

interface Col {
  key: ColKey;
  label: string;
  align: Align;
  sortable: boolean;
}

const COLS: Col[] = [
  { key: "campaign", label: "Campaign", align: "left", sortable: true },
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

/** The first column is the pinned identity — not hideable, not reorderable. */
const IDENTITY: ColKey = "campaign";
const DASH = "—";
const MIN_W = 64;

const fUsd = (v: number | null) => (v === null ? DASH : usd(v));
const fRatio = (v: number | null) => (v === null ? DASH : `${ratio(v)}×`);

const SORT_KEYS = new Set<string>(COLS.filter((c) => c.sortable).map((c) => c.key));

/** Hideable columns (everything but the identity column) — for a Columns control. */
export const CAMPAIGN_TABLE_COLUMNS = COLS.filter((c) => c.key !== IDENTITY).map(
  (c) => ({ key: c.key, label: c.label }),
);

/** Reorder the non-identity columns by the saved `order`; identity stays first. */
function orderedColumns(order: string[]): Col[] {
  const rest = COLS.filter((c) => c.key !== IDENTITY);
  const byKey = new Map(rest.map((c) => [c.key as string, c]));
  const out: Col[] = [];
  const seen = new Set<string>();
  for (const k of order) {
    const col = byKey.get(k);
    if (col && !seen.has(k)) {
      out.push(col);
      seen.add(k);
    }
  }
  for (const col of rest) if (!seen.has(col.key)) out.push(col);
  return [COLS.find((c) => c.key === IDENTITY)!, ...out];
}

export function PortfolioTable({
  rows,
  sort = "spend",
  dir: dirProp = "desc",
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

  const sortKey = (SORT_KEYS.has(sort) ? sort : "spend") as SortKey;
  const dir: "asc" | "desc" = dirProp === "asc" ? "asc" : "desc";
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const fullOrder = useMemo(() => orderedColumns(order), [order]);
  const cols = useMemo(
    () => fullOrder.filter((c) => !hiddenSet.has(c.key)),
    [fullOrder, hiddenSet],
  );

  // ── Column widths (drag to resize; ephemeral, like the Summary table) ──
  const [widths, setWidths] = useState<Record<string, number>>({});
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizing.current;
    if (!r) return;
    setWidths((prev) => ({
      ...prev,
      [r.key]: Math.max(MIN_W, r.startW + (e.clientX - r.startX)),
    }));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizing.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }, [onResizeMove]);
  const onResizeStart = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const startW = widths[key] ?? th?.getBoundingClientRect().width ?? 120;
      resizing.current = { key, startX: e.clientX, startW };
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
    },
    [widths, onResizeMove, onResizeEnd],
  );
  const styleFor = (key: string): React.CSSProperties | undefined => {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  // ── Column reorder (drag a header by its grip; persisted in the URL) ──
  const dragKey = useRef<string | null>(null);
  const onDrop = (targetKey: string) => {
    const from = dragKey.current;
    dragKey.current = null;
    if (!from || from === targetKey || from === IDENTITY || targetKey === IDENTITY) return;
    const keys = fullOrder.filter((c) => c.key !== IDENTITY).map((c) => c.key as string);
    const fi = keys.indexOf(from);
    const ti = keys.indexOf(targetKey);
    if (fi < 0 || ti < 0) return;
    keys.splice(fi, 1);
    keys.splice(ti, 0, from);
    const next = new URLSearchParams(searchParams.toString());
    next.set("order", keys.join(","));
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const toggleSort = (key: SortKey) => {
    const nextDir =
      key === sortKey ? (dir === "asc" ? "desc" : "asc") : key === "campaign" ? "asc" : "desc";
    const next = new URLSearchParams(searchParams.toString());
    next.set("sort", key);
    next.set("dir", nextDir);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "campaign") {
        const cmp = a.campaign.localeCompare(b.campaign);
        return dir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "lastDate") {
        const av = a.lastDate ?? "";
        const bv = b.lastDate ?? "";
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "asc" ? cmp : -cmp;
      }
      const av = (a[sortKey] as number | null) ?? 0;
      const bv = (b[sortKey] as number | null) ?? 0;
      return dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, dir]);

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

  if (rows.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-ink-3 text-sm border border-dashed border-line rounded-lg">
        No campaigns match these filters.
      </div>
    );
  }

  const cell = (r: PortfolioCampaignRow, key: ColKey) => {
    switch (key) {
      case "campaign":
        return <span className="text-ink truncate block max-w-[260px]">{r.campaign}</span>;
      case "platforms":
        return (
          <span className="inline-flex items-center gap-1">
            {r.platforms.map((p) => (
              <span
                key={p}
                className="w-2 h-2 rounded-full"
                style={{ background: PLATFORM_COLOR[p] }}
                title={PLATFORM_LABEL[p]}
              />
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
    }
  };

  const totalCell = (key: ColKey) => {
    switch (key) {
      case "campaign":
        return <span className="text-ink-2 font-medium">Totals · weighted</span>;
      case "platforms":
        return null;
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
      case "lastDate":
        return null;
    }
  };

  // border-l on every column after the first → full vertical grid like Summary.
  const colBorder = (i: number) => (i > 0 ? "border-l border-line" : "");
  const stickyId = (key: ColKey, bg: string) =>
    key === IDENTITY ? `sticky left-0 z-10 ${bg}` : "";

  return (
    <div className="rounded-lg border border-line bg-surface overflow-auto max-h-[70vh]">
      <table className="min-w-[1180px] w-full text-[12px] num">
        <thead className="sticky top-0 z-20 bg-surface">
          <tr className="text-[11px] uppercase tracking-[0.12em] text-ink-3 border-b border-line bg-surface-2/40">
            {cols.map((c, i) => {
              const reorderable = c.key !== IDENTITY;
              return (
                <th
                  key={c.key}
                  style={styleFor(c.key)}
                  onDragOver={reorderable ? (e) => e.preventDefault() : undefined}
                  onDrop={reorderable ? () => onDrop(c.key) : undefined}
                  className={cn(
                    "group/th relative font-medium px-3 py-2 whitespace-nowrap bg-surface-2/40",
                    c.align === "right" ? "text-right" : "text-left",
                    colBorder(i),
                    stickyId(c.key, "z-30 bg-surface-2"),
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      c.align === "right" && "flex-row-reverse",
                    )}
                  >
                    {reorderable && (
                      <span
                        draggable
                        onDragStart={() => {
                          dragKey.current = c.key;
                        }}
                        onDragEnd={() => {
                          dragKey.current = null;
                        }}
                        title="Drag to reorder"
                        className="cursor-grab active:cursor-grabbing text-ink-3/0 group-hover/th:text-ink-3 hover:!text-ink transition-colors"
                      >
                        <GripVertical className="w-3 h-3" />
                      </span>
                    )}
                    {c.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key as SortKey)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-ink transition-colors",
                          sortKey === c.key && "text-ink",
                          c.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {c.label}
                        {sortKey === c.key &&
                          (dir === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          ))}
                      </button>
                    ) : (
                      c.label
                    )}
                  </span>
                  {/* Drag-to-resize handle on the right edge */}
                  <span
                    onMouseDown={(e) => onResizeStart(c.key, e)}
                    title="Drag to resize"
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/40 active:bg-brand/60"
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr
              key={r.campaign}
              onClick={() => router.push(`/campaigns/${encodeURIComponent(r.campaign)}`)}
              className="group hover:bg-surface-2/60 transition-colors cursor-pointer"
            >
              {cols.map((c, i) => (
                <td
                  key={c.key}
                  style={styleFor(c.key)}
                  className={cn(
                    "px-3 py-2 whitespace-nowrap text-ink-2 overflow-hidden text-ellipsis",
                    c.align === "right" ? "text-right tabular-nums" : "text-left",
                    colBorder(i),
                    stickyId(c.key, "bg-surface group-hover:bg-surface-2/60"),
                  )}
                >
                  {cell(r, c.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-10 bg-surface">
          <tr className="border-t-2 border-line text-ink font-medium">
            {cols.map((c, i) => (
              <td
                key={c.key}
                style={styleFor(c.key)}
                className={cn(
                  "px-3 py-2.5 whitespace-nowrap bg-surface",
                  c.align === "right" ? "text-right tabular-nums" : "text-left",
                  colBorder(i),
                  stickyId(c.key, "z-20 bg-surface"),
                )}
              >
                {totalCell(c.key)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
