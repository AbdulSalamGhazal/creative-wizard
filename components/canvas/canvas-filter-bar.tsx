"use client";

import { CircleDot, Layers, MonitorSmartphone, Package } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useNavTransition } from "@/lib/nav-progress";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import {
  ClearButton,
  ExcludedToggle,
  FilterPill,
} from "@/components/filters/filter-pill";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { setIncludeExcludedPref } from "@/app/actions/user-prefs";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { CREATIVE_STATUSES, STATUS_LABEL } from "@/lib/creative-status";
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
 * The Canvas filter bar — the standard pattern (date → dimension pills → the
 * Excluded toggle; one Filters sheet below `lg`). Every change is a server
 * round-trip through `useNavTransition`, so the progress bar runs and the
 * graph is always what the URL says.
 */
export function CanvasFilterBar({
  products,
  resolvedRange,
  effectiveStatuses,
  includeExcludedDefault,
}: {
  products: Array<{ id: string; name: string }>;
  /** What the query actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  /** The statuses in force (the URL's, or the terminated-hidden default). */
  effectiveStatuses: readonly string[];
  includeExcludedDefault: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const rawIncludeExcluded = searchParams.get("includeExcluded");
  const includeExcluded =
    rawIncludeExcluded !== null ? rawIncludeExcluded === "1" : includeExcludedDefault;
  const platforms = useMemo(() => csv(searchParams.get("platforms")), [searchParams]);
  const productIds = useMemo(() => csv(searchParams.get("productIds")), [searchParams]);
  const stages = useMemo(() => csv(searchParams.get("stages")), [searchParams]);
  const statusesInUrl = searchParams.get("statuses") !== null;

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      for (const [key, value] of [...next.entries()]) {
        if (!value) next.delete(key);
      }
      const qs = next.toString();
      startTransition(() =>
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
      );
    },
    [pathname, router, searchParams, startTransition],
  );

  const toggleMulti = (key: string, value: string, current: readonly string[]) => {
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete(key);
      else next.set(key, [...set].join(","));
    });
  };

  const toggleExcluded = () => {
    const nextOn = !includeExcluded;
    void setIncludeExcludedPref(nextOn);
    update((next) => next.set("includeExcluded", nextOn ? "1" : "0"));
  };

  const filtersActive =
    !!from || !!to || includeExcluded || platforms.length > 0 ||
    productIds.length > 0 || stages.length > 0 || statusesInUrl;
  const clearAll = () =>
    update((next) => {
      for (const k of ["from", "to", "includeExcluded", "platforms", "productIds", "stages", "statuses"]) {
        next.delete(k);
      }
    });
  const activeCount =
    (from || to ? 1 : 0) + (platforms.length ? 1 : 0) + (productIds.length ? 1 : 0) +
    (stages.length ? 1 : 0) + (statusesInUrl ? 1 : 0) + (includeExcluded ? 1 : 0);

  const count = (n: number, none: string, one: () => string) =>
    n === 0 ? none : n === 1 ? one() : `${n} selected`;

  const controls = (fullWidth: boolean) => (
    <>
      <DateRangePicker
        from={from}
        to={to}
        onChange={(f, t) =>
          update((next) => {
            if (f) next.set("from", f); else next.delete("from");
            if (t) next.set("to", t); else next.delete("to");
          })
        }
        remember
        fullWidth={fullWidth}
        fallback={resolvedRange}
      />

      <FilterPill
        icon={MonitorSmartphone}
        label="Platforms"
        value={count(platforms.length, "All", () => PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")}
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
                onCheckedChange={() => toggleMulti("platforms", p.value, platforms)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

      <FilterPill
        icon={CircleDot}
        label="Status"
        value={
          statusesInUrl
            ? count(effectiveStatuses.length, "None", () => STATUS_LABEL[effectiveStatuses[0] as keyof typeof STATUS_LABEL])
            : "No terminated"
        }
        active={statusesInUrl}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Creative status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Toggles start from the statuses IN FORCE, so unticking one from
                the default writes the other three — never an empty set. */}
            {CREATIVE_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={effectiveStatuses.includes(s)}
                onCheckedChange={() => toggleMulti("statuses", s, effectiveStatuses)}
                onSelect={(e) => e.preventDefault()}
              >
                {STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

      <FilterPill
        icon={Package}
        label="Products"
        value={count(productIds.length, "All", () => products.find((p) => p.id === productIds[0])?.name ?? "1")}
        active={productIds.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuLabel>Products</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {products.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={productIds.includes(p.id)}
                onCheckedChange={() => toggleMulti("productIds", p.id, productIds)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

      <FilterPill
        icon={Layers}
        label="Stage"
        value={count(stages.length, "Any", () => stageFilterLabel(stages[0]!))}
        active={stages.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Stage</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {STAGE_FILTER_VALUES.map((v) => (
              <DropdownMenuCheckboxItem
                key={v}
                checked={stages.includes(v)}
                onCheckedChange={() => toggleMulti("stages", v, stages)}
                onSelect={(e) => e.preventDefault()}
              >
                {stageFilterLabel(v)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>
    </>
  );

  return (
    <div className="sticky top-14 z-10 -mx-6 border-b border-line bg-background/95 px-6 py-3 backdrop-blur">
      <div className="hidden flex-wrap items-center gap-2 lg:flex">
        {controls(false)}
        <div className="ml-auto flex items-center gap-2">
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} />
          {filtersActive && <ClearButton onClick={clearAll} />}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 lg:hidden">
        <FilterSheet activeCount={activeCount} onClear={clearAll}>
          {controls(true)}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth />
        </FilterSheet>
      </div>
    </div>
  );
}
