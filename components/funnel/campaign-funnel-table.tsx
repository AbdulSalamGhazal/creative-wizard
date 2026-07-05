"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, pct, ratio, usd } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metric-labels";
import { PLATFORM_LABEL } from "@/lib/palette";
import { PlatformDot } from "@/components/ui/platform-dot";
import { cn } from "@/lib/utils";
import type { CampaignFunnelRow } from "@/db/queries/funnel";

const COL_WIDTHS_KEY = "funnel-col-widths";
const MIN_COL_WIDTH = 140;

type SortKey =
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
  | "impressions";
type Dir = "asc" | "desc";

const TEXT_KEYS = new Set<SortKey>(["campaign", "platform"]);

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "campaign", label: "Campaign", numeric: false },
  { key: "platform", label: "Platform", numeric: false },
  { key: "spend", label: "Spend", numeric: true },
  { key: "cpm", label: "CPM", numeric: true },
  { key: "ctr", label: "CTR", numeric: true },
  { key: "voc", label: "VOC", numeric: true },
  { key: "atcRate", label: "ATC%", numeric: true },
  { key: "apRate", label: "AP%", numeric: true },
  { key: "purchaseRate", label: "CvR (AP)", numeric: true },
  { key: "cvr", label: "CvR (LP)", numeric: true },
  { key: "conversions", label: METRIC_LABEL.conversions, numeric: true },
  { key: "addToCart", label: "ATC", numeric: true },
  { key: "addPayment", label: "AP", numeric: true },
  { key: "roas", label: "ROAS", numeric: true },
  { key: "impressions", label: METRIC_LABEL.impressions, numeric: true },
];

/**
 * Per-campaign funnel table. One row per (platform, campaign_name). Every
 * column sorts (click to cycle); the Campaign column is drag-resizable with the
 * width persisted to localStorage — same behaviour as the Summary table. Sticky
 * header + footer, internal scroll.
 */
export function CampaignFunnelTable({ rows }: { rows: CampaignFunnelRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [dir, setDir] = useState<Dir>("desc");

  // ---- Resizable Campaign column ----
  const [widths, setWidths] = useState<Record<string, number>>({});
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
  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const measured = thRefs.current[key]?.getBoundingClientRect().width ?? 280;
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

  // ---- Sorting (client-side; all rows are loaded) ----
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "campaign") {
        cmp = a.campaign.localeCompare(b.campaign);
      } else if (sortKey === "platform") {
        cmp =
          PLATFORM_LABEL[a.platform].localeCompare(PLATFORM_LABEL[b.platform]) ||
          a.campaign.localeCompare(b.campaign);
      } else {
        // Null rates sort as 0 (consistent with the Summary table).
        const av = a[sortKey] ?? 0;
        const bv = b[sortKey] ?? 0;
        cmp = av - bv;
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, dir]);

  // Pinned footer: additive columns sum; rate columns are weighted averages
  // recomputed from component sums (never an average of ratios).
  const totals = useMemo(() => {
    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    let lpv = 0;
    let atc = 0;
    let ap = 0;
    let conversions = 0;
    let conversionValue = 0;
    for (const r of rows) {
      spend += r.spend;
      impressions += r.impressions;
      clicks += r.clicks;
      lpv += r.landingPageViews;
      atc += r.addToCart;
      ap += r.addPayment;
      conversions += r.conversions;
      conversionValue += r.conversionValue;
    }
    return {
      spend,
      impressions,
      conversions,
      addToCart: atc,
      addPayment: ap,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      ctr: impressions > 0 ? clicks / impressions : null,
      voc: clicks > 0 ? lpv / clicks : null,
      atcRate: lpv > 0 ? atc / lpv : null,
      apRate: atc > 0 ? ap / atc : null,
      purchaseRate: ap > 0 ? conversions / ap : null,
      cvr: lpv > 0 ? conversions / lpv : null,
      roas: spend > 0 ? conversionValue / spend : null,
    };
  }, [rows]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      // desc → asc → reset to default (spend desc)
      if (dir === "desc") setDir("asc");
      else {
        setSortKey("spend");
        setDir("desc");
      }
    } else {
      setSortKey(key);
      setDir(TEXT_KEYS.has(key) ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No campaign activity in this window.</p>
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm num">
        <thead>
          <tr className="text-left text-label text-ink-3">
            {COLUMNS.map((col) => {
              const active = sortKey === col.key;
              const resizable = col.key === "campaign";
              return (
                <th
                  key={col.key}
                  ref={
                    resizable
                      ? (el) => {
                          thRefs.current[col.key] = el;
                        }
                      : undefined
                  }
                  style={resizable ? widthStyle(col.key) : undefined}
                  className={cn(
                    "relative font-medium px-3 py-2.5 sticky top-0 z-10 bg-surface border-b border-line",
                    col.numeric ? "text-right" : "text-left",
                    resizable && widths[col.key] ? "" : "whitespace-nowrap",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 hover:text-ink transition-colors max-w-full",
                      col.numeric && "justify-end w-full",
                      active && "text-brand",
                    )}
                  >
                    <span className={resizable && widths[col.key] ? "truncate" : ""}>
                      {col.label}
                    </span>
                    <SortIcon active={active} dir={dir} />
                  </button>
                  {resizable && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize Campaign column"
                      onMouseDown={(e) => startResize(col.key, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-brand/40 active:bg-brand/60"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((r) => (
            <tr
              key={`${r.platform}::${r.campaign}`}
              className="hover:bg-surface-2/60 transition-colors"
            >
              <td
                style={widthStyle("campaign")}
                className={cn("px-3 py-2.5", widths.campaign ? "" : "max-w-[22rem]")}
              >
                <span className="block truncate text-ink" title={r.campaign}>
                  {r.campaign}
                </span>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <PlatformDot platform={r.platform} />
                  {PLATFORM_LABEL[r.platform]}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                <span className="inline-flex items-center gap-1.5 justify-end">
                  {usd(r.spend)}
                  <DeltaBadge delta={r.spendDelta} />
                </span>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.cpm)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.voc)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.atcRate)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.apRate)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.purchaseRate)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.cvr)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.conversions)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.addToCart)}</td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.addPayment)}</td>
              <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                {r.roas === null ? "—" : `${ratio(r.roas)}×`}
              </td>
              <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold [&>td]:sticky [&>td]:bottom-0 [&>td]:z-10 [&>td]:bg-surface-2 [&>td]:border-t [&>td]:border-line">
            <td
              style={widthStyle("campaign")}
              className={cn("px-3 py-2 text-ink", widths.campaign ? "truncate" : "")}
            >
              Total · {rows.length}
            </td>
            <td className="px-3 py-2 text-ink-3" />
            <td className="px-3 py-2 text-right text-ink tabular-nums">{usd(totals.spend)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{usd(totals.cpm)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.ctr)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.voc)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.atcRate)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.apRate)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.purchaseRate)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{pct(totals.cvr)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{int(totals.conversions)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{int(totals.addToCart)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{int(totals.addPayment)}</td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">
              {totals.roas === null ? "—" : `${ratio(totals.roas)}×`}
            </td>
            <td className="px-3 py-2 text-right text-ink tabular-nums">{int(totals.impressions)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: Dir }) {
  if (!active) {
    return <ArrowUpDown className="w-3 h-3 text-ink-3 opacity-60" aria-hidden />;
  }
  return dir === "asc" ? (
    <ArrowUp className="w-3 h-3 text-brand" aria-hidden />
  ) : (
    <ArrowDown className="w-3 h-3 text-brand" aria-hidden />
  );
}
