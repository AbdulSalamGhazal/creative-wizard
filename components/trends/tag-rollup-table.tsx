"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Columns3, Hash } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeltaBadge } from "@/components/kpi/delta-badge";
import { int, pct, ratio, usd } from "@/lib/format";
import { computeDelta, type Delta } from "@/lib/period";
import { cn } from "@/lib/utils";
import type { TagMetrics, TagRollupRow } from "@/db/queries/trends";

type Num = number | null;
const DASH = "—";
const fUsd = (v: Num) => (v === null ? DASH : usd(v));
const fPct = (v: Num) => (v === null ? DASH : pct(v));
const fRatio = (v: Num) => (v === null ? DASH : `${ratio(v)}×`);
const fInt = (v: Num) => (v === null ? DASH : int(v));

type Key = keyof TagMetrics;

interface Col {
  key: Key;
  label: string;
  fmt: (v: Num) => string;
  /** Lower is better (ranks ascending; delta colours invert). */
  lower?: boolean;
}

// Every numeric column (Tag is the row label, shown separately).
const COLS: Col[] = [
  { key: "creatives", label: "Creatives", fmt: fInt },
  { key: "spend", label: "Spend", fmt: fUsd },
  { key: "impressions", label: "Impr", fmt: fInt },
  { key: "clicks", label: "Clicks", fmt: fInt },
  { key: "conversions", label: "Conv", fmt: fInt },
  { key: "revenue", label: "Revenue", fmt: fUsd },
  { key: "ctr", label: "CTR", fmt: fPct },
  { key: "cvr", label: "CvR", fmt: fPct },
  { key: "cpa", label: "CPA", fmt: fUsd, lower: true },
  { key: "cpm", label: "CPM", fmt: fUsd, lower: true },
  { key: "cpc", label: "CPC", fmt: fUsd, lower: true },
  { key: "roas", label: "ROAS", fmt: fRatio },
  { key: "voc", label: "VOC", fmt: fPct },
  { key: "hookRate", label: "Hook", fmt: fPct },
  { key: "holdRate", label: "Hold", fmt: fPct },
  { key: "completeRate", label: "Complete", fmt: fPct },
  { key: "aov", label: "AOV", fmt: fUsd },
];

const DEFAULT_VISIBLE = new Set<Key>([
  "creatives", "spend", "conversions", "ctr", "cvr", "cpa", "roas", "hookRate",
]);

type SortKey = Key | "tag";
type Mode = "values" | "rank" | "avg" | "prev";

const MODES: { k: Mode; label: string }[] = [
  { k: "values", label: "Values" },
  { k: "rank", label: "Rank" },
  { k: "avg", label: "Vs avg" },
  { k: "prev", label: "Vs prev" },
];

const ABSENT: Delta = { pct: null, mode: "absent" };

export function TagRollupTable({ rows }: { rows: TagRollupRow[] }) {
  const [visible, setVisible] = useState<Set<Key>>(new Set(DEFAULT_VISIBLE));
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [mode, setMode] = useState<Mode>("values");

  const shown = COLS.filter((c) => visible.has(c.key));

  // Per-column rank maps (good direction) and cross-tag averages — recomputed
  // from the full set, independent of the sort order.
  const { rankMaps, avgs } = useMemo(() => {
    const rankMaps: Record<string, Map<string, number>> = {};
    const avgs: Record<string, number | null> = {};
    for (const c of COLS) {
      const vals = rows
        .map((r) => ({ tag: r.tag, v: r[c.key] as Num }))
        .filter((x): x is { tag: string; v: number } => x.v !== null);
      const sorted = [...vals].sort((a, b) => (c.lower ? a.v - b.v : b.v - a.v));
      const m = new Map<string, number>();
      sorted.forEach((x, i) => m.set(x.tag, i + 1));
      rankMaps[c.key] = m;
      avgs[c.key] = vals.length ? vals.reduce((s, x) => s + x.v, 0) / vals.length : null;
    }
    return { rankMaps, avgs };
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "tag") {
        const cmp = a.tag.localeCompare(b.tag);
        return dir === "asc" ? cmp : -cmp;
      }
      const av = (a[sortKey] as Num) ?? 0;
      const bv = (b[sortKey] as Num) ?? 0;
      return dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortKey, dir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setDir(key === "tag" ? "asc" : "desc"); }
  };
  const toggleCol = (key: Key) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No tagged creatives in this window.</p>
      </div>
    );
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null : dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;

  // Every mode keeps the value visible; non-default modes append an indicator.
  const cell = (r: TagRollupRow, c: Col) => {
    const v = r[c.key] as Num;
    const value = <span className="text-ink">{c.fmt(v)}</span>;
    if (mode === "values") return value;
    if (mode === "rank") {
      const rk = rankMaps[c.key]?.get(r.tag);
      return (
        <>
          {value}
          {rk ? (
            <span
              className={cn(
                "inline-flex items-center h-4 px-1 rounded text-[10px] border tabular-nums",
                rk <= 3
                  ? "border-brand/40 text-brand bg-[var(--brand-soft)]"
                  : "border-line-2 text-ink-3",
              )}
            >
              #{rk}
            </span>
          ) : null}
        </>
      );
    }
    if (mode === "avg") {
      const avg = avgs[c.key] ?? null;
      const delta: Delta =
        v === null || avg === null || avg === 0 ? ABSENT : { pct: (v - avg) / avg, mode: "pct" };
      return (
        <>
          {value}
          <DeltaBadge delta={delta} inverted={c.lower} />
        </>
      );
    }
    // prev
    const prevV = r.prev ? ((r.prev[c.key] as Num) ?? null) : null;
    return (
      <>
        {value}
        <DeltaBadge delta={r.prev ? computeDelta(v, prevV) : ABSENT} inverted={c.lower} />
      </>
    );
  };

  const modeHint =
    mode === "rank" ? "Each cell is the tag's rank among all tags for that metric."
    : mode === "avg" ? "Each cell is the delta vs the average tag this period."
    : mode === "prev" ? "Each cell is the delta vs the previous period."
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-xs">
          {MODES.map((m) => (
            <button
              key={m.k}
              type="button"
              onClick={() => setMode(m.k)}
              className={cn(
                "px-2.5 py-1 rounded transition-colors",
                mode === m.k ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {modeHint && <span className="text-[11px] text-ink-3 hidden md:inline">{modeHint}</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line text-xs text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink transition-colors">
                <Columns3 className="w-3.5 h-3.5" /> Columns <span className="text-ink-3">{shown.length}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 max-h-96 overflow-y-auto">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={visible.has(c.key)}
                  onCheckedChange={() => toggleCol(c.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">
                <button type="button" onClick={() => toggleSort("tag")} className="inline-flex items-center gap-1 hover:text-ink">
                  Tag <SortIcon k="tag" />
                </button>
              </th>
              {shown.map((c) => (
                <th key={c.key} className="font-medium px-3 py-2.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={cn("inline-flex items-center gap-1 flex-row-reverse hover:text-ink", sortKey === c.key && "text-ink")}
                  >
                    {c.label} <SortIcon k={c.key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => (
              <tr key={r.tag} className="hover:bg-surface-2/60 transition-colors">
                <td className="px-3 py-2.5">
                  <Link
                    href={`/creatives?tags=${encodeURIComponent(r.tag)}`}
                    className="inline-flex items-center gap-1.5 text-ink hover:text-brand transition-colors"
                  >
                    <Hash className="w-3 h-3 text-ink-3" />
                    {r.tag}
                  </Link>
                </td>
                {shown.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 text-right text-ink tabular-nums whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-1.5">{cell(r, c)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
