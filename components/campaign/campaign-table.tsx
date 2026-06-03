"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { int, pct, ratio, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CampaignListRow } from "@/db/queries/campaign";

type SortKey =
  | "campaign"
  | "creatives"
  | "spend"
  | "impressions"
  | "ctr"
  | "conversions"
  | "cvr"
  | "roas"
  | "lastDate";
type Dir = "asc" | "desc";

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "campaign", label: "Campaign", numeric: false },
  { key: "creatives", label: "Creatives", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "impressions", label: "Impr.", numeric: true },
  { key: "ctr", label: "CTR", numeric: true },
  { key: "conversions", label: "Conv.", numeric: true },
  { key: "cvr", label: "CvR", numeric: true },
  { key: "roas", label: "ROAS", numeric: true },
  { key: "lastDate", label: "Last active", numeric: false },
];

export function CampaignTable({ rows }: { rows: CampaignListRow[] }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [dir, setDir] = useState<Dir>("desc");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter((r) => r.campaign.toLowerCase().includes(needle))
      : rows;
    const arr = [...base];
    arr.sort((a, b) => {
      let cmp: number;
      if (sortKey === "campaign") cmp = a.campaign.localeCompare(b.campaign);
      else if (sortKey === "lastDate")
        cmp = (a.lastDate ?? "").localeCompare(b.lastDate ?? "");
      else cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, q, sortKey, dir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      if (dir === "desc") setDir("asc");
      else {
        setSortKey("spend");
        setDir("desc");
      }
    } else {
      setSortKey(key);
      setDir(key === "campaign" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search campaigns…"
            className="pl-8 h-9"
          />
        </div>
        <p className="text-xs text-ink-3 num">
          {filtered.length} of {rows.length} campaigns
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-ink-2 text-sm">No campaigns match.</p>
        </div>
      ) : (
        <div className="max-h-[68vh] overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm num">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                {COLUMNS.map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      className={cn(
                        "font-medium px-3 py-2.5 bg-surface whitespace-nowrap",
                        col.numeric ? "text-right" : "text-left",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(col.key)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-ink transition-colors",
                          col.numeric && "justify-end w-full",
                          active && "text-brand",
                        )}
                      >
                        {col.label}
                        {active ? (
                          dir === "asc" ? (
                            <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowDown className="w-3 h-3" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 opacity-50" />
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => (
                <tr key={r.campaign} className="hover:bg-surface-2/50 transition-colors">
                  <td className="px-3 py-2.5 max-w-[26rem]">
                    <Link
                      href={`/campaigns/${encodeURIComponent(r.campaign)}`}
                      title={r.campaign}
                      className="block truncate text-ink hover:text-brand transition-colors"
                    >
                      {r.campaign}
                    </Link>
                    <div className="flex items-center gap-1 mt-1">
                      {r.platforms.map((p) => (
                        <span
                          key={p}
                          title={PLATFORM_LABEL[p]}
                          className="w-2 h-2 rounded-sm"
                          style={{ background: PLATFORM_COLOR[p] }}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.creatives)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{usd(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.impressions)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.ctr)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2 tabular-nums">{int(r.conversions)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">{pct(r.cvr)}</td>
                  <td className="px-3 py-2.5 text-right text-ink tabular-nums">
                    {r.roas === null ? "—" : `${ratio(r.roas)}×`}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-3 tabular-nums whitespace-nowrap">
                    {r.lastDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
