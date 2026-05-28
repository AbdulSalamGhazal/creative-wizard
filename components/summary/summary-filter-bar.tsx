"use client";

import {
  CalendarDays,
  CircleDot,
  ChevronDown,
  Layers,
  Package,
  Search,
  Shapes,
  Tag,
  Users,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import { MAX_PLATFORMS } from "@/validators/summary";
import type { DateRange } from "react-day-picker";

interface Props {
  products: Array<{ id: string; name: string }>;
  tags: string[];
  creators: Array<{ id: string; name: string; email: string }>;
}

const PLATFORMS = [
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
] as const;

const TYPES = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "slides", label: "Slides" },
] as const;

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

const DATE_PRESETS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function presetRange(days: number) {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}
function activePresetKey(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  for (const p of DATE_PRESETS) {
    const r = presetRange(p.days);
    if (r.from === from && r.to === to) return p.key;
  }
  return null;
}

function csv(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").filter(Boolean);
}

export function SummaryFilterBar({ products, tags, creators }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const platforms = csv(searchParams.get("platforms")).slice(0, MAX_PLATFORMS);
  const productIds = csv(searchParams.get("productIds"));
  const types = csv(searchParams.get("types"));
  const statuses = csv(searchParams.get("statuses"));
  const selectedTags = csv(searchParams.get("tags"));
  const creatorIds = csv(searchParams.get("creatorIds"));
  const includeExcluded = searchParams.get("includeExcluded") === "1";

  const urlQ = searchParams.get("q") ?? "";
  const [qInput, setQInput] = useState(urlQ);
  useEffect(() => setQInput(urlQ), [urlQ]);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      for (const [key, value] of [...next.entries()]) {
        if (!value) next.delete(key);
      }
      const qs = next.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  // Debounce search → URL
  useEffect(() => {
    if (qInput === urlQ) return;
    const id = setTimeout(() => {
      update((next) => {
        if (qInput.trim()) next.set("q", qInput.trim());
        else next.delete("q");
      });
    }, 250);
    return () => clearTimeout(id);
  }, [qInput, urlQ, update]);

  /**
   * Platform toggle with hard cap. Selecting a 4th platform when 3 are
   * already on is a no-op — we don't silently drop another, we just block
   * the add. The server-side validator clamps too, so a stale URL still
   * lands cleanly.
   */
  const togglePlatform = (value: string) => {
    const set = new Set(platforms);
    if (set.has(value)) set.delete(value);
    else {
      if (set.size >= MAX_PLATFORMS) return;
      set.add(value);
    }
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

  const setPreset = (days: number) => {
    const r = presetRange(days);
    update((next) => {
      next.set("from", r.from);
      next.set("to", r.to);
    });
  };
  const setCustomRange = (f: Date, t: Date) => {
    update((next) => {
      next.set("from", isoDate(f));
      next.set("to", isoDate(t));
    });
  };

  const toggleExcluded = () => {
    update((next) => {
      if (includeExcluded) next.delete("includeExcluded");
      else next.set("includeExcluded", "1");
    });
  };

  const filtersActive =
    urlQ.length > 0 ||
    productIds.length > 0 ||
    types.length > 0 ||
    statuses.length > 0 ||
    selectedTags.length > 0 ||
    creatorIds.length > 0 ||
    platforms.length > 0 ||
    !!from ||
    !!to ||
    includeExcluded;

  const clearAll = () =>
    update((next) => {
      [
        "q",
        "productIds",
        "types",
        "statuses",
        "tags",
        "creatorIds",
        "platforms",
        "from",
        "to",
        "includeExcluded",
        "sort",
        "dir",
      ].forEach((k) => next.delete(k));
    });

  const productLabel = useMemo(() => {
    if (productIds.length === 0) return "All";
    if (productIds.length === 1) {
      return products.find((p) => p.id === productIds[0])?.name ?? "1 selected";
    }
    return `${productIds.length} selected`;
  }, [productIds, products]);

  const creatorLabel = useMemo(() => {
    if (creatorIds.length === 0) return "Any";
    if (creatorIds.length === 1) {
      return creators.find((c) => c.id === creatorIds[0])?.name ?? "1 selected";
    }
    return `${creatorIds.length} selected`;
  }, [creatorIds, creators]);

  const dateLabel = useMemo(() => {
    const key = activePresetKey(from, to);
    if (key) return DATE_PRESETS.find((p) => p.key === key)!.label;
    if (from && to) return `${from} → ${to}`;
    return "All time";
  }, [from, to]);

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-3 border-b border-line bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search creative name…"
            className={cn(
              "h-8 pl-8 pr-3 rounded-md border border-line bg-surface text-xs text-ink",
              "placeholder:text-ink-3 outline-none focus:border-line-2",
              "w-56",
            )}
          />
        </div>

        {/* Date range */}
        <DateRangeFilter
          from={from}
          to={to}
          setPreset={setPreset}
          setCustomRange={setCustomRange}
          dateLabel={dateLabel}
        />

        {/* Platforms — max 3 */}
        <FilterPill
          icon={Layers}
          label={`Platforms (max ${MAX_PLATFORMS})`}
          value={
            platforms.length === 0
              ? "All"
              : platforms.length === 1
                ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
                : `${platforms.length} of ${MAX_PLATFORMS}`
          }
          active={platforms.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>
                Platforms · pick up to {MAX_PLATFORMS}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PLATFORMS.map((p) => {
                const checked = platforms.includes(p.value);
                const disabled = !checked && platforms.length >= MAX_PLATFORMS;
                return (
                  <DropdownMenuCheckboxItem
                    key={p.value}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => togglePlatform(p.value)}
                  >
                    <span className={cn(disabled && "text-ink-3")}>
                      {p.label}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
              {platforms.length >= MAX_PLATFORMS && (
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Deselect a platform to add another.
                </div>
              )}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Product */}
        <FilterPill
          icon={Package}
          label="Products"
          value={productLabel}
          active={productIds.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Products</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {products.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-ink-3">
                  No products yet
                </div>
              )}
              {products.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={productIds.includes(p.id)}
                  onCheckedChange={() =>
                    toggleMulti("productIds", p.id, productIds)
                  }
                >
                  {p.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Type */}
        <FilterPill
          icon={Shapes}
          label="Types"
          value={
            types.length === 0
              ? "All"
              : types.length === 1
                ? (TYPES.find((t) => t.value === types[0])?.label ?? "1")
                : `${types.length} selected`
          }
          active={types.length > 0}
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
                >
                  {t.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Status */}
        <FilterPill
          icon={CircleDot}
          label="Status"
          value={
            statuses.length === 0
              ? "Any"
              : statuses.length === 1
                ? (STATUSES.find((s) => s.value === statuses[0])?.label ?? "1")
                : `${statuses.length} selected`
          }
          active={statuses.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s.value}
                  checked={statuses.includes(s.value)}
                  onCheckedChange={() =>
                    toggleMulti("statuses", s.value, statuses)
                  }
                >
                  {s.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Tags */}
        <FilterPill
          icon={Tag}
          label="Tags"
          value={
            selectedTags.length === 0
              ? "Any"
              : selectedTags.length === 1
                ? selectedTags[0]!
                : `${selectedTags.length} selected`
          }
          active={selectedTags.length > 0}
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
                >
                  {t}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Creator */}
        <FilterPill
          icon={Users}
          label="Creator"
          value={creatorLabel}
          active={creatorIds.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Creator</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {creators.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-ink-3">
                  No creators yet
                </div>
              )}
              {creators.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={creatorIds.includes(c.id)}
                  onCheckedChange={() =>
                    toggleMulti("creatorIds", c.id, creatorIds)
                  }
                >
                  <div className="flex flex-col">
                    <span>{c.name}</span>
                    <span className="text-[10px] font-mono text-ink-3">
                      {c.email}
                    </span>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

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
            {includeExcluded ? "Excluded shown" : "Excluded hidden"}
          </button>
          {filtersActive && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-line text-xs text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface PillProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  active: boolean;
  children: () => React.ReactNode;
}

function FilterPill({ icon: Icon, label, value, active, children }: PillProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            active
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="text-ink-3">{label}</span>
          <span className="text-ink">{value}</span>
          <ChevronDown className="w-3 h-3 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      {children()}
    </DropdownMenu>
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
  const initialRange: DateRange | undefined = useMemo(() => {
    if (from && to) {
      return {
        from: new Date(`${from}T00:00:00Z`),
        to: new Date(`${to}T00:00:00Z`),
      };
    }
    return undefined;
  }, [from, to]);
  const [pending, setPending] = useState<DateRange | undefined>(initialRange);
  const apply = () => {
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
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            from || to
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          <span className="text-ink-3">Date</span>
          <span className="text-ink">{dateLabel}</span>
          <ChevronDown className="w-3 h-3 text-ink-3" />
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
                    {isActive && (
                      <span className="text-brand text-xs">✓</span>
                    )}
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
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={pending?.from ?? new Date()}
              selected={pending}
              onSelect={setPending}
            />
            <div className="flex items-center justify-between gap-2">
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
                onClick={apply}
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
