"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavTransition } from "@/lib/nav-progress";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  METRIC_COLUMN_KEYS,
  METRIC_FILTER_OPS,
  METRIC_META,
  parseMetricFilters,
  serializeMetricFilters,
  type MetricColumnKey,
  type MetricFilterCondition,
  type MetricFilterOp,
  type MetricFilterScope,
  type MetricUnit,
} from "@/validators/summary";
import { PLATFORM_LABEL } from "@/lib/palette";

interface Props {
  /** Effective platforms shown in the table — the scope options besides Total. */
  platforms: string[];
}

const OP_SYMBOL: Record<MetricFilterOp, string> = {
  gte: "≥",
  lte: "≤",
  eq: "=",
};
const OP_LABEL: Record<MetricFilterOp, string> = {
  gte: "≥  at least",
  lte: "≤  at most",
  eq: "=  equals",
};

function scopeLabel(scope: MetricFilterScope): string {
  if (scope === "total") return "Total";
  return PLATFORM_LABEL[scope as keyof typeof PLATFORM_LABEL] ?? scope;
}

function unitPrefix(unit: MetricUnit): string {
  return unit === "usd" ? "$" : "";
}
function unitSuffix(unit: MetricUnit): string {
  if (unit === "pct") return "%";
  if (unit === "x") return "×";
  return "";
}

function formatValue(metric: MetricColumnKey, value: number): string {
  const { unit } = METRIC_META[metric];
  const body = value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return `${unitPrefix(unit)}${body}${unitSuffix(unit)}`;
}

/**
 * Numeric metric filter builder for the Summary view.
 *
 * Self-contained URL-state widget — reads/writes only the `metricFilters`
 * param so it can be dropped anywhere in the filter bar without prop
 * threading. Each rule is `metric op value` applied to the blended total.
 */
export function MetricFilterControl({ platforms }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();
  const [open, setOpen] = useState(false);

  const conditions = parseMetricFilters(searchParams.get("metricFilters"));

  // Scope options: Total + whichever platforms the table is showing.
  const scopeOptions: MetricFilterScope[] = [
    "total",
    ...(platforms as MetricFilterScope[]),
  ];

  const [draftScope, setDraftScope] = useState<MetricFilterScope>("total");
  const [draftMetric, setDraftMetric] = useState<MetricColumnKey>("roas");
  const [draftOp, setDraftOp] = useState<MetricFilterOp>("gte");
  const [draftValue, setDraftValue] = useState("");

  const writeConditions = useCallback(
    (next: MetricFilterCondition[]) => {
      const params = new URLSearchParams(searchParams.toString());
      const serial = serializeMetricFilters(next);
      if (serial) params.set("metricFilters", serial);
      else params.delete("metricFilters");
      const qs = params.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    },
    [pathname, router, searchParams],
  );

  const addCondition = () => {
    const value = Number(draftValue);
    if (!Number.isFinite(value) || draftValue.trim() === "") return;
    // Guard: if the platform set changed and the draft scope is no longer
    // available, fall back to Total.
    const scope: MetricFilterScope = scopeOptions.includes(draftScope)
      ? draftScope
      : "total";
    // Replace any existing rule with the same scope+metric+op (so re-adding
    // edits rather than duplicates); different ops/scopes coexist.
    const kept = conditions.filter(
      (c) => !(c.scope === scope && c.metric === draftMetric && c.op === draftOp),
    );
    writeConditions([
      ...kept,
      { scope, metric: draftMetric, op: draftOp, value },
    ]);
    setDraftValue("");
  };

  const removeCondition = (idx: number) => {
    writeConditions(conditions.filter((_, i) => i !== idx));
  };

  const clearAll = () => writeConditions([]);

  const draftUnit = METRIC_META[draftMetric].unit;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            conditions.length > 0
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="text-ink-3">Metric filters</span>
          <span className="text-ink">
            {conditions.length === 0
              ? "None"
              : `${conditions.length} rule${conditions.length === 1 ? "" : "s"}`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3 space-y-3">
        <div className="text-label text-ink-3">
          Filter by metric
        </div>

        {/* Active rules */}
        {conditions.length > 0 ? (
          <div className="space-y-1.5">
            {conditions.map((c, i) => (
              <div
                key={`${c.scope}:${c.metric}:${c.op}:${i}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-line bg-surface-2/50 text-xs"
              >
                <span className="text-ink-3 text-[10px] uppercase tracking-wide shrink-0">
                  {scopeLabel(c.scope)}
                </span>
                <span className="text-ink font-medium">
                  {METRIC_META[c.metric].label}
                </span>
                <span className="text-ink-3">{OP_SYMBOL[c.op]}</span>
                <span className="text-ink num tabular-nums">
                  {formatValue(c.metric, c.value)}
                </span>
                <button
                  type="button"
                  onClick={() => removeCondition(i)}
                  className="ml-auto text-ink-3 hover:text-neg transition-colors"
                  aria-label="Remove filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-ink-3 hover:text-ink transition-colors"
            >
              Clear all rules
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-ink-3">
            No rules yet. Add one below. Each rule targets a scope — the
            blended <strong className="text-ink-2">Total</strong> or a single
            platform&apos;s column.
          </p>
        )}

        {/* Add-rule builder */}
        <div className="space-y-2 pt-2 border-t border-line">
          {/* Scope: Total or a specific platform column */}
          <select
            value={draftScope}
            onChange={(e) => setDraftScope(e.target.value as MetricFilterScope)}
            className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-line-2"
          >
            {scopeOptions.map((s) => (
              <option key={s} value={s}>
                {s === "total" ? "Total (blended)" : scopeLabel(s)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <select
              value={draftMetric}
              onChange={(e) => setDraftMetric(e.target.value as MetricColumnKey)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-line-2"
            >
              {METRIC_COLUMN_KEYS.map((k) => (
                <option key={k} value={k}>
                  {METRIC_META[k].label}
                </option>
              ))}
            </select>
            <select
              value={draftOp}
              onChange={(e) => setDraftOp(e.target.value as MetricFilterOp)}
              className="h-8 w-[112px] rounded-md border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-line-2"
            >
              {METRIC_FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              {unitPrefix(draftUnit) && (
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3 pointer-events-none">
                  {unitPrefix(draftUnit)}
                </span>
              )}
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCondition();
                  }
                }}
                placeholder="value"
                className={cn(
                  "h-8 w-full rounded-md border border-line bg-surface text-xs text-ink outline-none focus:border-line-2",
                  unitPrefix(draftUnit) ? "pl-6" : "pl-2.5",
                  unitSuffix(draftUnit) ? "pr-7" : "pr-2.5",
                )}
              />
              {unitSuffix(draftUnit) && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-3 pointer-events-none">
                  {unitSuffix(draftUnit)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={addCondition}
              disabled={draftValue.trim() === "" || !Number.isFinite(Number(draftValue))}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-brand/50 bg-[var(--brand-soft)] text-xs text-ink hover:bg-brand/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>
          <p className="text-[10px] text-ink-3">
            {draftUnit === "pct"
              ? "Percentages are entered as shown — e.g. 2 means 2%."
              : draftUnit === "x"
                ? "ROAS as a multiple — e.g. 2 means 2×."
                : draftUnit === "usd"
                  ? "Dollar amount."
                  : "Whole number."}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
