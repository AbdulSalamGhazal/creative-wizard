"use client";

import {
  Check,
  ChevronDown,
  CircleDot,
  LayoutGrid,
  MonitorSmartphone,
  Package,
  Shapes,
  Table as TableIcon,
  Tag,
} from "lucide-react";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavTransition } from "@/lib/nav-progress";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ClearButton,
  FilterPill,
  FilterSearch,
} from "@/components/filters/filter-pill";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { cn } from "@/lib/utils";
import {
  creativeSortValues,
  creativeViewValues,
  type CreativeSort,
  type CreativeView,
} from "@/validators/creative";
import { CREATIVE_STATUSES, STATUS_LABEL } from "@/lib/creative-status";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";

interface Props {
  products: Array<{ id: string; name: string }>;
  tags: string[];
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
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
  "tag-asc": "First tag A→Z",
  "tag-desc": "First tag Z→A",
  "spend7-desc": "7-day spend (high→low)",
  "spend7-asc": "7-day spend (low→high)",
  "spend-desc": "30-day spend (high→low)",
  "spend-asc": "30-day spend (low→high)",
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

export function LibraryFilterBar({ products, tags, views, currentUserId, isAdmin }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();

  const productIds = csvParam(searchParams.get("productIds"));
  const types = csvParam(searchParams.get("types"));
  const statuses = csvParam(searchParams.get("statuses"));
  const platforms = csvParam(searchParams.get("platforms"));
  const selectedTags = csvParam(searchParams.get("tags"));
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

  const toggleMulti = (key: string, value: string, current: string[]) => {
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete(key);
      else next.set(key, [...set].join(","));
    });
  };

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

  const filtersActive =
    urlQ.length > 0 ||
    productIds.length > 0 ||
    types.length > 0 ||
    statuses.length > 0 ||
    platforms.length > 0 ||
    selectedTags.length > 0;

  // Sheet badge counts the dimension filters (search sits in the mobile row).
  const activeCount =
    (productIds.length > 0 ? 1 : 0) +
    (types.length > 0 ? 1 : 0) +
    (statuses.length > 0 ? 1 : 0) +
    (platforms.length > 0 ? 1 : 0) +
    (selectedTags.length > 0 ? 1 : 0);

  const clearAll = () =>
    update((next) => {
      next.delete("q");
      next.delete("productIds");
      next.delete("types");
      next.delete("statuses");
      next.delete("platforms");
      next.delete("tags");
    });

  const productLabel = useMemo(() => {
    if (productIds.length === 0) return "All";
    if (productIds.length === 1) {
      return products.find((p) => p.id === productIds[0])?.name ?? "1 selected";
    }
    return `${productIds.length} selected`;
  }, [productIds, products]);

  const views_ = (
    <ViewsControl
      views={views}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      page="creatives"
      clearLabel="Show all creatives (ignore default)"
    />
  );

  // Dimension pills in canonical order (Products → Type → Status → Platforms →
  // Tags). Rendered inline on desktop and stacked full-width in the mobile Sheet.
  const dimensionControls = (fullWidth: boolean) => (
    <>
      <FilterPill
        icon={Package}
        label="Products"
        value={productLabel}
        active={productIds.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-56">
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
              >
                {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

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
              >
                {t.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

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
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s.value}
                checked={statuses.includes(s.value)}
                onCheckedChange={() => toggleMulti("statuses", s.value, statuses)}
              >
                {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

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
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Platform</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PLATFORMS.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.value}
                checked={platforms.includes(p.value)}
                onCheckedChange={() => toggleMulti("platforms", p.value, platforms)}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

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
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-56">
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
    </>
  );

  const sortControl = (fullWidth: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors",
            fullWidth && "w-full justify-between",
          )}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="text-ink-3 shrink-0">Sort</span>
            <span className="text-ink truncate">{SORT_LABEL[sort]}</span>
          </span>
          <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DROPDOWN_SORTS.map((s) => (
          <DropdownMenuItem key={s} onSelect={() => setSort(s)}>
            <span className="flex-1">{SORT_LABEL[s]}</span>
            {sort === s && <Check className="w-3.5 h-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const viewToggle = (
    <div className="inline-flex items-center rounded-md border border-line bg-surface h-8 p-0.5 shrink-0">
      <button
        type="button"
        onClick={() => setView("grid")}
        aria-label="Grid view"
        className={cn(
          "h-7 px-2 rounded transition-colors inline-flex items-center justify-center",
          view === "grid" ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
        )}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setView("table")}
        aria-label="Table view"
        className={cn(
          "h-7 px-2 rounded transition-colors inline-flex items-center justify-center",
          view === "table" ? "bg-surface-3 text-ink" : "text-ink-3 hover:text-ink",
        )}
      >
        <TableIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const search = (fullWidth: boolean) => (
    <FilterSearch
      value={qInput}
      onChange={setQInput}
      placeholder="Search name, tag, notes…"
      fullWidth={fullWidth}
    />
  );

  return (
    <div className="sticky top-14 z-10 -mx-6 px-6 py-3 border-b border-line bg-background/95 backdrop-blur">
      {/* Desktop / wide */}
      <div className="hidden lg:flex items-center gap-2 flex-wrap">
        {views_}
        {search(false)}
        {dimensionControls(false)}
        <div className="ml-auto flex items-center gap-2">
          {filtersActive && <ClearButton onClick={clearAll} />}
          {sortControl(false)}
          {viewToggle}
        </div>
      </div>

      {/* Mobile / tablet: search + view toggle + a single Filters Sheet */}
      <div className="flex lg:hidden items-center gap-2">
        <div className="flex-1 min-w-0">{search(true)}</div>
        {viewToggle}
        <FilterSheet activeCount={activeCount} onClear={clearAll}>
          {views_}
          {dimensionControls(true)}
          {sortControl(true)}
        </FilterSheet>
      </div>
    </div>
  );
}

function csvParam(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").filter(Boolean);
}

