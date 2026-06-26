"use client";

import {
  Eye,
  EyeOff,
  Layers,
  Package,
  Shapes,
  Tag,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useNavTransition } from "@/lib/nav-progress";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
] as const;

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

  const filtersActive = !!(
    from ||
    to ||
    platformsParam ||
    includeExcluded ||
    productIds.length > 0 ||
    types.length > 0 ||
    selectedTags.length > 0
  );

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2 px-6 h-12 overflow-x-auto">
        {/* Date range */}
        <DateRangePicker
          from={from}
          to={to}
          onChange={applyRange}
          remember={rememberDate}
          fallback={
            defaultFrom && defaultTo
              ? { from: defaultFrom, to: defaultTo }
              : undefined
          }
        />

        {/* Platforms */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">
              <Chip
                icon={Layers}
                label="Platforms"
                value={
                  selectedPlatforms.length === 0
                    ? "All"
                    : selectedPlatforms.length === 1
                      ? PLATFORMS.find((p) => p.value === selectedPlatforms[0])?.label ?? ""
                      : `${selectedPlatforms.length} selected`
                }
                active={selectedPlatforms.length > 0}
              />
            </button>
          </DropdownMenuTrigger>
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
        </DropdownMenu>

        {/* Products */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">
              <Chip
                icon={Package}
                label="Products"
                value={productLabel}
                active={productIds.length > 0}
              />
            </button>
          </DropdownMenuTrigger>
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
        </DropdownMenu>

        {/* Type */}
        {!hideType && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button">
                <Chip
                  icon={Shapes}
                  label="Type"
                  value={typeLabel}
                  active={types.length > 0}
                />
              </button>
            </DropdownMenuTrigger>
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
          </DropdownMenu>
        )}

        {/* Tags */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">
              <Chip
                icon={Tag}
                label="Tags"
                value={tagLabel}
                active={selectedTags.length > 0}
              />
            </button>
          </DropdownMenuTrigger>
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
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleExcluded}
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
              includeExcluded
                ? "border-warn/40 text-warn bg-warn/10"
                : "border-line text-ink-3 hover:text-ink hover:bg-surface-2",
            )}
            title={
              includeExcluded
                ? "Excluded records included in totals"
                : "Excluded records hidden from totals"
            }
          >
            {includeExcluded ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>
              {includeExcluded ? "Excluded shown" : "Excluded hidden"}
            </span>
          </button>
          {filtersActive && (
            <button
              type="button"
              onClick={clearAll}
              className="h-8 px-3 rounded-md border border-line text-xs text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChipProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  active?: boolean;
}

function Chip({ icon: Icon, label, value, active }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors cursor-default",
        active
          ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
          : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="text-ink-3">{label}</span>
      {value && <span className="text-ink">{value}</span>}
    </span>
  );
}

