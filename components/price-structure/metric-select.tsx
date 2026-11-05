"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { METRIC_LIST, type MetricMeta } from "@/price-structure/engine/metrics";
import type { MetricKey } from "@/price-structure/engine/types";

/** A select over the metrics catalogue; the two monthly metrics hide without monthly volume. */
export function MetricSelect({
  value,
  onChange,
  monthly,
  ariaLabel = "Metric",
  filter,
  className,
}: {
  value: MetricKey;
  onChange: (key: MetricKey) => void;
  /** Whether monthly metrics mean anything (Σ ordersPerMonth > 0). */
  monthly: boolean;
  ariaLabel?: string;
  filter?: (m: MetricMeta) => boolean;
  className?: string;
}) {
  const options = METRIC_LIST.filter((m) => (monthly || !m.monthly) && (!filter || filter(m)));
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MetricKey)}>
      <SelectTrigger size="sm" className={className ?? "h-8 text-xs"} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((m) => (
          <SelectItem key={m.key} value={m.key}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
