"use client";

import {
  Activity,
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
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { cn } from "@/lib/utils";
import {
  IDENTITY_COLUMN_KEYS,
  MAX_PLATFORMS,
  METRIC_COLUMN_KEYS,
  parseRateFilter,
  parseStatusFilter,
  serializeRateFilter,
  serializeStatusFilter,
  type IdentityColumnKey,
  type MetricColumnKey,
  type MetricFilterScope,
} from "@/validators/summary";
import { RATING_META, RATING_VALUES, type Rating } from "@/lib/rating";
import {
  CREATIVE_STATUSES,
  STATUS_DOT,
  STATUS_LABEL,
  type CreativeStatus,
} from "@/lib/creative-status";
import { PLATFORM_LABEL } from "@/lib/palette";
import { platformEnum, creativeTypeEnum } from "@/db/schema";
import { MetricFilterControl } from "@/components/summary/metric-filter";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";

interface Props {
  products: Array<{ id: string; name: string }>;
  tags: string[];
  /** Effective platforms shown in the table — feeds the metric-filter + rate scope pickers. */
  effectivePlatforms: string[];
  /** Saved views for the Views control. */
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
}

// Derived from the canonical enums so the option lists can never drift from the
// live platform/type set (a new platform added to the schema shows up here for
// free). Labels come from the shared PLATFORM_LABEL map / a local type map.
const TYPE_LABEL: Record<(typeof creativeTypeEnum)[number], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};
const PLATFORMS = platformEnum.map((value) => ({
  value,
  label: PLATFORM_LABEL[value] ?? value,
}));
const TYPES = creativeTypeEnum.map((value) => ({
  value,
  label: TYPE_LABEL[value] ?? value,
}));

const ALL_PLATFORM_VALUES = PLATFORMS.map((p) => p.value);
// Sentinel meaning "the user deliberately deselected every platform" — distinct
// from an absent param (which defaults to all). Parses to [] server-side.
const PLATFORMS_NONE = "none";

