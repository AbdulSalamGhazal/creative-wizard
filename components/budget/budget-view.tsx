"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { MetricCard } from "@/components/overview/metric-card";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { usd, sar, int, roas } from "@/lib/format";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import {
  daysInMonth,
  elapsedDaysInMonth,
  monthKey,
  monthLabel,
  monthStartIso,
  nextMonthKey,
  pacingDeviation,
  pacingExpected,
  pacingTone,
  pacingVerdict,
  prevMonthKey,
  roasThroughRate,
  spendInDisplayCurrency,
  validateRate,
  variance,
  variancePct,
} from "@/lib/budget";
import {
  saveBudgetMonth,
  copyBudgetFromLastMonth,
  setUsdToSarRate,
} from "@/app/actions/budget";
import type { BudgetMonthData } from "@/db/queries/budget";

type Currency = "USD" | "SAR";
const CURRENCY_KEY = "cw-budget-currency";

interface SpendRow {
  key: string;
  kind: "platform" | "combo";
  platform: string;
  objective: string | null;
  planned: number;
  actual: number;
  unplanned: boolean;
}

/**
 * The Budget page body. Spend is USD natively; the toggle converts DISPLAY
 * through the per-brand rate. ROAS always goes through the rate regardless of
 * the toggle. Actuals are raw month totals (no exclusion filtering — standing
 * decision). Pacing applies to the CURRENT month only.
 */
