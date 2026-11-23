"use client";

import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { useNavTransition } from "@/lib/nav-progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  BREAKDOWN_LEVELS,
  BREAKDOWN_LEVEL_LABEL,
  type BreakdownLevel,
} from "@/lib/breakdown-level";
import { cn } from "@/lib/utils";

const OPTIONS = BREAKDOWN_LEVELS.map((value) => ({
  value,
  label: BREAKDOWN_LEVEL_LABEL[value],
}));

/**
 * "By  Campaign · Ad set" — which level a campaign-side breakdown shows
 * (2026-11). URL-backed (`?level=adset`; campaign is the clean URL), so a
 * shared link and a comment's captured query string reproduce it. The level
 * changes what the SERVER groups by, so the switch is a navigation through
 * `useNavTransition` (the progress bar runs) that keeps every other param.
 */
export function LevelSwitch({
  level,
  className,
}: {
  /** The level the page RAN — resolved server-side from the same param. */
  level: BreakdownLevel;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  const onChange = (next: BreakdownLevel) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "campaign") params.delete("level");
    else params.set("level", next);
    const qs = params.toString();
    startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <span className="text-xs text-ink-3" aria-hidden>
        By
      </span>
      <SegmentedControl
        ariaLabel="Break down by campaign or ad set"
        options={OPTIONS}
        value={level}
        onChange={onChange}
      />
    </div>
  );
}