/** Human labels for the Columns dropdown — must match the keys in validators/summary. */
const IDENTITY_LABELS: Record<IdentityColumnKey, string> = {
  product: "Product",
  type: "Type",
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
  complete_rate: "Complete rate",
  landing_page_views: "Landing page views",
  voc: "VOC",
  cvr: "CvR",
};

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
  defaultFrom,
  defaultTo,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // No `platforms` param → all platforms (the default). The "none" sentinel →
  // nothing selected (user cleared them). Otherwise the listed subset.
  const rawPlatforms = searchParams.get("platforms");
  const platforms =
    rawPlatforms === null
      ? ALL_PLATFORM_VALUES
      : rawPlatforms === PLATFORMS_NONE
        ? []
        : csv(rawPlatforms).slice(0, MAX_PLATFORMS);
  const productIds = csv(searchParams.get("productIds"));
  const types = csv(searchParams.get("types"));
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

  // Dynamic-status filter — same shape as the rate filter: scope in local state
  // (so a scope can be picked before any status is checked), statuses in the URL.
  const statusParam = searchParams.get("status");
  const parsedStatus = useMemo(() => parseStatusFilter(statusParam), [statusParam]);
  const statusValues = parsedStatus?.statuses ?? [];
  const [statusScope, setStatusScope] = useState<MetricFilterScope>(
    parsedStatus?.scope ?? "total",
  );
  useEffect(() => {
    if (parsedStatus?.scope) setStatusScope(parsedStatus.scope);
  }, [parsedStatus?.scope]);

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
      if (set.size === 0)
        next.set("platforms", PLATFORMS_NONE); // explicit "show nothing"
      else if (set.size >= ALL_PLATFORM_VALUES.length)
        next.delete("platforms"); // all selected = the default → clean URL
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
    });

  const applyRange = (nextFrom: string | null, nextTo: string | null) => {
    update((next) => {
      if (nextFrom) next.set("from", nextFrom);
      else next.delete("from");
      if (nextTo) next.set("to", nextTo);
      else next.delete("to");
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

  // Status filter: toggle a status in/out of the active set (URL param
  // `status=<scope>:<statuses>`); change scope while keeping selected statuses.
  const writeStatus = (scope: MetricFilterScope, statuses: CreativeStatus[]) =>
    update((next) => {
      if (statuses.length === 0) next.delete("status");
      else next.set("status", serializeStatusFilter({ scope, statuses }));
    });
  const toggleStatus = (s: CreativeStatus) => {
    const set = new Set(statusValues);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    writeStatus(statusScope, [...set]);
  };
  const changeStatusScope = (scope: MetricFilterScope) => {
    setStatusScope(scope);
    if (statusValues.length > 0) writeStatus(scope, statusValues);
  };

  const filtersActive =
    urlQ.length > 0 ||
    productIds.length > 0 ||
    types.length > 0 ||
    selectedTags.length > 0 ||
    // A platform filter is "active" only when the URL explicitly sets it — the
    // default (no param) resolves `platforms` to all 5, so `platforms.length`
    // would otherwise be permanently truthy and pin the "Clear" button on.
    rawPlatforms !== null ||
    !!from ||
    !!to ||
    includeExcluded ||
    rateRatings.length > 0 ||
    statusValues.length > 0 ||
    !!searchParams.get("metricFilters");

  const clearAll = () =>
    update((next) => {
      [
        "q",
        "productIds",
        "types",
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
        "status",
      ].forEach((k) => next.delete(k));
    });

  const hiddenColumnsCount =
    hiddenIdentity.length + hiddenMetrics.length + (rateHidden ? 1 : 0);

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

  // Scopes the Status filter can target: the general roll-up (Total) + each
  // shown platform's per-platform status.
  const statusScopeOptions: Array<{ value: MetricFilterScope; label: string }> = [
    { value: "total", label: "Total" },
    ...effectivePlatforms.map((p) => ({
      value: p as MetricFilterScope,
      label: PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL] ?? p,
    })),
  ];
  const statusLabel =
    statusValues.length === 0
      ? "Any"
      : `${statusScope === "total" ? "Total" : PLATFORM_LABEL[statusScope as keyof typeof PLATFORM_LABEL] ?? statusScope} · ${statusValues.length}`;

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
        <DateRangePicker
          from={from}
          to={to}
          onChange={applyRange}
          remember
          fallback={
            defaultFrom && defaultTo
              ? { from: defaultFrom, to: defaultTo }
              : undefined
          }
        />

        {/* Platforms — select any number */}
        <FilterPill
          icon={Layers}
          label="Platforms"
          value={
            platforms.length === 0
              ? "None"
              : platforms.length >= ALL_PLATFORM_VALUES.length
                ? "All"
                : platforms.length === 1
                  ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
                  : `${platforms.length} selected`
          }
          active={platforms.length < ALL_PLATFORM_VALUES.length}
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
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={!blendedHidden}
                onCheckedChange={toggleBlended}
                onSelect={(e) => e.preventDefault()}
              >
                Blended total (weighted)
              </DropdownMenuCheckboxItem>
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

        {/* Dynamic-status filter — keep only creatives at a given live status,
            on a chosen scope (general roll-up or one platform). */}
        <FilterPill
          icon={Activity}
          label="Live status"
          value={statusLabel}
          active={statusValues.length > 0}
        >
          {() => (
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Scope</DropdownMenuLabel>
              <div className="px-2 pb-2 flex flex-wrap gap-1">
                {statusScopeOptions.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => changeStatusScope(s.value)}
                    className={cn(
                      "px-2 h-6 rounded text-[11px] border transition-colors",
                      statusScope === s.value
                        ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
                        : "border-line text-ink-2 hover:text-ink hover:bg-surface-2",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CREATIVE_STATUSES.map((s) => {
                // Per-platform scopes never carry the whole-creative "new" state.
                const disabled = statusScope !== "total" && s === "new";
                return (
                  <DropdownMenuCheckboxItem
                    key={s}
                    checked={statusValues.includes(s)}
                    disabled={disabled}
                    onCheckedChange={() => toggleStatus(s)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: STATUS_DOT[s] }}
                      />
                      <span className={cn(disabled && "text-ink-3")}>
                        {STATUS_LABEL[s]}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
              {statusValues.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={() => writeStatus(statusScope, [])}
                    className="w-full text-left px-2 py-1.5 text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
                  >
                    Clear status filter
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
