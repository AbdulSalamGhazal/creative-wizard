"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { int, usd } from "@/lib/format";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { cn } from "@/lib/utils";
import type { CampaignDayRow, CampaignRecordRow } from "@/db/queries/campaign";

/** Every uploaded metric column. `money` → currency, else integer count. */
const METRIC_COLS: Array<{ key: MetricKey; label: string; money?: boolean }> = [
  { key: "spend", label: "Spend", money: true },
  { key: "impressions", label: "Impr." },
  { key: "clicks", label: "Clicks" },
  { key: "landingPageViews", label: "LP views" },
  { key: "addToCart", label: "ATC" },
  { key: "addPayment", label: "AP" },
  { key: "conversions", label: "Conv." },
  { key: "conversionValue", label: "Value", money: true },
  { key: "videoViews2s", label: "V·2s" },
  { key: "videoViews25", label: "V·25%" },
  { key: "videoViews50", label: "V·50%" },
  { key: "videoViews75", label: "V·75%" },
  { key: "videoViews100", label: "V·100%" },
];

type MetricKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "landingPageViews"
  | "addToCart"
  | "addPayment"
  | "conversions"
  | "conversionValue"
  | "videoViews2s"
  | "videoViews25"
  | "videoViews50"
  | "videoViews75"
  | "videoViews100";

type Mode = "raw" | "day";
type SortDir = 1 | -1;

const fmtMetric = (v: number | null, money?: boolean) =>
  v === null ? "—" : money ? usd(v) : int(v);

type SortVal = string | number | null;

function sortRows<T>(
  rows: T[],
  getVal: (r: T) => SortVal,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a);
    const bv = getVal(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls always last
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    return ((av as number) - (bv as number)) * dir;
  });
}

export function CampaignRecordsTable({
  records,
  byDay,
}: {
  records: CampaignRecordRow[];
  byDay: CampaignDayRow[];
}) {
  const [mode, setMode] = useState<Mode>("raw");
  const [sortKey, setSortKey] = useState<string>("date");
  const [dir, setDir] = useState<SortDir>(-1);

  const onSort = (key: string) => {
    if (key === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setDir(-1);
    }
  };

  const getVal = (r: CampaignRecordRow | CampaignDayRow, key: string): SortVal => {
    if (key === "date") return r.date;
    if (key === "creativeName") return "creativeName" in r ? r.creativeName : null;
    if (key === "platform") return "platform" in r ? r.platform : null;
    if (key === "records") return "records" in r ? r.records : null;
    return (r as unknown as Record<string, number | null>)[key] ?? null;
  };

  const sortedRecords = useMemo(
    () => sortRows(records, (r) => getVal(r, sortKey), dir),
    [records, sortKey, dir],
  );
  const sortedDays = useMemo(
    () => sortRows(byDay, (r) => getVal(r, sortKey), dir),
    [byDay, sortKey, dir],
  );

  const truncated = records.length >= 2000;

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
        No records in this window.
      </div>
    );
  }

  const Th = ({
    label,
    sortK,
    align = "right",
  }: {
    label: string;
    sortK: string;
    align?: "left" | "right";
  }) => (
    <th
      className={cn(
        "font-medium px-3 py-2.5 bg-surface whitespace-nowrap select-none cursor-pointer hover:text-ink",
        align === "right" ? "text-right" : "text-left",
      )}
      onClick={() => onSort(sortK)}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse")}>
        {label}
        {sortKey === sortK &&
          (dir === 1 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center rounded-md border border-line bg-surface-2 p-0.5 text-[11px]">
          {(
            [
              ["raw", "Per record"],
              ["day", "By day"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={cn(
                "px-2.5 h-7 rounded transition-colors",
                mode === k ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-3 num">
          {mode === "raw"
            ? `${records.length}${truncated ? "+" : ""} records`
            : `${byDay.length} days`}
        </span>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-[11px] uppercase tracking-[0.12em] text-ink-3 border-b border-line">
              <Th label="Date" sortK="date" align="left" />
              {mode === "raw" ? (
                <>
                  <Th label="Creative" sortK="creativeName" align="left" />
                  <Th label="Platform" sortK="platform" align="left" />
                </>
              ) : (
                <Th label="Rows" sortK="records" />
              )}
              {METRIC_COLS.map((c) => (
                <Th key={c.key} label={c.label} sortK={c.key} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {mode === "raw"
              ? sortedRecords.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "hover:bg-surface-2/50 transition-colors",
                      r.excludedFromAggregates && "opacity-55",
                    )}
                  >
                    <td className="px-3 py-2 text-ink-2 tabular-nums whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="block truncate max-w-[14rem] font-mono text-[12px] text-ink-2"
                          title={r.creativeName}
                        >
                          {r.creativeName}
                        </span>
                        {r.excludedFromAggregates && (
                          <Badge variant="outline" className="text-[9px] border-line-2 text-ink-3">
                            excl
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-ink-2 whitespace-nowrap text-xs">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ background: PLATFORM_COLOR[r.platform] }}
                        />
                        {PLATFORM_LABEL[r.platform]}
                      </span>
                    </td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {fmtMetric(r[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                ))
              : sortedDays.map((r) => (
                  <tr key={r.date} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-3 py-2 text-ink-2 tabular-nums whitespace-nowrap">
                      {r.date}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-3 tabular-nums">{r.records}</td>
                    {METRIC_COLS.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {fmtMetric(r[c.key], c.money)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {truncated && mode === "raw" && (
        <p className="text-[10px] text-ink-3">
          Showing the first 2,000 records. Switch to “By day” for the full
          window, or narrow the date range.
        </p>
      )}
    </div>
  );
}
