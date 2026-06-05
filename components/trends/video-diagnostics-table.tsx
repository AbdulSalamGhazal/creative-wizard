"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { int, pct, ratio, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/creative/status-badge";
import type { VideoDiagnosticRow } from "@/db/queries/trends";

const DASH = "—";
type Num = number | null;
const fUsd = (v: Num) => (v === null ? DASH : usd(v));
const fPct = (v: Num) => (v === null ? DASH : pct(v));
const fRatio = (v: Num) => (v === null ? DASH : `${ratio(v)}×`);
const fInt = (v: Num) => (v === null ? DASH : int(v));

type Key = Exclude<keyof VideoDiagnosticRow, "creativeId" | "name">;

interface Col {
  key: Key;
  label: string;
  kind: "num" | "text" | "status";
  fmt?: (v: Num) => string;
  /** Flag amber when below this median (the funnel-rate columns). */
  median?: "hook" | "hold" | "complete";
}

const COLS: Col[] = [
  { key: "productName", label: "Product", kind: "text" },
  { key: "status", label: "Status", kind: "status" },
  { key: "spend", label: "Spend", kind: "num", fmt: fUsd },
  { key: "impressions", label: "Impr", kind: "num", fmt: fInt },
  { key: "hookRate", label: "Hook", kind: "num", fmt: fPct, median: "hook" },
  { key: "ret25", label: "25%", kind: "num", fmt: fPct },
  { key: "holdRate", label: "Hold (50%)", kind: "num", fmt: fPct, median: "hold" },
  { key: "ret75", label: "75%", kind: "num", fmt: fPct },
  { key: "completeRate", label: "Complete", kind: "num", fmt: fPct, median: "complete" },
  { key: "ctr", label: "CTR", kind: "num", fmt: fPct },
  { key: "cvr", label: "CvR", kind: "num", fmt: fPct },
  { key: "cpa", label: "CPA", kind: "num", fmt: fUsd },
  { key: "roas", label: "ROAS", kind: "num", fmt: fRatio },
  { key: "costPerHook", label: "Cost/hook", kind: "num", fmt: fUsd },
  { key: "costPerCompletion", label: "Cost/compl.", kind: "num", fmt: fUsd },
];

const DEFAULT_VISIBLE = new Set<Key>([
  "productName", "spend", "hookRate", "holdRate", "completeRate", "cvr", "roas",
]);

type SortKey = Key | "name";

export function VideoDiagnosticsTable({
  rows,
  medianHookRate,
  medianHoldRate,
  medianCompleteRate,
}: {
  rows: VideoDiagnosticRow[];
  medianHookRate: number | null;
  medianHoldRate: number | null;
  medianCompleteRate: number | null;
}) {
  const [visible, setVisible] = useState<Set<Key>>(new Set(DEFAULT_VISIBLE));
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const shown = COLS.filter((c) => visible.has(c.key));

  const medianFor = (m?: "hook" | "hold" | "complete") =>
    m === "hook" ? medianHookRate : m === "hold" ? medianHoldRate : m === "complete" ? medianCompleteRate : null;

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortKey === "name") return dir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av).localeCompare(String(bv));
        return dir === "asc" ? cmp : -cmp;
      }
      const an = (av as Num) ?? 0;
      const bn = (bv as Num) ?? 0;
      return dir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sortKey, dir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setDir(k === "name" || k === "productName" || k === "status" ? "asc" : "desc"); }
  };
  const toggleCol = (k: Key) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="text-ink-2 text-sm">No video creatives in this window.</p>
      </div>
    );
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey !== k ? null : dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-3">
          {rows.length} video{rows.length === 1 ? "" : "s"} · sortable · rates below the median are amber
        </span>
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

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">
                <button type="button" onClick={() => toggleSort("name")} className="inline-flex items-center gap-1 hover:text-ink">
                  Video <SortIcon k="name" />
                </button>
              </th>
              {shown.map((c) => (
                <th key={c.key} className={cn("font-medium px-3 py-2.5 whitespace-nowrap", c.kind === "num" ? "text-right" : "text-left")}>
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className={cn("inline-flex items-center gap-1 hover:text-ink", c.kind === "num" && "flex-row-reverse", sortKey === c.key && "text-ink")}
                  >
                    {c.label} <SortIcon k={c.key} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => (
              <tr key={r.creativeId} className="hover:bg-surface-2/60 transition-colors">
                <td className="px-3 py-2.5">
                  <Link href={`/creatives/${encodeURIComponent(r.name)}`} className="text-ink hover:text-brand transition-colors truncate block max-w-[240px]">
                    {r.name}
                  </Link>
                </td>
                {shown.map((c) => {
                  if (c.kind === "status") {
                    return (
                      <td key={c.key} className="px-3 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                    );
                  }
                  if (c.kind === "text") {
                    return <td key={c.key} className="px-3 py-2.5 text-ink-2 truncate max-w-[160px]">{String(r[c.key] ?? DASH)}</td>;
                  }
                  const v = r[c.key] as Num;
                  const med = medianFor(c.median);
                  const below = c.median && v !== null && med !== null && v < med;
                  return (
                    <td key={c.key} className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", below ? "text-warn" : "text-ink")}>
                      {c.fmt!(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
