"use client";

import { useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COMPARE_COLORS } from "@/components/charts/compare-chart";
import { int, pct, roas, usd } from "@/lib/format";
import type { Kpis } from "@/db/queries/performance";

type ColumnDef = {
  key: keyof Kpis;
  label: string;
  fmt: (v: number | null) => string;
  /** Stronger ink for the headline metrics. */
  strong?: boolean;
};

/**
 * Every metric available on the A/B totals table. The user toggles which ones
 * show via the "Columns" menu; the choice persists in localStorage. Spend +
 * Selection are always shown.
 */
const COLUMNS: ColumnDef[] = [
  { key: "spend", label: "Spend", fmt: (v) => usd(v), strong: true },
  { key: "impressions", label: "Impressions", fmt: (v) => int(v) },
  { key: "clicks", label: "Clicks", fmt: (v) => int(v) },
  { key: "conversions", label: "Conversions", fmt: (v) => int(v) },
  { key: "conversionValue", label: "Conv. value", fmt: (v) => usd(v) },
  { key: "landingPageViews", label: "LP views", fmt: (v) => int(v) },
  { key: "ctr", label: "CTR", fmt: (v) => pct(v) },
  { key: "voc", label: "VOC", fmt: (v) => pct(v) },
  { key: "cvr", label: "CvR", fmt: (v) => pct(v) },
  { key: "cpm", label: "CPM", fmt: (v) => usd(v) },
  { key: "cpc", label: "CPC", fmt: (v) => usd(v) },
  { key: "cpa", label: "CPA", fmt: (v) => usd(v) },
  { key: "roas", label: "ROAS", fmt: (v) => roas(v), strong: true },
  { key: "hookRate", label: "Hook rate", fmt: (v) => pct(v) },
  { key: "holdRate", label: "Hold rate", fmt: (v) => pct(v) },
];

const DEFAULT_VISIBLE: Array<keyof Kpis> = [
  "spend",
  "impressions",
  "ctr",
  "cvr",
  "cpa",
  "roas",
  "hookRate",
];
const STORAGE_KEY = "compare-totals-cols";

export interface CompareSideTotals {
  label: string;
  selection: string;
  totals: Kpis;
}

export function CompareTotalsTable({ sides }: { sides: CompareSideTotals[] }) {
  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE as string[]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          const valid = arr.filter((k): k is string =>
            COLUMNS.some((c) => c.key === k),
          );
          if (valid.length > 0) setVisible(valid);
        }
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  const toggle = (key: string) => {
    setVisible((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      if (next.length === 0) return prev; // keep at least one metric
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Render in the canonical COLUMNS order regardless of toggle order.
  const cols = COLUMNS.filter((c) => visible.includes(c.key as string));

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Columns
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 max-h-[60vh] overflow-y-auto"
          >
            <DropdownMenuLabel>Metric columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key as string}
                checked={visible.includes(c.key as string)}
                onCheckedChange={() => toggle(c.key as string)}
                onSelect={(e) => e.preventDefault()}
              >
                {c.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-label text-ink-3">
              <th className="font-medium px-2 py-2">Side</th>
              <th className="font-medium px-2 py-2">Selection</th>
              {cols.map((c) => (
                <th
                  key={c.key as string}
                  className="font-medium px-2 py-2 text-right whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sides.map((s, i) => (
              <tr key={s.label} className="hover:bg-surface-2/60 transition-colors">
                <td className="px-2 py-2.5">
                  <span className="inline-flex items-center gap-2 text-ink font-medium whitespace-nowrap">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{
                        background: COMPARE_COLORS[i % COMPARE_COLORS.length],
                      }}
                    />
                    {s.label}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-ink-3 text-xs whitespace-nowrap">
                  {s.selection}
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key as string}
                    className={`px-2 py-2.5 text-right tabular-nums ${
                      c.strong ? "text-ink" : "text-ink-2"
                    }`}
                  >
                    {c.fmt(s.totals[c.key] as number | null)}
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
