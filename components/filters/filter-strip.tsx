"use client";

import { Layers, Package, Shapes, Tag } from "lucide-react";
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
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";

// Derived from the canonical platform list (lib/palette) — no hand-copied set.
const PLATFORMS = ALL_PLATFORMS.map((value) => ({
  value,
  label: PLATFORM_LABEL[value],
}));

const TYPES = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "slides", label: "Slides" },
] as const;

interface FilterStripProps {
  /** Product options for the Products filter. Empty → dropdown shows a hint. */
  products?: Array<{ id: string; name: string }>;
  /** Tag options for the Tags filter. */
  tags?: string[];
  /** Hide the Type filter — e.g. on the video-only diagnostics page. */
  hideType?: boolean;
  /** The effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  /** Persist the picked range as the user's global default. Off for pages where
   *  the date means something page-specific (e.g. Launches = launch cohort). */
  rememberDate?: boolean;
}

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function FilterStrip({
  products = [],
  tags = [],
  hideType = false,
  defaultFrom,
  defaultTo,
  rememberDate = true,
}: FilterStripProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const platformsParam = searchParams.get("platforms");
  const includeExcluded = searchParams.get("includeExcluded") === "1";
  const productIds = csv(searchParams.get("productIds"));
  const types = csv(searchParams.get("types"));
  const selectedTags = csv(searchParams.get("tags"));

  const selectedPlatforms = useMemo(
    () => (platformsParam ? platformsParam.split(",").filter(Boolean) : []),
    [platformsParam],
  );

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      // Drop empty keys for a clean URL.
      for (const [key, value] of [...next.entries()]) {
        if (!value) next.delete(key);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, searchParams],
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
  const tagLabel =
    selectedTags.length === 0
      ? "Any"
      : selectedTags.length === 1
        ? selectedTags[0]!
        : `${selectedTags.length} selected`;

  const toggleExcluded = () => {
    update((next) => {
      if (includeExcluded) next.delete("includeExcluded");
      else next.set("includeExcluded", "1");
    });
  };

  const clearAll = () => {
    update((next) => {
      next.delete("from");
      next.delete("to");
      next.delete("platforms");
      next.delete("includeExcluded");
      next.delete("productIds");
      next.delete("types");
      next.delete("tags");
    });
  };

  const platformLabel =
    selectedPlatforms.length === 0
      ? "All"
      : selectedPlatforms.length === 1
        ? (PLATFORMS.find((p) => p.value === selectedPlatforms[0])?.label ?? "")
        : `${selectedPlatforms.length} selected`;

  const filtersActive = !!(
    from ||
    to ||
    platformsParam ||
    includeExcluded ||
    productIds.length > 0 ||
    types.length > 0 ||
    selectedTags.length > 0
  );

  const activeCount =
    (from || to ? 1 : 0) +
    (selectedPlatforms.length > 0 ? 1 : 0) +
    (productIds.length > 0 ? 1 : 0) +
    (types.length > 0 ? 1 : 0) +
    (selectedTags.length > 0 ? 1 : 0) +
    (includeExcluded ? 1 : 0);

  // Canonical control order: Date → dimension pills (Platforms, Products, Type,
  // Tags). Rendered inline on desktop and stacked full-width inside the mobile
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

      <FilterPill
        icon={Layers}
        label="Platforms"
        value={platformLabel}
        active={selectedPlatforms.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Platforms</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PLATFORMS.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.value}
                checked={selectedPlatforms.includes(p.value)}
                onCheckedChange={() => togglePlatform(p.value)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

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
        label="Tags"
        value={tagLabel}
        active={selectedTags.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Tags</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tags.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-ink-3">No tags yet</div>
            )}
            {tags.map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={selectedTags.includes(t)}
                onCheckedChange={() => toggleMulti("tags", t, selectedTags)}
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
      <div className="hidden lg:flex items-center gap-2 px-6 h-12 overflow-x-auto">
        {dimensionControls(false)}
        <div className="ml-auto flex items-center gap-2">
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} />
          {filtersActive && <ClearButton onClick={clearAll} />}
        </div>
      </div>

      {/* Mobile / tablet: collapse into a single Filters Sheet */}
      <div className="flex lg:hidden items-center gap-2 px-6 h-12">
        <FilterSheet activeCount={activeCount} onClear={clearAll}>
          {dimensionControls(true)}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth />
        </FilterSheet>
      </div>
    </div>
  );
}

