"use client";

import {
  CalendarDays,
  CircleDot,
  ChevronDown,
  Columns3,
  Layers,
  Package,
  Search,
  Shapes,
  Star,
  Tag,
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
import {
  IDENTITY_COLUMN_KEYS,
  MAX_PLATFORMS,
  METRIC_COLUMN_KEYS,
  parseRateFilter,
  serializeRateFilter,
  type IdentityColumnKey,
  type MetricColumnKey,
  type MetricFilterScope,
} from "@/validators/summary";
import { RATING_META, RATING_VALUES, type Rating } from "@/lib/rating";
import { PLATFORM_LABEL } from "@/lib/palette";
import { MetricFilterControl } from "@/components/summary/metric-filter";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import type { DateRange } from "react-day-picker";

interface Props {
  products: Array<{ id: string; name: string }>;
  tags: string[];
  /** Effective platforms shown in the table — feeds the metric-filter + rate scope pickers. */
  effectivePlatforms: string[];
  /** Saved views for the Views control. */
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
}

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

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
] as const;

/** Human labels for the Columns dropdown — must match the keys in validators/summary. */
const IDENTITY_LABELS: Record<IdentityColumnKey, string> = {
  product: "Product",
  type: "Type",
  status: "Status",
  creator: "Creator",
};
const METRIC_LABELS: Record<MetricColumnKey, string> = {
  spend: "Spend",
  impressions: "Impressions",
  clicks: "Clicks",
  conversions: "Conversions",
  ctr: "CTR",
  cpm: "CPM",
  cpc: "CPC",
  cpa: "CPA",
  roas: "ROAS",
  hook_rate: "Hook rate",
  hold_rate: "Hold rate",
  landing_page_views: "Landing page views",
  voc: "VOC",
};

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

