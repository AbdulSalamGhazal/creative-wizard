"use client";

import { CalendarDays, Check, Eye, EyeOff, Layers, Package, Tag } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  { value: "meta", label: "Meta" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
] as const;

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

export function FilterStrip() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const platformsParam = searchParams.get("platforms");
  const includeExcluded = searchParams.get("includeExcluded") === "1";

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

  const togglePlatform = (value: string) => {
    const set = new Set(selectedPlatforms);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete("platforms");
      else next.set("platforms", [...set].join(","));
    });
  };

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

  const filtersActive = !!(from || to || platformsParam || includeExcluded);

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2 px-6 h-12 overflow-x-auto">
        {/* Date range */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button">
              <Chip icon={CalendarDays} label="Date" value={dateLabel} active />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Date range</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DATE_PRESETS.map((p) => {
              const active = activePresetKey(from, to) === p.key;
              return (
                <DropdownMenuItem key={p.key} onSelect={() => setPreset(p.days)}>
                  <span className="flex-1">{p.label}</span>
                  {active && <Check className="w-3.5 h-3.5 text-brand" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

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
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Products / Tags — placeholders until pickers exist */}
        <Chip icon={Package} label="Products" value="All" />
        <Chip icon={Tag} label="Tags" value="Any" />

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
