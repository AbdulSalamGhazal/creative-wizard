"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Columns3, Download, Megaphone, Percent, Scale, ShoppingBag } from "lucide-react";
import {
  DataTable,
  compareSortValues,
  type DataColumn,
} from "@/components/ui/data-table";
import { MetricCard, type BreakdownBar } from "@/components/overview/metric-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { FilterShell } from "@/components/filters/filter-shell";
import { useFilterParams } from "@/components/filters/use-filter-params";
import type { DateRangeValue } from "@/lib/date-presets";
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { sar, usd, isoDate, int, intCompact, pct1, signedPct } from "@/lib/format";
import { downloadCsv, todayStamp, matrixToCsv } from "@/lib/csv-export";
import {
  reconDelta,
  reconDeltaPct,
  reconDeltaTone,
  reconMatchRate,
  isWithinAttributionLag,
  unattributedShare,
  sumPlatformDays,
} from "@/lib/reconciliation";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ExcludedParamToggle } from "@/components/filters/excluded-param-toggle";
import type {
  ReconOverviewRow,
  ReconByPlatformRow,
  ReconByChannelRow,
} from "@/db/queries/reconciliation";
import { CHANNEL_LABEL, channelDeltas, sumChannelDays } from "@/store/channels";

/**
 * Two modes, Channels first. There is no "overview" mode: it showed store
 * orders vs claimed with revenue/spend for context, which is exactly the
 * Channels table's Store total / Claimed columns plus its two hidden context
 * columns — a strict subset, so it was merged away rather than maintained.
 */
type Mode = "channel" | "platform";
type PlatformKey = keyof typeof PLATFORM_COLOR;

/** One Channels row: the store's channel split joined to what platforms claim. */
interface ChannelRow {
  day: string;
  storeOrders: number;
  website: number;
  application: number;
  unmapped: number;
  claimed: number;
  /** Context only — NEVER diffed (this page compares counts, never money). */
  revenue: number;
  spend: number;
}

interface Props {
  /** Raw URL range (drives the highlighted preset), null when absent. */
  from: string | null;
  to: string | null;
  /** What the page's queries actually ran — the picker's label falls back to it. */
  resolvedRange: DateRangeValue;
  /** Effective Excluded state for the ads side (URL → saved pref → hidden). */
  includeExcluded: boolean;
  overview: ReconOverviewRow[];
  byPlatform: ReconByPlatformRow[];
  byChannel: ReconByChannelRow[];
  platforms: PlatformKey[];
  sourceConfigured: boolean;
  /** Latest ads data day across platforms, for the attribution-lag marker. */
  maxHorizon: string | null;
  /** Distinct source values present in data but not yet mapped. */
  unmappedCount: number;
  /** Distinct raw CHANNEL values in range with no mapping row. */
  unmappedChannelCount: number;
  canConfig: boolean;
}

/** Signed integer with a real minus sign, e.g. +3 / −4 / 0. */
function signed(n: number): string {
  if (n > 0) return `+${int(n)}`;
  if (n < 0) return `−${int(Math.abs(n))}`;
  return "0";
}
/** Same, compacted (12.3k) — for the dense Platforms grid. */
function signedCompact(n: number): string {
  if (n > 0) return `+${intCompact(n)}`;
  if (n < 0) return `−${intCompact(Math.abs(n))}`;
  return "0";
}
const pctText = (pct: number | null) => signedPct(pct);
const csvPct = (pct: number | null) => (pct === null ? "" : (pct * 100).toFixed(1));