export function BudgetView({
  month,
  today,
  data,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startNav] = useNavTransition();
  const [isPending, setIsPending] = useState(false);

  // ── Display currency (per-user, display-only → localStorage) ───────────────
  const [currency, setCurrency] = useState<Currency>("USD");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENCY_KEY);
      if (stored === "SAR" || stored === "USD") setCurrency(stored);
    } catch {
      /* keep USD */
    }
  }, []);
  const pickCurrency = (c: Currency) => {
    setCurrency(c);
    try {
      localStorage.setItem(CURRENCY_KEY, c);
    } catch {
      /* ignore */
    }
  };
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) =>
    currency === "SAR" ? sar(spendInDisplayCurrency(usdAmount, "SAR", rate)) : usd(usdAmount);

  // ── Month math ─────────────────────────────────────────────────────────────
  const isCurrentMonth = monthKey(today) === month;
  const totalDays = daysInMonth(monthStartIso(month));
  const elapsed = elapsedDaysInMonth(month, today);

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [revenueDraft, setRevenueDraft] = useState<string>("");
  const [addPlatform, setAddPlatform] = useState<string>("");
  const [addObjective, setAddObjective] = useState<string>("");
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  const comboKey = (p: string, o: string) => `${p}|${o}`;
  const startEditing = () => {
    setDrafts(
      new Map(data.allocations.map((a) => [comboKey(a.platform, a.objective), String(a.plannedSpend)])),
    );
    setRevenueDraft(data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar));
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDrafts(new Map());
    setRevenueDraft("");
  };
  const dirty = useMemo(() => {
    if (!editing) return false;
    const orig = new Map(
      data.allocations.map((a) => [comboKey(a.platform, a.objective), a.plannedSpend]),
    );
    if (orig.size !== drafts.size) return true;
    for (const [k, v] of drafts) {
      if (!orig.has(k) || Number(v || 0) !== orig.get(k)) return true;
    }
    const origRev = data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar);
    return revenueDraft.trim() !== origRev;
  }, [editing, drafts, revenueDraft, data]);

  // ── Spend rows: plan ∪ actual, grouped platform → objective ────────────────
  const planned = editing
    ? new Map([...drafts].map(([k, v]) => [k, Number(v || 0)]))
    : new Map(data.allocations.map((a) => [comboKey(a.platform, a.objective), a.plannedSpend]));
  const actualByCombo = new Map(
    data.actualSpendByCombo.map((c) => [comboKey(c.platform, c.objective), c.actualSpend]),
  );

  const rows: SpendRow[] = useMemo(() => {
    const out: SpendRow[] = [];
    for (const platform of ALL_PLATFORMS) {
      const combos = new Set<string>();
      for (const k of planned.keys()) if (k.startsWith(platform + "|")) combos.add(k);
      for (const k of actualByCombo.keys()) if (k.startsWith(platform + "|")) combos.add(k);
      if (combos.size === 0) continue;
      const children: SpendRow[] = [...combos]
        .map((k) => {
          const objective = k.split("|")[1]!;
          const plan = planned.get(k) ?? 0;
          const actual = actualByCombo.get(k) ?? 0;
          return {
            key: k,
            kind: "combo" as const,
            platform,
            objective,
            planned: plan,
            actual,
            unplanned: !planned.has(k),
          };
        })
        .sort((a, b) => (a.objective! < b.objective! ? -1 : 1));
      out.push({
        key: platform,
        kind: "platform",
        platform,
        objective: null,
        planned: children.reduce((s, c) => s + c.planned, 0),
        actual: children.reduce((s, c) => s + c.actual, 0),
        unplanned: false,
      });
      out.push(...children);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, editing, drafts]);

  const totals = useMemo(() => {
    const combos = rows.filter((r) => r.kind === "combo");
    return {
      planned: combos.reduce((s, r) => s + r.planned, 0),
      actual: combos.reduce((s, r) => s + r.actual, 0),
    };
  }, [rows]);

  // ── Headline numbers ───────────────────────────────────────────────────────
  const actualRoas = roasThroughRate(data.actualRevenueSar, totals.actual, rate);
  const targetRoas =
    data.plannedRevenueSar !== null && totals.planned > 0
      ? roasThroughRate(data.plannedRevenueSar, totals.planned, rate)
      : null;
  const spendDeviation = isCurrentMonth
    ? pacingDeviation(totals.actual, pacingExpected(totals.planned, elapsed, totalDays))
    : null;
  const revenueDeviation =
    isCurrentMonth && data.plannedRevenueSar !== null
      ? pacingDeviation(
          data.actualRevenueSar,
          pacingExpected(data.plannedRevenueSar, elapsed, totalDays),
        )
      : null;

  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => new Map(prev).set(key, value));
  const removeDraft = (key: string) =>
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });

  // ── Table columns ──────────────────────────────────────────────────────────
  const pacingCell = (r: SpendRow) => {
    const dev = pacingDeviation(r.actual, pacingExpected(r.planned, elapsed, totalDays));
    return (
      <span className={cn("num text-xs", pacingTone(dev) === "warn" ? "text-warn" : "text-ink-3")}>
        {pacingVerdict(dev)}
      </span>
    );
  };

  const columns: DataColumn<SpendRow>[] = useMemo(() => {
    const cols: DataColumn<SpendRow>[] = [
      {
        key: "item",
        label: "Platform / objective",
        pinned: true,
        render: (r) =>
          r.kind === "platform" ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <PlatformDot platform={r.platform as never} size="sm" />
              {PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 pl-6">
              {r.objective}
              {r.unplanned && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  unplanned
                </span>
              )}
            </span>
          ),
        csv: (r) =>
          r.kind === "platform"
            ? (PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform)
            : `  ${r.objective}${r.unplanned ? " (unplanned)" : ""}`,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned",
        label: `Planned (${currency})`,
        align: "right",
        render: (r) => {
          if (editing && r.kind === "combo" && !r.unplanned) {
            return (
              <span className="inline-flex items-center justify-end gap-1">
                <Input
                  value={drafts.get(r.key) ?? ""}
                  onChange={(e) => setDraft(r.key, e.target.value.replace(/[^0-9.]/g, ""))}
                  className="h-7 w-24 text-right num"
                  aria-label={`Planned spend for ${r.platform} ${r.objective}`}
                />
                <button
                  type="button"
                  onClick={() => removeDraft(r.key)}
                  className="text-ink-3 hover:text-neg"
                  aria-label="Remove allocation"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            );
          }
          return <span className="num tabular-nums">{r.planned > 0 || !r.unplanned ? fmtSpend(r.planned) : "—"}</span>;
        },
        csv: (r) => spendInDisplayCurrency(r.planned, currency, rate).toFixed(2),
        total: () => <span className="num tabular-nums font-semibold">{fmtSpend(totals.planned)}</span>,
      },
      {
        key: "actual",
        label: `Actual (${currency})`,
        align: "right",
        render: (r) => <span className="num tabular-nums">{fmtSpend(r.actual)}</span>,
        csv: (r) => spendInDisplayCurrency(r.actual, currency, rate).toFixed(2),
        total: () => <span className="num tabular-nums font-semibold">{fmtSpend(totals.actual)}</span>,
      },
      ...(isCurrentMonth
        ? [
            {
              key: "pacing",
              label: "Pacing",
              align: "right" as const,
              render: pacingCell,
              csv: (r: SpendRow) =>
                pacingVerdict(
                  pacingDeviation(r.actual, pacingExpected(r.planned, elapsed, totalDays)),
                ),
              total: () => (
                <span
                  className={cn(
                    "num text-xs",
                    pacingTone(spendDeviation) === "warn" ? "text-warn" : "text-ink-3",
                  )}
                >
                  {pacingVerdict(spendDeviation)}
                </span>
              ),
            },
          ]
        : []),
      {
        key: "variance",
        label: `Variance (${currency})`,
        align: "right",
        render: (r) => {
          const v = variance(r.actual, r.planned);
          return (
            <span className="num tabular-nums text-ink-2">
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {fmtSpend(Math.abs(v))}
            </span>
          );
        },
        csv: (r) => spendInDisplayCurrency(variance(r.actual, r.planned), currency, rate).toFixed(2),
        total: () => {
          const v = variance(totals.actual, totals.planned);
          return (
            <span className="num tabular-nums font-semibold text-ink-2">
              {v > 0 ? "+" : v < 0 ? "−" : ""}
              {fmtSpend(Math.abs(v))}
            </span>
          );
        },
      },
      {
        key: "variance_pct",
        label: "Variance %",
        align: "right",
        render: (r) => {
          const pct = variancePct(r.actual, r.planned);
          return (
            <span className="num tabular-nums text-ink-3">
              {pct === null ? "—" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
            </span>
          );
        },
        csv: (r) => {
          const pct = variancePct(r.actual, r.planned);
          return pct === null ? "" : (pct * 100).toFixed(1);
        },
        total: () => {
          const pct = variancePct(totals.actual, totals.planned);
          return (
            <span className="num tabular-nums font-semibold text-ink-3">
              {pct === null ? "—" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`}
            </span>
          );
        },
      },
    ];
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, rate, editing, drafts, totals, isCurrentMonth, elapsed, totalDays, spendDeviation]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const save = async () => {
    setIsPending(true);
    try {
      const allocations = [...drafts].map(([k, v]) => {
        const [platform, objective] = k.split("|");
        return { platform: platform!, objective: objective!, plannedSpend: Number(v || 0) };
      });
      const rev = revenueDraft.trim();
      const res = await saveBudgetMonth({
        month,
        allocations,
        plannedRevenueSar: rev === "" ? null : Number(rev),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the plan");
        return;
      }
      toast.success("Plan saved");
      stopEditing();
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const doCopy = async () => {
    setIsPending(true);
    try {
      const res = await copyBudgetFromLastMonth({ month });
      if (!res.ok) {
        toast.error(res.error ?? "Could not copy");
        return;
      }
      toast.success(`Copied ${int(res.copied ?? 0)} allocations from ${monthLabel(prevMonthKey(month))}`);
      setCopyConfirm(false);
      stopEditing();
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const saveRate = async () => {
    if (rateDraft === null) return;
    const value = Number(rateDraft);
    if (!validateRate(value)) {
      toast.error("Rate must be greater than 0 and at most 100.");
      return;
    }
    setIsPending(true);
    try {
      const res = await setUsdToSarRate(value);
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the rate");
        return;
      }
      toast.success(`Rate set to ${value.toFixed(4)}`);
      setRateDraft(null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const hasPlan = data.allocations.length > 0 || data.plannedRevenueSar !== null;
  const monthQ = (m: string) => startNav(() => router.replace(`/budget?month=${m}`, { scroll: false }));

  const addDraftRow = () => {
    if (!addPlatform || !addObjective) return;
    const k = comboKey(addPlatform, addObjective);
    if (drafts.has(k)) {
      toast.error("That platform × objective already has a row.");
      return;
    }
    setDraft(k, "0");
    setAddPlatform("");
    setAddObjective("");
  };

  return (
    <div className="space-y-4">
      {/* Month nav + controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="xs" onClick={() => monthQ(prevMonthKey(month))} aria-label="Previous month">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-[10rem] text-center font-display text-lg">{monthLabel(month)}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => monthQ(nextMonthKey(month))} aria-label="Next month">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          {!isCurrentMonth && (
            <Button type="button" variant="ghost" size="xs" onClick={() => monthQ(monthKey(today))}>
              Today
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rate (display + inline edit) */}
          <span className="text-[11px] text-ink-3 num">
            1 USD ={" "}
            {rateDraft === null ? (
              <>
                {rate.toFixed(2)} SAR
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setRateDraft(String(rate))}
                    className="ml-1 text-ink-3 hover:text-ink"
                    aria-label="Edit rate"
                  >
                    <Pencil className="inline h-3 w-3" />
                  </button>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Input
                  value={rateDraft}
                  onChange={(e) => setRateDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                  className="h-6 w-20 text-right num"
                  aria-label="USD to SAR rate"
                />
                <button type="button" onClick={saveRate} disabled={isPending} className="text-pos" aria-label="Save rate">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setRateDraft(null)} className="text-ink-3" aria-label="Cancel rate edit">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </span>

          {/* Currency toggle */}
          <div className="inline-flex rounded-md border border-line bg-surface p-0.5">
            {(["USD", "SAR"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pickCurrency(c)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors",
                  currency === c ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink",
                )}
              >
                {c}
              </button>
            ))}
          </div>

          {canManage && !editing && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data.prevMonthHasPlan || isPending}
                title={data.prevMonthHasPlan ? undefined : `${monthLabel(prevMonthKey(month))} has no plan to copy.`}
                onClick={() => (hasPlan ? setCopyConfirm(true) : void doCopy())}
              >
                <CopyPlus className="h-3.5 w-3.5" />
                Copy from last month
              </Button>
              <Button type="button" size="sm" onClick={startEditing}>
                <Pencil className="h-3.5 w-3.5" />
                Edit plan
              </Button>
            </>
          )}
          {editing && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={stopEditing} disabled={isPending}>
                Discard
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={!dirty || isPending}>
                Save plan
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Actual spend"
          value={fmtSpend(totals.actual)}
          icon={Wallet}
          bars={[]}
          emptyText={`Plan: ${totals.planned > 0 ? fmtSpend(totals.planned) : "—"}`}
        />
        <MetricCard
          label="Actual revenue"
          value={sar(data.actualRevenueSar)}
          icon={ShoppingBag}
          bars={[]}
          emptyText={`Plan: ${data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}`}
        />
        <MetricCard
          label="ROAS (via rate)"
          value={actualRoas === null ? "—" : roas(actualRoas)}
          icon={TrendingUp}
          bars={[]}
          emptyText={
            !validateRate(rate)
              ? "Set a USD→SAR rate to compute ROAS."
              : `Target: ${targetRoas === null ? "—" : roas(targetRoas)}`
          }
        />
        <MetricCard
          label="Actual orders"
          value={int(data.actualOrders)}
          icon={Package}
          bars={[]}
          emptyText="Context only — no plan."
        />
      </div>

      {/* Pacing verdict line (current month only) */}
      {isCurrentMonth && (
        <p className="text-xs text-ink-3">
          Day {elapsed} of {totalDays}
          {" · "}
          spend{" "}
          <span className={pacingTone(spendDeviation) === "warn" ? "text-warn" : "text-ink-2"}>
            {spendDeviation === null ? "— no plan" : `${pacingVerdict(spendDeviation)} vs plan`}
          </span>
          {data.plannedRevenueSar !== null && (
            <>
              {" · "}
              revenue{" "}
              <span className={pacingTone(revenueDeviation) === "warn" ? "text-warn" : "text-ink-2"}>
                {revenueDeviation === null ? "—" : `${pacingVerdict(revenueDeviation)} vs plan`}
              </span>
            </>
          )}
        </p>
      )}

      {/* Revenue block */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-label text-ink-3">Revenue target (SAR)</span>
        {editing ? (
          <Input
            value={revenueDraft}
            onChange={(e) => setRevenueDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 250000"
            className="h-8 w-36 text-right num"
            aria-label="Planned monthly revenue (SAR)"
          />
        ) : (
          <span className="num tabular-nums text-ink">
            {data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}
          </span>
        )}
        <span className="text-ink-3">
          actual <span className="num tabular-nums text-ink">{sar(data.actualRevenueSar)}</span>
        </span>
        <span className="text-ink-3">
          orders <span className="num tabular-nums text-ink">{int(data.actualOrders)}</span>
        </span>
        {isCurrentMonth && data.plannedRevenueSar !== null && (
          <span
            className={cn(
              "num text-xs",
              pacingTone(revenueDeviation) === "warn" ? "text-warn" : "text-ink-3",
            )}
          >
            {revenueDeviation === null ? "—" : pacingVerdict(revenueDeviation)}
          </span>
        )}
      </div>

      {/* Empty-plan hint */}
      {!hasPlan && !editing && (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink-2">No plan for this month yet.</p>
          <p className="mt-1 text-xs text-ink-3">
            {canManage
              ? "Copy last month or add allocations to start tracking against a plan."
              : "Ask someone with budget access to add a plan."}
          </p>
        </div>
      )}

      {/* Add-allocation controls (edit mode) */}
      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
          <div className="w-40">
            <Select value={addPlatform} onValueChange={setAddPlatform}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Platform…" />
              </SelectTrigger>
              <SelectContent>
                {ALL_PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    <span className="flex items-center gap-2">
                      <PlatformDot platform={p} size="sm" />
                      {PLATFORM_LABEL[p]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select value={addObjective} onValueChange={setAddObjective}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Objective…" />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_OBJECTIVES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addDraftRow} disabled={!addPlatform || !addObjective}>
            <Plus className="h-3.5 w-3.5" />
            Add allocation
          </Button>
        </div>
      )}

      {/* Spend table */}
      <DataTable<SpendRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[720px]"
        csvFileName={`budget-${month}-${currency.toLowerCase()}`}
        rowClassName={(r) =>
          cn(
            r.kind === "platform" && "bg-surface-2/50 font-medium",
            r.unplanned && "opacity-60",
          )
        }
        empty={
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Wallet className="h-6 w-6 text-ink-3" />
            <p className="text-sm text-ink-2">Nothing planned or spent this month.</p>
          </div>
        }
      />

      {/* Copy-over-existing confirm */}
      <Dialog open={copyConfirm} onOpenChange={(o) => !isPending && setCopyConfirm(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Replace this month&rsquo;s plan?</DialogTitle>
            <DialogDescription>
              {monthLabel(month)} already has a plan. Copying from{" "}
              {monthLabel(prevMonthKey(month))} replaces it entirely (allocations
              and the revenue target).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCopyConfirm(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={doCopy} disabled={isPending}>
              Replace with last month
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
