"use client";

import {
  Check,
  ChevronDown,
  LayoutGrid,
  MonitorSmartphone,
  Table as TableIcon,
} from "lucide-react";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterPill, FilterSearch } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { cn } from "@/lib/utils";
import {
  creativeSortValues,
  creativeViewValues,
  type CreativeSort,
  type CreativeView,
} from "@/validators/creative";
import { CREATIVE_STATUSES, STATUS_LABEL } from "@/lib/creative-status";
import {
  STAGE_FILTER_VALUES,
  stageFilterLabel,
} from "@/lib/funnel-stages";
import {
  PRIORITY_FILTER_LABEL,
  PRIORITY_FILTER_VALUES,
  type PriorityFilterValue,
} from "@/lib/priority";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";

interface Props {
  /** Effective Excluded-toggle state (URL param → saved pref → hidden). */
  includeExcluded: boolean;
  products: Array<{ id: string; name: string }>;
  angles: string[];
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
  /**
   * Remembered filters, as the server resolved them for this render (URL →
   * this user's saved value for this brand → nothing). The bar reads its own
   * params through them, so the chips say what actually ran.
   */
  resolvedFilters?: Record<string, string | undefined>;
}

const TYPES = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "slides", label: "Slides" },
] as const;

// Dynamic creative status (new|active|pause|terminated), labelled via the
// shared STATUS_LABEL map.
const STATUSES = CREATIVE_STATUSES.map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

const PLATFORMS = ALL_PLATFORMS.map((p) => ({
  value: p,
  label: PLATFORM_LABEL[p],
}));

const SORT_LABEL: Record<CreativeSort, string> = {
  "launched-desc": "Recently launched",
  "launched-asc": "Earliest launched",
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "product-asc": "Product A→Z",
  "product-desc": "Product Z→A",
  "type-asc": "Type A→Z",
  "type-desc": "Type Z→A",
  "status-asc": "Status A→Z",
  "status-desc": "Status Z→A",
  "angle-asc": "First angle A→Z",
  "angle-desc": "First angle Z→A",
  "spend7-desc": "7-day spend (high→low)",
  "spend7-asc": "7-day spend (low→high)",
  "spend-desc": "30-day spend (high→low)",
  "spend-asc": "30-day spend (low→high)",
  "priority-desc": "Priority (high→low)",
  "priority-asc": "Priority (low→high)",
  "stage-asc": "Stage (TOF→BOF)",
  "stage-desc": "Stage (BOF→TOF)",
  "created-desc": "Recently added",
};

/** Curated subset shown in the Sort dropdown; column headers cover the rest. */
const DROPDOWN_SORTS: CreativeSort[] = [
  "launched-desc",
  "launched-asc",
  "name-asc",
  "name-desc",
  "spend7-desc",
  "spend-desc",
  "created-desc",
];

