"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";

/**
 * The canonical single-metric picker for charts — a segmented control that
 * wraps when there are many options. One look everywhere (replaces the mix of
 * native <select>, shadcn <Select>, and ad-hoc segmented controls that charts
 * grew independently).
 */
export function MetricPicker<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Metric",
  className,
}: {
  /** A `disabled` option renders locked; `title` explains why it is. */
  options: ReadonlyArray<{
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}
