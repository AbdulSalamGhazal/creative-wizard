"use client";

import type { ReactNode } from "react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilterPill } from "@/components/filters/filter-pill";
import { FILTER_KEY_ICONS } from "@/components/filters/filter-icons";
import { PLATFORM_LABEL, type ALL_PLATFORMS } from "@/lib/palette";
import { cn } from "@/lib/utils";

type Platform = (typeof ALL_PLATFORMS)[number];

/**
 * THE Platforms pill (D21, 2026-10). It was re-implemented six times with
 * three icons — on Ads it wore Stage's `Layers` in the bar while the Filters
 * dialog used Layers for Stage — and two behaviours: some menus closed on
 * every click, and an empty selection read "None" on one page and "All" on
 * the rest. Now: the icon is the filter map's (`FILTER_KEY_ICONS.platforms`),
 * the menu STAYS OPEN while you pick, and an empty selection reads "All" —
 * a filter that is off filters nothing.
 *
 * The one page where an empty selection is NOT "off" is Ads, whose platforms
 * choose the table's column GROUPS: there `emptyMeans="none"`, and deselecting
 * every platform honestly reads "None" (its URL says `platforms=none`).
 *
 * Presentational: the caller owns the param and its writer.
 */
export function platformsPillValue(
  selected: readonly string[],
  options: readonly Platform[],
  emptyMeans: "all" | "none" = "all",
): { value: string; active: boolean } {
  const all = options.length > 0 && options.every((p) => selected.includes(p));
  if (selected.length === 0)
    return emptyMeans === "none" ? { value: "None", active: true } : { value: "All", active: false };
  if (all) return { value: "All", active: false };
  if (selected.length === 1) {
    const only = selected[0] as Platform;
    return { value: PLATFORM_LABEL[only] ?? only, active: true };
  }
  return { value: `${selected.length} selected`, active: true };
}

export function PlatformsPill({
  options,
  selected,
  onToggle,
  emptyMeans = "all",
  max,
  footer,
  fullWidth,
}: {
  /** The platforms this page offers, in display order. */
  options: readonly Platform[];
  /** The effective selection (what the page's query ran with). */
  selected: readonly string[];
  /** Flip one platform; the caller writes the URL. */
  onToggle: (platform: Platform) => void;
  /** What an empty selection MEANS here — "all" (a filter that is off) on
   *  every page but Ads. */
  emptyMeans?: "all" | "none";
  /** A cap on how many may be on; further options disable with a hint. */
  max?: number;
  /** Extra menu rows under the platforms (Ads' Blended total toggle). */
  footer?: ReactNode;
  fullWidth?: boolean;
}) {
  const { value, active } = platformsPillValue(selected, options, emptyMeans);
  const capped = max !== undefined && selected.length >= max;
  return (
    <FilterPill
      icon={FILTER_KEY_ICONS.platforms!}
      label="Platforms"
      value={value}
      active={active}
      fullWidth={fullWidth}
    >
      {() => (
        <DropdownMenuContent align="start" className={footer ? "w-56" : "w-48"}>
          <DropdownMenuLabel>Platforms</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((p) => {
            const checked = selected.includes(p);
            const disabled = !checked && capped;
            return (
              <DropdownMenuCheckboxItem
                key={p}
                checked={checked}
                disabled={disabled}
                onCheckedChange={() => onToggle(p)}
                // Stay open while picking — every platform pill, every page.
                onSelect={(e) => e.preventDefault()}
              >
                <span className={cn(disabled && "text-ink-3")}>{PLATFORM_LABEL[p]}</span>
              </DropdownMenuCheckboxItem>
            );
          })}
          {capped && (
            <div className="px-2 py-1.5 text-[10px] text-ink-3">
              Deselect a platform to add another.
            </div>
          )}
          {footer && (
            <>
              <DropdownMenuSeparator />
              {footer}
            </>
          )}
        </DropdownMenuContent>
      )}
    </FilterPill>
  );
}
