"use client";

import { Columns3, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFilterParams } from "@/components/filters/use-filter-params";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import {
  ExcludedToggle,
  FilterPill,
  FilterSearch,
} from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import type { FilterDef } from "@/components/filters/filter-model";
import { cn } from "@/lib/utils";
import {
  IDENTITY_COLUMN_KEYS,
  MAX_PLATFORMS,
  METRIC_COLUMN_KEYS,
  metricConditionLabel,
  parseMetricFilters,
  parseRateFilter,
  parseStatusFilter,
  serializeMetricFilters,
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
import { PLATFORMS_WITH_CREATIVES, PLATFORM_LABEL } from "@/lib/palette";
import { STAGE_FILTER_VALUES, stageFilterLabel } from "@/lib/funnel-stages";
import {
  PRIORITY_FILTER_LABEL,
  PRIORITY_FILTER_VALUES,
  type PriorityFilterValue,
} from "@/lib/priority";
import { creativeTypeEnum } from "@/db/schema";
import { MetricFilterControl } from "@/components/summary/metric-filter";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { setIncludeExcludedPref } from "@/app/actions/user-prefs";

interface Props {
  products: Array<{ id: string; name: string }>;
  angles: string[];
  /** Effective platforms shown in the table — feeds the metric-filter + rate scope pickers. */
  effectivePlatforms: string[];
  /** Saved views for the Views control. */
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  /** The user's saved Excluded-toggle default (URL param overrides it). */
  includeExcludedDefault?: boolean;
  /**
   * Remembered filters, as the server resolved them for this render (URL →
   * this user's saved value for this brand → nothing). The bar reads its own
   * params through them, so the chips say what actually ran.
   */
  resolvedFilters?: Record<string, string | undefined>;
}

// Derived from the canonical enums so the option lists can never drift from the
// live platform/type set (a new platform added to the schema shows up here for
// free). Labels come from the shared PLATFORM_LABEL map / a local type map.
const TYPE_LABEL: Record<(typeof creativeTypeEnum)[number], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};
// Ads is a per-CREATIVE table: only platforms that HAVE creatives can be a
// column group here (google has no creative concept — lib/palette).
const PLATFORMS = PLATFORMS_WITH_CREATIVES.map((value) => ({
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
  priority: "Priority",
  stage: "Stage",
  creator: "Creator",
  launch: "Launch date",
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
  angles,
  effectivePlatforms,
  views,
  currentUserId,
  isAdmin,
  defaultFrom,
  defaultTo,
  includeExcludedDefault,
  resolvedFilters,
}: Props) {
  // Writes COMPOSE within a tick — see useFilterParams. Clear touches every
  // declared filter at once, and must land as ONE navigation.
  // `resolvedFilters` is the server's URL→preference→default answer: a
  // remembered filter shows its chip on a bare URL, and removing that chip
  // deletes the preference instead of resurrecting it.
  const { searchParams, update, get } = useFilterParams(resolvedFilters);

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // No `platforms` param → all platforms (the default). The "none" sentinel →
  // nothing selected (user cleared them). Otherwise the listed subset.
  const rawPlatforms = get("platforms");
  const platforms =
    rawPlatforms === null
      ? ALL_PLATFORM_VALUES
      : rawPlatforms === PLATFORMS_NONE
        ? []
        : csv(rawPlatforms).slice(0, MAX_PLATFORMS);
  const productIds = csv(get("productIds"));
  const types = csv(get("types"));
  const priorities = csv(get("priorities"));
  const stages = csv(get("stages"));
  const selectedAngles = csv(get("angles"));
  // Effective Excluded state: explicit URL param wins, else the saved
  // per-user preference the server resolved into `includeExcludedDefault`.
  const rawIncludeExcluded = searchParams.get("includeExcluded");
  const includeExcluded =
    rawIncludeExcluded !== null
      ? rawIncludeExcluded === "1"
      : (includeExcludedDefault ?? false);
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
  const rateParam = get("rate");
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
  const statusParam = get("status");
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
  // The search input is the source of truth while the user types; the URL `q` is
  // just a debounced side effect. We must NOT mirror the URL back into the input
  // for our own writes — a navigation that lands a few keystrokes late would
  // otherwise reset the field and eat the characters typed since. So we track
  // the values we've pushed and only adopt a `q` change that we DIDN'T originate
  // (Clear, a saved view, browser back/forward).
  const pendingQPushes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pendingQPushes.current.has(urlQ)) {
      // Our own debounced write echoing back — consume it, keep the (possibly
      // newer) text the user has typed in the meantime.
      pendingQPushes.current.delete(urlQ);
      return;
    }
    // Genuine external change → adopt it and drop any of our now-stale writes.
    pendingQPushes.current.clear();
    setQInput(urlQ);
  }, [urlQ]);

  // Debounce search → URL. Compare the TRIMMED input against the URL so a
  // trailing space the user just typed doesn't loop a no-op write.
  useEffect(() => {
    const trimmed = qInput.trim();
    if (trimmed === urlQ) return;
    const id = setTimeout(() => {
      // Record the value before navigating so the URL echo above is recognised
      // as ours and doesn't clobber the input.
      pendingQPushes.current.add(trimmed);
      update((next) => {
        if (trimmed) next.set("q", trimmed);
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

  /** The shell hands back the WHOLE next value of a multi filter. */
  const writeMulti = (key: string, values: readonly string[]) =>
    update((next) => {
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
    });

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
    const nextOn = !includeExcluded;
    void setIncludeExcludedPref(nextOn); // remember as this user's default
    update((next) => {
      next.set("includeExcluded", nextOn ? "1" : "0");
    });
  };

  // Rate filter: toggle a rating in/out of the active set (URL param
  // `rate=<scope>:<ratings>`); change scope while keeping selected ratings.
  const writeRate = (scope: MetricFilterScope, ratings: Rating[]) =>
    update((next) => {
      if (ratings.length === 0) next.delete("rate");
      else next.set("rate", serializeRateFilter({ scope, ratings }));
    });
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
  const changeStatusScope = (scope: MetricFilterScope) => {
    setStatusScope(scope);
    if (statusValues.length > 0) writeStatus(scope, statusValues);
  };

  // Scopes a status/rate/metric rule can target: the blended total, or one of
  // the platforms actually shown.
  const scopeLabel = (scope: MetricFilterScope) =>
    scope === "total"
      ? "Total"
      : (PLATFORM_LABEL[scope as keyof typeof PLATFORM_LABEL] ?? scope);
  const scopeOptions: Array<{ value: MetricFilterScope; label: string }> = [
    { value: "total", label: "Total" },
    ...effectivePlatforms.map((p) => ({
      value: p as MetricFilterScope,
      label: scopeLabel(p as MetricFilterScope),
    })),
  ];

  const metricConditions = useMemo(
    () => parseMetricFilters(searchParams.get("metricFilters")),
    [searchParams],
  );

  // ── TIER 2: the panel's filters, DECLARED ─────────────────────────────────
  // One entry each. The shell derives the panel row, the chip, the count badge
  // and the mobile sheet from it — adding a filter here is the whole diff.
  const filters: FilterDef[] = [
    {
      key: "status",
      label: "Live status",
      type: "multi",
      options: CREATIVE_STATUSES.map((s) => ({
        value: s,
        label: STATUS_LABEL[s],
        dot: STATUS_DOT[s],
      })),
      values: statusValues,
      onChange: (next) => writeStatus(statusScope, next as CreativeStatus[]),
      header: (
        <ScopePicker
          options={scopeOptions}
          value={statusScope}
          onChange={changeStatusScope}
          ariaLabel="Status scope"
        />
      ),
      // The scope is part of the question ("Instagram · 2"), so it rides the chip.
      chipFormat: (v) => `${scopeLabel(statusScope)} · ${v.length}`,
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
      key: "types",
      label: "Type",
      type: "multi",
      options: TYPES.map((t) => ({ value: t.value, label: t.label })),
      values: types,
      onChange: (next) => writeMulti("types", next),
    },
    {
      key: "angles",
      label: "Angles",
      type: "multi",
      options: angles.map((a) => ({ value: a, label: a })),
      values: selectedAngles,
      onChange: (next) => writeMulti("angles", next),
      emptyHint: "No angles yet",
    },
    {
      key: "priorities",
      label: "Priority",
      type: "multi",
      options: PRIORITY_FILTER_VALUES.map((v) => ({
        value: v,
        label: PRIORITY_FILTER_LABEL[v as PriorityFilterValue],
      })),
      values: priorities,
      onChange: (next) => writeMulti("priorities", next),
    },
    {
      key: "stages",
      label: "Stage",
      type: "multi",
      options: STAGE_FILTER_VALUES.map((v) => ({ value: v, label: stageFilterLabel(v) })),
      values: stages,
      onChange: (next) => writeMulti("stages", next),
    },
    {
      key: "rate",
      label: "Rate",
      type: "multi",
      options: RATING_VALUES.map((r) => ({
        value: r,
        label: RATING_META[r as Rating].label,
      })),
      values: rateRatings,
      onChange: (next) => writeRate(rateScope, next as Rating[]),
      header: (
        <ScopePicker
          options={scopeOptions}
          value={rateScope}
          onChange={changeRateScope}
          ariaLabel="Rate scope"
        />
      ),
      chipFormat: (v) => `${scopeLabel(rateScope)} · ${v.length}`,
    },
    {
      // The rule builder keeps its own component — a CUSTOM def, so the badge,
      // the chips and Clear still work without the shell knowing its shape.
      key: "metricFilters",
      label: "Metric rules",
      type: "custom",
      active: metricConditions.length > 0,
      chips: metricConditions.map((c, i) => ({
        key: `metricFilters:${i}`,
        label: metricConditionLabel(c, scopeLabel),
        onRemove: () =>
          update((next) => {
            const rest = metricConditions.filter((_, j) => j !== i);
            if (rest.length === 0) next.delete("metricFilters");
            else next.set("metricFilters", serializeMetricFilters(rest));
          }),
      })),
      onClear: () => update((next) => next.delete("metricFilters")),
      render: () => <MetricFilterControl platforms={effectivePlatforms} />,
    },
  ];

  const hiddenColumnsCount =
    hiddenIdentity.length + hiddenMetrics.length + (rateHidden ? 1 : 0);

  return (
    <FilterShell
      filters={filters}
      tier1={({ fullWidth }) => (
        <>
          <ViewsControl views={views} currentUserId={currentUserId} isAdmin={isAdmin} />
                        <span className="h-5 w-px bg-line" aria-hidden />
              <FilterSearch
                value={qInput}
                onChange={setQInput}
                placeholder="Search creative name…"
              />
          <DateRangePicker
            from={from}
            to={to}
            onChange={applyRange}
            remember
            fullWidth={fullWidth}
            fallback={
              defaultFrom && defaultTo ? { from: defaultFrom, to: defaultTo } : undefined
            }
          />
          {/* Platforms is tier 1 on Ads: it chooses the table's COLUMN GROUPS,
              not just which rows survive — so it stays visible, and Clear
              (tier-2 only) leaves it alone. */}
          <FilterPill
            fullWidth={fullWidth}
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
                <DropdownMenuLabel>Platforms · show any</DropdownMenuLabel>
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
                      <span className={cn(disabled && "text-ink-3")}>{p.label}</span>
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
        </>
      )}
      toolbar={({ fullWidth }) => (
        <>
          {/* TABLE controls, not filters — they stay where table controls live,
              and Clear never touches them. */}
          <FilterPill
            fullWidth={fullWidth}
            icon={Columns3}
            label="Columns"
            value={hiddenColumnsCount === 0 ? "All shown" : `${hiddenColumnsCount} hidden`}
            active={hiddenColumnsCount > 0}
          >
            {() => (
              <DropdownMenuContent align="end" className="w-64 max-h-[28rem] overflow-y-auto">
                <DropdownMenuLabel>Identity columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-[10px] text-ink-3">
                  Creative name is always shown.
                </div>
                {IDENTITY_COLUMN_KEYS.map((k) => (
                  <DropdownMenuCheckboxItem
                    key={k}
                    checked={!hiddenIdentity.includes(k)}
                    onCheckedChange={() => toggleColumn("hideIdentity", k, hiddenIdentity)}
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
                    onCheckedChange={() => toggleColumn("hideMetrics", k, hiddenMetrics)}
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
                      className="w-full px-2 py-1.5 text-left text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      Show all columns
                    </button>
                  </>
                )}
              </DropdownMenuContent>
            )}
          </FilterPill>
          {/* Data SCOPE, not a filter — house-wide convention: always visible. */}
          <ExcludedToggle
            on={includeExcluded}
            onToggle={toggleExcluded}
            fullWidth={fullWidth}
          />
        </>
      )}
    />
  );
}

/** The scope row a status/rate filter carries above its options. */
function ScopePicker({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: MetricFilterScope; label: string }>;
  value: MetricFilterScope;
  onChange: (next: MetricFilterScope) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {options.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          aria-pressed={value === s.value}
          className={cn(
            "h-6 rounded border px-2 text-[11px] transition-colors",
            value === s.value
              ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
              : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
