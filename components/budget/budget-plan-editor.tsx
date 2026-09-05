"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CopyPlus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
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
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_LABEL } from "@/lib/palette";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { int, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  curveExpected,
  curveFraction,
  daysInMonth,
  elapsedDaysInMonth,
  monthKey,
  monthLabel,
  monthStartIso,
  pacingDeviation,
  pacingTone,
  pacingVerdict,
  prevMonthKey,
  spendInDisplayCurrency,
  validateRate,
  validateWeight,
  variance,
  variancePct,
} from "@/lib/budget";
import {
  saveBudgetMonth,
  copyBudgetFromLastMonth,
  setUsdToSarRate,
} from "@/app/actions/budget";
import type { BudgetMonthData } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  formatSpend,
  platformAnchorId,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";

interface SpendRow {
  key: string;
  kind: "platform" | "combo";
  platform: string;
  objective: string | null;
  planned: number;
  actual: number;
  unplanned: boolean;
}

const WEIGHT_STEP = 0.5;
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 10;

/**
 * The Plan page body — v1's Budget editor relocated intact (allocations table
 * with draft/dirty/save, copy-from-last-month, revenue target, rate, currency
 * toggle), plus v2's day-curve calendar editor and the reserve budget. Spend is
 * USD natively; the toggle converts DISPLAY through the per-brand rate. Actuals
 * are raw month totals (no exclusion filtering — standing decision). Pacing is
 * curve-based (current month only).
 */
