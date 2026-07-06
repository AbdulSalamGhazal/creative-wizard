"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Circle,
  Clock,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ratio, roas, usd } from "@/lib/format";
import {
  FATIGUE_TIER_ORDER,
  FATIGUE_WINDOWS,
  windowState,
  type FatigueAssessment,
  type FatigueTier,
  type FatigueWindowKey,
  type FatigueWindowMetrics,
} from "@/lib/launch-fatigue";

export interface LaunchFatigueViewRow {
  creativeId: string;
  name: string;
  productName: string;
  type: string;
  launchDate: string;
  derived: boolean;
  daysSinceLaunch: number;
  href: string;
  assessment: FatigueAssessment;
}

const TIER_META: Record<
  FatigueTier,
  { row: string; badge: string; icon: React.ComponentType<{ className?: string }> }
> = {
  fatigued: {
    row: "bg-neg/[0.04]",
    badge: "border-neg/40 bg-neg/10 text-neg",
    icon: TrendingDown,
  },
  improving: {
    row: "bg-pos/[0.03]",
    badge: "border-pos/40 bg-pos/10 text-pos",
    icon: TrendingUp,
  },
  holding: {
    row: "",
    badge: "border-line bg-surface-2 text-ink-2",
    icon: Minus,
  },
  new: {
    row: "",
    badge: "border-brand/40 bg-[var(--brand-soft)] text-ink",
    icon: Sparkles,
  },
  low: {
    row: "",
    badge: "border-line bg-surface-2 text-ink-3",
    icon: Minus,
  },
};

