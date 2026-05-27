"use client";

import {
  Check,
  ChevronDown,
  CircleDot,
  LayoutGrid,
  Package,
  Search,
  Shapes,
  Table as TableIcon,
  Tag,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import {
  creativeSortValues,
  creativeViewValues,
  type CreativeSort,
  type CreativeView,
} from "@/validators/creative";

interface Props {
  products: Array<{ id: string; name: string }>;
  tags: string[];
}

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

const SORT_LABEL: Record<CreativeSort, string> = {
  "launched-desc": "Recently launched",
  "launched-asc": "Earliest launched",
  "name-asc": "Name A→Z",
  "name-desc": "Name Z→A",
  "spend-desc": "30-day spend",
  "created-desc": "Recently added",
};

export function LibraryFilterBar({ products, tags }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const productIds = csvParam(searchParams.get("productIds"));
  const types = csvParam(searchParams.get("types"));
  const statuses = csvParam(searchParams.get("statuses"));
  const selectedTags = csvParam(searchParams.get("tags"));
  const sortParam = (searchParams.get("sort") ?? "launched-desc") as CreativeSort;
  const sort = creativeSortValues.includes(sortParam) ? sortParam : "launched-desc";
  const viewParam = (searchParams.get("view") ?? "grid") as CreativeView;
  const view = creativeViewValues.includes(viewParam) ? viewParam : "grid";

  // Local search input state so typing feels instant; we push to URL on debounce.
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

  // Debounce search input → URL.
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
      if (v === "grid") next.delete("view");
      else next.set("view", v);
    });

  const filtersActive =
    urlQ.length > 0 ||
    productIds.length > 0 ||
    types.length > 0 ||
    statuses.length > 0 ||
    selectedTags.length > 0;

  const clearAll = () =>
    update((next) => {
      next.delete("q");
      next.delete("productIds");
      next.delete("types");
      next.delete("statuses");
      next.delete("tags");
    });

  const productLabel = useMemo(() => {
    if (productIds.length === 0) return "All";
    if (productIds.length === 1) {
      return products.find((p) => p.id === productIds[0])?.name ?? "1 selected";
    }
    return `${productIds.length} selected`;
  }, [productIds, products]);

  return (
    <div className="sticky top-0 z-10 -mx-6 px-6 py-3 border-b border-line bg-background/95 backdrop-blur">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name, tag, notes…"
            className={cn(
              "h-8 pl-8 pr-3 rounded-md border border-line bg-surface text-xs text-ink",
              "placeholder:text-ink-3 outline-none focus:border-line-2",
              "w-64",
            )}
          />
        </div>

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
                <div className="px-2 py-1.5 text-xs text-ink-3">No products yet</div>
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
                  onCheckedChange={() => toggleMulti("statuses", s.value, statuses)}
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

        <div className="ml-auto flex items-center gap-2">
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

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <span className="text-ink-3">Sort</span>
                <span className="text-ink">{SORT_LABEL[sort]}</span>
                <ChevronDown className="w-3 h-3 text-ink-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {creativeSortValues.map((s) => (
                <DropdownMenuItem key={s} onSelect={() => setSort(s)}>
                  <span className="flex-1">{SORT_LABEL[s]}</span>
                  {sort === s && <Check className="w-3.5 h-3.5 text-brand" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View toggle */}
          <div className="inline-flex items-center rounded-md border border-line bg-surface h-8 p-0.5">
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-label="Grid view"
              className={cn(
                "h-7 px-2 rounded transition-colors inline-flex items-center justify-center",
                view === "grid"
                  ? "bg-surface-3 text-ink"
                  : "text-ink-3 hover:text-ink",
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
                view === "table"
                  ? "bg-surface-3 text-ink"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function csvParam(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").filter(Boolean);
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

