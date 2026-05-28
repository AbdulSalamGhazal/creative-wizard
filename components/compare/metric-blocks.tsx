"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CompareMetric } from "@/db/queries/performance";
import {
  COMPARE_METRICS,
  COMPARE_METRIC_LABEL,
  MAX_COMPARE_BLOCKS,
} from "@/validators/compare";

function useMetricsUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  return useCallback(
    (nextMetrics: CompareMetric[]) => {
      const next = new URLSearchParams(searchParams.toString());
      // Default is a single Spend block — keep the URL clean for it.
      if (nextMetrics.length === 1 && nextMetrics[0] === "spend") {
        next.delete("metrics");
      } else if (nextMetrics.length === 0) {
        next.set("metrics", "spend");
      } else {
        next.set("metrics", nextMetrics.join(","));
      }
      const qs = next.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    },
    [pathname, router, searchParams],
  );
}

/**
 * Header controls for one metric block: switch this block's metric (to one
 * not already shown) or remove the block. The last block can't be removed.
 */
export function MetricBlockHeader({
  metric,
  metrics,
}: {
  metric: CompareMetric;
  metrics: CompareMetric[];
}) {
  const writeMetrics = useMetricsUrl();

  const changeTo = (m: CompareMetric) => {
    if (m === metric) return;
    // Replace this position; drop any existing occurrence of the new metric.
    const next = metrics
      .filter((x) => x !== m)
      .map((x) => (x === metric ? m : x));
    writeMetrics(next);
  };

  const remove = () => writeMetrics(metrics.filter((m) => m !== metric));

  const taken = new Set(metrics);

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-sm text-ink hover:text-brand transition-colors"
          >
            {COMPARE_METRIC_LABEL[metric]}
            <ChevronDown className="w-3.5 h-3.5 text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {COMPARE_METRICS.map((m) => {
            const isCurrent = m === metric;
            const usedElsewhere = taken.has(m) && !isCurrent;
            return (
              <DropdownMenuItem
                key={m}
                disabled={usedElsewhere}
                onSelect={() => changeTo(m)}
              >
                <span className="flex-1">{COMPARE_METRIC_LABEL[m]}</span>
                {isCurrent && <Check className="w-3.5 h-3.5 text-brand" />}
                {usedElsewhere && (
                  <span className="text-[10px] text-ink-3">shown</span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {metrics.length > 1 && (
        <button
          type="button"
          onClick={remove}
          className="ml-auto text-ink-3 hover:text-neg transition-colors"
          aria-label={`Remove ${COMPARE_METRIC_LABEL[metric]} block`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** "Add comparison" — appends a metric block for a metric not already shown. */
export function AddMetricBlock({ metrics }: { metrics: CompareMetric[] }) {
  const writeMetrics = useMetricsUrl();
  const taken = new Set(metrics);
  const available = COMPARE_METRICS.filter((m) => !taken.has(m));

  if (metrics.length >= MAX_COMPARE_BLOCKS || available.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-dashed border-line text-sm text-ink-2 hover:text-ink hover:border-line-2 hover:bg-surface-2/50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add comparison block
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {available.map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => writeMetrics([...metrics, m])}
          >
            {COMPARE_METRIC_LABEL[m]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
