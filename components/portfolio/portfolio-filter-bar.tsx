"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { ExcludedToggle, FilterSearch } from "@/components/filters/filter-pill";
import { FilterShell } from "@/components/filters/filter-shell";
import { PlatformsPill } from "@/components/filters/platforms-pill";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { FilterDef } from "@/components/filters/filter-model";
import { ViewsControl } from "@/components/summary/views-control";
import type { SummaryViewRow } from "@/db/queries/summary-views";
import { ALL_PLATFORMS } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL } from "@/lib/campaign-status";
import { rememberIncludeExcluded } from "@/lib/pref-sync";

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
  resolvedFilters,
}: {
  /** Effective default range (user's saved choice) for the picker label. */
  defaultFrom?: string;
  defaultTo?: string;
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
  /** The user's saved Excluded-toggle default (URL param overrides it). */
  includeExcludedDefault?: boolean;
  /**
   * Remembered filters, as the server resolved them for this render (URL →
   * this user's saved value for this brand → nothing). The bar reads its own
   * params through them, so the chips say what actually ran.
   */
  resolvedFilters?: Record<string, string | undefined>;

}) {
  // The shell's batching writer — the only URL writer on a migrated bar.
  // `resolvedFilters` is the server's URL→preference→default answer: a
  // remembered filter shows its chip on a bare URL, and removing that chip
  // deletes the preference instead of resurrecting it.
  const { searchParams, update, get } = useFilterParams(resolvedFilters);

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
    () => csv(get("platforms")),
    [get],
  );
  const objectives = useMemo(
    () => csv(get("objectives")),
    [get],
  );
  const statuses = useMemo(
    () => csv(get("statuses")),
    [get],
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

  const toggleExcluded = () => {
    const nextOn = !includeExcluded;
    rememberIncludeExcluded(nextOn); // remember as this user's default
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
          <PlatformsPill
            options={ALL_PLATFORMS}
            selected={platforms}
            onToggle={(p) =>
              writeMulti(
                "platforms",
                platforms.includes(p) ? platforms.filter((v) => v !== p) : [...platforms, p],
              )
            }
            fullWidth={fullWidth}
          />
        </>
      )}
      toolbar={({ fullWidth }) => (
        <>
          {/* The Columns dropdown that lived here is GONE (2026-10): columns
              belong to the TABLE, which now carries its own corner control. */}
          <ExcludedToggle on={includeExcluded} onToggle={toggleExcluded} fullWidth={fullWidth} />
        </>
      )}
    />
  );
}
