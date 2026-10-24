"use client";

import { Package, Shapes, Tag } from "lucide-react";
import { useMemo } from "react";
import { useFilterParams } from "@/components/filters/use-filter-params";
import { PlatformsPill } from "@/components/filters/platforms-pill";
import { setPersistedKeys } from "@/lib/filter-prefs";
import { useRegisterFilterScope } from "@/lib/filter-scope";
import {
  STRIP_FILTER_KEYS,
  STRIP_TIER2_KEYS,
  type StripFilterKey,
} from "@/validators/filters";
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
import { ALL_PLATFORMS, PLATFORMS_WITH_CREATIVES, TYPE_OPTIONS } from "@/lib/palette";
import { rememberIncludeExcluded } from "@/lib/pref-sync";

const TYPES = TYPE_OPTIONS;

interface FilterStripProps {
  /** Product options for the Products filter. Empty → dropdown shows a hint. */
  products?: Array<{ id: string; name: string }>;
  /** Angle options for the Angles filter. */
  angles?: string[];
  /** Hide the Type filter — e.g. on the video-only diagnostics page. */
  hideType?: boolean;
  /**
   * Which platforms the Platform filter offers. `"creative"` narrows it to
   * `PLATFORMS_WITH_CREATIVES` — for the creative-granularity pages (by-angle,
   * by-type, Video, Launches) and for /funnel, which excludes google wholesale.
   * Default `"all"`: the brand-level pages (Dashboard, Trends over-time).
   */
  platformScope?: "all" | "creative";
  /** The effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  /** Persist the picked range as the user's global default. Off for pages where
   *  the date means something page-specific (e.g. Launches = launch cohort). */
  rememberDate?: boolean;
  /** The user's saved Excluded-toggle default (URL param overrides it). */
  includeExcludedDefault?: boolean;
  /**
   * The filters THIS page's queries apply (D20). Only these are remembered
   * and resolved; default: all four (minus Type when `hideType`).
   */
  applies?: readonly StripFilterKey[];
  /**
   * Remembered filters as the server resolved them for this render
   * (`resolveStripFilters`: URL → saved preference → nothing). The strip reads
   * its params through them, so a remembered filter shows on a bare URL and
   * removing it deletes the preference.
   */
  resolvedFilters?: Record<string, string | undefined>;
}

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function FilterStrip({
  products = [],
  angles = [],
  includeExcludedDefault,
  hideType = false,
  platformScope = "all",
  defaultFrom,
  defaultTo,
  rememberDate = true,
  applies,
  resolvedFilters,
}: FilterStripProps = {}) {
  // The house URL writer (D20): writes compose within a tick, the progress bar
  // shows, and every change to a remembered key is written through — the
  // same mechanism every FilterShell page uses, sharing keys with them.
  const { searchParams, update, get } = useFilterParams(resolvedFilters);
  const remembered = applies ?? STRIP_FILTER_KEYS.filter((k) => !(hideType && k === "types"));
  setPersistedKeys(remembered);

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const platformsParam = get("platforms");
  // Effective Excluded state: explicit URL param wins, else the saved
  // per-user preference the server resolved into `includeExcludedDefault`.
  const rawIncludeExcluded = searchParams.get("includeExcluded");
  const includeExcluded =
    rawIncludeExcluded !== null
      ? rawIncludeExcluded === "1"
      : (includeExcludedDefault ?? false);
  const productIds = csv(get("productIds"));
  const types = csv(get("types"));
  const selectedAngles = csv(get("angles"));

  const selectedPlatforms = useMemo(
    () => (platformsParam ? platformsParam.split(",").filter(Boolean) : []),
    [platformsParam],
  );

  const applyRange = (nextFrom: string | null, nextTo: string | null) => {
    update((next) => {
      if (nextFrom) next.set("from", nextFrom);
      else next.delete("from");
      if (nextTo) next.set("to", nextTo);
      else next.delete("to");
    });
  };

  const togglePlatform = (value: string) => {
    const set = new Set(selectedPlatforms);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete("platforms");
      else next.set("platforms", [...set].join(","));
    });
  };

  const toggleMulti = (key: string, value: string, current: string[]) => {
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete(key);
      else next.set(key, [...set].join(","));
    });
  };

  const productLabel =
    productIds.length === 0
      ? "All"
      : productIds.length === 1
        ? (products.find((p) => p.id === productIds[0])?.name ?? "1 selected")
        : `${productIds.length} selected`;
  const typeLabel =
    types.length === 0
      ? "All"
      : types.length === 1
        ? (TYPES.find((t) => t.value === types[0])?.label ?? "1")
        : `${types.length} selected`;
  const angleLabel =
    selectedAngles.length === 0
      ? "Any"
      : selectedAngles.length === 1
        ? selectedAngles[0]!
        : `${selectedAngles.length} selected`;

  const toggleExcluded = () => {
    const nextOn = !includeExcluded;
    rememberIncludeExcluded(nextOn); // remember as this user's default
    update((next) => {
      next.set("includeExcluded", nextOn ? "1" : "0");
    });
  };

  // CLEAR CLEARS TIER-2 FILTERS AND NOTHING ELSE (D19, the house rule): the
  // date range, the Excluded toggle and the tier-1 Platforms stay put.
  const clearAll = () => {
    update((next) => {
      for (const key of STRIP_TIER2_KEYS) next.delete(key);
    });
  };

  // The offered set: narrowed on creative-granularity pages (and /funnel).
  const platformOptions =
    platformScope === "creative" ? PLATFORMS_WITH_CREATIVES : ALL_PLATFORMS;

  /** Clear has something to do — a tier-2 filter is on. */
  const filtersActive =
    productIds.length > 0 || types.length > 0 || selectedAngles.length > 0;
  // An empty state's "Clear filters" calls THIS Clear (D24, lib/filter-scope).
  useRegisterFilterScope(clearAll, filtersActive);

  const activeCount =
    (from || to ? 1 : 0) +
    (selectedPlatforms.length > 0 ? 1 : 0) +
    (productIds.length > 0 ? 1 : 0) +
    (types.length > 0 ? 1 : 0) +
    (selectedAngles.length > 0 ? 1 : 0) +
    (includeExcluded ? 1 : 0);

  // Canonical control order: Date → dimension pills (Platforms, Products, Type,
  // Angles). Rendered inline on desktop and stacked full-width inside the mobile
  // Sheet via `fullWidth`.
  const dimensionControls = (fullWidth: boolean) => (
    <>
      <DateRangePicker
        from={from}
        to={to}
        onChange={applyRange}
        remember={rememberDate}
        fullWidth={fullWidth}
        fallback={
          defaultFrom && defaultTo
            ? { from: defaultFrom, to: defaultTo }
            : undefined
        }
      />

      <PlatformsPill
        options={platformOptions}
        selected={selectedPlatforms}
        onToggle={togglePlatform}
        fullWidth={fullWidth}
      />

      <FilterPill
        icon={Package}
        label="Products"
        value={productLabel}
        active={productIds.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Products</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {products.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-ink-3">No products yet</div>
            )}
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

      {!hideType && (
        <FilterPill
          icon={Shapes}
          label="Type"
          value={typeLabel}
          active={types.length > 0}
          fullWidth={fullWidth}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {TYPES.map((t) => (
                <DropdownMenuCheckboxItem
                  key={t.value}
                  checked={types.includes(t.value)}
                  onCheckedChange={() => toggleMulti("types", t.value, types)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {t.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>
      )}

      <FilterPill
        icon={Tag}
        label="Angles"
        value={angleLabel}
        active={selectedAngles.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Angles</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {angles.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-ink-3">No angles yet</div>
            )}
            {angles.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={selectedAngles.includes(t)}
                onCheckedChange={() => toggleMulti("angles", t, selectedAngles)}
                onSelect={(e) => e.preventDefault()}
              >
                {t}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>
    </>
  );

  return (
    <div className="sticky top-14 z-10 border-b border-line bg-background/95 backdrop-blur">
      {/* Desktop / wide: one inline row */}
      {/* Wraps, like FilterShell's tier 1: a crowded row (seven controls in
          ~1040px beside the sidebar) moves Excluded + Clear to a second
          line instead of squeezing a label onto two lines or scrolling
          Clear out of sight (W3). */}
      <div className="hidden lg:flex flex-wrap items-center gap-2 px-6 py-2 min-h-12">
        {dimensionControls(false)}
        <div className="ml-auto flex items-center gap-2">
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} />
          {filtersActive && <ClearButton onClick={clearAll} />}
        </div>
      </div>

      {/* Mobile / tablet: collapse into a single Filters Sheet */}
      <div className="flex lg:hidden items-center gap-2 px-6 h-12">
        <FilterSheet activeCount={activeCount} onClear={clearAll} clearable={filtersActive}>
          {dimensionControls(true)}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth />
        </FilterSheet>
      </div>
    </div>
  );
}

