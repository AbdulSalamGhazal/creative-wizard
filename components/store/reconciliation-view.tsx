"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Columns3, Download, Megaphone, Percent, Scale, ShoppingBag } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { MetricCard } from "@/components/overview/metric-card";
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
import { PlatformDot } from "@/components/ui/platform-dot";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { sar, usd, isoDate, int } from "@/lib/format";
import { downloadCsv, todayStamp } from "@/lib/csv-export";
import { useNavTransition } from "@/lib/nav-progress";
import {
  reconDelta,
  reconDeltaPct,
  reconDeltaTone,
  reconMatchRate,
  isWithinAttributionLag,
} from "@/lib/reconciliation";
import { cn } from "@/lib/utils";
import type {
  ReconOverviewRow,
  ReconByPlatformRow,
} from "@/db/queries/reconciliation";

type Mode = "overview" | "platform";
type PlatformKey = keyof typeof PLATFORM_COLOR;

interface Props {
  from: string | null;
  to: string | null;
  overview: ReconOverviewRow[];
  byPlatform: ReconByPlatformRow[];
  platforms: PlatformKey[];
  sourceConfigured: boolean;
  /** Latest ads data day across platforms, for the attribution-lag marker. */
  maxHorizon: string | null;
  /** Distinct source values present in data but not yet mapped. */
  unmappedCount: number;
  canConfig: boolean;
}

/** Signed integer with a real minus sign, e.g. +3 / −4 / 0. */
function signed(n: number): string {
  if (n > 0) return `+${int(n)}`;
  if (n < 0) return `−${int(Math.abs(n))}`;
  return "0";
}
function pctText(pct: number | null): string {
  if (pct === null) return "—";
  const v = (pct * 100).toFixed(1);
  return `${pct > 0 ? "+" : ""}${v}%`;
}