export function BudgetPlanEditor({
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
  const [isPending, setIsPending] = useState(false);

  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  // ── Month math ─────────────────────────────────────────────────────────────
  const isCurrentMonth = monthKey(today) === month;
  const totalDays = daysInMonth(monthStartIso(month));
  const elapsed = elapsedDaysInMonth(month, today);

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [revenueDraft, setRevenueDraft] = useState<string>("");
  const [reserveDraft, setReserveDraft] = useState<string>("");
  const [weightsDraft, setWeightsDraft] = useState<Record<number, number>>({});
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
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
    setReserveDraft(data.reserveSpendUsd > 0 ? String(data.reserveSpendUsd) : "");
    setWeightsDraft({ ...data.dayWeightOverrides });
    setSelectedDay(null);
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDrafts(new Map());
    setRevenueDraft("");
    setReserveDraft("");
    setWeightsDraft({});
    setSelectedDay(null);
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
    if (revenueDraft.trim() !== origRev) return true;
    if (Number(reserveDraft || 0) !== data.reserveSpendUsd) return true;
    // Weights: compare only the meaningful (non-1) overrides.
    const clean = (o: Record<number, number>) =>
      Object.entries(o)
        .filter(([, w]) => w !== 1)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([d, w]) => `${d}:${w}`)
        .join(",");
    return clean(weightsDraft) !== clean(data.dayWeightOverrides);
  }, [editing, drafts, revenueDraft, reserveDraft, weightsDraft, data]);

  // The curve the page is showing: the draft while editing (live preview), the
  // stored overrides otherwise.
  const activeWeights = editing ? weightsDraft : data.dayWeightOverrides;

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

  const spendDeviation = isCurrentMonth
    ? pacingDeviation(totals.actual, curveExpected(totals.planned, month, activeWeights, elapsed))
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
    const dev = pacingDeviation(r.actual, curveExpected(r.planned, month, activeWeights, elapsed));
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
                  pacingDeviation(r.actual, curveExpected(r.planned, month, activeWeights, elapsed)),
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
  }, [currency, rate, editing, drafts, totals, isCurrentMonth, elapsed, activeWeights, spendDeviation]);

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
        reserveSpendUsd: Number(reserveDraft || 0),
        dayWeights: Object.entries(weightsDraft)
          .filter(([, w]) => w !== 1)
          .map(([d, w]) => ({ day: Number(d), weight: w })),
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

  // ── Day-weight editing ─────────────────────────────────────────────────────
  const weightOf = (day: number) => {
    const w = activeWeights[day];
    return w !== undefined && validateWeight(w) ? w : 1;
  };
  const setWeight = (day: number, weight: number) => {
    setWeightsDraft((prev) => {
      const next = { ...prev };
      if (weight === 1) delete next[day]; // weight 1 = no override
      else next[day] = weight;
      return next;
    });
  };
  const bump = (day: number, delta: number) => {
    const next = Math.round((weightOf(day) + delta) * 2) / 2;
    setWeight(day, Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, next)));
  };
  const overrideCount = Object.values(activeWeights).filter(
    (w) => w !== 1 && validateWeight(w),
  ).length;

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today}>
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

        <CurrencyToggle currency={currency} onChange={pickCurrency} />

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
      </BudgetMonthBar>

      {/* Revenue target + reserve */}
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
        <span className="text-label text-ink-3">Reserve (USD)</span>
        {editing ? (
          <Input
            value={reserveDraft}
            onChange={(e) => setReserveDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            className="h-8 w-28 text-right num"
            aria-label="Reserve spend (USD)"
          />
        ) : (
          <span className="num tabular-nums text-ink">
            {data.reserveSpendUsd > 0 ? usd(data.reserveSpendUsd) : "—"}
          </span>
        )}
        <span className="text-[11px] text-ink-3">
          Contingency on top of the plan — excluded from pacing.
        </span>
      </div>

      {/* Day-weight curve */}
      <DayCurveEditor
        month={month}
        totalDays={totalDays}
        weights={activeWeights}
        weightOf={weightOf}
        editing={editing}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        onBump={bump}
        onSetWeight={setWeight}
        onResetAll={() => {
          setWeightsDraft({});
          setSelectedDay(null);
        }}
        overrideCount={overrideCount}
      />

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

      {/* Spend table — platform rows carry anchor ids for Overview's cards */}
      <DataTable<SpendRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        rowId={(r) => (r.kind === "platform" ? platformAnchorId(r.platform) : undefined)}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[720px]"
        csvFileName={`budget-${month}-${currency.toLowerCase()}`}
        rowClassName={(r) =>
          cn(
            r.kind === "platform" && "bg-surface-2/50 font-medium scroll-mt-24",
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
              {monthLabel(prevMonthKey(month))} replaces it entirely (allocations,
              the revenue target, the reserve, and the day-weight curve).
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

/**
 * The day-weight calendar: a weekday-aligned grid of the month's days, each
 * showing its weight when overridden (paydays pop). In edit mode, clicking a
 * day selects it and a stepper adjusts its weight in 0.5 steps (weight 1 = no
 * override, deleted on save). The preview line shows the cumulative plan curve
 * the weights produce vs the linear baseline.
 */
function DayCurveEditor({
  month,
  totalDays,
  weights,
  weightOf,
  editing,
  selectedDay,
  onSelectDay,
  onBump,
  onSetWeight,
  onResetAll,
  overrideCount,
}: {
  month: string;
  totalDays: number;
  weights: Record<number, number>;
  weightOf: (day: number) => number;
  editing: boolean;
  selectedDay: number | null;
  onSelectDay: (day: number | null) => void;
  onBump: (day: number, delta: number) => void;
  onSetWeight: (day: number, weight: number) => void;
  onResetAll: () => void;
  overrideCount: number;
}) {
  // Sunday-first weekday of day 1, for calendar alignment.
  const startIso = monthStartIso(month);
  const firstWeekday = new Date(`${startIso}T00:00:00Z`).getUTCDay();

  // Cumulative preview: the weighted curve vs the linear diagonal, as an SVG
  // polyline over [0..1]² (x = day share, y = cumulative plan share).
  const W = 260;
  const H = 64;
  const pts = (frac: (d: number) => number) =>
    [
      `0,${H}`,
      ...Array.from({ length: totalDays }, (_, i) => {
        const x = ((i + 1) / totalDays) * W;
        const y = H - frac(i + 1) * H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }),
    ].join(" ");

  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-ink">Plan curve</h3>
          <p className="text-[11px] text-ink-3">
            {overrideCount === 0
              ? "All days weighted 1 — plan-to-date is spread evenly (linear)."
              : `${overrideCount} weighted day${overrideCount === 1 ? "" : "s"} — paydays get a bigger share of the plan.`}
            {editing && " Click a day to adjust its weight."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live preview */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-12 w-48 shrink-0"
            aria-label="Cumulative plan curve preview"
            role="img"
          >
            <line x1={0} y1={H} x2={W} y2={0} stroke="var(--line-2)" strokeDasharray="3 3" />
            <polyline
              points={pts((d) => curveFraction(month, weights, d))}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={1.8}
            />
          </svg>
          {editing && (
            <Button type="button" variant="outline" size="xs" onClick={onResetAll} disabled={overrideCount === 0}>
              <RotateCcw className="h-3 w-3" />
              Reset all to 1
            </Button>
          )}
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 max-w-md">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`${d}${i}`} className="text-center text-[10px] text-ink-3">
            {d}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={`pad${i}`} />
        ))}
        {Array.from({ length: totalDays }, (_, i) => {
          const day = i + 1;
          const w = weightOf(day);
          const overridden = w !== 1;
          const selected = editing && selectedDay === day;
          return (
            <button
              key={day}
              type="button"
              disabled={!editing}
              onClick={() => onSelectDay(selected ? null : day)}
              title={overridden ? `Weighted day ×${w}` : undefined}
              aria-label={`Day ${day}, weight ${w}`}
              className={cn(
                "flex h-9 flex-col items-center justify-center rounded-md border text-[11px] num transition-colors",
                overridden
                  ? "border-brand/50 bg-[var(--brand-soft)] text-ink"
                  : "border-line text-ink-2",
                editing && "hover:border-brand/60 cursor-pointer",
                !editing && "cursor-default",
                selected && "ring-2 ring-[var(--brand)]",
              )}
            >
              <span>{day}</span>
              {overridden && <span className="text-[9px] leading-none text-ink-3">×{w}</span>}
            </button>
          );
        })}
      </div>

      {/* Weight stepper for the selected day */}
      {editing && selectedDay !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-label text-ink-3">Day {selectedDay}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => onBump(selectedDay, -WEIGHT_STEP)} aria-label="Decrease weight">
            −
          </Button>
          <span className="num tabular-nums w-10 text-center">×{weightOf(selectedDay)}</span>
          <Button type="button" variant="outline" size="xs" onClick={() => onBump(selectedDay, WEIGHT_STEP)} aria-label="Increase weight">
            +
          </Button>
          {weightOf(selectedDay) !== 1 && (
            <Button type="button" variant="ghost" size="xs" onClick={() => onSetWeight(selectedDay, 1)}>
              Reset to 1
            </Button>
          )}
          <span className="text-[11px] text-ink-3">
            0.5–10, step 0.5. Weight 1 means a normal day.
          </span>
        </div>
      )}
    </div>
  );
}
