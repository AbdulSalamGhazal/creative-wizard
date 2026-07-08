"use client";

import { Activity, Columns3, Layers, Target } from "lucide-react";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import {
  ClearButton,
  ExcludedToggle,
  FilterPill,
  FilterSearch,
} from "@/components/filters/filter-pill";
import { FilterSheet } from "@/components/filters/filter-sheet";
import { ViewsControl } from "@/components/summary/views-control";
import { CAMPAIGN_TABLE_COLUMNS } from "@/components/portfolio/portfolio-table";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL } from "@/lib/campaign-status";

const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
] as const;

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function PortfolioFilterBar({
  defaultFrom,
  defaultTo,
  views,
  currentUserId,
  isAdmin,
}: {
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useNavTransition();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const includeExcluded = searchParams.get("includeExcluded") === "1";
  const platforms = useMemo(
    () => csv(searchParams.get("platforms")),
    [searchParams],
  );
  const objectives = useMemo(
    () => csv(searchParams.get("objectives")),
    [searchParams],
  );
  const statuses = useMemo(
    () => csv(searchParams.get("statuses")),
    [searchParams],
  );
  const hiddenCols = useMemo(
    () => new Set(csv(searchParams.get("hide"))),
    [searchParams],
  );
  const qParam = searchParams.get("q") ?? "";

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

  // Debounced campaign search. The input is the source of truth while typing;
  // we only adopt a `q` change we DIDN'T originate (Clear, back/forward) so a
  // late-landing navigation can't reset the field and eat typed characters.
  const [qLocal, setQLocal] = useState(qParam);
  const pendingQPushes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pendingQPushes.current.has(qParam)) {
      pendingQPushes.current.delete(qParam);
      return;
    }
    pendingQPushes.current.clear();
    setQLocal(qParam);
  }, [qParam]);
  useEffect(() => {
    const trimmed = qLocal.trim();
    if (trimmed === qParam) return;
    const t = setTimeout(() => {
      pendingQPushes.current.add(trimmed);
      update((next) => {
        if (trimmed) next.set("q", trimmed);
        else next.delete("q");
      });
    }, 300);
    return () => clearTimeout(t);
  }, [qLocal, qParam, update]);

  const setRange = (f: string | null, t: string | null) => {
    update((next) => {
      if (f) next.set("from", f);
      else next.delete("from");
      if (t) next.set("to", t);
      else next.delete("to");
    });
  };

  const toggleFromSet = (key: string, value: string, current: string[]) => {
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    update((next) => {
      if (set.size === 0) next.delete(key);
      else next.set(key, [...set].join(","));
    });
  };

  const toggleColumn = (key: string) => {
    const set = new Set(hiddenCols);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    update((next) => {
      if (set.size === 0) next.delete("hide");
      else next.set("hide", [...set].join(","));
    });
  };

  const toggleExcluded = () =>
    update((next) => {
      if (includeExcluded) next.delete("includeExcluded");
      else next.set("includeExcluded", "1");
    });

  const filtersActive =
    !!from ||
    !!to ||
    !!qParam ||
    includeExcluded ||
    platforms.length > 0 ||
    objectives.length > 0 ||
    statuses.length > 0;

  const clearAll = () =>
    update((next) => {
      for (const k of [
        "from",
        "to",
        "q",
        "includeExcluded",
        "platforms",
        "objectives",
        "statuses",
      ]) {
        next.delete(k);
      }
    });

  // Sheet badge counts active filters (search sits in the mobile row).
  const activeCount =
    (from || to ? 1 : 0) +
    (platforms.length > 0 ? 1 : 0) +
    (objectives.length > 0 ? 1 : 0) +
    (statuses.length > 0 ? 1 : 0) +
    (includeExcluded ? 1 : 0);

  const platformLabel =
    platforms.length === 0
      ? "All"
      : platforms.length === 1
        ? (PLATFORMS.find((p) => p.value === platforms[0])?.label ?? "1")
        : `${platforms.length} selected`;
  const objectiveLabel =
    objectives.length === 0
      ? "All"
      : objectives.length === 1
        ? objectives[0]!
        : `${objectives.length} selected`;
  const statusLabel =
    statuses.length === 0
      ? "Any"
      : statuses.length === 1
        ? (CAMPAIGN_STATUS_LABEL[
            statuses[0] as keyof typeof CAMPAIGN_STATUS_LABEL
          ] ?? statuses[0]!)
        : `${statuses.length} selected`;
  const shownCount = CAMPAIGN_TABLE_COLUMNS.filter(
    (c) => !hiddenCols.has(c.key),
  ).length;

  const views_ = (
    <ViewsControl
      views={views}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      page="campaigns"
      clearLabel="Show all campaigns (ignore default)"
    />
  );

  const search = (fullWidth: boolean) => (
    <FilterSearch
      value={qLocal}
      onChange={setQLocal}
      placeholder="Search campaigns…"
      fullWidth={fullWidth}
    />
  );

  // Canonical order: Date → dimension pills (Platforms, Objectives, Status).
  const dimensionControls = (fullWidth: boolean) => (
    <>
      <DateRangePicker
        from={from}
        to={to}
        onChange={setRange}
        remember
        fullWidth={fullWidth}
        fallback={
          defaultFrom && defaultTo
            ? { from: defaultFrom, to: defaultTo }
            : undefined
        }
      />

      <FilterPill
        icon={Layers}
        label="Platforms"
        value={platformLabel}
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
                  toggleFromSet("platforms", p.value, platforms)
                }
                onSelect={(e) => e.preventDefault()}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

      <FilterPill
        icon={Target}
        label="Objectives"
        value={objectiveLabel}
        active={objectives.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Objectives</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CAMPAIGN_OBJECTIVES.map((o) => (
              <DropdownMenuCheckboxItem
                key={o}
                checked={objectives.includes(o)}
                onCheckedChange={() => toggleFromSet("objectives", o, objectives)}
                onSelect={(e) => e.preventDefault()}
              >
                {o}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>

      <FilterPill
        icon={Activity}
        label="Status"
        value={statusLabel}
        active={statuses.length > 0}
        fullWidth={fullWidth}
      >
        {() => (
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CAMPAIGN_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={statuses.includes(s)}
                onCheckedChange={() => toggleFromSet("statuses", s, statuses)}
                onSelect={(e) => e.preventDefault()}
              >
                {CAMPAIGN_STATUS_LABEL[s]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        )}
      </FilterPill>
    </>
  );

  const columnsPill = (fullWidth: boolean) => (
    <FilterPill
      icon={Columns3}
      label="Columns"
      value={`${shownCount} shown`}
      active={hiddenCols.size > 0}
      fullWidth={fullWidth}
    >
      {() => (
        <DropdownMenuContent align="end" className="w-44 max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {CAMPAIGN_TABLE_COLUMNS.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.key}
              checked={!hiddenCols.has(c.key)}
              onCheckedChange={() => toggleColumn(c.key)}
              onSelect={(e) => e.preventDefault()}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      )}
    </FilterPill>
  );

  return (
    <div className="sticky top-14 z-10 -mx-6 px-6 py-3 border-b border-line bg-background/95 backdrop-blur">
      {/* Desktop / wide */}
      <div className="hidden lg:flex items-center gap-2 flex-wrap">
        {views_}
        {search(false)}
        {dimensionControls(false)}
        <div className="ml-auto flex items-center gap-2">
          {columnsPill(false)}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} />
          {filtersActive && <ClearButton onClick={clearAll} />}
        </div>
      </div>

      {/* Mobile / tablet: search + a single Filters Sheet */}
      <div className="flex lg:hidden items-center gap-2">
        <div className="flex-1 min-w-0">{search(true)}</div>
        <FilterSheet activeCount={activeCount} onClear={clearAll}>
          {views_}
          {dimensionControls(true)}
          {columnsPill(true)}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth />
        </FilterSheet>
      </div>
    </div>
  );
}