function tierLabel(tier: FatigueTier, daysSinceLaunch: number): string {
  switch (tier) {
    case "fatigued":
      return "Fatigued";
    case "improving":
      return "Improving";
    case "holding":
      return "Holding";
    case "low":
      return "Low spend";
    case "new":
      return daysSinceLaunch < 8 ? "Too new" : "Launch only";
  }
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`;
}

/** Total spend across the three windows. */
function totalSpend(a: FatigueAssessment): number {
  return a.w1.spend + a.w2.spend + a.w3.spend;
}

function StatusBadge({
  tier,
  daysSinceLaunch,
}: {
  tier: FatigueTier;
  daysSinceLaunch: number;
}) {
  const meta = TIER_META[tier];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 px-1.5 rounded text-[10px] border whitespace-nowrap",
        meta.badge,
      )}
    >
      <Icon className="w-3 h-3" />
      {tierLabel(tier, daysSinceLaunch)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

/** Portfolio summary across every launch in view: the blended ROAS decay curve,
 *  the net fatigue, and a verdict tally. */
export function LaunchFatigueSummary({
  count,
  totalSpend: spend,
  estimatedCount,
  counts,
  w1,
  w2,
  w3,
  drop,
}: {
  count: number;
  totalSpend: number;
  estimatedCount: number;
  counts: Record<FatigueTier, number>;
  w1: FatigueWindowMetrics;
  w2: FatigueWindowMetrics;
  w3: FatigueWindowMetrics;
  drop: number | null;
}) {
  const chipOrder: FatigueTier[] = [
    "fatigued",
    "holding",
    "improving",
    "new",
    "low",
  ];
  const metricsByKey: Record<FatigueWindowKey, FatigueWindowMetrics> = {
    w1,
    w2,
    w3,
  };
  const bars = FATIGUE_WINDOWS.map((w) => {
    const metrics = metricsByKey[w.key];
    return {
      label: w.short,
      metrics,
      // The launch week is the anchor, so it has no delta of its own.
      delta: w.key === "w1" ? null : deltaVs(metrics.roas, w1.roas),
    };
  });
  const maxRoas = Math.max(0, ...bars.map((b) => b.metrics.roas ?? 0));

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.5fr)_minmax(0,0.75fr)] divide-y divide-line lg:divide-y-0 lg:divide-x">
        {/* Portfolio headline + verdict tally */}
        <div className="p-5 flex flex-col gap-4">
          <div>
            <div className="text-eyebrow text-ink-3">
              Launches in view
            </div>
            <div className="font-display text-3xl text-ink leading-none mt-1.5">
              {count}
            </div>
            <div className="text-[11px] text-ink-3 mt-1.5">
              {usd(spend)} total spend
            </div>
            {estimatedCount > 0 && (
              <div
                className="text-[11px] text-warn/90 mt-1 inline-flex items-center gap-1"
                title="These creatives have no manual launch date, so their launch is estimated from the first day they spent."
              >
                <Clock className="w-3 h-3" />
                {estimatedCount} of {count} launch date
                {count === 1 ? "" : "s"} estimated
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {chipOrder
              .filter((t) => counts[t] > 0)
              .map((t) => {
                const Icon = TIER_META[t].icon;
                return (
                  <span
                    key={t}
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 px-2 rounded-md border text-[11px]",
                      TIER_META[t].badge,
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {tierLabel(t, 99)}
                    <span className="font-semibold tabular-nums">{counts[t]}</span>
                  </span>
                );
              })}
          </div>
        </div>

        {/* Blended ROAS decay — the centerpiece, as a mini bar chart */}
        <div className="p-5">
          <div className="text-eyebrow text-ink-3">
            Blended ROAS by window
          </div>
          <div className="mt-4 flex items-end gap-5">
            {bars.map((b) => (
              <DecayBar
                key={b.label}
                label={b.label}
                metrics={b.metrics}
                delta={b.delta}
                maxRoas={maxRoas}
              />
            ))}
          </div>
        </div>

        {/* Net fatigue */}
        <div className="p-5 flex flex-col justify-center">
          <div className="text-eyebrow text-ink-3">
            Net fatigue
          </div>
          {drop === null ? (
            <div className="font-display text-3xl text-ink-3 leading-none mt-2">—</div>
          ) : (
            <div
              className={cn(
                "font-display text-4xl leading-none mt-2 tabular-nums",
                drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink",
              )}
            >
              {fmtPct(-drop)}
            </div>
          )}
          <div className="text-[11px] text-ink-3 mt-2 leading-snug">
            launch week → latest window, weighted across all spend
          </div>
        </div>
      </div>
    </div>
  );
}

function deltaVs(roas: number | null, baseRoas: number | null): number | null {
  return baseRoas !== null && baseRoas > 0 && roas !== null
    ? (roas - baseRoas) / baseRoas
    : null;
}

/** One bar in the blended-ROAS decay chart. Height ∝ ROAS; the delta vs the
 *  launch week is colored by direction. */
function DecayBar({
  label,
  metrics,
  delta,
  maxRoas,
}: {
  label: string;
  metrics: FatigueWindowMetrics;
  delta: number | null;
  maxRoas: number;
}) {
  const hasData = metrics.roas !== null;
  const heightPct =
    hasData && maxRoas > 0
      ? Math.max(8, Math.round((metrics.roas! / maxRoas) * 100))
      : 0;
  const tone =
    delta === null
      ? "bg-ink-2/40"
      : delta < -0.001
        ? "bg-neg/70"
        : delta > 0.001
          ? "bg-pos/70"
          : "bg-ink-2/40";
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
      <div className="text-sm tabular-nums text-ink font-medium leading-none">
        {hasData ? (
          <>
            {ratio(metrics.roas)}
            <span className="text-ink-3">×</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </div>
      <div className="w-full h-12 flex items-end justify-center">
        <div
          className={cn("w-8 rounded-t-sm transition-all", tone)}
          style={{ height: `${heightPct}%` }}
        />
      </div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3 text-center leading-tight">
        {label}
      </div>
      {delta !== null && (
        <div
          className={cn(
            "text-[11px] tabular-nums leading-none",
            delta < -0.001 ? "text-neg" : delta > 0.001 ? "text-pos" : "text-ink-3",
          )}
        >
          {fmtPct(delta)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table (sortable + drag-to-resize)                                   */
/* ------------------------------------------------------------------ */

const COL_WIDTHS_KEY = "launch-col-widths";
const MIN_COL_WIDTH = 160;

type SortKey =
  | "status"
  | "creative"
  | "launched"
  | "spend"
  | FatigueWindowKey
  | "fatigue";
type Dir = "asc" | "desc";

/** Columns whose first click sorts ascending (the rest sort descending first). */
const ASC_FIRST = new Set<SortKey>(["status", "creative", "launched"]);

const COLUMNS: Array<{
  key: SortKey;
  label: string;
  numeric: boolean;
  resizable?: boolean;
}> = [
  { key: "status", label: "Status", numeric: false },
  { key: "creative", label: "Creative", numeric: false, resizable: true },
  { key: "launched", label: "Launched", numeric: false },
  { key: "spend", label: "Spend", numeric: true },
  ...FATIGUE_WINDOWS.map((w) => ({
    key: w.key as SortKey,
    label: w.label,
    numeric: true,
  })),
  { key: "fatigue", label: "Fatigue", numeric: true },
];

export function LaunchFatigueTable({ rows }: { rows: LaunchFatigueViewRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [dir, setDir] = useState<Dir>("asc");

  // ---- Resizable Creative column (persisted to localStorage) ----
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

  // ---- Sorting (client-side; every row is already loaded) ----
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const c = compareRows(a, b, sortKey);
      return dir === "asc" ? c : -c;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir(ASC_FIRST.has(key) ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No launched creatives match these filters.</p>
        <p className="text-ink-3 text-xs mt-1">
          Widen the launch-date range or clear filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-xs num min-w-max">
          <thead>
            <tr className="text-left text-label text-ink-3 border-b border-line">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const isWindow = col.key === "w1" || col.key === "w2" || col.key === "w3";
                return (
                  <th
                    key={col.key}
                    ref={
                      col.resizable
                        ? (el) => {
                            thRefs.current[col.key] = el;
                          }
                        : undefined
                    }
                    style={col.resizable ? widthStyle(col.key) : undefined}
                    className={cn(
                      "relative font-medium px-3 py-2.5",
                      col.numeric ? "text-right" : "text-left",
                      (col.key === "fatigue" || isWindow) && "border-l border-line",
                      col.resizable && widths[col.key] ? "" : "whitespace-nowrap",
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
                      <span className={col.resizable && widths[col.key] ? "truncate" : ""}>
                        {col.label}
                      </span>
                      <SortIcon active={active} dir={dir} />
                    </button>
                    {col.resizable && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${col.label} column`}
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
            {sorted.map((r) => {
              const a = r.assessment;
              const drop = a.drop;
              return (
                <tr
                  key={r.creativeId}
                  className={cn(
                    "hover:bg-surface-2/40 transition-colors",
                    TIER_META[a.tier].row,
                    a.tier === "low" && "opacity-60",
                  )}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <StatusBadge tier={a.tier} daysSinceLaunch={r.daysSinceLaunch} />
                  </td>
                  <td
                    style={widthStyle("creative")}
                    className={cn("px-3 py-2.5", widths.creative ? "" : "max-w-[20rem]")}
                  >
                    <Link
                      href={r.href}
                      title={r.name}
                      className="block truncate font-medium text-ink hover:text-brand transition-colors"
                    >
                      {r.name}
                    </Link>
                    <div className="text-[11px] text-ink-3 truncate">
                      {r.productName} · {r.type}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn("tabular-nums", r.derived ? "text-ink-2 italic" : "text-ink-2")}
                        title={
                          r.derived
                            ? undefined
                            : "Manual launch date set on the creative."
                        }
                      >
                        {r.derived ? "≈ " : ""}
                        {r.launchDate}
                      </span>
                      {r.derived && (
                        <span
                          className="text-[9px] leading-none px-1 py-0.5 rounded border border-warn/30 text-warn/90 bg-warn/5"
                          title="Estimated from the first day with spend — no manual launch date is set on this creative."
                        >
                          est.
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-ink-3">{r.daysSinceLaunch}d ago</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-2 whitespace-nowrap">
                    {usd(totalSpend(a))}
                  </td>
                  {FATIGUE_WINDOWS.map((w) => (
                    <WindowCell
                      key={w.key}
                      label={w.label}
                      metrics={a[w.key]}
                      state={windowState(r.daysSinceLaunch, w.startDay, w.endDay)}
                      daysSinceLaunch={r.daysSinceLaunch}
                      w1Roas={w.key === "w1" ? null : a.w1.roas}
                    />
                  ))}
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-line">
                    {drop === null ? (
                      <span
                        className="text-ink-3"
                        title="Not enough history yet to measure decay."
                      >
                        —
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "font-medium",
                          drop > 0.001 ? "text-neg" : drop < -0.001 ? "text-pos" : "text-ink-2",
                        )}
                      >
                        {fmtPct(-drop)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FatigueLegend />
    </div>
  );
}

/** A window cell. Distinguishes "window hasn't started yet" from "ran but spent
 *  nothing here" from "window still in progress" — see point 2. */
function WindowCell({
  label,
  metrics,
  state,
  daysSinceLaunch,
  w1Roas,
}: {
  label: string;
  metrics: FatigueWindowMetrics;
  state: "not_started" | "in_progress" | "complete";
  daysSinceLaunch: number;
  w1Roas: number | null;
}) {
  const cell = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap border-l border-line";

  if (state === "not_started") {
    return (
      <td
        className={cell}
        title={`${label} haven’t elapsed yet — launched ${daysSinceLaunch}d ago.`}
      >
        <span className="text-ink-3/40">–</span>
      </td>
    );
  }

  if (metrics.roas === null) {
    // The window has begun (in progress or complete) but there was no spend.
    const title =
      state === "in_progress"
        ? `${label}: no spend yet — window still in progress.`
        : `${label}: no spend — paused or off during this window.`;
    return (
      <td className={cell} title={title}>
        <Circle className="inline w-3 h-3 text-ink-3/70" aria-hidden />
      </td>
    );
  }

  const delta = deltaVs(metrics.roas, w1Roas);
  return (
    <td className={cell}>
      <span className="text-ink inline-flex items-center justify-end gap-1">
        {state === "in_progress" && (
          <span
            title={`${label} still in progress — ROAS so far, through day ${daysSinceLaunch + 1}.`}
            className="inline-flex"
          >
            <Clock className="w-3 h-3 text-ink-3/70" aria-hidden />
          </span>
        )}
        <span>
          {roas(metrics.roas)}
          {delta !== null && (
            <span
              className={cn(
                "ml-1 text-[11px]",
                delta < -0.001 ? "text-neg" : delta > 0.001 ? "text-pos" : "text-ink-3",
              )}
            >
              {fmtPct(delta)}
            </span>
          )}
        </span>
      </span>
    </td>
  );
}

function FatigueLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-ink-3/40">–</span> window not started
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Circle className="w-3 h-3 text-ink-3/70" /> no spend in window
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock className="w-3 h-3 text-ink-3/70" /> window in progress (partial ROAS)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[9px] px-1 py-0.5 rounded border border-warn/30 text-warn/90 bg-warn/5">
          est.
        </span>
        launch estimated from first spend day
      </span>
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

/** Comparator for the table. `status` reproduces the default tiered order
 *  (worst-first, biggest drop first, then newest launch). */
function compareRows(
  a: LaunchFatigueViewRow,
  b: LaunchFatigueViewRow,
  key: SortKey,
): number {
  const aa = a.assessment;
  const bb = b.assessment;
  switch (key) {
    case "creative":
      return a.name.localeCompare(b.name);
    case "launched":
      return a.launchDate.localeCompare(b.launchDate);
    case "spend":
      return totalSpend(aa) - totalSpend(bb);
    case "w1":
    case "w2":
    case "w3":
      return (aa[key].roas ?? 0) - (bb[key].roas ?? 0);
    case "fatigue":
      return (aa.drop ?? 0) - (bb.drop ?? 0);
    case "status": {
      const r = FATIGUE_TIER_ORDER[aa.tier] - FATIGUE_TIER_ORDER[bb.tier];
      if (r !== 0) return r;
      // Within a tier: biggest drop first (nulls last), then newest launch.
      const av = aa.drop ?? -Infinity;
      const bv = bb.drop ?? -Infinity;
      if (av !== bv) return bv - av;
      return b.launchDate.localeCompare(a.launchDate);
    }
  }
}