export function LibraryFilterBar({
  products,
  angles,
  views,
  currentUserId,
  isAdmin,
  includeExcluded,
  resolvedFilters,
}: Props) {
  // The shell's batching writer — the only URL writer on a migrated bar.
  // `resolvedFilters` is the server's URL→preference→default answer: a
  // remembered filter shows its chip on a bare URL, and removing that chip
  // deletes the preference instead of resurrecting it.
  const { searchParams, update, get } = useFilterParams(resolvedFilters);

  const productIds = csvParam(get("productIds"));
  const types = csvParam(get("types"));
  const statuses = csvParam(get("statuses"));
  const platforms = csvParam(get("platforms"));
  const selectedAngles = csvParam(get("angles"));
  const priorities = csvParam(get("priorities"));
  const stages = csvParam(get("stages"));
  const sortParam = (searchParams.get("sort") ?? "launched-desc") as CreativeSort;
  const sort = creativeSortValues.includes(sortParam) ? sortParam : "launched-desc";
  const viewParam = (searchParams.get("view") ?? "table") as CreativeView;
  const view = creativeViewValues.includes(viewParam) ? viewParam : "table";

  // Local search input state so typing feels instant; we push to URL on debounce.
  // The input is the source of truth while typing — we only adopt a `q` change
  // we DIDN'T originate (Clear, back/forward), tracking our own debounced writes
  // so a late-landing navigation can't reset the field and eat typed characters.
  const urlQ = searchParams.get("q") ?? "";
  const [qInput, setQInput] = useState(urlQ);
  const pendingQPushes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pendingQPushes.current.has(urlQ)) {
      pendingQPushes.current.delete(urlQ);
      return;
    }
    pendingQPushes.current.clear();
    setQInput(urlQ);
  }, [urlQ]);

  // Debounce search input → URL. Compare the TRIMMED value so a trailing space
  // doesn't loop a no-op write; record the push so the URL echo is ignored.
  useEffect(() => {
    const trimmed = qInput.trim();
    if (trimmed === urlQ) return;
    const id = setTimeout(() => {
      pendingQPushes.current.add(trimmed);
      update((next) => {
        if (trimmed) next.set("q", trimmed);
        else next.delete("q");
      });
    }, 250);
    return () => clearTimeout(id);
  }, [qInput, urlQ, update]);

  /** The shell hands back the WHOLE next value of a multi filter. */
  const writeMulti = (key: string, values: readonly string[]) =>
    update((next) => {
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
    });

  const setSort = (s: CreativeSort) =>
    update((next) => {
      if (s === "launched-desc") next.delete("sort");
      else next.set("sort", s);
    });
  const setView = (v: CreativeView) =>
    update((next) => {
      // Table is the default, so it carries no param; grid is the opt-in.
      if (v === "table") next.delete("view");
      else next.set("view", v);
    });

  // ── TIER 2: one entry each; the shell derives panel, chips, badge, sheet ──
  // The status FACET STRIP above the list writes these same params — it is a
  // summary of the listing, not a second filter bar, so its chips simply light
  // up the shell's `statuses` chip too.
  const filters: FilterDef[] = [
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
      key: "statuses",
      label: "Status",
      type: "multi",
      options: STATUSES.map((s) => ({ value: s.value, label: s.label })),
      values: statuses,
      onChange: (next) => writeMulti("statuses", next),
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
  ];

  const sortControl = (fullWidth: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-3 text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
            fullWidth && "w-full justify-between",
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-ink-3">Sort</span>
            <span className="truncate text-ink">{SORT_LABEL[sort]}</span>
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DROPDOWN_SORTS.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => setSort(s)}>
            <span className="flex-1">{SORT_LABEL[s]}</span>
            {sort === s && <Check className="h-3.5 w-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const viewToggle = (
    <div className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-surface p-0.5">
      <button
        type="button"
        onClick={() => setView("grid")}
        aria-label="Grid view"
        className={cn(
          "inline-flex h-7 items-center justify-center rounded px-2 transition-colors",
          view === "grid" ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setView("table")}
        aria-label="Table view"
        className={cn(
          "inline-flex h-7 items-center justify-center rounded px-2 transition-colors",
          view === "table" ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
        )}
      >
        <TableIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <FilterShell
      filters={filters}
      tier1={({ fullWidth }) => (
        <>
          {/* A view switch, not a filter — kept in tier 1 beside search. */}
          <ViewsControl
            views={views}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            page="creatives"
            clearLabel="Show all creatives (ignore default)"
          />
          <FilterSearch
              value={qInput}
              onChange={setQInput}
              placeholder="Search name, angle, notes…"
          />
          <FilterPill
            icon={MonitorSmartphone}
            label="Platforms"
            value={
              platforms.length === 0
                ? "All"
                : platforms.length === 1
                  ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
                  : `${platforms.length} selected`
            }
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
                    onCheckedChange={() =>
                      writeMulti(
                        "platforms",
                        platforms.includes(p.value)
                          ? platforms.filter((v) => v !== p.value)
                          : [...platforms, p.value],
                      )
                    }
                  >
                    {p.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            )}
          </FilterPill>
        </>
      )}
      toolbar={({ fullWidth }) => (
        <>
          {/* TABLE + data-scope controls — never filters, so Clear skips them. */}
          {sortControl(fullWidth)}
          {viewToggle}
          <ExcludedParamToggle on={includeExcluded} fullWidth={fullWidth} />
        </>
      )}
    />
  );
}

function csvParam(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").filter(Boolean);
}
