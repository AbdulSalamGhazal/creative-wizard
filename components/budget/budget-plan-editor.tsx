"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CopyPlus,
  Pencil,
  Percent,
  Plus,
  RotateCcw,
  Split,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { int, pct1, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  curveFraction,
  daysInMonth,
  distributeRemainder,
  monthLabel,
  monthStartIso,
  pctShare,
  prevMonthKey,
  redistributeByPct,
  round2,
  scaleAll,
  spendInDisplayCurrency,
  validateRate,
  validateWeight,
} from "@/lib/budget";
import {
  saveBudgetMonth,
  copyBudgetFromMonth,
  setUsdToSarRate,
} from "@/app/actions/budget";
import type { BudgetMonthData, PlanRevisionRow } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  formatSpend,
  platformAnchorId,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { BudgetPlanRevisions } from "@/components/budget/budget-plan-revisions";

interface PlanRow {
  key: string;
  kind: "platform" | "combo";
  platform: string;
  objective: string | null;
  /** USD. For a platform row: its target when one is set, else the row sum. */
  planned: number;
  /** Percent of the row's denominator (platform → month, objective → platform). */
  share: number | null;
}

const WEIGHT_STEP = 0.5;
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 10;
const NOTE_MAX = 200;

const comboKey = (p: string, o: string) => `${p}|${o}`;
const numeric = (raw: string) => raw.replace(/[^0-9.]/g, "");
const parse = (raw: string | undefined) => {
  const n = Number(raw ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * The Plan page body — a PURE PLANNING surface (2026-09). It holds the month's
 * USD allocations per platform → budget objective (Awareness / Activation /
 * Retargeting / Other — Budget's own axis), the SAR revenue target, the reserve
 * and the day-weight curve, and nothing about what was actually spent: no
 * actuals, no pacing, no variance. Plan-vs-actual lives on Overview (and, next,
 * its own Pacing tab), so this screen can be about intent alone.
 *
 * Percentages are an EDITING AFFORDANCE ONLY — amounts remain the stored truth
 * (`budget_allocations.planned_spend`); every share here is computed live from
 * the drafts and never persisted. Each save writes a plan revision, so any past
 * state can be inspected and restored from the Revisions drawer.
 */
export function BudgetPlanEditor({
  month,
  today,
  data,
  plannedMonths,
  revisions,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  /** Months that already have a plan — the "Copy from month…" options. */
  plannedMonths: string[];
  revisions: PlanRevisionRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const [currency, pickCurrency] = useBudgetCurrency();
  const rate = data.usdToSarRate;
  const fmtSpend = (usdAmount: number) => formatSpend(usdAmount, currency, rate);

  const totalDays = daysInMonth(monthStartIso(month));

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [revenueDraft, setRevenueDraft] = useState<string>("");
  const [reserveDraft, setReserveDraft] = useState<string>("");
  const [weightsDraft, setWeightsDraft] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  /** Optional month-wide budget the shares are measured against. Draft-only. */
  const [monthTotalDraft, setMonthTotalDraft] = useState("");
  /** Optional per-platform intent — the "unallocated" chips need something to
   *  measure against. Draft-only, never stored. */
  const [targets, setTargets] = useState<Map<string, string>>(new Map());
  /** The % cell being typed in — its raw text, so a keystroke isn't reformatted
   *  out from under the caret by the recomputed share. */
  const [pctEdit, setPctEdit] = useState<{ key: string; raw: string } | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [addPlatform, setAddPlatform] = useState<string>("");
  const [addObjective, setAddObjective] = useState<string>("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleDraft, setScaleDraft] = useState("");
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  const startEditing = () => {
    setDrafts(
      new Map(
        data.allocations.map((a) => [comboKey(a.platform, a.objective), String(a.plannedSpend)]),
      ),
    );
    setRevenueDraft(data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar));
    setReserveDraft(data.reserveSpendUsd > 0 ? String(data.reserveSpendUsd) : "");
    setWeightsDraft({ ...data.dayWeightOverrides });
    setMonthTotalDraft("");
    setTargets(new Map());
    setNote("");
    setPctEdit(null);
    setSelectedDay(null);
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDrafts(new Map());
    setRevenueDraft("");
    setReserveDraft("");
    setWeightsDraft({});
    setMonthTotalDraft("");
    setTargets(new Map());
    setNote("");
    setPctEdit(null);
    setSelectedDay(null);
  };
  const dirty = useMemo(() => {
    if (!editing) return false;
    const orig = new Map(
      data.allocations.map((a) => [comboKey(a.platform, a.objective), a.plannedSpend]),
    );
    if (orig.size !== drafts.size) return true;
    for (const [k, v] of drafts) {
      if (!orig.has(k) || parse(v) !== orig.get(k)) return true;
    }
    const origRev = data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar);
    if (revenueDraft.trim() !== origRev) return true;
    if (parse(reserveDraft) !== data.reserveSpendUsd) return true;
    // Weights: compare only the meaningful (non-1) overrides.
    const clean = (o: Record<number, number>) =>
      Object.entries(o)
        .filter(([, w]) => w !== 1)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([d, w]) => `${d}:${w}`)
        .join(",");
    return clean(weightsDraft) !== clean(data.dayWeightOverrides);
  }, [editing, drafts, revenueDraft, reserveDraft, weightsDraft, data]);

  // The curve the page shows: the draft while editing, the stored one otherwise.
  const activeWeights = editing ? weightsDraft : data.dayWeightOverrides;

  // ── Allocation model ───────────────────────────────────────────────────────
  const planned = useMemo(
    () =>
      editing
        ? new Map([...drafts].map(([k, v]) => [k, parse(v)]))
        : new Map(
            data.allocations.map((a) => [comboKey(a.platform, a.objective), a.plannedSpend]),
          ),
    [editing, drafts, data.allocations],
  );

  /** A platform's objective keys, in the canonical bucket order. */
  const keysFor = (platform: string) =>
    [...planned.keys()]
      .filter((k) => k.startsWith(`${platform}|`))
      .sort(
        (a, b) =>
          BUDGET_OBJECTIVES.indexOf(a.split("|")[1] as (typeof BUDGET_OBJECTIVES)[number]) -
          BUDGET_OBJECTIVES.indexOf(b.split("|")[1] as (typeof BUDGET_OBJECTIVES)[number]),
      );

  const platformSum = (platform: string) =>
    round2(keysFor(platform).reduce((s, k) => s + (planned.get(k) ?? 0), 0));

  const grandTotal = round2([...planned.values()].reduce((s, v) => s + v, 0));

  /** The platform's intent, when the planner typed one. */
  const targetOf = (platform: string): number | null => {
    if (!editing) return null;
    const raw = targets.get(platform);
    if (raw === undefined || raw.trim() === "") return null;
    return round2(parse(raw));
  };
  /** What a platform's objective shares are measured against. */
  const platformDenom = (platform: string) => targetOf(platform) ?? platformSum(platform);
  const monthTotal = monthTotalDraft.trim() === "" ? null : round2(parse(monthTotalDraft));
  const monthDenom = editing ? (monthTotal ?? grandTotal) : grandTotal;

  const rows: PlanRow[] = useMemo(() => {
    const out: PlanRow[] = [];
    for (const platform of ALL_PLATFORMS) {
      const keys = keysFor(platform);
      if (keys.length === 0) continue;
      const denom = platformDenom(platform);
      out.push({
        key: platform,
        kind: "platform",
        platform,
        objective: null,
        planned: targetOf(platform) ?? platformSum(platform),
        share: pctShare(targetOf(platform) ?? platformSum(platform), monthDenom),
      });
      for (const k of keys) {
        const amount = planned.get(k) ?? 0;
        out.push({
          key: k,
          kind: "combo",
          platform,
          objective: k.split("|")[1]!,
          planned: amount,
          share: pctShare(amount, denom),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, targets, monthTotalDraft, editing]);

  // ── Draft mutations ────────────────────────────────────────────────────────
  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => new Map(prev).set(key, value));
  const removeDraft = (key: string) =>
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  /** Write a computed set of amounts back onto a platform's rows. */
  const applyAmounts = (keys: string[], amounts: number[]) =>
    setDrafts((prev) => {
      const next = new Map(prev);
      keys.forEach((k, i) => next.set(k, String(amounts[i] ?? 0)));
      return next;
    });

  /** Editing a row's % holds its platform's total and rescales the siblings. */
  const setRowPct = (platform: string, key: string, raw: string) => {
    const keys = keysFor(platform);
    const amounts = keys.map((k) => planned.get(k) ?? 0);
    const index = keys.indexOf(key);
    if (index < 0) return;
    applyAmounts(keys, redistributeByPct(amounts, index, parse(raw), platformDenom(platform)));
  };

  /** Editing a platform's % sets its intent as a share of the month total. */
  const setPlatformPct = (platform: string, raw: string) => {
    if (monthTotal === null) return;
    const share = Math.min(100, Math.max(0, parse(raw)));
    setTargets((prev) =>
      new Map(prev).set(platform, String(round2((monthTotal * share) / 100))),
    );
  };

  const distributeRemaining = (platform: string) => {
    const keys = keysFor(platform);
    const target = targetOf(platform);
    if (target === null || keys.length === 0) return;
    const amounts = keys.map((k) => planned.get(k) ?? 0);
    applyAmounts(keys, distributeRemainder(amounts, round2(target - platformSum(platform))));
  };

  const applyScale = () => {
    const pct = Number(scaleDraft);
    if (!Number.isFinite(pct) || scaleDraft.trim() === "") {
      toast.error("Enter a percentage, e.g. 10 or −5.");
      return;
    }
    const keys = [...planned.keys()];
    applyAmounts(keys, scaleAll(keys.map((k) => planned.get(k) ?? 0), pct));
    setScaleOpen(false);
    setScaleDraft("");
  };

  // ── Table ──────────────────────────────────────────────────────────────────
  const columns: DataColumn<PlanRow>[] = useMemo(() => {
    const label = (r: PlanRow) =>
      PLATFORM_LABEL[r.platform as keyof typeof PLATFORM_LABEL] ?? r.platform;
    return [
      {
        key: "item",
        label: "Platform / objective",
        pinned: true,
        render: (r) =>
          r.kind === "platform" ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <PlatformDot platform={r.platform as never} size="sm" />
              {label(r)}
              {editing && platformChip(r.platform)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 pl-6">{r.objective}</span>
          ),
        csv: (r) => (r.kind === "platform" ? label(r) : `  ${r.objective}`),
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned",
        label: editing ? "Planned (USD)" : `Planned (${currency})`,
        align: "right",
        render: (r) => {
          if (!editing) return <span className="num tabular-nums">{fmtSpend(r.planned)}</span>;
          if (r.kind === "platform") {
            return (
              <Input
                value={targets.get(r.platform) ?? ""}
                onChange={(e) =>
                  setTargets((prev) => new Map(prev).set(r.platform, numeric(e.target.value)))
                }
                placeholder={String(platformSum(r.platform))}
                className="h-7 w-28 text-right num"
                aria-label={`Budget for ${label(r)}`}
              />
            );
          }
          return (
            <span className="inline-flex items-center justify-end gap-1">
              <Input
                value={drafts.get(r.key) ?? ""}
                onChange={(e) => setDraft(r.key, numeric(e.target.value))}
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
        },
        csv: (r) => spendInDisplayCurrency(r.planned, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">
            {editing ? usd(grandTotal) : fmtSpend(grandTotal)}
          </span>
        ),
      },
      {
        key: "share",
        label: "% share",
        align: "right",
        render: (r) => {
          const editableRow = editing && r.kind === "combo" && keysFor(r.platform).length > 1;
          const editablePlatform = editing && r.kind === "platform" && monthTotal !== null;
          if (editableRow || editablePlatform) {
            return (
              <span className="inline-flex items-center justify-end gap-1">
                <Input
                  value={
                    pctEdit?.key === r.key
                      ? pctEdit.raw
                      : r.share === null
                        ? ""
                        : r.share.toFixed(1)
                  }
                  onChange={(e) => {
                    const raw = numeric(e.target.value);
                    setPctEdit({ key: r.key, raw });
                    if (r.kind === "platform") setPlatformPct(r.platform, raw);
                    else setRowPct(r.platform, r.key, raw);
                  }}
                  onBlur={() => setPctEdit(null)}
                  className="h-7 w-16 text-right num"
                  aria-label={
                    r.kind === "platform"
                      ? `${label(r)} share of the month budget`
                      : `${r.objective} share of ${label(r)}`
                  }
                />
                <span className="text-ink-3">%</span>
              </span>
            );
          }
          return (
            <span className="num tabular-nums text-ink-3">
              {r.share === null ? "—" : pct1(r.share / 100)}
            </span>
          );
        },
        csv: (r) => (r.share === null ? "" : r.share.toFixed(1)),
        total: () => <span className="num tabular-nums text-ink-3">100.0%</span>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, rate, editing, drafts, targets, monthTotalDraft, grandTotal, planned, pctEdit]);

  /** The per-platform "unallocated" chip + its distribute button. */
  function platformChip(platform: string) {
    const target = targetOf(platform);
    if (target === null) return null;
    const left = round2(target - platformSum(platform));
    if (left === 0) return null;
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-normal">
        <span className={cn("num", left > 0 ? "text-ink-3" : "text-warn")}>
          {left > 0 ? `${usd(left)} unallocated` : `${usd(-left)} over`}
        </span>
        {left > 0 && (
          <button
            type="button"
            onClick={() => distributeRemaining(platform)}
            className="inline-flex items-center gap-0.5 text-brand hover:underline"
          >
            <Split className="h-3 w-3" />
            Distribute evenly
          </button>
        )}
      </span>
    );
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  const save = async () => {
    setIsPending(true);
    try {
      const allocations = [...drafts].map(([k, v]) => {
        const [platform, objective] = k.split("|");
        return { platform: platform!, objective: objective!, plannedSpend: parse(v) };
      });
      const rev = revenueDraft.trim();
      const res = await saveBudgetMonth({
        month,
        allocations,
        plannedRevenueSar: rev === "" ? null : Number(rev),
        reserveSpendUsd: parse(reserveDraft),
        dayWeights: Object.entries(weightsDraft)
          .filter(([, w]) => w !== 1)
          .map(([d, w]) => ({ day: Number(d), weight: w })),
        note: note.trim() === "" ? undefined : note.trim(),
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

  const copyOptions = plannedMonths.filter((m) => m !== month);
  const openCopy = () => {
    const prev = prevMonthKey(month);
    setCopyFrom(copyOptions.includes(prev) ? prev : (copyOptions[0] ?? ""));
    setCopyOpen(true);
  };
  const doCopy = async () => {
    if (!copyFrom) return;
    setIsPending(true);
    try {
      const res = await copyBudgetFromMonth({ month, from: copyFrom });
      if (!res.ok) {
        toast.error(res.error ?? "Could not copy");
        return;
      }
      toast.success(`Copied ${int(res.copied ?? 0)} allocations from ${monthLabel(copyFrom)}`);
      setCopyOpen(false);
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

  const monthLeft = monthTotal === null ? null : round2(monthTotal - grandTotal);

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
                onChange={(e) => setRateDraft(numeric(e.target.value))}
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

        <BudgetPlanRevisions
          month={month}
          revisions={revisions}
          current={{
            allocations: data.allocations.map((a) => ({
              platform: a.platform,
              objective: a.objective,
              plannedSpend: a.plannedSpend,
            })),
            plannedRevenueSar: data.plannedRevenueSar,
            reserveSpendUsd: data.reserveSpendUsd,
            dayWeights: data.dayWeightOverrides,
          }}
          canManage={canManage}
        />

        {canManage && !editing && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={copyOptions.length === 0 || isPending}
              title={
                copyOptions.length === 0
                  ? "No other month has a plan to copy."
                  : undefined
              }
              onClick={openCopy}
            >
              <CopyPlus className="h-3.5 w-3.5" />
              Copy from month…
            </Button>
            <Button type="button" size="sm" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5" />
              Edit plan
            </Button>
          </>
        )}
        {editing && (
          <>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              placeholder="What changed? (optional)"
              maxLength={NOTE_MAX}
              className="h-8 w-52"
              aria-label="Revision note"
            />
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
            onChange={(e) => setRevenueDraft(numeric(e.target.value))}
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
            onChange={(e) => setReserveDraft(numeric(e.target.value))}
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

      {/* Month budget + distribution helpers (edit mode) */}
      {editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-label text-ink-3">Month total budget (USD)</span>
          <Input
            value={monthTotalDraft}
            onChange={(e) => setMonthTotalDraft(numeric(e.target.value))}
            placeholder="optional"
            className="h-8 w-32 text-right num"
            aria-label="Month total budget (USD)"
          />
          <span className="num text-[11px] text-ink-3">
            Allocated {usd(grandTotal)}
            {monthLeft !== null && monthLeft !== 0 && (
              <>
                {" · "}
                <span className={monthLeft > 0 ? "text-ink-3" : "text-warn"}>
                  {monthLeft > 0
                    ? `${usd(monthLeft)} unallocated`
                    : `${usd(-monthLeft)} over budget`}
                </span>
              </>
            )}
          </span>

          <Popover open={scaleOpen} onOpenChange={setScaleOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="xs" disabled={planned.size === 0}>
                <Percent className="h-3 w-3" />
                Scale all ±%
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] space-y-2">
              <p className="text-xs text-ink-2">
                Scale every allocation. 10 raises them by 10%, −5 trims 5%.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={scaleDraft}
                  onChange={(e) => setScaleDraft(e.target.value.replace(/[^0-9.\-−]/g, "").replace("−", "-"))}
                  placeholder="10"
                  className="h-8 w-24 text-right num"
                  aria-label="Scale percentage"
                />
                <span className="text-ink-3">%</span>
                <Button type="button" size="xs" onClick={applyScale}>
                  Apply
                </Button>
              </div>
              <p className="text-[11px] text-ink-3">
                Applies to the drafts — nothing is saved until you save the plan.
              </p>
            </PopoverContent>
          </Popover>

          <span className="text-[11px] text-ink-3">
            Shares are a planning aid; the amounts are what gets saved.
          </span>
        </div>
      )}

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
              ? "Copy another month or add allocations to start planning."
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
                {BUDGET_OBJECTIVES.map((o) => (
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

      {/* Plan table — platform rows carry anchor ids for Overview's cards */}
      <DataTable<PlanRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        rowId={(r) => (r.kind === "platform" ? platformAnchorId(r.platform) : undefined)}
        showTotals={rows.length > 0}
        minWidthClass="min-w-[520px]"
        csvFileName={`budget-plan-${month}-${currency.toLowerCase()}`}
        rowClassName={(r) => cn(r.kind === "platform" && "bg-surface-2/50 font-medium scroll-mt-24")}
        empty={
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Wallet className="h-6 w-6 text-ink-3" />
            <p className="text-sm text-ink-2">Nothing planned for this month.</p>
          </div>
        }
      />

      {/* Copy from any planned month */}
      <Dialog open={copyOpen} onOpenChange={(o) => !isPending && setCopyOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy a plan into {monthLabel(month)}</DialogTitle>
            <DialogDescription>
              {hasPlan
                ? `${monthLabel(month)} already has a plan — copying replaces it entirely (allocations, the revenue target, the reserve, and the day-weight curve).`
                : "Copies the allocations, revenue target, reserve and day-weight curve."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <span className="text-label text-ink-3">Copy from</span>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger className="h-9 w-full" aria-label="Month to copy from">
                <SelectValue placeholder="Pick a month…" />
              </SelectTrigger>
              <SelectContent>
                {copyOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCopyOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={doCopy} disabled={isPending || !copyFrom}>
              {hasPlan ? "Replace this month" : "Copy plan"}
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