export function ReconciliationView({
  from,
  to,
  resolvedRange,
  includeExcluded,
  overview,
  byPlatform,
  byChannel,
  platforms,
  sourceConfigured,
  maxHorizon,
  unmappedCount,
  unmappedChannelCount,
  canConfig,
}: Props) {
  const { update } = useFilterParams();

  // Client state only — no URL param has ever carried the mode, so a stale
  // "overview" value cannot arrive from a bookmark or a saved view.
  const [mode, setMode] = useState<Mode>("channel");
  // The two context columns are hidden by default (counts-only page).
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(["store_revenue", "spend"]),
  );

  // The shell's batching writer — the only URL writer on a migrated bar.
  const setRange = (nf: string | null, nt: string | null) =>
    update((next) => {
      if (nf) next.set("from", nf);
      else next.delete("from");
      if (nt) next.set("to", nt);
      else next.delete("to");
    });

  const lag = (day: string) => isWithinAttributionLag(day, maxHorizon);

  const overviewTotals = useMemo(
    () =>
      overview.reduce(
        (a, r) => ({
          orders: a.orders + r.storeOrders,
          conv: a.conv + r.platformConv,
        }),
        { orders: 0, conv: 0 },
      ),
    [overview],
  );

  // Per-platform range totals (KPI tile breakdowns + the Platforms footer).
  // Sums per component; the footer's Δ/Δ% are derived FROM these sums.
  const bpTotals = useMemo(
    () => sumPlatformDays(byPlatform, platforms),
    [byPlatform, platforms],
  );

  // In Platforms mode the KPI tiles break down per platform (the Dashboard
  // MetricCard bar pattern). Only platforms with data in range get a bar; the
  // Unattributed bucket rides along on the store-orders and Δ tiles so the bar
  // sums always reconcile with the headline totals.
  const tileBars = useMemo((): {
    orders: BreakdownBar[];
    conv: BreakdownBar[];
    delta: BreakdownBar[];
    match: BreakdownBar[];
  } | null => {
    if (mode !== "platform" || byPlatform.length === 0) return null;
    const UNATTR = { label: "Unattr.", color: "var(--ink-3)" };
    const active = platforms.filter(
      (p) => (bpTotals.store[p] ?? 0) > 0 || (bpTotals.claimed[p] ?? 0) > 0,
    );
    const totalOrders = Math.max(1, overviewTotals.orders);
    const totalConv = Math.max(1, overviewTotals.conv);

    const orders: BreakdownBar[] = active.map((p) => ({
      key: p,
      label: PLATFORM_LABEL[p],
      color: PLATFORM_COLOR[p],
      fraction: (bpTotals.store[p] ?? 0) / totalOrders,
      display: int(bpTotals.store[p] ?? 0),
    }));
    if (bpTotals.unattributed > 0) {
      orders.push({
        key: "unattr",
        ...UNATTR,
        fraction: bpTotals.unattributed / totalOrders,
        display: int(bpTotals.unattributed),
      });
    }

    const conv: BreakdownBar[] = active.map((p) => ({
      key: p,
      label: PLATFORM_LABEL[p],
      color: PLATFORM_COLOR[p],
      fraction: (bpTotals.claimed[p] ?? 0) / totalConv,
      display: int(bpTotals.claimed[p] ?? 0),
    }));

    const deltas = active.map((p) => ({
      p,
      d: reconDelta(bpTotals.store[p] ?? 0, bpTotals.claimed[p] ?? 0),
    }));
    const maxAbs = Math.max(
      1,
      ...deltas.map((x) => Math.abs(x.d)),
      bpTotals.unattributed,
    );
    const delta: BreakdownBar[] = deltas.map(({ p, d }) => ({
      key: p,
      label: PLATFORM_LABEL[p],
      color: PLATFORM_COLOR[p],
      fraction: Math.abs(d) / maxAbs,
      display: signed(d),
    }));
    if (bpTotals.unattributed > 0) {
      // Unattributed orders have no claiming platform, so their Δ contribution
      // is claimed(0) − store(n) = −n under the inflation framing. Through the
      // HELPER, never re-derived here, so the sign can't drift again (keeps
      // Σ bars == the headline Δ).
      const unattrDelta = reconDelta(bpTotals.unattributed, 0);
      delta.push({
        key: "unattr",
        ...UNATTR,
        fraction: Math.abs(unattrDelta) / maxAbs,
        display: signed(unattrDelta),
      });
    }

    const rates = active.map((p) => ({
      p,
      r: reconMatchRate(bpTotals.store[p] ?? 0, bpTotals.claimed[p] ?? 0),
    }));
    const maxRate = Math.max(1e-9, ...rates.map((x) => x.r ?? 0));
    const match: BreakdownBar[] = rates.map(({ p, r }) => ({
      key: p,
      label: PLATFORM_LABEL[p],
      color: PLATFORM_COLOR[p],
      fraction: r === null ? 0 : r / maxRate,
      display: pct1(r),
    }));

    return { orders, conv, delta, match };
  }, [mode, byPlatform.length, platforms, bpTotals, overviewTotals]);

  // ── Channels rows ──────────────────────────────────────────────────────────
  /** Claimed conversions + the money context per day, from the overview rows
   *  the page already fetched rather than re-scanning the ads table. */
  const overviewByDay = useMemo(() => {
    const m = new Map<string, ReconOverviewRow>();
    for (const r of overview) m.set(r.day, r);
    return m;
  }, [overview]);

  const channelRows = useMemo((): ChannelRow[] => {
    return byChannel.map((r) => {
      const o = overviewByDay.get(r.day);
      return {
        day: r.day,
        storeOrders: r.storeOrders,
        website: r.website,
        application: r.application,
        unmapped: r.unmapped,
        claimed: o?.platformConv ?? 0,
        revenue: o?.storeRevenue ?? 0,
        spend: o?.spend ?? 0,
      };
    });
  }, [byChannel, overviewByDay]);

  /** Range totals: component sums. Every delta in the footer comes from THESE,
   *  never from averaging the per-day deltas. */
  const channelTotals = useMemo(() => sumChannelDays(channelRows), [channelRows]);

  /** The Unmapped column only exists when there's something in it. */
  const showUnmappedChannel = channelTotals.unmapped > 0;

  const channelColumns: DataColumn<ChannelRow>[] = useMemo(() => {
    const t = channelTotals;
    const td = channelDeltas(t);
    const num = (v: number) => <span className="num tabular-nums">{int(v)}</span>;
    const tot = (v: string) => (
      <span className="num tabular-nums font-semibold">{v}</span>
    );
    const pctCell = (pct: number | null, bold = false) => (
      <span
        className={cn(
          "num tabular-nums",
          bold && "font-semibold",
          reconDeltaTone(pct) === "warn" ? "text-warn" : "text-ink-2",
        )}
      >
        {pctText(pct)}
      </span>
    );
    const cols: DataColumn<ChannelRow>[] = [
      {
        key: "day",
        label: "Day",
        pinned: true,
        sortable: true,
        render: (r) => <DayCell day={r.day} isLag={lag(r.day)} />,
        sortValue: (r) => r.day,
        csv: (r) => r.day,
        total: () => (
          <span className="text-ink-3">{int(channelRows.length)} days</span>
        ),
      },
      {
        key: "store_orders",
        label: "Store total",
        align: "right",
        sortable: true,
        render: (r) => num(r.storeOrders),
        sortValue: (r) => r.storeOrders,
        total: () => tot(int(t.storeOrders)),
      },
      {
        key: "website",
        label: CHANNEL_LABEL.website,
        align: "right",
        sortable: true,
        render: (r) => num(r.website),
        sortValue: (r) => r.website,
        total: () => tot(int(t.website)),
      },
      {
        key: "application",
        label: CHANNEL_LABEL.application,
        align: "right",
        sortable: true,
        render: (r) => num(r.application),
        sortValue: (r) => r.application,
        total: () => tot(int(t.application)),
      },
    ];
    if (showUnmappedChannel) {
      cols.push({
        key: "unmapped",
        label: "Unmapped",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums text-ink-3">{int(r.unmapped)}</span>,
        sortValue: (r) => r.unmapped,
        total: () => <span className="num tabular-nums font-semibold text-ink-3">{int(t.unmapped)}</span>,
      });
    }
    cols.push(
      {
        key: "claimed",
        label: "Claimed",
        align: "right",
        sortable: true,
        render: (r) => num(r.claimed),
        sortValue: (r) => r.claimed,
        total: () => tot(int(t.claimed)),
      },
      {
        key: "delta_incl",
        label: "Δ incl. app",
        align: "right",
        sortable: true,
        render: (r) => (
          <span className="num tabular-nums">
            {signed(channelDeltas(r).inclApp)}
          </span>
        ),
        sortValue: (r) => channelDeltas(r).inclApp,
        total: () => tot(signed(td.inclApp)),
      },
      {
        key: "delta_incl_pct",
        label: "Δ incl. app %",
        align: "right",
        sortable: true,
        render: (r) => pctCell(reconDeltaPct(r.website + r.application, r.claimed)),
        sortValue: (r) => reconDeltaPct(r.website + r.application, r.claimed),
        csv: (r) => csvPct(reconDeltaPct(r.website + r.application, r.claimed)),
        total: () => pctCell(reconDeltaPct(t.website + t.application, t.claimed), true),
      },
      {
        key: "delta_excl",
        label: "Δ excl. app",
        align: "right",
        sortable: true,
        render: (r) => (
          <span className="num tabular-nums">
            {signed(channelDeltas(r).exclApp)}
          </span>
        ),
        sortValue: (r) => channelDeltas(r).exclApp,
        total: () => tot(signed(td.exclApp)),
      },
      {
        key: "delta_excl_pct",
        label: "Δ excl. app %",
        align: "right",
        sortable: true,
        render: (r) => pctCell(reconDeltaPct(r.website, r.claimed)),
        sortValue: (r) => reconDeltaPct(r.website, r.claimed),
        csv: (r) => csvPct(reconDeltaPct(r.website, r.claimed)),
        total: () => pctCell(reconDeltaPct(t.website, t.claimed), true),
      },
      // Context, hidden by default: the only money on this page, and it is
      // never differenced against anything.
      {
        key: "store_revenue",
        label: "Revenue (SAR)",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums text-ink-2">{sar(r.revenue)}</span>,
        sortValue: (r) => r.revenue,
        total: () => tot(sar(t.revenue)),
      },
      {
        key: "spend",
        label: "Spend (USD)",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums text-ink-2">{usd(r.spend)}</span>,
        sortValue: (r) => r.spend,
        total: () => tot(usd(t.spend)),
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelRows, channelTotals, showUnmappedChannel, maxHorizon]);

  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "day",
    dir: "desc",
  });
  /** Sorted here (not only inside DataTable) so the CSV exports the order the
   *  reader is looking at. */
  const sortedChannelRows = useMemo(() => {
    const col = channelColumns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return channelRows;
    const sv = col.sortValue;
    return [...channelRows].sort((a, b) => compareSortValues(sv(a), sv(b), sort.dir));
  }, [channelRows, channelColumns, sort]);

  function exportCsv() {
    if (mode === "channel") {
      // Exactly the visible columns, in the order and sort on screen.
      const cols = channelColumns.filter((c) => !hidden.has(c.key));
      const head = cols.map((c) => c.label);
      const lines = sortedChannelRows.map((r) =>
        cols.map((c) => {
          const v = c.csv ? c.csv(r) : c.sortValue ? c.sortValue(r) : null;
          return v ?? "";
        }),
      );
      downloadCsv(`reconciliation-by-channel-${todayStamp()}.csv`, matrixToCsv(head, lines));
      return;
    }
    const head = ["Day", "Store total", "Unattributed", "Unattributed %"];
    for (const p of platforms) {
      head.push(
        `${PLATFORM_LABEL[p]} store`,
        `${PLATFORM_LABEL[p]} claimed`,
        `${PLATFORM_LABEL[p]} Δ`,
        `${PLATFORM_LABEL[p]} Δ%`,
      );
    }
    const lines = byPlatform.map((r) => {
      const cells: (string | number)[] = [
        r.day,
        r.storeOrders,
        r.unattributed,
        csvPct(unattributedShare(r.unattributed, r.storeOrders)),
      ];
      for (const p of platforms) {
        const o = r.storeByPlatform[p] ?? 0;
        const c = r.claimedByPlatform[p] ?? 0;
        cells.push(o, c, reconDelta(o, c), csvPct(reconDeltaPct(o, c)));
      }
      return cells;
    });
    downloadCsv(`reconciliation-by-platform-${todayStamp()}.csv`, matrixToCsv(head, lines));
  }

  const empty = mode === "channel" ? channelRows.length === 0 : byPlatform.length === 0;

  return (
    <div className="space-y-4">
      {/* Filter + controls bar. The view toggle LEADS, then the range, then
          everything else is pushed right by `ml-auto`. On a phone the row wraps
          — and because the toggle is the first flex item, it stays first. */}
      {/* The bar is FilterShell's (phase 2) — a ZERO-DEF page: no tier-2
          filters, so no Filters button and no chips row. The MODE TOGGLE is a
          view switch, not a filter (user decision, 9c47d17), so it stays the
          row's first element inside tier 1; Excluded, the per-mode Columns
          menu and CSV are toolbar controls. */}
      <FilterShell
        filters={[]}
        tier1={({ fullWidth }) => (
          <>
            <ModeToggle mode={mode} onChange={setMode} />
            <DateRangePicker
              from={from}
              to={to}
              onChange={setRange}
              remember
              fullWidth={fullWidth}
              fallback={resolvedRange}
            />
          </>
        )}
        toolbar={() => (
          <>
            <ExcludedParamToggle on={includeExcluded} />
            {mode === "channel" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Columns3 className="h-3.5 w-3.5" />
                    Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Context columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {[
                    { k: "store_revenue", label: "Revenue (SAR)" },
                    { k: "spend", label: "Spend (USD)" },
                  ].map(({ k, label }) => (
                    <DropdownMenuCheckboxItem
                      key={k}
                      checked={!hidden.has(k)}
                      onCheckedChange={(on) =>
                        setHidden((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                    >
                      {label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={empty}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </>
        )}
      />

      {/* Range summary — counts only, mode-independent (both modes reconcile to
          the same totals). Match rate = claimed / store orders. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Store orders"
          value={overview.length === 0 ? "—" : int(overviewTotals.orders)}
          icon={ShoppingBag}
          bars={tileBars?.orders ?? []}
          hideBreakdown={!tileBars}
          empty={overview.length === 0}
        />
        <MetricCard
          label="Platform conv."
          value={overview.length === 0 ? "—" : int(overviewTotals.conv)}
          icon={Megaphone}
          bars={tileBars?.conv ?? []}
          hideBreakdown={!tileBars}
          empty={overview.length === 0}
        />
        <MetricCard
          label="Δ claimed − store"
          value={
            overview.length === 0
              ? "—"
              : signed(reconDelta(overviewTotals.orders, overviewTotals.conv))
          }
          icon={Scale}
          bars={tileBars?.delta ?? []}
          hideBreakdown={!tileBars}
          empty={overview.length === 0}
        />
        <MetricCard
          label="Match rate"
          value={(() => {
            if (overview.length === 0) return "—";
            const rate = reconMatchRate(overviewTotals.orders, overviewTotals.conv);
            return pct1(rate);
          })()}
          icon={Percent}
          bars={tileBars?.match ?? []}
          hideBreakdown={!tileBars}
          empty={overview.length === 0}
        />
      </div>

      {/* Unmapped-SOURCE hint — the source mapping only drives Platforms. */}
      {mode === "platform" && sourceConfigured && unmappedCount > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-xs text-ink-2">
          {int(unmappedCount)} source value{unmappedCount === 1 ? "" : "s"} in your
          orders {unmappedCount === 1 ? "is" : "are"} unmapped — those orders count
          as Unattributed.{" "}
          {canConfig ? (
            <Link
              href="/store/uploads?tab=fields"
              className="underline hover:text-ink"
            >
              Configure
            </Link>
          ) : (
            <span className="text-ink-3">Ask an admin to configure the mapping.</span>
          )}
        </div>
      )}

      {/* Unmapped-CHANNEL hint — date-bounded, like the source one above. */}
      {mode === "channel" && unmappedChannelCount > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-xs text-ink-2">
          {int(unmappedChannelCount)} channel value
          {unmappedChannelCount === 1 ? "" : "s"} in your orders{" "}
          {unmappedChannelCount === 1 ? "is" : "are"} unmapped — those orders sit
          in their own Unmapped column and count toward neither delta.{" "}
          {canConfig ? (
            <Link href="/store/uploads?tab=fields" className="underline hover:text-ink">
              Configure
            </Link>
          ) : (
            <span className="text-ink-3">Ask an admin to configure the mapping.</span>
          )}
        </div>
      )}

      {mode === "channel" && channelRows.length > 0 && (
        <p className="text-xs text-ink-3">
          Platform pixels largely see WEBSITE purchases, so{" "}
          <span className="text-ink-2">Δ excl. app</span> is the honest
          attribution gap — Application explains the rest. Counts only, never
          revenue.
        </p>
      )}

      {mode === "channel" ? (
        <DataTable<ChannelRow>
          columns={channelColumns}
          rows={sortedChannelRows}
          rowKey={(r) => r.day}
          sort={sort.key}
          dir={sort.dir}
          hidden={[...hidden]}
          onSort={(key, dir) => setSort({ key, dir })}
          showTotals={channelRows.length > 0}
          evenColumns
          minWidthClass="min-w-[880px]"
          empty={<EmptyState />}
        />
      ) : !sourceConfigured ? (
        <NotConfigured canConfig={canConfig} />
      ) : byPlatform.length === 0 ? (
        <EmptyState />
      ) : (
        <ByPlatformTable
          rows={byPlatform}
          platforms={platforms}
          lag={lag}
          totals={bpTotals}
        />
      )}
    </div>
  );
}

function DayCell({ day, isLag }: { day: string; isLag: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="num">{isoDate(day)}</span>
      {isLag && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-ink-3/60"
          role="img"
          aria-label="Still attributing — within 7 days of the latest ads data, so a negative Δ (claimed under store) here may not be a real discrepancy."
          title="Platform data may still be attributing (within 7 days of the latest ads data) — claimed runs low, so a negative Δ here may not be a real discrepancy."
        />
      )}
    </span>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <SegmentedControl<Mode>
      ariaLabel="Reconciliation mode"
      value={mode}
      onChange={onChange}
      options={[
        { value: "channel", label: "Channels" },
        { value: "platform", label: "Platforms" },
      ]}
    />
  );
}

/**
 * One Δ% cell in the Platforms grid: warn-tinted by MAGNITUDE (never
 * good/bad — both directions are discrepancies), "—" when the store side is 0.
 */
function PctCell({ pct, className }: { pct: number | null; className?: string }) {
  return (
    <span
      className={cn(
        reconDeltaTone(pct) === "warn" ? "text-warn" : "text-ink-3",
        className,
      )}
    >
      {pct === null ? "—" : signedPct(pct)}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface py-14 text-center">
      <p className="text-sm text-ink-2">No data in this range</p>
      <p className="text-xs text-ink-3">
        Pick a range where you have store orders or ads data.
      </p>
    </div>
  );
}

function NotConfigured({ canConfig }: { canConfig: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface py-14 text-center">
      <p className="text-sm text-ink-2">Source field not configured</p>
      <p className="max-w-sm text-xs text-ink-3">
        By-platform reconciliation needs to know which order field holds the
        traffic source, and how its values map to ad platforms.
      </p>
      {canConfig && (
        <Link
          href="/store/uploads?tab=fields"
          className="mt-1 text-xs text-ink-2 underline hover:text-ink"
        >
          Configure in Upload orders → Order fields
        </Link>
      )}
    </div>
  );
}

// ── Platforms: grouped table (summary-table visual language) ─────────────────
/**
 * The SECOND sanctioned grouped-header table (the Summary table is the first):
 * every platform is a GROUP of four columns — Store · Claim · Δ · Δ% — which
 * DataTable's flat column model cannot express. Deliberately dense (text-xs,
 * `py-1.5 px-1.5`, compact counts) so 4 platforms × 4 + 4 leading columns fit a
 * 1366px desktop without horizontal scroll.
 */
const CELL = "px-1.5 py-1.5 text-right tabular-nums";
const SUB = "px-1.5 py-1 text-right text-[10px] font-medium uppercase tracking-[0.06em]";

function ByPlatformTable({
  rows,
  platforms,
  lag,
  totals,
}: {
  rows: ReconByPlatformRow[];
  platforms: PlatformKey[];
  lag: (day: string) => boolean;
  /** Range totals (computed once by the parent, shared with the KPI tiles). */
  totals: { store: Record<string, number>; claimed: Record<string, number>; unattributed: number; storeOrders: number };
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[720px] border-collapse text-xs num">
        <thead className="sticky top-0 z-20 bg-surface">
          {/* Group banners */}
          <tr className="border-b border-line">
            <th
              rowSpan={2}
              className="sticky left-0 z-30 bg-surface px-1.5 py-1.5 text-left text-label text-ink-3"
            >
              Day
            </th>
            <th
              colSpan={3}
              className="border-l border-line px-1.5 py-1.5 text-center text-label text-ink-3"
            >
              Store
            </th>
            {platforms.map((p) => (
              <th
                key={p}
                colSpan={4}
                className="border-l border-line px-1.5 py-1.5 text-center text-label"
                style={{ color: PLATFORM_COLOR[p] }}
              >
                <span className="inline-flex items-center gap-1">
                  <PlatformDot platform={p} size="sm" />
                  {PLATFORM_LABEL[p]}
                </span>
              </th>
            ))}
          </tr>
          {/* Sub-labels */}
          <tr className="border-b border-line text-ink-3">
            <th className={cn(SUB, "border-l border-line")}>Total</th>
            <th className={SUB}>Unattr.</th>
            <th className={SUB} title="Unattributed ÷ store total">%</th>
            {platforms.map((p) => (
              <SubHead key={p} />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.day} className="hover:bg-surface-2/50">
              <td className="sticky left-0 z-10 bg-surface px-1.5 py-1.5 text-left">
                <DayCell day={r.day} isLag={lag(r.day)} />
              </td>
              <td className={cn(CELL, "border-l border-line")}>{intCompact(r.storeOrders)}</td>
              <td className={cn(CELL, "text-ink-3")}>{intCompact(r.unattributed)}</td>
              <td className={CELL}>
                <PctCell pct={unattributedShare(r.unattributed, r.storeOrders)} />
              </td>
              {platforms.map((p) => (
                <GroupCells
                  key={p}
                  store={r.storeByPlatform[p] ?? 0}
                  claimed={r.claimedByPlatform[p] ?? 0}
                />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-surface-2">
          <tr className="border-t border-line font-semibold">
            <td className="sticky left-0 z-30 bg-surface-2 px-1.5 py-1.5 text-left text-ink-3">
              Totals
            </td>
            {/* Every footer figure below is computed from the range SUMS, not
                from averaging the per-day numbers. */}
            <td className={cn(CELL, "border-l border-line")}>{intCompact(totals.storeOrders)}</td>
            <td className={cn(CELL, "text-ink-3")}>{intCompact(totals.unattributed)}</td>
            <td className={CELL}>
              <PctCell pct={unattributedShare(totals.unattributed, totals.storeOrders)} />
            </td>
            {platforms.map((p) => (
              <GroupCells
                key={p}
                store={totals.store[p] ?? 0}
                claimed={totals.claimed[p] ?? 0}
              />
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SubHead() {
  return (
    <>
      <th className={cn(SUB, "border-l border-line")}>Store</th>
      <th className={SUB}>Claim</th>
      <th className={SUB}>Δ</th>
      <th className={SUB}>Δ%</th>
    </>
  );
}

function GroupCells({ store, claimed }: { store: number; claimed: number }) {
  return (
    <>
      <td className={cn(CELL, "border-l border-line")}>{intCompact(store)}</td>
      <td className={CELL}>{intCompact(claimed)}</td>
      <td className={cn(CELL, "text-ink-2")}>{signedCompact(reconDelta(store, claimed))}</td>
      <td className={CELL}>
        <PctCell pct={reconDeltaPct(store, claimed)} />
      </td>
    </>
  );
}
