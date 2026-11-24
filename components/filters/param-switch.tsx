"use client";

import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

/**
 * "By  A · B · C" — a small URL-backed switch for WHAT a page groups by
 * (2026-11). One implementation behind the two that exist: the campaign /
 * ad-set level (`LevelSwitch`, Funnel and the one-platform Dashboard) and
 * Changes' four-way breakdown — so they read, look and behave as one control.
 *
 * The choice changes what the SERVER groups by, so a switch is a navigation
 * through `useNavTransition` (the progress bar runs) that keeps every other
 * param. The default value is the clean URL: it removes the param.
 */
export function ParamSwitch<T extends string>({
  param,
  options,
  value,
  defaultValue,
  ariaLabel,
  label = "By",
  className,
}: {
  /** The search param this switch owns (`level`, `dim`). */
  param: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  /** The value the page RAN — resolved server-side from the same param. */
  value: T;
  /** The value the clean URL means. */
  defaultValue: T;
  ariaLabel: string;
  /** The word in front of the options. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  const onChange = (next: T) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultValue) params.delete(param);
    else params.set(param, next);
    const qs = params.toString();
    startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <span className="text-xs text-ink-3" aria-hidden>
        {label}
      </span>
      <SegmentedControl ariaLabel={ariaLabel} options={options} value={value} onChange={onChange} />
    </div>
  );
}
