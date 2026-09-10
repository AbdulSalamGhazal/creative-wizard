"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Pencil,
  RotateCcw,
  Split,
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
import { pct1, plural, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  allocatableFromTotal,
  amountsFromShares,
  budgetComboKey,
  daysInMonth,
  distributeShareEvenly,
  monthLabel,
  planGateProblems,
  monthStartIso,
  pctShare,
  prevMonthKey,
  reserveFromShare,
  reserveShare,
  round2,
  shareFromAmount,
  sharesComplete,
  spendInDisplayCurrency,
  transferFromReserve,
  validateRate,
  validateWeight,
  type BudgetObjective,
} from "@/lib/budget";
import { WEIGHT_MAX, WEIGHT_MIN } from "@/validators/budget";
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
  platformLabel,
  useBudgetCurrency,
} from "@/components/budget/budget-shared";
import { BudgetPlanRevisions } from "@/components/budget/budget-plan-revisions";

interface PlanRow {
  key: string;
  kind: "platform" | "combo";
  platform: string;
  objective: string | null;
  planned: number;
  /** Percent of the row's parent (platform → allocatable, objective → platform). */
  share: number | null;
}

const WEIGHT_STEP = 0.5;
const NOTE_MAX = 200;

const numeric = (raw: string) => raw.replace(/[^0-9.]/g, "");
const parse = (raw: string | undefined) => {
  const n = Number(raw ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** The editor's draft: shares are primary, amounts are derived from them. */
interface Draft {
  /** Total spend budget, USD — the number everything else is a share of. */
  total: string;
  /** Reserve, USD. Carved OUT of the total: allocatable = total − reserve. */
  reserve: string;
  revenue: string;
  /** platform → share of the allocatable, as typed. */
  platformShares: Record<string, string>;
  /** `platform|objective` → share of THAT platform's amount. */
  objectiveShares: Record<string, string>;
}

const emptyDraft: Draft = {
  total: "",
  reserve: "",
  revenue: "",
  platformShares: {},
  objectiveShares: {},
};

/**
 * The Plan page body — a PURE PLANNING surface, edited TOP-DOWN (2026-09).
 *
 * Edit mode is a cascade: a total spend budget and a revenue target, a reserve
 * carved out of the total (money deliberately not decided yet), then percentage
 * shares down two levels — each platform's share of the allocatable, and each
 * objective's share of its platform. Percentages are the primary input and the
 * dollar amounts are derived from them cents-exactly, which is what makes
 * "change the total" a clean rescale: every share holds, every amount follows.
 *
 * Save is blocked until the shares add to exactly 100% at both levels — money
 * you don't want to commit belongs in the reserve, not in a gap. Moving money
 * out of the reserve later is a separate, explicit operation that leaves every
 * other platform's dollars alone.
 *
 * Storage is unchanged: derived amounts land in `budget_allocations`, and
 * opening the editor reconstructs the shares from them, so a round-trip is
 * exact.
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
  /** Months that already have a plan — the Copy dialog's options. */
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
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [weightsDraft, setWeightsDraft] = useState<Record<number, number>>({});
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** The share cell being typed in — raw text, so a keystroke isn't reformatted
   *  out from under the caret by the recomputed value. */
  const [shareEdit, setShareEdit] = useState<{ key: string; raw: string } | null>(null);
  const [totalFocused, setTotalFocused] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveAmount, setMoveAmount] = useState("");
  const [movePlatform, setMovePlatform] = useState<string>(ALL_PLATFORMS[0]);
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  /**
   * Rebuild the cascade from what's stored: the total is the allocated sum plus
   * the reserve, and every share is its amount over its parent — at full
   * precision, so deriving straight back gives the same amounts to the cent.
   */
  const startEditing = () => {
    const allocated = round2(
      data.allocations.reduce((s, a) => s + a.plannedSpend, 0),
    );
    const reserve = data.reserveSpendUsd;
    const platformShares: Record<string, string> = {};
    const objectiveShares: Record<string, string> = {};
    for (const platform of ALL_PLATFORMS) {
      const rows = data.allocations.filter((a) => a.platform === platform);
      const platformSum = round2(rows.reduce((s, a) => s + a.plannedSpend, 0));
      if (platformSum <= 0 && rows.length === 0) continue;
      platformShares[platform] = String(shareFromAmount(platformSum, allocated));
      for (const row of rows) {
        objectiveShares[budgetComboKey(platform, row.objective)] = String(
          shareFromAmount(row.plannedSpend, platformSum),
        );
      }
    }
    setDraft({
      total: allocated + reserve > 0 ? String(round2(allocated + reserve)) : "",
      reserve: reserve > 0 ? String(reserve) : "",
      revenue: data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar),
      platformShares,
      objectiveShares,
    });
    // A stored weight below the editor's floor (a legacy row, or one written
    // before the bounds tightened) would fail save validation with a raw zod
    // message. Clamp it into range as the draft loads — what you see is what
    // saves.
    setWeightsDraft(
      Object.fromEntries(
        Object.entries(data.dayWeightOverrides).map(([day, w]) => [
          Number(day),
          Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w)),
        ]),
      ),
    );
    setExpanded(new Set(Object.keys(platformShares)));
    setNote("");
    setShareEdit(null);
    setSelectedDay(null);
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDraft(emptyDraft);
    setWeightsDraft({});
    setExpanded(new Set());
    setNote("");
    setShareEdit(null);
    setSelectedDay(null);
  };

  // ── Derivation ─────────────────────────────────────────────────────────────
  const total = round2(parse(draft.total));
  const reserve = round2(parse(draft.reserve));
  const allocatable = allocatableFromTotal(total, reserve);

  /** Platforms carrying a share — the ones the cascade is actually planning. */
  const activePlatforms: string[] = useMemo(
    () =>
      ALL_PLATFORMS.filter(
        (p) => draft.platformShares[p] !== undefined && draft.platformShares[p] !== "",
      ),
    [draft.platformShares],
  );

  const platformShareList = activePlatforms.map((p) => parse(draft.platformShares[p]));
  const platformAmounts = amountsFromShares(allocatable, platformShareList);
  const amountOf = (platform: string) =>
    platformAmounts[activePlatforms.indexOf(platform)] ?? 0;

  const objectiveSharesOf = (platform: string) =>
    BUDGET_OBJECTIVES.map((o) => parse(draft.objectiveShares[budgetComboKey(platform, o)]));
  const objectiveAmountsOf = (platform: string) =>
    amountsFromShares(amountOf(platform), objectiveSharesOf(platform));

  // ── Validation: 100% or no save ────────────────────────────────────────────
  const problems = useMemo(() => {
    if (!editing) return [];
    return planGateProblems({
      total,
      reserve,
      hasRevenueTarget: draft.revenue.trim() !== "",
      platforms: activePlatforms.map((platform) => ({
        label: platformLabel(platform),
        share: parse(draft.platformShares[platform]),
        objectiveShares: objectiveSharesOf(platform),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, total, reserve, activePlatforms]);

  const canSave = editing && problems.length === 0;

  // ── Draft mutations ────────────────────────────────────────────────────────
  const setField = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const setPlatformShare = (platform: string, raw: string) =>
    setDraft((d) => ({
      ...d,
      platformShares: { ...d.platformShares, [platform]: raw },
      // A platform joining the cascade starts with an empty objective split.
      objectiveShares: d.objectiveShares,
    }));

  const setObjectiveShare = (platform: string, objective: string, raw: string) =>
    setDraft((d) => ({
      ...d,
      objectiveShares: { ...d.objectiveShares, [budgetComboKey(platform, objective)]: raw },
    }));

  /** A typed dollar amount becomes a share of its parent, parent held fixed. */
  const setPlatformAmount = (platform: string, rawAmount: string) =>
    setPlatformShare(platform, String(shareFromAmount(parse(rawAmount), allocatable)));
  const setObjectiveAmount = (platform: string, objective: string, rawAmount: string) =>
    setObjectiveShare(
      platform,
      objective,
      String(shareFromAmount(parse(rawAmount), amountOf(platform))),
    );

  const togglePlatform = (platform: string) => {
    setDraft((d) => {
      const next = { ...d.platformShares };
      const objectives = { ...d.objectiveShares };
      if (next[platform] === undefined) {
        next[platform] = "";
      } else {
        delete next[platform];
        for (const o of BUDGET_OBJECTIVES) delete objectives[budgetComboKey(platform, o)];
      }
      return { ...d, platformShares: next, objectiveShares: objectives };
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const distributePlatforms = () => {
    const fixed = distributeShareEvenly(platformShareList);
    setDraft((d) => {
      const next = { ...d.platformShares };
      activePlatforms.forEach((p, i) => (next[p] = String(fixed[i] ?? 0)));
      return { ...d, platformShares: next };
    });
  };

  const distributeObjectives = (platform: string) => {
    const fixed = distributeShareEvenly(objectiveSharesOf(platform));
    setDraft((d) => {
      const next = { ...d.objectiveShares };
      BUDGET_OBJECTIVES.forEach(
        (o, i) => (next[budgetComboKey(platform, o)] = String(fixed[i] ?? 0)),
      );
      return { ...d, objectiveShares: next };
    });
  };

  /**
   * Move money out of the reserve into one platform. Deliberately NOT a
   * re-plan: the other platforms keep their dollars and only their displayed
   * shares move, because the allocatable grew beneath them.
   */
  const doMove = () => {
    const amount = round2(parse(moveAmount));
    const index = activePlatforms.indexOf(movePlatform);
    if (index < 0) {
      toast.error(`${platformLabel(movePlatform)} has no share to move money into.`);
      return;
    }
    // The editor re-derives amounts as share × (total − reserve), so the
    // transfer has to compute shares against THAT allocatable — not Σ amounts,
    // which is smaller whenever the split is still incomplete.
    const result = transferFromReserve({
      amounts: platformAmounts,
      index,
      transfer: amount,
      reserve,
      allocatable,
    });
    if (!result) {
      toast.error(
        amount > reserve
          ? `The reserve only holds ${usd(reserve)}.`
          : "Enter an amount to move.",
      );
      return;
    }
    setDraft((d) => {
      const shares = { ...d.platformShares };
      activePlatforms.forEach((p, i) => (shares[p] = String(result.shares[i] ?? 0)));
      return { ...d, reserve: String(result.reserve), platformShares: shares };
    });
    // Pre-fill the revision note — this is a decision worth recording, and the
    // author can still edit or clear it before saving.
    if (note.trim() === "") {
      setNote(`Moved ${usd(amount)} from reserve to ${platformLabel(movePlatform)}`);
    }
    setMoveOpen(false);
    setMoveAmount("");
    toast.success(`Moved ${usd(amount)} to ${platformLabel(movePlatform)}`);
  };

  // ── View-mode rows ─────────────────────────────────────────────────────────
  const storedAllocated = round2(
    data.allocations.reduce((s, a) => s + a.plannedSpend, 0),
  );

  const rows: PlanRow[] = useMemo(() => {
    const out: PlanRow[] = [];
    for (const platform of ALL_PLATFORMS) {
      const mine = data.allocations.filter((a) => a.platform === platform);
      if (mine.length === 0) continue;
      const platformSum = round2(mine.reduce((s, a) => s + a.plannedSpend, 0));
      out.push({
        key: platform,
        kind: "platform",
        platform,
        objective: null,
        planned: platformSum,
        share: pctShare(platformSum, storedAllocated),
      });
      for (const objective of BUDGET_OBJECTIVES) {
        const row = mine.find((a) => a.objective === objective);
        if (!row) continue;
        out.push({
          key: budgetComboKey(platform, objective),
          kind: "combo",
          platform,
          objective,
          planned: row.plannedSpend,
          share: pctShare(row.plannedSpend, platformSum),
        });
      }
    }
    return out;
  }, [data.allocations, storedAllocated]);

  const columns: DataColumn<PlanRow>[] = useMemo(
    () => [
      {
        key: "item",
        label: "Platform / objective",
        pinned: true,
        render: (r) =>
          r.kind === "platform" ? (
            <span className="inline-flex items-center gap-2 font-medium">
              <PlatformDot platform={r.platform as never} size="sm" />
              {platformLabel(r.platform)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 pl-6">{r.objective}</span>
          ),
        csv: (r) =>
          r.kind === "platform" ? platformLabel(r.platform) : `  ${r.objective}`,
        total: () => <span className="text-ink-3">Total</span>,
      },
      {
        key: "planned",
        label: `Planned (${currency})`,
        align: "right",
        render: (r) => <span className="num tabular-nums">{fmtSpend(r.planned)}</span>,
        csv: (r) => spendInDisplayCurrency(r.planned, currency, rate).toFixed(2),
        total: () => (
          <span className="num tabular-nums font-semibold">{fmtSpend(storedAllocated)}</span>
        ),
      },
      {
        key: "share",
        label: "% share",
        align: "right",
        render: (r) => (
          <span className="num tabular-nums text-ink-3">
            {r.share === null ? "—" : pct1(r.share / 100)}
          </span>
        ),
        csv: (r) => (r.share === null ? "" : r.share.toFixed(1)),
        total: () => <span className="num tabular-nums text-ink-3">100.0%</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, rate, storedAllocated],
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  const save = async () => {
    setIsPending(true);
    try {
      const allocations: Array<{
        platform: string;
        objective: BudgetObjective;
        plannedSpend: number;
      }> = [];
      for (const platform of activePlatforms) {
        const amounts = objectiveAmountsOf(platform);
        BUDGET_OBJECTIVES.forEach((objective, i) => {
          const plannedSpend = amounts[i] ?? 0;
          if (plannedSpend > 0) allocations.push({ platform, objective, plannedSpend });
        });
      }
      const rev = draft.revenue.trim();
      const res = await saveBudgetMonth({
        month,
        allocations,
        plannedRevenueSar: rev === "" ? null : Number(rev),
        reserveSpendUsd: reserve,
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
      toast.success(
        `Copied ${plural(res.copied ?? 0, "allocation")} from ${monthLabel(copyFrom)}`,
      );
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

  // ── Day-weight editing ─────────────────────────────────────────────────────
  const activeWeights = editing ? weightsDraft : data.dayWeightOverrides;
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

  /** A share input + the amount it derives — the cascade's one repeated unit. */
  const shareCell = (
    key: string,
    value: number,
    amount: number,
    onShare: (raw: string) => void,
    onAmount: (raw: string) => void,
    ariaShare: string,
    ariaAmount: string,
  ) => (
    <div className="flex items-center gap-1.5">
      <Input
        value={shareEdit?.key === key ? shareEdit.raw : value === 0 ? "" : value.toFixed(1)}
        onChange={(e) => {
          const raw = numeric(e.target.value);
          setShareEdit({ key, raw });
          onShare(raw);
        }}
        onBlur={() => setShareEdit(null)}
        placeholder="0"
        className="h-8 w-16 text-right num"
        aria-label={ariaShare}
      />
      <span className="text-ink-3">%</span>
      <Input
        value={amount === 0 ? "" : String(amount)}
        onChange={(e) => {
          setShareEdit(null);
          onAmount(numeric(e.target.value));
        }}
        placeholder="0"
        className="h-8 w-28 text-right num text-ink-2"
        aria-label={ariaAmount}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <BudgetMonthBar month={month} today={today} locked={editing}>
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
              title={copyOptions.length === 0 ? "No other month has a plan to copy." : undefined}
              onClick={openCopy}
            >
              <CopyPlus className="h-3.5 w-3.5" />
              Copy
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
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={!canSave || isPending}
              title={problems[0]}
            >
              Save plan
            </Button>
          </>
        )}
      </BudgetMonthBar>

      {editing ? (
        <>
          {/* ── 1. Targets ─────────────────────────────────────────────── */}
          <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div>
              <h3 className="text-sm font-medium text-ink">Targets</h3>
              <p className="text-[11px] text-ink-3">
                The reserve is part of the total, held back to decide later —
                everything below shares out what&rsquo;s left.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="space-y-1">
                <span className="block text-label text-ink-3">Total budget (USD)</span>
                <Input
                  value={draft.total}
                  onChange={(e) => setField({ total: numeric(e.target.value) })}
                  onFocus={() => setTotalFocused(true)}
                  onBlur={() => setTotalFocused(false)}
                  placeholder="e.g. 50000"
                  className="h-9 w-40 text-right num"
                  aria-label="Total budget (USD)"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-label text-ink-3">Revenue target (SAR)</span>
                <Input
                  value={draft.revenue}
                  onChange={(e) => setField({ revenue: numeric(e.target.value) })}
                  placeholder="e.g. 250000"
                  className="h-9 w-40 text-right num"
                  aria-label="Planned monthly revenue (SAR)"
                />
              </label>
              <div className="space-y-1">
                <span className="block text-label text-ink-3">Reserve (of the total)</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={draft.reserve}
                    onChange={(e) => setField({ reserve: numeric(e.target.value) })}
                    placeholder="0"
                    className="h-9 w-32 text-right num"
                    aria-label="Reserve (USD)"
                  />
                  <span className="text-ink-3">USD</span>
                  <Input
                    value={
                      total > 0 && reserve > 0
                        ? (reserveShare(reserve, total) ?? 0).toFixed(1)
                        : ""
                    }
                    onChange={(e) =>
                      setField({
                        reserve: String(reserveFromShare(parse(numeric(e.target.value)), total)),
                      })
                    }
                    placeholder="0"
                    className="h-9 w-20 text-right num"
                    aria-label="Reserve (% of total)"
                  />
                  <span className="text-ink-3">%</span>
                </div>
              </div>
              <p className="text-[11px] text-ink-3">
                Allocatable{" "}
                <span className="num text-ink-2">{usd(allocatable)}</span>
                {reserve > 0 && <> · reserve {usd(reserve)}</>}
              </p>
            </div>
            {totalFocused && (
              <p className="text-[11px] text-ink-3">
                Changing the total rescales every amount through the shares below —
                a platform on 50% stays on 50%. To hand money to ONE platform, use
                Move from reserve instead.
              </p>
            )}
          </section>

          {/* ── 2 + 3. Platform shares → objective shares ──────────────── */}
          <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-ink">Split the budget</h3>
                <p className="text-[11px] text-ink-3">
                  Each platform takes a share of the allocatable; inside it, each
                  objective takes a share of the platform.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "num text-[11px]",
                    sharesComplete(platformShareList) ? "text-ink-3" : "text-warn",
                  )}
                >
                  {pct1(
                    platformShareList.reduce((s, v) => s + v, 0) / 100,
                  )}{" "}
                  of 100%
                </span>
                {!sharesComplete(platformShareList) && activePlatforms.length > 0 && (
                  <Button type="button" variant="outline" size="xs" onClick={distributePlatforms}>
                    <Split className="h-3 w-3" />
                    Distribute remaining evenly
                  </Button>
                )}
                {reserve > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setMoveOpen(true)}
                    disabled={activePlatforms.length === 0}
                  >
                    <ArrowRightLeft className="h-3 w-3" />
                    Move from reserve
                  </Button>
                )}
              </div>
            </div>

            <ul className="divide-y divide-line">
              {ALL_PLATFORMS.map((platform) => {
                const on = draft.platformShares[platform] !== undefined;
                const isOpen = on && expanded.has(platform);
                const objectiveShares = objectiveSharesOf(platform);
                const objectiveAmounts = objectiveAmountsOf(platform);
                const objectivesOk = sharesComplete(objectiveShares);
                return (
                  <li key={platform} className="py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <button
                        type="button"
                        onClick={() => togglePlatform(platform)}
                        role="checkbox"
                        aria-checked={on}
                        className="inline-flex min-w-[8.5rem] items-center gap-2 text-left text-sm"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded border",
                            on ? "border-brand bg-[var(--brand-soft)]" : "border-line",
                          )}
                        >
                          {on && <Check className="h-3 w-3 text-brand" />}
                        </span>
                        <PlatformDot platform={platform} size="sm" />
                        {PLATFORM_LABEL[platform]}
                      </button>

                      {on ? (
                        <>
                          {shareCell(
                            `p:${platform}`,
                            parse(draft.platformShares[platform]),
                            amountOf(platform),
                            (raw) => setPlatformShare(platform, raw),
                            (raw) => setPlatformAmount(platform, raw),
                            `${PLATFORM_LABEL[platform]} share of the allocatable budget`,
                            `${PLATFORM_LABEL[platform]} amount in USD`,
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(platform)) next.delete(platform);
                                else next.add(platform);
                                return next;
                              })
                            }
                            className={cn(
                              "inline-flex items-center gap-1 text-[11px]",
                              objectivesOk ? "text-ink-3" : "text-warn",
                            )}
                            aria-expanded={isOpen}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            Objectives{" "}
                            {pct1(objectiveShares.reduce((s, v) => s + v, 0) / 100)}
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-ink-3">Not planned this month</span>
                      )}
                    </div>

                    {isOpen && (
                      <div className="mt-2 space-y-1.5 border-l border-line pl-4">
                        {BUDGET_OBJECTIVES.map((objective, i) => (
                          <div
                            key={objective}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1"
                          >
                            <span className="min-w-[7rem] text-sm text-ink-2">{objective}</span>
                            {shareCell(
                              `o:${platform}:${objective}`,
                              objectiveShares[i] ?? 0,
                              objectiveAmounts[i] ?? 0,
                              (raw) => setObjectiveShare(platform, objective, raw),
                              (raw) => setObjectiveAmount(platform, objective, raw),
                              `${objective} share of ${PLATFORM_LABEL[platform]}`,
                              `${objective} amount on ${PLATFORM_LABEL[platform]} in USD`,
                            )}
                          </div>
                        ))}
                        {!objectivesOk && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => distributeObjectives(platform)}
                          >
                            <Split className="h-3 w-3" />
                            Distribute remaining evenly
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Blocked-save explanation */}
          {problems.length > 0 && (
            <div className="rounded-md border border-warn/40 bg-warn/5 px-4 py-3">
              <p className="text-xs font-medium text-ink">
                Finish the split to save — every level has to reach 100%.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                {problems.map((p) => (
                  <li key={p} className="num">
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-ink-3">
                Money you don&rsquo;t want to commit yet belongs in the reserve.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {/* View mode — the calm read of what's planned. On a month with no
              plan at all we show ONE empty state: not a strip of dashes, a
              hint card, AND an empty table stacked on top of each other. */}
          {hasPlan ? (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className="text-label text-ink-3">Total budget</span>
                  <span className="num tabular-nums text-ink">
                    {fmtSpend(storedAllocated + data.reserveSpendUsd)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="text-label text-ink-3">Revenue target (SAR)</span>
                  <span className="num tabular-nums text-ink">
                    {data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="text-label text-ink-3">Reserve</span>
                  <span className="num tabular-nums text-ink">
                    {data.reserveSpendUsd > 0 ? fmtSpend(data.reserveSpendUsd) : "—"}
                  </span>
                </span>
                <span className="text-[11px] text-ink-3">
                  Held back from the total — allocated {fmtSpend(storedAllocated)}.
                </span>
              </div>

              <DataTable<PlanRow>
                columns={columns}
                rows={rows}
                rowKey={(r) => r.key}
                rowId={(r) => (r.kind === "platform" ? platformAnchorId(r.platform) : undefined)}
                showTotals={rows.length > 0}
                minWidthClass="min-w-[520px]"
                csvFileName={`budget-plan-${month}-${currency.toLowerCase()}`}
                rowClassName={(r) =>
                  cn(r.kind === "platform" && "bg-surface-2/50 font-medium scroll-mt-24")
                }
                empty={
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Wallet className="h-6 w-6 text-ink-3" />
                    <p className="text-sm text-ink-2">Nothing planned for this month.</p>
                  </div>
                }
              />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
              <p className="text-sm text-ink-2">No plan for this month yet.</p>
              <p className="mt-1 text-xs text-ink-3">
                {canManage
                  ? "Copy another month or set a total budget to start planning."
                  : "Ask someone with budget access to add a plan."}
              </p>
            </div>
          )}
        </>
      )}

      {/* ── 4. Day curve ─────────────────────────────────────────────── */}
      <DayCurveEditor
        month={month}
        totalDays={totalDays}
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

      {/* Copy from any planned month */}
      <Dialog open={copyOpen} onOpenChange={(o) => !isPending && setCopyOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Copy a plan into {monthLabel(month)}</DialogTitle>
            <DialogDescription>
              {hasPlan
                ? `${monthLabel(month)} already has a plan — copying replaces it entirely (allocations, the revenue target, the reserve, and the plan curve).`
                : "Copies the allocations, revenue target, reserve and plan curve."}
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

      {/* Move money out of the reserve */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move money from the reserve</DialogTitle>
            <DialogDescription>
              This moves money — it doesn&rsquo;t re-plan. The platform you pick gains
              the amount, spread across its objectives by their current shares;
              every other platform keeps exactly the dollars it has.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-label text-ink-3">Amount (USD)</span>
              <Input
                value={moveAmount}
                onChange={(e) => setMoveAmount(numeric(e.target.value))}
                placeholder="0"
                className="h-9 w-full text-right num"
                aria-label="Amount to move from the reserve"
              />
              <span className="block text-[11px] text-ink-3">
                Reserve holds {usd(reserve)}.
              </span>
            </label>
            <div className="space-y-1">
              <span className="text-label text-ink-3">To platform</span>
              <Select value={movePlatform} onValueChange={setMovePlatform}>
                <SelectTrigger className="h-9 w-full" aria-label="Platform to move money to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activePlatforms.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={doMove}>
              Move money
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
 * override, deleted on save).
 */
function DayCurveEditor({
  month,
  totalDays,
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
        {editing && (
          <Button type="button" variant="outline" size="xs" onClick={onResetAll} disabled={overrideCount === 0}>
            <RotateCcw className="h-3 w-3" />
            Reset all to 1
          </Button>
        )}
      </div>

      {/* Calendar left, stepper/help right at sm+ — the grid is ~380px wide,
          so a single column left the right 60% of the card empty. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="grid grid-cols-7 gap-1 max-w-md shrink-0">
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
      <div className="min-w-0 flex-1">
      {editing && selectedDay !== null ? (
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
      ) : editing ? (
        <p className="text-[11px] text-ink-3">
          Pick a day to weight it. A weighted day takes a bigger share of the
          plan, so plan-to-date steps up on paydays instead of rising evenly.
        </p>
      ) : null}
      </div>
      </div>
    </div>
  );
}
