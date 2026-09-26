"use client";

import { useMemo } from "react";
import { MonitorSmartphone } from "lucide-react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ExcludedToggle, FilterPill } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { setIncludeExcludedPref } from "@/app/actions/user-prefs";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { CREATIVE_STATUSES, STATUS_DOT, STATUS_LABEL } from "@/lib/creative-status";
import { STAGE_FILTER_VALUES, stageFilterLabel } from "@/lib/funnel-stages";
import type { DateRangeValue } from "@/lib/date-presets";

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

// Google is ordinary data here — the canvas is about who spent WHERE, which it
// reports like everyone else — so this is the full platform list.
const PLATFORMS = ALL_PLATFORMS.map((value) => ({
  value,
  label: PLATFORM_LABEL[value],
}));

/**
 * The Canvas filter bar — on `FilterShell` (phase 2): tier 1 is the date and
 * the platform pill, tier 2 declares status · product · stage, and the
 * Excluded toggle stays in the toolbar where every data-scope switch lives.
 * Every change is a server round-trip through `useFilterParams`, so the
 * progress bar runs and the graph is always what the URL says.
 */
export function CanvasFilterBar({
  products,
  resolvedRange,
  effectiveStatuses,
  includeExcludedDefault,
  resolvedFilters,
}: {
  products: Array<{ id: string; name: string }>;
  /** What the query actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  /** The statuses in force (the URL's, or the terminated-hidden default). */
  effectiveStatuses: readonly string[];
  includeExcludedDefault: boolean;
  /**
   * Remembered filters, as the server resolved them for this render (URL →
   * this user's saved value for this brand → nothing). The bar reads its own
   * params through them, so the chips say what actually ran.
   */
  resolvedFilters?: Record<string, string | undefined>;

}) {
  // `resolvedFilters` is the server's URL→preference→default answer: a
  // remembered filter shows its chip on a bare URL, and removing that chip
  // deletes the preference instead of resurrecting it.
  const { searchParams, update, get } = useFilterParams(resolvedFilters);

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const rawIncludeExcluded = searchParams.get("includeExcluded");
  const includeExcluded =
    rawIncludeExcluded !== null ? rawIncludeExcluded === "1" : includeExcludedDefault;
  const platforms = useMemo(() => csv(get("platforms")), [get]);
  const productIds = useMemo(() => csv(get("productIds")), [get]);
  const stages = useMemo(() => csv(get("stages")), [get]);
  const statusesInUrl = get("statuses") !== null;

  const writeMulti = (key: string, values: readonly string[]) =>
    update((next) => {
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
    });

  const toggleExcluded = () => {
    const nextOn = !includeExcluded;
    void setIncludeExcludedPref(nextOn);
    update((next) => next.set("includeExcluded", nextOn ? "1" : "0"));
  };

  const filters: FilterDef[] = [
    {
      key: "statuses",
      label: "Creative status",
      type: "multi",
      options: CREATIVE_STATUSES.map((s) => ({
        value: s,
        label: STATUS_LABEL[s],
        dot: STATUS_DOT[s],
      })),
      // Toggles start from the statuses IN FORCE, so unticking one from the
      // default writes the other three — never an empty set.
      values: effectiveStatuses,
      // The DEFAULT is non-empty (all but terminated), so "active" is "the URL
      // says something" — and clearing writes nothing, restoring that default.
      active: statusesInUrl,
      onChange: (next) => writeMulti("statuses", next),
      chipFormat: (v) =>
        v.length === CREATIVE_STATUSES.length
          ? "All"
          : v.length === 1
            ? STATUS_LABEL[v[0] as keyof typeof STATUS_LABEL]
            : `${v.length} selected`,
    },
    {
      key: "productIds",
      label: "Products",
      type: "multi",
      options: products.map((p) => ({ value: p.id, label: p.name })),
      values: productIds,
      onChange: (next) => writeMulti("productIds", next),
      emptyHint: "No products yet",
    },
    {
      key: "stages",
      label: "Stage",
      type: "multi",
      options: STAGE_FILTER_VALUES.map((v) => ({ value: v, label: stageFilterLabel(v) })),
      values: stages,
      onChange: (next) => writeMulti("stages", next),
    },
  ];

  return (
    <FilterShell
      filters={filters}
      tier1={({ fullWidth }) => (
        <>
          <DateRangePicker
            from={from}
            to={to}
            onChange={(f, t) =>
              update((next) => {
                if (f) next.set("from", f);
                else next.delete("from");
                if (t) next.set("to", t);
                else next.delete("to");
              })
            }
            remember
            fullWidth={fullWidth}
            fallback={resolvedRange}
          />
          <FilterPill
            icon={MonitorSmartphone}
            label="Platforms"
            value={
              platforms.length === 0
                ? "All"
                : platforms.length === 1
                  ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
                  : `${platforms.length} selected`
            }
            active={platforms.length > 0}
            fullWidth={fullWidth}
          >
            {() => (
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Platforms</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {PLATFORMS.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.value}
                    checked={platforms.includes(p.value)}
                    onCheckedChange={() =>
                      writeMulti(
                        "platforms",
                        platforms.includes(p.value)
                          ? platforms.filter((v) => v !== p.value)
                          : [...platforms, p.value],
                      )
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {p.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            )}
          </FilterPill>
        </>
      )}
      toolbar={({ fullWidth }) => (
        <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth={fullWidth} />
      )}
    />
  );
}
