"use client";

import { ParamSwitch } from "@/components/filters/param-switch";
import {
  BREAKDOWN_LEVELS,
  BREAKDOWN_LEVEL_LABEL,
  type BreakdownLevel,
} from "@/lib/breakdown-level";

const OPTIONS = BREAKDOWN_LEVELS.map((value) => ({
  value,
  label: BREAKDOWN_LEVEL_LABEL[value],
}));

/**
 * "By  Campaign · Ad set" — which level a campaign-side breakdown shows
 * (2026-11). URL-backed (`?level=adset`; campaign is the clean URL), so a
 * shared link and a comment's captured query string reproduce it. The shared
 * `ParamSwitch` does the navigation.
 */
export function LevelSwitch({
  level,
  className,
}: {
  /** The level the page RAN — resolved server-side from the same param. */
  level: BreakdownLevel;
  className?: string;
}) {
  return (
    <ParamSwitch
      param="level"
      options={OPTIONS}
      value={level}
      defaultValue="campaign"
      ariaLabel="Break down by campaign or ad set"
      className={className}
    />
  );
}
