"use client";

import { CheckCircle2, Info } from "lucide-react";
import { int } from "@/lib/format";
import type { ValidationError } from "@/csv/errors";

interface Summary {
  rows: number;
  creatives: number;
  dateRange: { from: string; to: string } | null;
  upsert?: true;
  newRows?: number;
  updatedRows?: number;
}

export function SummaryCard({
  summary,
  warnings,
}: {
  summary: Summary;
  warnings: ValidationError[];
}) {
  const isUpsert = summary.upsert === true;
  return (
    <div className="rounded-lg border border-pos/30 bg-pos/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-pos/20 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-pos" />
        <div className="text-sm text-ink">
          File validated. Review the summary, then confirm to import.
        </div>
      </div>

      {isUpsert && (
        <div className="px-4 pt-4 -mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-pos/30 bg-pos/10 px-2 py-1 text-pos num">
            <span className="font-display text-sm leading-none">
              {int(summary.newRows ?? 0)}
            </span>
            new
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/10 px-2 py-1 text-brand num">
            <span className="font-display text-sm leading-none">
              {int(summary.updatedRows ?? 0)}
            </span>
            updated
          </span>
          <span className="text-ink-3">
            Upsert: existing rows are overwritten in place, new rows inserted.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 px-4 py-4">
        <Stat label="Rows" value={int(summary.rows)} />
        <Stat label="Creatives" value={int(summary.creatives)} />
        <Stat
          label="Date range"
          value={
            summary.dateRange
              ? `${summary.dateRange.from} → ${summary.dateRange.to}`
              : "—"
          }
        />
      </div>

      {warnings.length > 0 && (
        <div className="border-t border-pos/20 bg-warn/5">
          <div className="px-4 py-2.5 text-[11px] text-warn flex items-center gap-2 border-b border-warn/20">
            <Info className="w-3 h-3" />
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}{" "}
            <span className="text-ink-3">(non-blocking)</span>
          </div>
          <ul className="max-h-32 overflow-y-auto divide-y divide-warn/10 text-xs">
            {warnings.map((w, i) => (
              <li key={i} className="px-4 py-2 flex items-start gap-2">
                <span className="inline-flex items-center justify-center px-1.5 h-5 rounded text-[10px] uppercase tracking-wide bg-warn/15 text-warn border border-warn/30 shrink-0 mt-0.5">
                  Warning
                </span>
                <span className="text-ink-2">{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-3 mb-1">
        {label}
      </div>
      <div className="font-display text-2xl num text-ink leading-none">
        {value}
      </div>
    </div>
  );
}