export function SummaryFilterBar({
  products,
  tags,
  effectivePlatforms,
  views,
  currentUserId,
  isAdmin,
}: Props) {
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
  const includeExcluded = searchParams.get("includeExcluded") === "1";
  const hiddenIdentity = csv(searchParams.get("hideIdentity")).filter(
    (k): k is IdentityColumnKey =>
      (IDENTITY_COLUMN_KEYS as readonly string[]).includes(k),
  );
  const hiddenMetrics = csv(searchParams.get("hideMetrics")).filter(
    (k): k is MetricColumnKey =>
      (METRIC_COLUMN_KEYS as readonly string[]).includes(k),
  );
  const rateHidden = searchParams.get("hideRate") === "1";
  const blendedHidden = searchParams.get("hideBlended") === "1";

  // Rate filter — scope is kept in local state so the user can pick a scope
  // before any ratings are checked (the URL only carries it once a rating is
  // selected). Re-sync if the URL scope changes (e.g. a view is applied).
  const rateParam = searchParams.get("rate");
  const parsedRate = useMemo(() => parseRateFilter(rateParam), [rateParam]);
  const rateRatings = parsedRate?.ratings ?? [];
  const [rateScope, setRateScope] = useState<MetricFilterScope>(
    parsedRate?.scope ?? "total",
  );
  useEffect(() => {
    if (parsedRate?.scope) setRateScope(parsedRate.scope);
  }, [parsedRate?.scope]);

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

  /**
   * Column visibility uses an opt-out URL pattern: the param holds *hidden*
   * columns, so the default "show all" needs no URL state. Visible = checked;
   * unchecking adds the key to the hidden list.
   */
  const toggleColumn = (
    paramKey: "hideIdentity" | "hideMetrics",
    columnKey: string,
    currentHidden: string[],
  ) => {
    const set = new Set(currentHidden);
    if (set.has(columnKey)) set.delete(columnKey);
    else set.add(columnKey);
    update((next) => {
      if (set.size === 0) next.delete(paramKey);
      else next.set(paramKey, [...set].join(","));
    });
  };

  // The Rate column is a single boolean (shown by default). Unchecking sets
  // hideRate=1; checking removes the param.
  const toggleRate = () =>
    update((next) => {
      if (rateHidden) next.delete("hideRate");
      else next.set("hideRate", "1");
    });

  // Blended Total is a single boolean (shown by default), toggled like Rate.
  const toggleBlended = () =>
    update((next) => {
      if (blendedHidden) next.delete("hideBlended");
      else next.set("hideBlended", "1");
    });

  const showAllColumns = () =>
    update((next) => {
      next.delete("hideIdentity");
      next.delete("hideMetrics");
      next.delete("hideRate");
      next.delete("hideBlended");
    });

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

  // Rate filter: toggle a rating in/out of the active set (URL param
  // `rate=<scope>:<ratings>`); change scope while keeping selected ratings.
  const writeRate = (scope: MetricFilterScope, ratings: Rating[]) =>
    update((next) => {
      if (ratings.length === 0) next.delete("rate");
      else next.set("rate", serializeRateFilter({ scope, ratings }));
    });
  const toggleRating = (r: Rating) => {
    const set = new Set(rateRatings);
    if (set.has(r)) set.delete(r);
    else set.add(r);
    writeRate(rateScope, [...set]);
  };
  const changeRateScope = (scope: MetricFilterScope) => {
    setRateScope(scope);
    if (rateRatings.length > 0) writeRate(scope, rateRatings);
  };

  const filtersActive =
    urlQ.length > 0 ||
    productIds.length > 0 ||
    types.length > 0 ||
    statuses.length > 0 ||
    selectedTags.length > 0 ||
    platforms.length > 0 ||
    !!from ||
    !!to ||
    includeExcluded ||
    rateRatings.length > 0 ||
    !!searchParams.get("metricFilters");

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
        "hideIdentity",
        "hideMetrics",
        "hideRate",
        "hideBlended",
        "metricFilters",
        "rate",
      ].forEach((k) => next.delete(k));
    });

  const hiddenColumnsCount =
    hiddenIdentity.length +
    hiddenMetrics.length +
    (rateHidden ? 1 : 0) +
    (blendedHidden ? 1 : 0);

  const productLabel = useMemo(() => {
    if (productIds.length === 0) return "All";
    if (productIds.length === 1) {
      return products.find((p) => p.id === productIds[0])?.name ?? "1 selected";
    }
    return `${productIds.length} selected`;
  }, [productIds, products]);

  // Scopes the Rate filter can target: the blended total + each shown platform.
  const rateScopeOptions: Array<{ value: MetricFilterScope; label: string }> = [
    { value: "total", label: "Total" },
    ...effectivePlatforms.map((p) => ({
      value: p as MetricFilterScope,
      label: PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p,
    })),
  ];
  const rateLabel =
    rateRatings.length === 0
      ? "Any"
      : `${rateScope === "total" ? "Total" : PLATFORM_LABEL[rateScope as keyof typeof PLATFORM_LABEL] ?? rateScope} · ${rateRatings.length}`;

  const dateLabel = useMemo(() => {
    const key = activePresetKey(from, to);
    if (key) return DATE_PRESETS.find((p) => p.key === key)!.label;
    if (from && to) return `${from} → ${to}`;
    return "All time";
  }, [from, to]);

  return (
    <div className="sticky top-0 z-20 -mx-6 px-6 py-3 border-b border-line bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Saved views */}
        <ViewsControl
          views={views}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />

        <span className="w-px h-5 bg-line" aria-hidden />

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

        {/* Platforms — select any number */}
        <FilterPill
          icon={Layers}
          label="Platforms"
          value={
            platforms.length === 0
              ? "All"
              : platforms.length === 1
                ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
                : `${platforms.length} selected`
          }
          active={platforms.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>
                Platforms · show any
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
                    onSelect={(e) => e.preventDefault()}
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
                  onSelect={(e) => e.preventDefault()}
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
                  onSelect={(e) => e.preventDefault()}
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
                  onSelect={(e) => e.preventDefault()}
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
                  onSelect={(e) => e.preventDefault()}
                >
                  {t}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Rate filter — keep only creatives at a given rating, on a chosen scope */}
        <FilterPill
          icon={Star}
          label="Rate"
          value={rateLabel}
          active={rateRatings.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Scope</DropdownMenuLabel>
              <div className="px-2 pb-2 flex flex-wrap gap-1">
                {rateScopeOptions.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => changeRateScope(s.value)}
                    className={cn(
                      "px-2 h-6 rounded text-[11px] border transition-colors",
                      rateScope === s.value
                        ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
                        : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Rating</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {RATING_VALUES.map((r) => (
                <DropdownMenuCheckboxItem
                  key={r}
                  checked={rateRatings.includes(r as Rating)}
                  onCheckedChange={() => toggleRating(r as Rating)}
                  onSelect={(e) => e.preventDefault()}
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center h-5 px-1.5 rounded text-[10px] border whitespace-nowrap",
                      RATING_META[r as Rating].badgeClass,
                    )}
                  >
                    {RATING_META[r as Rating].label}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {rateRatings.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={() => writeRate(rateScope, [])}
                    className="w-full text-left px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
                  >
                    Clear rating filter
                  </button>
                </>
              )}
            </DropdownMenuContent>
          )}
        </FilterPill>

        {/* Numeric metric filters (ROAS ≥ 2, Spend ≥ 500, …) */}
        <MetricFilterControl platforms={effectivePlatforms} />

        <div className="ml-auto flex items-center gap-2">
          {/* Columns visibility — opt-out (URL only lists hidden columns) */}
          <FilterPill
            icon={Columns3}
            label="Columns"
            value={
              hiddenColumnsCount === 0
                ? "All shown"
                : `${hiddenColumnsCount} hidden`
            }
            active={hiddenColumnsCount > 0}
          >
            {() => (
              <DropdownMenuContent
                align="end"
                className="w-64 max-h-[28rem] overflow-y-auto"
              >
                <DropdownMenuLabel>Identity columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Creative name is always shown.
                </div>
                {IDENTITY_COLUMN_KEYS.map((k) => (
                  <DropdownMenuCheckboxItem
                    key={k}
                    checked={!hiddenIdentity.includes(k)}
                    onCheckedChange={() =>
                      toggleColumn("hideIdentity", k, hiddenIdentity)
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {IDENTITY_LABELS[k]}
                  </DropdownMenuCheckboxItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Metric columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Applies to every platform group and the Blended total.
                </div>
                {METRIC_COLUMN_KEYS.map((k) => (
                  <DropdownMenuCheckboxItem
                    key={k}
                    checked={!hiddenMetrics.includes(k)}
                    onCheckedChange={() =>
                      toggleColumn("hideMetrics", k, hiddenMetrics)
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {METRIC_LABELS[k]}
                  </DropdownMenuCheckboxItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Rating</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Leads each platform group and the Blended total.
                </div>
                <DropdownMenuCheckboxItem
                  checked={!rateHidden}
                  onCheckedChange={toggleRate}
                  onSelect={(e) => e.preventDefault()}
                >
                  Rate
                </DropdownMenuCheckboxItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Blended total</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Weighted aggregate column across the selected platforms.
                </div>
                <DropdownMenuCheckboxItem
                  checked={!blendedHidden}
                  onCheckedChange={toggleBlended}
                  onSelect={(e) => e.preventDefault()}
                >
                  Blended total
                </DropdownMenuCheckboxItem>

                {hiddenColumnsCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <button
                      type="button"
                      onClick={showAllColumns}
                      className="w-full text-left px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
                    >
                      Show all columns
                    </button>
                  </>
                )}
              </DropdownMenuContent>
            )}
          </FilterPill>

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