export function ReconciliationView({
  from,
  to,
  overview,
  byPlatform,
  platforms,
  sourceConfigured,
  maxHorizon,
  unmappedCount,
  canConfig,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useNavTransition();

  const [mode, setMode] = useState<Mode>("overview");
  // The two context columns are hidden by default (counts-only page).
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(["store_revenue", "spend"]),
  );

  const setRange = (nf: string | null, nt: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (nf) next.set("from", nf); else next.delete("from");
    if (nt) next.set("to", nt); else next.delete("to");
    startNav(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const lag = (day: string) => isWithinAttributionLag(day, maxHorizon);

  // ── Overview columns ───────────────────────────────────────────────────────
  const overviewTotals = useMemo(() => {
    const s = overview.reduce(
      (a, r) => ({
        orders: a.orders + r.storeOrders,
        conv: a.conv + r.platformConv,
        rev: a.rev + r.storeRevenue,
        spend: a.spend + r.spend,
      }),
      { orders: 0, conv: 0, rev: 0, spend: 0 },
    );
    return s;
  }, [overview]);

  const columns: DataColumn<ReconOverviewRow>[] = useMemo(() => {
    const t = overviewTotals;
    return [
      {
        key: "day",
        label: "Day",
        pinned: true,
        sortable: true,
        render: (r) => <DayCell day={r.day} isLag={lag(r.day)} />,
        sortValue: (r) => r.day,
        csv: (r) => r.day,
        total: () => <span className="text-ink-3">{int(overview.length)} days</span>,
      },
      {
        key: "store_orders",
        label: "Store orders",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums">{int(r.storeOrders)}</span>,
        sortValue: (r) => r.storeOrders,
        csv: (r) => r.storeOrders,
        total: () => <span className="num tabular-nums font-semibold">{int(t.orders)}</span>,
      },
      {
        key: "platform_conv",
        label: "Platform conv.",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums">{int(r.platformConv)}</span>,
        sortValue: (r) => r.platformConv,
        csv: (r) => r.platformConv,
        total: () => <span className="num tabular-nums font-semibold">{int(t.conv)}</span>,
      },
      {
        key: "delta",
        label: "Δ",
        align: "right",
        sortable: true,
        render: (r) => (
          <span className="num tabular-nums">{signed(reconDelta(r.storeOrders, r.platformConv))}</span>
        ),
        sortValue: (r) => reconDelta(r.storeOrders, r.platformConv),
        csv: (r) => reconDelta(r.storeOrders, r.platformConv),
        total: () => (
          <span className="num tabular-nums font-semibold">
            {signed(reconDelta(t.orders, t.conv))}
          </span>
        ),
      },
      {
        key: "delta_pct",
        label: "Δ%",
        align: "right",
        sortable: true,
        render: (r) => {
          const pct = reconDeltaPct(r.storeOrders, r.platformConv);
          return (
            <span
              className={cn(
                "num tabular-nums",
                reconDeltaTone(pct) === "warn" ? "text-warn" : "text-ink-2",
              )}
            >
              {pctText(pct)}
            </span>
          );
        },
        sortValue: (r) => reconDeltaPct(r.storeOrders, r.platformConv),
        csv: (r) => {
          const pct = reconDeltaPct(r.storeOrders, r.platformConv);
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        total: () => {
          const pct = reconDeltaPct(t.orders, t.conv);
          return (
            <span
              className={cn(
                "num tabular-nums font-semibold",
                reconDeltaTone(pct) === "warn" ? "text-warn" : "text-ink-2",
              )}
            >
              {pctText(pct)}
            </span>
          );
        },
      },
      {
        key: "store_revenue",
        label: "Store revenue",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums">{sar(r.storeRevenue)}</span>,
        sortValue: (r) => r.storeRevenue,
        csv: (r) => r.storeRevenue,
        total: () => <span className="num tabular-nums font-semibold">{sar(t.rev)}</span>,
      },
      {
        key: "spend",
        label: "Spend",
        align: "right",
        sortable: true,
        render: (r) => <span className="num tabular-nums">{usd(r.spend)}</span>,
        sortValue: (r) => r.spend,
        csv: (r) => r.spend,
        total: () => <span className="num tabular-nums font-semibold">{usd(t.spend)}</span>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, overviewTotals, maxHorizon]);

  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "day",
    dir: "desc",
  });
  const sortedOverview = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return overview;
    const sv = col.sortValue;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...overview].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
  }, [overview, columns, sort]);

  function exportCsv() {
    if (mode === "overview") {
      const head = [
        "Day",
        "Store orders",
        "Platform conversions",
        "Delta",
        "Delta %",
        "Store revenue (SAR)",
        "Spend (USD)",
      ];
      const lines = sortedOverview.map((r) => {
        const pct = reconDeltaPct(r.storeOrders, r.platformConv);
        return [
          r.day,
          r.storeOrders,
          r.platformConv,
          reconDelta(r.storeOrders, r.platformConv),
          pct === null ? "" : (pct * 100).toFixed(1),
          r.storeRevenue,
          r.spend,
        ];
      });
      downloadCsv(`reconciliation-overview-${todayStamp()}.csv`, toCsv(head, lines));
    } else {
      const head = ["Day"];
      for (const p of platforms) {
        head.push(`${PLATFORM_LABEL[p]} orders`, `${PLATFORM_LABEL[p]} claimed`, `${PLATFORM_LABEL[p]} Δ`);
      }
      head.push("Unattributed orders");
      const lines = byPlatform.map((r) => {
        const cells: (string | number)[] = [r.day];
        for (const p of platforms) {
          const o = r.storeByPlatform[p] ?? 0;
          const c = r.claimedByPlatform[p] ?? 0;
          cells.push(o, c, reconDelta(o, c));
        }
        cells.push(r.unattributed);
        return cells;
      });
      downloadCsv(`reconciliation-by-platform-${todayStamp()}.csv`, toCsv(head, lines));
    }
  }

  const empty = mode === "overview" ? overview.length === 0 : byPlatform.length === 0;

  return (
    <div className="space-y-4">
      {/* Filter + controls bar */}
      <div className="sticky top-14 z-10 -mx-6 flex flex-wrap items-center justify-between gap-2 bg-bg/80 px-6 py-2 backdrop-blur">
        <DateRangePicker from={from} to={to} onChange={setRange} />
        <div className="flex items-center gap-2">
          <ModeToggle mode={mode} onChange={setMode} />
          {mode === "overview" && (
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
                  { k: "store_revenue", label: "Store revenue" },
                  { k: "spend", label: "Spend" },
                ].map(({ k, label }) => (
                  <DropdownMenuCheckboxItem
                    key={k}
                    checked={!hidden.has(k)}
                    onCheckedChange={(on) =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (on) next.delete(k); else next.add(k);
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
        </div>
      </div>

      {/* Range summary — counts only, mode-independent (both modes reconcile to
          the same totals). Match rate = claimed / store orders. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Store orders"
          value={overview.length === 0 ? "—" : int(overviewTotals.orders)}
          icon={ShoppingBag}
          hideBreakdown
          empty={overview.length === 0}
        />
        <MetricCard
          label="Platform conv."
          value={overview.length === 0 ? "—" : int(overviewTotals.conv)}
          icon={Megaphone}
          hideBreakdown
          empty={overview.length === 0}
        />
        <MetricCard
          label="Δ store − claimed"
          value={
            overview.length === 0
              ? "—"
              : signed(reconDelta(overviewTotals.orders, overviewTotals.conv))
          }
          icon={Scale}
          hideBreakdown
          empty={overview.length === 0}
        />
        <MetricCard
          label="Match rate"
          value={(() => {
            if (overview.length === 0) return "—";
            const rate = reconMatchRate(overviewTotals.orders, overviewTotals.conv);
            return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
          })()}
          icon={Percent}
          hideBreakdown
          empty={overview.length === 0}
        />
      </div>

      {/* Unmapped-values hint */}
      {sourceConfigured && unmappedCount > 0 && (
        <div className="rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2 text-xs text-ink-2">
          {int(unmappedCount)} source value{unmappedCount === 1 ? "" : "s"} in your
          orders {unmappedCount === 1 ? "is" : "are"} unmapped — those orders count
          as Unattributed.{" "}
          {canConfig ? (
            <Link
              href="/admin/catalog?tab=store_fields"
              className="underline hover:text-ink"
            >
              Configure
            </Link>
          ) : (
            <span className="text-ink-3">Ask an admin to configure the mapping.</span>
          )}
        </div>
      )}

      {mode === "overview" ? (
        <DataTable<ReconOverviewRow>
          columns={columns}
          rows={sortedOverview}
          rowKey={(r) => r.day}
          sort={sort.key}
          dir={sort.dir}
          hidden={[...hidden]}
          onSort={(key, dir) => setSort({ key, dir })}
          showTotals={overview.length > 0}
          minWidthClass="min-w-[640px]"
          empty={<EmptyState />}
        />
      ) : !sourceConfigured ? (
        <NotConfigured canConfig={canConfig} />
      ) : byPlatform.length === 0 ? (
        <EmptyState />
      ) : (
        <ByPlatformTable rows={byPlatform} platforms={platforms} lag={lag} />
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
          title="Platform data may still be attributing (within 7 days of the latest ads data) — a store &gt; claimed gap here may not be a real discrepancy."
        />
      )}
    </span>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opts: Array<{ k: Mode; label: string }> = [
    { k: "overview", label: "Overview" },
    { k: "platform", label: "By platform" },
  ];
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => onChange(o.k)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            mode === o.k ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
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
          href="/admin/catalog?tab=store_fields"
          className="mt-1 text-xs text-ink-2 underline hover:text-ink"
        >
          Configure in Configuration → Store
        </Link>
      )}
    </div>
  );
}

// ── By-platform grouped table (summary-table visual language) ─────────────────
function ByPlatformTable({
  rows,
  platforms,
  lag,
}: {
  rows: ReconByPlatformRow[];
  platforms: PlatformKey[];
  lag: (day: string) => boolean;
}) {
  const totals = useMemo(() => {
    const store: Record<string, number> = {};
    const claimed: Record<string, number> = {};
    let unattr = 0;
    for (const r of rows) {
      for (const p of platforms) {
        store[p] = (store[p] ?? 0) + (r.storeByPlatform[p] ?? 0);
        claimed[p] = (claimed[p] ?? 0) + (r.claimedByPlatform[p] ?? 0);
      }
      unattr += r.unattributed;
    }
    return { store, claimed, unattr };
  }, [rows, platforms]);

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[760px] border-collapse text-sm num">
        <thead className="sticky top-0 z-20 bg-surface">
          {/* Group banners */}
          <tr className="border-b border-line">
            <th className="sticky left-0 z-30 bg-surface px-3 py-2 text-left text-label text-ink-3">
              Day
            </th>
            {platforms.map((p) => (
              <th
                key={p}
                colSpan={3}
                className="border-l border-line px-3 py-2 text-center text-label"
                style={{ color: PLATFORM_COLOR[p] }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <PlatformDot platform={p} size="sm" />
                  {PLATFORM_LABEL[p]}
                </span>
              </th>
            ))}
            <th className="border-l border-line px-3 py-2 text-center text-label text-ink-3">
              Unattributed
            </th>
          </tr>
          {/* Sub-labels */}
          <tr className="border-b border-line text-label text-ink-3">
            <th className="sticky left-0 z-30 bg-surface px-3 py-1.5" />
            {platforms.map((p) => (
              <SubHead key={p} />
            ))}
            <th className="border-l border-line px-3 py-1.5 text-right font-medium">
              Orders
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.day} className="hover:bg-surface-2/50">
              <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-left">
                <DayCell day={r.day} isLag={lag(r.day)} />
              </td>
              {platforms.map((p) => {
                const o = r.storeByPlatform[p] ?? 0;
                const c = r.claimedByPlatform[p] ?? 0;
                return (
                  <GroupCells key={p} orders={o} claimed={c} />
                );
              })}
              <td className="border-l border-line px-3 py-2 text-right tabular-nums">
                {int(r.unattributed)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-surface-2">
          <tr className="border-t border-line font-semibold">
            <td className="sticky left-0 z-30 bg-surface-2 px-3 py-2 text-left text-ink-3">
              Totals
            </td>
            {platforms.map((p) => (
              <GroupCells
                key={p}
                orders={totals.store[p] ?? 0}
                claimed={totals.claimed[p] ?? 0}
              />
            ))}
            <td className="border-l border-line px-3 py-2 text-right tabular-nums">
              {int(totals.unattr)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SubHead() {
  return (
    <>
      <th className="border-l border-line px-3 py-1.5 text-right font-medium">Orders</th>
      <th className="px-3 py-1.5 text-right font-medium">Claimed</th>
      <th className="px-3 py-1.5 text-right font-medium">Δ</th>
    </>
  );
}

function GroupCells({ orders, claimed }: { orders: number; claimed: number }) {
  return (
    <>
      <td className="border-l border-line px-3 py-2 text-right tabular-nums">{int(orders)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{int(claimed)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-2">
        {signed(reconDelta(orders, claimed))}
      </td>
    </>
  );
}

function toCsv(head: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
