"use client";

import {
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  Layers,
  Package,
  Shapes,
  Tag,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { DateRange } from "react-day-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DatePreset {
  key: string;
  label: string;
  days: number;
}

const DATE_PRESETS: DatePreset[] = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
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
}

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(days: number): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

function activePresetKey(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  for (const preset of DATE_PRESETS) {
    const r = presetRange(preset.days);
    if (r.from === from && r.to === to) return preset.key;
  }
  return null;
}

export function FilterStrip({ products = [], tags = [] }: FilterStripProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

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

  const dateLabel = useMemo(() => {
    const presetKey = activePresetKey(from, to);
    if (presetKey) {
      return DATE_PRESETS.find((p) => p.key === presetKey)!.label;
    }
    if (from && to) return `${from} → ${to}`;
    return "Last 30 days";
  }, [from, to]);

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

  const setPreset = (days: number) => {
    const range = presetRange(days);
    update((next) => {
      next.set("from", range.from);
      next.set("to", range.to);
    });
  };

  const setCustomRange = (fromDate: Date, toDate: Date) => {
    update((next) => {
      next.set("from", isoDate(fromDate));
      next.set("to", isoDate(toDate));
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
      next.delete("statuses");
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
        <DateRangeFilter
          from={from}
          to={to}
          setPreset={setPreset}
          setCustomRange={setCustomRange}
          dateLabel={dateLabel}
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

interface DateRangeFilterProps {
  from: string | null;
  to: string | null;
  setPreset: (days: number) => void;
  setCustomRange: (from: Date, to: Date) => void;
  dateLabel: string;
}

function DateRangeFilter({
  from,
  to,
  setPreset,
  setCustomRange,
  dateLabel,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"presets" | "custom">("presets");

  // Seed the calendar with the current URL range so the user picks up where
  // they left off.
  const initialRange: DateRange | undefined = useMemo(() => {
    if (from && to) {
      return { from: new Date(`${from}T00:00:00Z`), to: new Date(`${to}T00:00:00Z`) };
    }
    return undefined;
  }, [from, to]);
  const [pending, setPending] = useState<DateRange | undefined>(initialRange);

  const applyPending = () => {
    if (pending?.from && pending.to) {
      setCustomRange(pending.from, pending.to);
      setOpen(false);
      setMode("presets");
    }
  };

  const presetActive = activePresetKey(from, to);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setMode("presets");
          setPending(initialRange);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button">
          <Chip icon={CalendarDays} label="Date" value={dateLabel} active />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-auto">
        {mode === "presets" ? (
          <div className="w-56 p-1">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3">
              Date range
            </div>
            <div className="space-y-0.5">
              {DATE_PRESETS.map((p) => {
                const isActive = presetActive === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      setPreset(p.days);
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
                  >
                    <span className="flex-1 text-left">{p.label}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-brand" />}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setMode("custom")}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-2 hover:bg-surface-2 hover:text-ink border-t border-line mt-1"
              >
                <span className="flex-1 text-left">Custom range…</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-ink-3 px-1">
              Pick a custom range
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={pending?.from ?? new Date()}
              selected={pending}
              onSelect={setPending}
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode("presets")}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyPending}
                disabled={!pending?.from || !pending?.to}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
