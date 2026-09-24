"use client";

import { Columns3, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { ViewsControl } from "@/components/summary/views-control";
import { CAMPAIGN_TABLE_COLUMNS } from "@/components/portfolio/portfolio-table";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL } from "@/lib/campaign-status";
import { setIncludeExcludedPref } from "@/app/actions/user-prefs";

/** Derived from the canonical list — never re-list the platforms. */
const PLATFORMS = ALL_PLATFORMS.map((value) => ({
  value,
  label: PLATFORM_LABEL[value],
}));

function csv(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function PortfolioFilterBar({
  defaultFrom,
  defaultTo,
  views,
  currentUserId,
  isAdmin,
  includeExcludedDefault,
}: {
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
  /** The user's saved Excluded-toggle default (URL param overrides it). */
  includeExcludedDefault?: boolean;
}) {
  // The shell's batching writer — the only URL writer on a migrated bar.
  const { searchParams, update } = useFilterParams();

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  // Effective Excluded state: explicit URL param wins, else the saved
  // per-user preference the server resolved into `includeExcludedDefault`.
  const rawIncludeExcluded = searchParams.get("includeExcluded");
  const includeExcluded =
    rawIncludeExcluded !== null
      ? rawIncludeExcluded === "1"
      : (includeExcludedDefault ?? false);
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

  /** The shell hands back the WHOLE next value of a multi filter. */
  const writeMulti = (key: string, values: readonly string[]) =>
    update((next) => {
      if (values.length === 0) next.delete(key);
      else next.set(key, values.join(","));
    });

  const toggleColumn = (key: string) => {
    const set = new Set(hiddenCols);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    update((next) => {
      if (set.size === 0) next.delete("hide");
      else next.set("hide", [...set].join(","));
    });
  };

  const toggleExcluded = () => {
    const nextOn = !includeExcluded;
    void setIncludeExcludedPref(nextOn); // remember as this user's default
    update((next) => {
      next.set("includeExcluded", nextOn ? "1" : "0");
    });
  };

  // ── TIER 2: one entry each; the shell derives panel, chips, badge, sheet ──
  const filters: FilterDef[] = [
    {
      key: "objectives",
      label: "Objectives",
      type: "multi",
      options: CAMPAIGN_OBJECTIVES.map((o) => ({ value: o, label: o })),
      values: objectives,
      onChange: (next) => writeMulti("objectives", next),
    },
    {
      key: "statuses",
      label: "Status",
      type: "multi",
      options: CAMPAIGN_STATUSES.map((s) => ({
        value: s,
        label: CAMPAIGN_STATUS_LABEL[s] ?? s,
      })),
      values: statuses,
      onChange: (next) => writeMulti("statuses", next),
    },
  ];

  const shownCount = CAMPAIGN_TABLE_COLUMNS.filter((c) => !hiddenCols.has(c.key)).length;

  return (
    <FilterShell
      filters={filters}
      tier1={({ fullWidth }) => (
        <>
          <ViewsControl
            views={views}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            page="campaigns"
            clearLabel="Show all campaigns (ignore default)"
          />
          <FilterSearch
              value={qLocal}
              onChange={setQLocal}
              placeholder="Search campaigns…"
          />
          <DateRangePicker
            from={from}
            to={to}
            onChange={setRange}
            remember
            fullWidth={fullWidth}
            fallback={
              defaultFrom && defaultTo ? { from: defaultFrom, to: defaultTo } : undefined
            }
          />
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
                    onSelect={(e) => e.preventDefault()}
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
          {/* TABLE control, not a filter — Clear never touches it. */}
          <FilterPill
            icon={Columns3}
            label="Columns"
            value={`${shownCount} shown`}
            active={hiddenCols.size > 0}
            fullWidth={fullWidth}
          >
            {() => (
              <DropdownMenuContent align="end" className="max-h-80 w-44 overflow-y-auto">
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
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth={fullWidth} />
        </>
      )}
    />
  );
}
