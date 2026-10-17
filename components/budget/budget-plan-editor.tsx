"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  CopyPlus,
  Download,
  MoreHorizontal,
  Trash2,
  Upload,
  Pencil,
  RotateCcw,
  Scale,
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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformDot } from "@/components/ui/platform-dot";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL, seriesColor } from "@/lib/palette";
import { pct1, plural, roas as fmtRoas, sar, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  BUDGET_OBJECTIVES,
  buildPlanSeries,
  planSeriesSourceOf,
  allocatableFromTotal,
  amountsFromShares,
  budgetComboKey,
  daysInMonth,
  distributePlatformsEvenly,
  distributeShareEvenly,
  monthDayIncrements,
  monthLabel,
  moveMoney,
  normalizeShares,
  planGateProblems,
  monthStartIso,
  pctShare,
  prevMonthKey,
  roasThroughRate,
  round2,
  sendRemainderToReserve,
  shareFromAmount,
  shareRemainder,
  sharesComplete,
  sharesFromStoredPlan,
  splitTotalByShares,
  validateRate,
  validateWeight,
  type BudgetObjective,
} from "@/lib/budget";
import { WEIGHT_MAX, WEIGHT_MIN } from "@/validators/budget";
import {
  saveBudgetMonth,
  convertPlanToCurve,
  copyBudgetFromMonth,
  setUsdToSarRate,
} from "@/app/actions/budget";
import type { BudgetMonthData, PlanRevisionRow } from "@/db/queries/budget";
import {
  BudgetMonthBar,
  CurrencyToggle,
  PlanDayBars,
  UnitInput,
  formatSpend,
  platformAnchorId,
  platformLabel,
  useBudgetCurrency,
  useFieldFlow,
} from "@/components/budget/budget-shared";
import { BudgetPlanRevisions } from "@/components/budget/budget-plan-revisions";
import { BudgetPlanUpload, downloadPlanSheet } from "@/components/budget/budget-plan-upload";

const WEIGHT_STEP = 0.5;
const NOTE_MAX = 200;

const numeric = (raw: string) => raw.replace(/[^0-9.]/g, "");
const parse = (raw: string | undefined) => {
  const n = Number(raw ?? "");
  return Number.isFinite(n) ? n : 0;
};

/**
 * The editor's draft: shares are primary, amounts are derived from them. Since
 * 2026-10-17 the RESERVE IS ONE OF THE SHARES — "the reserve should be within
 * the percentages" — so the first level is reserve + platforms = 100% of the
 * total, and the reserve's USD figure is derived like any platform's.
 */
interface Draft {
  /** Total spend budget, USD — the number everything else is a share of. */
  total: string;
  /** The reserve's share of the TOTAL, as typed. Held back, not paced. */
  reserveShare: string;
  revenue: string;
  /** platform → share of the TOTAL, as typed. */
  platformShares: Record<string, string>;
  /** `platform|objective` → share of THAT platform's amount. */
  objectiveShares: Record<string, string>;
}

const emptyDraft: Draft = {
  total: "",
  reserveShare: "",
  revenue: "",
  platformShares: {},
  objectiveShares: {},
};

/** The reserve's shareCell key — it sits beside the platforms' `p:<key>`. */
const RESERVE_KEY = "reserve";

/**
 * The Plan page body — a PURE PLANNING surface, edited TOP-DOWN (2026-09).
 *
 * Edit mode is a cascade: a total spend budget and a revenue target, then
 * percentage shares OF THE TOTAL — the reserve first (money deliberately not
 * decided yet, held back and never paced), then each platform — and inside a
 * platform, each objective's share of it. Percentages are the primary input
 * and the dollar amounts are derived from them cents-exactly, which is what
 * makes "change the total" a clean rescale: every share holds (the reserve's
 * too), every amount follows.
 *
 * Save is blocked until the shares add to exactly 100% at both levels — money
 * you don't want to commit belongs in the reserve, not in a gap, and "Send the
 * rest to reserve" does exactly that in one click. Moving money out of the
 * reserve later is a separate, explicit operation that leaves every other
 * platform's dollars alone.
 *
 * View mode is a VISUAL read of the plan (2026-10): the targets strip, a
 * composition bar of the total (platforms in their colours, the reserve as a
 * dashed outline — the Overview hero bar's grammar), read-only platform cards
 * in the editor's own grid, and the plan curve collapsed to one line while
 * every day is equal.
 *
 * Storage is unchanged: the reserve's derived amount lands in
 * `budget_targets.reserve_spend_usd` and the derived platform × objective
 * amounts in `budget_allocations`; opening the editor reconstructs the shares
 * from them (`sharesFromStoredPlan`), so a round-trip is exact.
 */
export function BudgetPlanEditor({
  month,
  today,
  data,
  plannedMonths,
  dailyMonths,
  seedMonth,
  revisions,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  /** Months that already have a plan — the Copy dialog's options. */
  plannedMonths: string[];
  /** The subset planned DAY BY DAY — copying one copies its days and mode. */
  dailyMonths: string[];
  /**
   * The most recent planned month BEFORE this one — the empty state's "Copy
   * <month>'s plan". A month NAME only: the plan itself is fetched by the copy,
   * server side.
   */
  seedMonth: string | null;
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
  /** "reserve" · "new" · a platform key. */
  const [moveFrom, setMoveFrom] = useState<string>("reserve");
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNote, setDeleteNote] = useState("");
  /** The upload dialog is controlled, and REMOUNTED per opening (`key`) so
   *  its draft always starts from the month as it stands. */
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKey, setUploadKey] = useState(0);
  const openUpload = () => {
    setUploadKey((k) => k + 1);
    setUploadOpen(true);
  };
  const [convertNote, setConvertNote] = useState("");

  /**
   * ONE MODE AT A TIME (user-approved v1): a month planned day by day from a
   * sheet is NOT editable here — no cascade, no Move money, no calendar. It
   * reads, downloads, re-uploads, or is switched back to editor planning.
   */
  const isDaily = data.planMode === "daily";
  const series = useMemo(() => buildPlanSeries(planSeriesSourceOf(data, month)), [data, month]);
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  // Phone + keyboard flow for every numeric field in the cascade (shared with
  // the Audience record grid — see useFieldFlow).
  const { formRef, fieldProps } = useFieldFlow();
  const totalRef = useRef<HTMLInputElement>(null);

  /**
   * Rebuild the cascade from what's stored (`sharesFromStoredPlan`): the total
   * is the allocated sum plus the reserve, the reserve's share is its amount
   * over the total, and every platform/objective share is its amount over its
   * parent — at full precision, so deriving straight back gives the same
   * amounts to the cent (unit-pinned).
   */
  const startEditing = () => {
    const stored = sharesFromStoredPlan(data.allocations, data.reserveSpendUsd);
    setDraft({
      total: stored.total > 0 ? String(stored.total) : "",
      reserveShare: stored.reserveShare > 0 ? String(stored.reserveShare) : "",
      revenue: data.plannedRevenueSar === null ? "" : String(data.plannedRevenueSar),
      platformShares: Object.fromEntries(
        Object.entries(stored.platformShares).map(([p, share]) => [p, String(share)]),
      ),
      objectiveShares: Object.fromEntries(
        Object.entries(stored.objectiveShares).map(([k, share]) => [k, String(share)]),
      ),
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
    setNote("");
    setShareEdit(null);
    setSelectedDay(null);
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDraft(emptyDraft);
    setWeightsDraft({});
    setNote("");
    setShareEdit(null);
    setSelectedDay(null);
  };

  // ── Derivation ─────────────────────────────────────────────────────────────
  const total = round2(parse(draft.total));
  const reserveShareValue = parse(draft.reserveShare);

  /** Platforms carrying a share — the ones the cascade is actually planning. */
  const activePlatforms: string[] = useMemo(
    () =>
      ALL_PLATFORMS.filter(
        (p) => draft.platformShares[p] !== undefined && draft.platformShares[p] !== "",
      ),
    [draft.platformShares],
  );

  const platformShareList = activePlatforms.map((p) => parse(draft.platformShares[p]));
  // ONE split of the total: the reserve and the platforms are rounded together.
  const split = splitTotalByShares(total, reserveShareValue, platformShareList);
  const reserve = split.reserve;
  const platformAmounts = split.platforms;
  const allocatable = allocatableFromTotal(total, reserve);
  /** The first level as a whole — what the header counter and the gate judge. */
  const totalShareList = [reserveShareValue, ...platformShareList];
  const totalShareSum = totalShareList.reduce((s, v) => s + v, 0);
  const totalSharesOk = sharesComplete(totalShareList);
  const amountOf = (platform: string) =>
    platformAmounts[activePlatforms.indexOf(platform)] ?? 0;
  /**
   * Revenue target ÷ (ALLOCATED spend × rate): the reserve is not expected to
   * be spent, so the ROAS the plan implies is over what is — exactly how the
   * Overview's `roasFigures` derives its target, so the two pages agree.
   */
  const draftRevenue = parse(draft.revenue);
  const impliedRoas =
    draftRevenue > 0 && allocatable > 0 ? roasThroughRate(draftRevenue, allocatable, rate) : null;

  const objectiveSharesOf = (platform: string) =>
    BUDGET_OBJECTIVES.map((o) => parse(draft.objectiveShares[budgetComboKey(platform, o)]));
  const objectiveAmountsOf = (platform: string) =>
    amountsFromShares(amountOf(platform), objectiveSharesOf(platform));

  // ── Validation: 100% or no save ────────────────────────────────────────────
  const problems = useMemo(() => {
    if (!editing) return [];
    return planGateProblems({
      total,
      reserveShare: reserveShareValue,
      hasRevenueTarget: draft.revenue.trim() !== "",
      platforms: activePlatforms.map((platform) => ({
        label: platformLabel(platform),
        share: parse(draft.platformShares[platform]),
        objectiveShares: objectiveSharesOf(platform),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, total, reserveShareValue, activePlatforms]);

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
    setPlatformShare(platform, String(shareFromAmount(parse(rawAmount), total)));
  const setReserveShare = (raw: string) => setField({ reserveShare: raw });
  const setReserveAmount = (rawAmount: string) =>
    setReserveShare(String(shareFromAmount(parse(rawAmount), total)));
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
  };

  /**
   * Scale the first level to exactly 100%, keeping proportions — the reserve
   * and the platforms TOGETHER, since the reserve is one of the shares.
   */
  const normalizeTotalShares = () => {
    const [fixedReserve = 0, ...fixed] = normalizeShares(totalShareList);
    setDraft((d) => {
      const next = { ...d.platformShares };
      activePlatforms.forEach((p, i) => (next[p] = String(fixed[i] ?? 0)));
      return {
        ...d,
        reserveShare: fixedReserve > 0 ? String(fixedReserve) : "",
        platformShares: next,
      };
    });
  };
  /** The whole gap into the reserve; platforms untouched. */
  const sendRestToReserve = () => {
    const next = sendRemainderToReserve(reserveShareValue, platformShareList);
    if (next === null) return;
    setField({ reserveShare: next > 0 ? String(next) : "" });
  };
  const canSendToReserve =
    !totalSharesOk && sendRemainderToReserve(reserveShareValue, platformShareList) !== null;
  const normalizeObjectives = (platform: string) => {
    const fixed = normalizeShares(objectiveSharesOf(platform));
    setDraft((d) => {
      const next = { ...d.objectiveShares };
      BUDGET_OBJECTIVES.forEach(
        (o, i) => (next[budgetComboKey(platform, o)] = String(fixed[i] ?? 0)),
      );
      return { ...d, objectiveShares: next };
    });
  };

  /** The gap spread across the ACTIVE platforms — never into the reserve. */
  const distributePlatforms = () => {
    const fixed = distributePlatformsEvenly(reserveShareValue, platformShareList);
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
    const toIndex = activePlatforms.indexOf(movePlatform);
    if (toIndex < 0) {
      toast.error(`${platformLabel(movePlatform)} has no share to move money into.`);
      return;
    }
    const fromIndex = activePlatforms.indexOf(moveFrom);
    const source =
      moveFrom === "reserve"
        ? ({ kind: "reserve" } as const)
        : moveFrom === "new"
          ? ({ kind: "new" } as const)
          : ({ kind: "platform", index: fromIndex } as const);

    // Amounts domain, against the editor's OWN allocatable (total − reserve) —
    // never Σ amounts, which is smaller while the split is incomplete.
    const result = moveMoney({
      amounts: platformAmounts,
      toIndex,
      amount,
      source,
      reserve,
      total,
      allocatable,
    });
    if (!result) {
      toast.error(moveError(amount));
      return;
    }

    // moveMoney speaks in AMOUNTS (and shares of the allocatable, which this
    // draft no longer stores); the dollars it returns are cents-exact, so each
    // platform's share of the NEW total — and the reserve's — is its amount
    // over that total at full precision, and the derived amounts come back
    // identical (the stored-plan round-trip rule).
    setDraft((d) => {
      const shares = { ...d.platformShares };
      activePlatforms.forEach(
        (p, i) => (shares[p] = String(shareFromAmount(result.amounts[i] ?? 0, result.total))),
      );
      const nextReserve = shareFromAmount(result.reserve, result.total);
      return {
        ...d,
        total: String(result.total),
        reserveShare: nextReserve > 0 ? String(nextReserve) : "",
        platformShares: shares,
      };
    });
    // Pre-fill the revision note — a money move is worth recording, and the
    // author can still edit or clear it before saving.
    if (note.trim() === "") setNote(moveNote(amount));
    setMoveOpen(false);
    setMoveAmount("");
    toast.success(moveNote(amount));
  };

  /** Both ends of the move, in one sentence. */
  const moveNote = (amount: number) =>
    moveFrom === "new"
      ? `Added ${usd(amount)} new money to ${platformLabel(movePlatform)}`
      : moveFrom === "reserve"
        ? `Moved ${usd(amount)} from reserve to ${platformLabel(movePlatform)}`
        : `Moved ${usd(amount)} ${platformLabel(moveFrom)} → ${platformLabel(movePlatform)}`;

  const moveError = (amount: number) => {
    if (amount <= 0) return "Enter an amount to move.";
    if (moveFrom === "reserve") return `The reserve only holds ${usd(reserve)}.`;
    if (moveFrom === movePlatform) return "Pick a different platform to move from.";
    if (moveFrom !== "new") {
      return `${platformLabel(moveFrom)} only holds ${usd(amountOf(moveFrom))}.`;
    }
    return "That move isn't possible.";
  };

  /** How much the chosen source can give — shown under the amount input. */
  const moveSourceCap =
    moveFrom === "reserve"
      ? reserve
      : moveFrom === "new"
        ? null
        : amountOf(moveFrom);

  // ── View-mode model ────────────────────────────────────────────────────────
  const storedAllocated = round2(
    data.allocations.reduce((s, a) => s + a.plannedSpend, 0),
  );
  const storedTotal = round2(storedAllocated + data.reserveSpendUsd);
  /** Planned platforms in ALL_PLATFORMS order, each with its objective rows. */
  const viewPlatforms = useMemo(
    () =>
      ALL_PLATFORMS.flatMap((platform) => {
        const mine = data.allocations.filter((a) => a.platform === platform);
        if (mine.length === 0) return [];
        const amount = round2(mine.reduce((s, a) => s + a.plannedSpend, 0));
        return [
          {
            platform,
            amount,
            objectives: BUDGET_OBJECTIVES.flatMap((objective, i) => {
              const row = mine.find((a) => a.objective === objective);
              return row ? [{ objective, amount: row.plannedSpend, color: seriesColor(i) }] : [];
            }),
          },
        ];
      }),
    [data.allocations],
  );
  /**
   * The ROAS the stored plan implies: revenue ÷ (allocated × rate). On a daily
   * month this IS the stored target ROAS (the revenue target was derived from
   * it), so the strip shows one figure either way.
   */
  const storedImpliedRoas =
    isDaily && data.targetRoas !== null
      ? data.targetRoas
      : data.plannedRevenueSar !== null && storedAllocated > 0
        ? roasThroughRate(data.plannedRevenueSar, storedAllocated, rate)
        : null;

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
  const copyFromDaily = dailyMonths.includes(copyFrom);

  const doConvert = async () => {
    setIsPending(true);
    try {
      const res = await convertPlanToCurve({
        month,
        note: convertNote.trim() === "" ? undefined : convertNote.trim(),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not switch the plan");
        return;
      }
      toast.success(`${monthLabel(month)} is planned in the editor again`);
      setConvertOpen(false);
      setConvertNote("");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };
  /** Open the Copy dialog already pointed at a month. */
  const openCopyFrom = (from: string) => {
    setCopyFrom(from);
    setCopyOpen(true);
  };

  /**
   * DELETE = an EMPTY full-replace through the one writer (saveBudgetMonth,
   * source "delete") — never a parallel DELETE. So it leaves a revision like
   * every other write, and the plan it removed stays restorable.
   */
  const doDelete = async () => {
    setIsPending(true);
    try {
      const res = await saveBudgetMonth({
        month,
        mode: "curve",
        source: "delete",
        allocations: [],
        plannedRevenueSar: null,
        reserveSpendUsd: 0,
        dayWeights: [],
        note: deleteNote.trim() === "" ? undefined : deleteNote.trim(),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the plan");
        return;
      }
      toast.success(`${monthLabel(month)}'s plan deleted — it's in Revisions if you need it back`);
      setDeleteOpen(false);
      setDeleteNote("");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };
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

  const hasPlan =
    data.allocations.length > 0 || data.plannedRevenueSar !== null || isDaily;

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
  const curveEditor = (
    <DayCurveEditor
      month={month}
      totalDays={totalDays}
      weightOf={weightOf}
      /** The pot the bars divide up: the draft's allocated amount while
       *  editing, the stored allocated total otherwise. */
      plannedTotal={editing ? allocatable : storedAllocated}
      weights={activeWeights}
      fmtSpend={fmtSpend}
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
  );

  /**
   * A share input + the amount it derives — the cascade's one repeated unit.
   * `lock` names why a field can't take input right now; a locked field is
   * disabled (so Enter-advance skips it) rather than silently swallowing
   * keystrokes into a zero parent.
   */
  const shareCell = (
    key: string,
    value: number,
    amount: number,
    onShare: (raw: string) => void,
    onAmount: (raw: string) => void,
    ariaShare: string,
    ariaAmount: string,
    lock: { share?: string; amount?: string } = {},
  ) => (
    <div className="flex items-center gap-1.5">
      <UnitInput
        unit="%"
        wrapperClassName="w-20 shrink-0"
        {...fieldProps}
        value={shareEdit?.key === key ? shareEdit.raw : value === 0 ? "" : value.toFixed(1)}
        onChange={(e) => {
          const raw = numeric(e.target.value);
          setShareEdit({ key, raw });
          onShare(raw);
        }}
        onBlur={() => setShareEdit(null)}
        placeholder="0"
        className="h-8"
        aria-label={ariaShare}
        disabled={lock.share !== undefined}
        title={lock.share}
      />
      <div className="w-28 shrink-0" title={lock.amount}>
        <Input
          {...fieldProps}
          value={amount === 0 ? "" : String(amount)}
          onChange={(e) => {
            setShareEdit(null);
            onAmount(numeric(e.target.value));
          }}
          placeholder="0"
          className="h-8 text-right num text-ink-2"
          aria-label={ariaAmount}
          disabled={lock.amount !== undefined}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4" ref={formRef}>
      <BudgetMonthBar month={month} today={today} locked={editing}>
        {isDaily && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-ink"
            title="Planned from an uploaded sheet, one day at a time. The editor and the curve are read-only for this month."
          >
            <CalendarDays className="h-3 w-3" aria-hidden />
            Day by day
          </span>
        )}
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
          // ONE primary per mode, then the ⋯ menu — adjacent, so they wrap
          // onto a phone's second line TOGETHER. Everything a planner does
          // less often lives in the menu (the toolbar pattern for
          // action-heavy tabs; see the Budget bullets in CLAUDE.md).
          <span className="inline-flex items-center gap-1.5">
            {isDaily ? (
              <Button type="button" size="sm" onClick={openUpload}>
                <Upload className="h-3.5 w-3.5" />
                Upload sheet
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={startEditing}>
                <Pencil className="h-3.5 w-3.5" />
                Edit plan
              </Button>
            )}
            {/* modal={false}: a menu item opens a Dialog, and a MODAL menu
                closing underneath it can leave the body's pointer lock behind. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="px-2"
                  aria-label="More plan actions"
                  disabled={isPending}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {!isDaily && (
                  <DropdownMenuItem onSelect={openUpload}>
                    <Upload />
                    Upload plan…
                  </DropdownMenuItem>
                )}
                {isDaily && (
                  <DropdownMenuItem onSelect={() => downloadPlanSheet(month, data)}>
                    <Download />
                    Download sheet
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={openCopy}
                  disabled={copyOptions.length === 0}
                  title={copyOptions.length === 0 ? "No other month has a plan to copy." : undefined}
                >
                  <CopyPlus />
                  Copy from month…
                </DropdownMenuItem>
                {isDaily ? (
                  <DropdownMenuItem onSelect={() => setConvertOpen(true)}>
                    <Pencil />
                    Switch to editor planning
                  </DropdownMenuItem>
                ) : (
                  // Useful standalone too: a curve month downloads curve-shaped.
                  <DropdownMenuItem onSelect={() => downloadPlanSheet(month, data)}>
                    <Download />
                    Download sheet
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteOpen(true)}
                  disabled={!hasPlan}
                >
                  <Trash2 />
                  Delete plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
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
          <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div>
              <h3 className="text-sm font-medium text-ink">Targets</h3>
              <p className="text-[11px] text-ink-3">
                The total is what everything below is a share of — the reserve
                included. The revenue target is read against what is actually
                allocated.
              </p>
            </div>
            {/* One baseline grid: every field is a single-line label over an
                h-9 input with its unit inside the box; the third column is the
                live read-only figure the two inputs imply. */}
            <div className="grid gap-x-6 gap-y-3 sm:max-w-3xl sm:grid-cols-3">
              <label className="min-w-0 space-y-1">
                <span className="block truncate text-label text-ink-3">Total budget</span>
                <UnitInput
                  unit="USD"
                  {...fieldProps}
                  value={draft.total}
                  onChange={(e) => setField({ total: numeric(e.target.value) })}
                  placeholder="e.g. 50000"
                  aria-label="Total budget (USD)"
                  ref={totalRef}
                  // The rescale note shows while this field has focus, so it
                  // wraps the shared handler rather than replacing it.
                  onFocus={(e) => {
                    setTotalFocused(true);
                    e.currentTarget.select();
                  }}
                  onBlur={() => setTotalFocused(false)}
                />
              </label>
              <label className="min-w-0 space-y-1">
                <span className="block truncate text-label text-ink-3">Revenue target</span>
                <UnitInput
                  unit="SAR"
                  {...fieldProps}
                  value={draft.revenue}
                  onChange={(e) => setField({ revenue: numeric(e.target.value) })}
                  placeholder="e.g. 250000"
                  aria-label="Planned monthly revenue (SAR)"
                />
              </label>
              {/* Live, read-only: what the two inputs imply, against ALLOCATED
                  spend (the reserve is held back, not spent). The h-9 box keeps
                  it on the inputs' baseline. */}
              <div className="min-w-0 space-y-1">
                <span className="block truncate text-label text-ink-3">Implied ROAS target</span>
                <div
                  className="flex h-9 items-baseline gap-2 rounded-md border border-dashed border-line px-3"
                  aria-live="polite"
                  title="Revenue target ÷ (allocated spend × rate). The reserve is not expected to be spent."
                >
                  <span className="num tabular-nums text-sm text-ink">{fmtRoas(impliedRoas)}</span>
                  <span className="num truncate text-[11px] text-ink-3">at {rate.toFixed(2)} SAR/USD</span>
                </div>
              </div>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {/* Each label + value wraps as a unit at 375px. */}
              <span className="whitespace-nowrap">
                <span className="text-label text-ink-3">Allocated</span>{" "}
                <span className="num text-sm text-ink-2">{usd(allocatable)}</span>
              </span>
              {reserve > 0 && (
                <span className="whitespace-nowrap">
                  <span className="text-label text-ink-3">Reserve</span>{" "}
                  <span className="num text-sm text-ink-2">{usd(reserve)}</span>
                </span>
              )}
            </p>
            {totalFocused && (
              <p className="text-[11px] text-ink-3">
                Changing the total rescales every amount through the shares below —
                the reserve and each platform keep their percentages. To hand money
                to ONE platform, use Move money instead.
              </p>
            )}
          </section>

          {/* ── 2 + 3. Platform shares → objective shares ──────────────── */}
          <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-ink">Split the budget</h3>
                <p className="text-[11px] text-ink-3">
                  The reserve and each platform take a share of the total; inside
                  a platform, each objective takes a share of it.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn("num text-[11px]", totalSharesOk ? "text-ink-3" : "text-warn")}
                >
                  {pct1(totalShareSum / 100)} of 100%
                </span>
                {!totalSharesOk && activePlatforms.length > 0 && (
                  <>
                    {/* Three different intents: pad the gap across the platforms,
                        park the whole gap in the reserve, or scale everything
                        (reserve included) so the ratios survive. */}
                    <Button type="button" variant="outline" size="xs" onClick={distributePlatforms}>
                      <Split className="h-3 w-3" />
                      Distribute remaining evenly
                    </Button>
                    {canSendToReserve && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={sendRestToReserve}
                        title={
                          shareRemainder(totalShareList) > 0
                            ? "Put everything not yet assigned into the reserve"
                            : "Take the over-assigned share back out of the reserve"
                        }
                      >
                        <Wallet className="h-3 w-3" />
                        Send the rest to reserve
                      </Button>
                    )}
                    {totalShareSum > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={normalizeTotalShares}
                        title="Scale the reserve and every platform proportionally so they total 100%"
                      >
                        <Scale className="h-3 w-3" />
                        Normalize to 100%
                      </Button>
                    )}
                  </>
                )}
                {activePlatforms.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setMoveFrom(reserve > 0 ? "reserve" : "new");
                      setMoveOpen(true);
                    }}
                  >
                    <ArrowRightLeft className="h-3 w-3" />
                    Move money
                  </Button>
                )}
              </div>
            </div>

            {/* THE RESERVE ROW — first (user decision): the same share-primary
                pair a platform has, no objectives beneath it, and it may be 0.
                In DOM order it precedes the cards, so Enter-advance reaches it
                right after the targets. */}
            <div className="@container flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-dashed border-line-2 bg-surface px-3 py-2.5">
              <div className="min-w-0">
                <span className="block text-sm font-medium text-ink">Reserve</span>
                <span className="block text-[11px] text-ink-3">held back, not paced</span>
              </div>
              <div className="@min-[18.75rem]:ml-auto">
                {shareCell(
                  RESERVE_KEY,
                  reserveShareValue,
                  reserve,
                  setReserveShare,
                  setReserveAmount,
                  "Reserve share of the total budget",
                  "Reserve amount in USD",
                  total <= 0 ? { amount: "Set a total budget first" } : {},
                )}
              </div>
            </div>

            {/* Always-open platform cards, 2×2 from sm up. DOM order is the
                visual order (row-major), so Enter-advance walks card by card —
                top-left, top-right, bottom-left, bottom-right — and top to
                bottom inside each. */}
            <ul className="grid gap-3 sm:grid-cols-2">
              {ALL_PLATFORMS.map((platform) => {
                const on = draft.platformShares[platform] !== undefined;
                const label = PLATFORM_LABEL[platform];
                const objectiveShares = objectiveSharesOf(platform);
                const objectiveAmounts = objectiveAmountsOf(platform);
                const objectivesOk = sharesComplete(objectiveShares);
                const objectiveSum = objectiveShares.reduce((s, v) => s + v, 0);
                // A platform that isn't planned shows its split read-only; one
                // with no money yet can take its split but has no parent for a
                // typed dollar amount to be a share of.
                const objectiveLock = !on
                  ? { share: `Plan ${label} this month first`, amount: `Plan ${label} this month first` }
                  : amountOf(platform) <= 0
                    ? { amount: `Give ${label} a share first` }
                    : {};
                return (
                  <li
                    key={platform}
                    className={cn(
                      // A container, so every row in the card switches between
                      // stacked and inline TOGETHER: a 375px phone card is ~267px
                      // inside, and "Retargeting" + its two inputs need ~298px —
                      // without this, one row would wrap while its siblings don't.
                      "@container flex flex-col gap-3 rounded-lg border border-line p-3",
                      on ? "bg-surface-2/50" : "bg-surface",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <button
                        type="button"
                        onClick={() => togglePlatform(platform)}
                        role="checkbox"
                        aria-checked={on}
                        className="inline-flex items-center gap-2 text-left text-sm font-medium text-ink"
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
                        {label}
                      </button>
                      <div className="@min-[18.75rem]:ml-auto">
                        {on ? (
                          shareCell(
                            `p:${platform}`,
                            parse(draft.platformShares[platform]),
                            amountOf(platform),
                            (raw) => setPlatformShare(platform, raw),
                            (raw) => setPlatformAmount(platform, raw),
                            `${label} share of the total budget`,
                            `${label} amount in USD`,
                            total <= 0 ? { amount: "Set a total budget first" } : {},
                          )
                        ) : (
                          <span className="text-[11px] text-ink-3">Not planned this month</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5 border-t border-line pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-label text-ink-3">Objectives</span>
                        {on && (
                          <span
                            className={cn(
                              "num text-[11px]",
                              objectivesOk ? "text-ink-3" : "text-warn",
                            )}
                          >
                            {pct1(objectiveSum / 100)} of 100%
                          </span>
                        )}
                      </div>
                      {BUDGET_OBJECTIVES.map((objective, i) => (
                        <div
                          key={objective}
                          className="flex flex-col gap-1 @min-[18.75rem]:flex-row @min-[18.75rem]:items-center @min-[18.75rem]:justify-between @min-[18.75rem]:gap-3"
                        >
                          <span className={cn("text-sm", on ? "text-ink-2" : "text-ink-3")}>
                            {objective}
                          </span>
                          {shareCell(
                            `o:${platform}:${objective}`,
                            objectiveShares[i] ?? 0,
                            objectiveAmounts[i] ?? 0,
                            (raw) => setObjectiveShare(platform, objective, raw),
                            (raw) => setObjectiveAmount(platform, objective, raw),
                            `${objective} share of ${label}`,
                            `${objective} amount on ${label} in USD`,
                            objectiveLock,
                          )}
                        </div>
                      ))}
                    </div>

                    {on && !objectivesOk && (
                      <div className="mt-auto flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => distributeObjectives(platform)}
                        >
                          <Split className="h-3 w-3" />
                          Distribute remaining evenly
                        </Button>
                        {objectiveSum > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => normalizeObjectives(platform)}
                            title="Scale these shares proportionally so they total 100%"
                          >
                            <Scale className="h-3 w-3" />
                            Normalize to 100%
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
              {/* 1. The targets strip */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className="text-label text-ink-3">Total budget</span>
                  <span className="num tabular-nums text-ink">{fmtSpend(storedTotal)}</span>
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
                  {data.reserveSpendUsd > 0 && storedTotal > 0 && (
                    <span className="num tabular-nums text-[11px] text-ink-3">
                      {pct1((pctShare(data.reserveSpendUsd, storedTotal) ?? 0) / 100)} of total
                    </span>
                  )}
                </span>
                <span
                  className="inline-flex items-center gap-2"
                  title={
                    isDaily
                      ? "Each day's revenue target is that day's spend × this ROAS, through the brand rate."
                      : "Revenue target ÷ (allocated spend × rate). The reserve is not expected to be spent."
                  }
                >
                  <span className="text-label text-ink-3">
                    {isDaily ? "Target ROAS" : "Implied ROAS target"}
                  </span>
                  <span className="num tabular-nums text-ink">{fmtRoas(storedImpliedRoas)}</span>
                  <span className="num text-[11px] text-ink-3">at {rate.toFixed(2)} SAR/USD</span>
                </span>
              </div>

              {/* 2. The composition bar — how the total is split */}
              <CompositionBar
                total={storedTotal}
                platforms={viewPlatforms}
                reserve={data.reserveSpendUsd}
                fmt={fmtSpend}
              />

              {/* 3. The platform cards — read-only, the editor's own grid, so
                  "Edit plan" turns these same cards into inputs */}
              {viewPlatforms.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {viewPlatforms.map((p) => (
                    <li
                      key={p.platform}
                      id={platformAnchorId(p.platform)}
                      className="flex scroll-mt-24 flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                          <PlatformDot platform={p.platform} size="sm" />
                          {PLATFORM_LABEL[p.platform]}
                        </span>
                        <span className="num tabular-nums text-sm text-ink">
                          {fmtSpend(p.amount)}
                          <span className="ml-1.5 text-[11px] text-ink-3">
                            {pct1((pctShare(p.amount, storedTotal) ?? 0) / 100)} of total
                          </span>
                        </span>
                      </div>
                      {/* The objective split, as a bar and as rows. */}
                      <div
                        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-surface-2"
                        role="img"
                        aria-label={`${PLATFORM_LABEL[p.platform]}: ${p.objectives
                          .map((o) => `${o.objective} ${pct1((pctShare(o.amount, p.amount) ?? 0) / 100)}`)
                          .join(", ")}`}
                      >
                        {p.objectives.map((o) => (
                          <span
                            key={o.objective}
                            className="h-full"
                            style={{
                              width: `${pctShare(o.amount, p.amount) ?? 0}%`,
                              background: o.color,
                            }}
                          />
                        ))}
                      </div>
                      <ul className="space-y-1 border-t border-line pt-2">
                        {p.objectives.map((o) => (
                          <li
                            key={o.objective}
                            className="flex items-baseline justify-between gap-3 text-xs"
                          >
                            <span className="inline-flex min-w-0 items-center gap-2 text-ink-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ background: o.color }}
                                aria-hidden
                              />
                              <span className="truncate">{o.objective}</span>
                            </span>
                            <span className="num tabular-nums text-ink-2">
                              {fmtSpend(o.amount)}
                              <span className="ml-1.5 text-[11px] text-ink-3">
                                {pct1((pctShare(o.amount, p.amount) ?? 0) / 100)}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
              <p className="text-sm text-ink-2">No plan for this month yet.</p>
              {canManage ? (
                <>
                  <p className="mt-1 text-xs text-ink-3">
                    {seedMonth
                      ? `${monthLabel(seedMonth)} has one — reuse it, plan from scratch, or upload a sheet.`
                      : "Plan it in the editor, or upload a day-by-day sheet."}
                  </p>
                  {/* The toolbar's hierarchy: one primary, the rest quieter. */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" size="sm" onClick={startEditing} disabled={isPending}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit plan
                    </Button>
                    {seedMonth && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCopyFrom(seedMonth)}
                        disabled={isPending}
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                        Copy {monthLabel(seedMonth)}&rsquo;s plan
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={openUpload} disabled={isPending}>
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-ink-3">
                  Ask someone with budget access to add a plan.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── 4. The day grain: the curve, or — on a daily month — its cells ── */}
      {isDaily ? (
        <DailyPlanPanel
          month={month}
          values={series.spendDays()}
          fmtSpend={fmtSpend}
          dormantWeights={Object.keys(data.dayWeightOverrides).length}
        />
      ) : !editing && hasPlan && overrideCount === 0 ? (
        // Every day equal: nothing to read in a calendar of ones, so the panel
        // collapses to one line that still opens. In edit mode it is always
        // open (the curve is being set).
        <CollapsibleSection title="Plan curve" subtitle="every day equal">
          {curveEditor}
        </CollapsibleSection>
      ) : (
        curveEditor
      )}

      {/* Copy from any planned month */}
      {canManage && (
        <BudgetPlanUpload
          key={uploadKey}
          month={month}
          data={data}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
        />
      )}

      {/* Delete: the house destructive pattern. No type-to-confirm — unlike
          the cleanup tools this is revision-recoverable, and the dialog says so. */}
      <Dialog open={deleteOpen} onOpenChange={(o) => !isPending && setDeleteOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {monthLabel(month)}&rsquo;s plan?</DialogTitle>
            <DialogDescription>
              Deletes {monthLabel(month)}&rsquo;s plan entirely. Recoverable — the previous
              plan stays in Revisions.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteNote}
            onChange={(e) => setDeleteNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="Plan deleted"
            maxLength={NOTE_MAX}
            className="h-8"
            aria-label="Revision note"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={doDelete} disabled={isPending}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Daily → editor planning: a COLLAPSE, said out loud */}
      <Dialog open={convertOpen} onOpenChange={(o) => !isPending && setConvertOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch {monthLabel(month)} to editor planning?</DialogTitle>
            <DialogDescription>
              The day-by-day detail is collapsed: each platform · bucket keeps its
              monthly total ({fmtSpend(storedAllocated)} allocated), paced LINEARLY
              from here on, and the target ROAS becomes a plain revenue target of{" "}
              {data.plannedRevenueSar !== null ? sar(data.plannedRevenueSar) : "—"}.
              Nothing is lost — the revision history keeps every day, and restoring
              it brings the daily plan back.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={convertNote}
            onChange={(e) => setConvertNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="Switched to editor planning — daily detail collapsed"
            maxLength={NOTE_MAX}
            className="h-8"
            aria-label="Revision note"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConvertOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={doConvert} disabled={isPending}>
              Collapse to monthly totals
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <div className="space-y-3">
            {copyFromDaily && (
              <p className="text-[11px] text-ink-3">
                {`${monthLabel(copyFrom)} is planned day by day — copying brings its days across and plans ${monthLabel(month)} day by day too (days past the month's end are dropped).`}
              </p>
            )}
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
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCopyOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void doCopy()}
              disabled={isPending || !copyFrom}
            >
              {hasPlan ? "Replace this month" : "Copy plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move money out of the reserve */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move money</DialogTitle>
            <DialogDescription>
              This moves money — it doesn&rsquo;t re-plan. The platform you pick gains
              the amount, spread across its objectives by their current shares;
              every other platform keeps exactly the dollars it has.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-label text-ink-3">From</span>
              <Select value={moveFrom} onValueChange={setMoveFrom}>
                <SelectTrigger className="h-9 w-full" aria-label="Where the money comes from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reserve">Reserve</SelectItem>
                  {activePlatforms
                    .filter((p) => p !== movePlatform)
                    .map((p) => (
                      <SelectItem key={p} value={p}>
                        {platformLabel(p)}
                      </SelectItem>
                    ))}
                  <SelectItem value="new">New money (grows the total)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="block space-y-1">
              <span className="text-label text-ink-3">Amount (USD)</span>
              <Input
                value={moveAmount}
                onChange={(e) => setMoveAmount(numeric(e.target.value))}
                inputMode="decimal"
                placeholder="0"
                className="h-9 w-full text-right num"
                aria-label="Amount to move"
              />
              <span className="block text-[11px] text-ink-3">
                {moveSourceCap === null
                  ? "New money raises the total budget by this amount."
                  : `${moveFrom === "reserve" ? "Reserve" : platformLabel(moveFrom)} holds ${usd(moveSourceCap)}.`}
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

/** Below this share a segment keeps its colour but drops its inline label. */
const LABEL_MIN_SHARE = 6;

/**
 * One horizontal stacked bar of the TOTAL: the planned platforms in
 * `ALL_PLATFORMS` order, each in its platform colour, then the reserve LAST as
 * a dashed outline rather than a fill — the Overview hero bar's grammar, so
 * the two pages read alike (the reserve is money held back, not a track).
 * Below it, a legend row that wraps on a phone. The bar says the split in
 * words for a screen reader.
 */
function CompositionBar({
  total,
  platforms,
  reserve,
  fmt,
}: {
  total: number;
  platforms: ReadonlyArray<{ platform: (typeof ALL_PLATFORMS)[number]; amount: number }>;
  reserve: number;
  fmt: (usd: number) => string;
}) {
  if (total <= 0) return null;
  const share = (amount: number) => pctShare(amount, total) ?? 0;
  const segments = [
    ...platforms.map((p) => ({
      key: p.platform as string,
      label: PLATFORM_LABEL[p.platform],
      amount: p.amount,
      color: PLATFORM_COLOR[p.platform],
      reserve: false,
    })),
    ...(reserve > 0
      ? [{ key: "reserve", label: "Reserve", amount: reserve, color: null, reserve: true }]
      : []),
  ];
  const words = `${fmt(total)} in all: ${segments
    .map((s) => `${s.label} ${fmt(s.amount)} (${pct1(share(s.amount) / 100)})`)
    .join(", ")}`;
  return (
    <section className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">How the total splits</h3>
        <span className="num tabular-nums text-xs text-ink-3">{fmt(total)}</span>
      </div>
      <div role="img" aria-label={words} title={words} className="flex h-7 w-full gap-0.5">
        {segments.map((s) => {
          const pct = share(s.amount);
          return (
            // Each segment is a container: the label shows only once the
            // segment is wide enough for it (the % past ~2.75rem, the name past
            // ~7rem), so a phone never shows a clipped "7…" — the legend below
            // carries every name and number regardless.
            <div
              key={s.key}
              className={cn(
                "@container flex min-w-0 items-center justify-center overflow-hidden rounded-md text-[10px] font-medium",
                s.reserve
                  ? "border border-dashed border-line-2 text-ink-3"
                  : "text-[var(--background)]",
              )}
              style={{ width: `${pct}%`, background: s.color ?? undefined }}
            >
              {pct >= LABEL_MIN_SHARE && (
                <span className="hidden whitespace-nowrap px-1.5 num tabular-nums @min-[2.75rem]:inline">
                  <span className="hidden @min-[7rem]:inline">{s.label} </span>
                  {pct1(pct / 100)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            {s.reserve ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full border border-dashed border-line-2"
                aria-hidden
              />
            ) : (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.color ?? undefined }}
                aria-hidden
              />
            )}
            <span className="text-ink-2">{s.label}</span>
            <span className="num tabular-nums text-ink">{fmt(s.amount)}</span>
            <span className="num tabular-nums text-ink-3">{pct1(share(s.amount) / 100)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Weight presets — one tap for the two curves people actually plan around. */
const CURVE_PRESETS: Array<{
  label: string;
  title: string;
  /** Which days of THIS month the preset weights, and to what. */
  days: (totalDays: number, month: string) => Array<{ day: number; weight: number }>;
}> = [
  {
    label: "Paydays (10th & 25th) ×3",
    title: "Weight the 10th and 25th at ×3",
    days: (totalDays) =>
      [10, 25].filter((d) => d <= totalDays).map((day) => ({ day, weight: 3 })),
  },
  {
    label: "Weekends (Fri–Sat) ×0.5",
    // Deliberately Fri–Sat: this is the Saudi working week, not Sat–Sun.
    title: "Halve Fridays and Saturdays — the Saudi weekend",
    days: (totalDays, month) => {
      const start = monthStartIso(month);
      const out: Array<{ day: number; weight: number }> = [];
      for (let day = 1; day <= totalDays; day++) {
        const weekday = new Date(
          `${start.slice(0, 8)}${String(day).padStart(2, "0")}T00:00:00Z`,
        ).getUTCDay();
        if (weekday === 5 || weekday === 6) out.push({ day, weight: 0.5 });
      }
      return out;
    },
  },
];

/**
 * The plan curve: a weekday calendar beside a live bar chart of what each day
 * is planned to spend.
 *
 * The model is normalized shares — weighting a day gives it a bigger slice and
 * shrinks every other day, so the month always totals the budget. That is the
 * part people got wrong when it was invisible, so the bars ARE the explanation:
 * change a weight and every bar moves. Calendar and chart select in sync.
 */
/**
 * A daily month's day grain — read-only. The SAME bars the curve editor draws,
 * fed by the month's series (its cells, verbatim), so both kinds of month read
 * alike. No calendar and no weights: a daily month's shape IS its cells.
 */
function DailyPlanPanel({
  month,
  values,
  fmtSpend,
  dormantWeights,
}: {
  month: string;
  values: number[];
  fmtSpend: (usd: number) => string;
  dormantWeights: number;
}) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const total = values.reduce((s, v) => s + v, 0);
  const planned = values.filter((v) => v > 0).length;
  const peakDay = values.indexOf(Math.max(...values)) + 1;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div>
        <h3 className="text-sm font-medium text-ink">Planned day by day</h3>
        <p className="text-[11px] text-ink-3">
          From an uploaded sheet — each day carries exactly what the sheet said. To
          change it, download the sheet, edit it and upload it again.
          {dormantWeights > 0 &&
            (dormantWeights === 1
              ? " The old curve's one weighted day is kept, unused."
              : ` The old curve's ${dormantWeights} weighted days are kept, unused.`)}
        </p>
      </div>
      <PlanDayBars
        values={values}
        label={(v) => fmtSpend(v)}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        ariaLabel={`Planned spend per day for ${monthLabel(month)}, ${fmtSpend(total)} in all`}
        tone="data"
      />
      <p className="text-[11px] text-ink-3">
        {selectedDay !== null ? (
          <>
            Day {selectedDay} ·{" "}
            <span className="num text-ink-2">{fmtSpend(values[selectedDay - 1] ?? 0)}</span>
          </>
        ) : total > 0 ? (
          <>
            {planned} of {values.length} days carry spend; the biggest is day {peakDay} at{" "}
            <span className="num text-ink-2">{fmtSpend(values[peakDay - 1] ?? 0)}</span>.
          </>
        ) : (
          <>The sheet planned no spend for this month.</>
        )}
      </p>
    </div>
  );
}

function DayCurveEditor({
  month,
  totalDays,
  weightOf,
  plannedTotal,
  weights,
  fmtSpend,
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
  /** The allocatable the curve divides. 0 → bars are labelled as % of plan. */
  plannedTotal: number;
  weights: Record<number, number>;
  fmtSpend: (usd: number) => string;
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

  const hasMoney = plannedTotal > 0;
  // The SAME numbers the pacing math uses — with no total yet, plot the shares
  // (a 100-unit pot) so the shape is still readable.
  const perDay = monthDayIncrements(startIso, weights, hasMoney ? plannedTotal : 100);
  const normalDay = monthDayIncrements(startIso, {}, hasMoney ? plannedTotal : 100)[0] ?? 0;
  const dayValue = (day: number) => perDay[day - 1] ?? 0;
  const label = (value: number) =>
    hasMoney ? fmtSpend(value) : `${value.toFixed(1)}% of plan`;

  const [typedWeight, setTypedWeight] = useState("");

  const applyPreset = (preset: (typeof CURVE_PRESETS)[number]) => {
    for (const { day, weight } of preset.days(totalDays, month)) onSetWeight(day, weight);
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-ink">Plan curve</h3>
        <p className="text-[11px] text-ink-3">
          The plan always totals your budget — weighting a day gives it a bigger
          slice and shrinks the others.
          {overrideCount > 0 &&
            ` ${overrideCount} weighted day${overrideCount === 1 ? "" : "s"}.`}
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Calendar */}
        <div className="grid grid-cols-7 gap-1 sm:w-[19rem] sm:shrink-0">
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
            const selected = selectedDay === day;
            return (
              <button
                key={day}
                type="button"
                disabled={!editing}
                onClick={() => onSelectDay(selected ? null : day)}
                title={`${label(dayValue(day))}${overridden ? ` · ×${w}` : ""}`}
                aria-label={`Day ${day}, weight ${w}, ${label(dayValue(day))}`}
                className={cn(
                  "flex h-10 flex-col items-center justify-center rounded-md border text-[11px] num transition-colors",
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

        {/* Live per-day bars — one per day, height = that day's planned money */}
        <div className="min-w-0 flex-1 space-y-2">
          <PlanDayBars
            values={perDay}
            label={(value) => label(value)}
            emphasize={(day) => weightOf(day) !== 1}
            selectedDay={selectedDay}
            onSelectDay={editing ? onSelectDay : undefined}
            ariaLabel={`Planned spend per day — ${label(normalDay)} on a normal day`}
          />
          <p className="text-[11px] text-ink-3">
            {selectedDay !== null ? (
              <>
                Day {selectedDay} · ×{weightOf(selectedDay)} · ≈{" "}
                <span className="num text-ink-2">{label(dayValue(selectedDay))}</span>{" "}
                (normal day ≈ {label(normalDay)})
              </>
            ) : hasMoney ? (
              <>A normal day is ≈ {label(normalDay)}.</>
            ) : (
              <>Bars show each day&rsquo;s share — set a total to see dollars.</>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      {editing && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {selectedDay !== null ? (
            <>
              <span className="text-label text-ink-3">Day {selectedDay}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onBump(selectedDay, -WEIGHT_STEP)}
                aria-label="Decrease weight"
              >
                −
              </Button>
              <span className="num tabular-nums w-10 text-center">×{weightOf(selectedDay)}</span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onBump(selectedDay, WEIGHT_STEP)}
                aria-label="Increase weight"
              >
                +
              </Button>
              <Input
                value={typedWeight}
                onChange={(e) => setTypedWeight(e.target.value.replace(/[^0-9.]/g, ""))}
                onBlur={() => {
                  if (typedWeight.trim() === "") return;
                  // Snap to the 0.5 grid and the stored bounds, so a typed
                  // 7.3 becomes a weight the save schema will accept.
                  const snapped = Math.min(
                    WEIGHT_MAX,
                    Math.max(WEIGHT_MIN, Math.round(Number(typedWeight) * 2) / 2),
                  );
                  if (Number.isFinite(snapped)) onSetWeight(selectedDay, snapped);
                  setTypedWeight("");
                }}
                placeholder="e.g. 2.5"
                inputMode="decimal"
                className="h-7 w-20 text-right num"
                aria-label={`Weight for day ${selectedDay}`}
              />
              {weightOf(selectedDay) !== 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onSetWeight(selectedDay, 1)}
                >
                  Reset to 1
                </Button>
              )}
              <span className="text-[11px] text-ink-3">0.5–10, in steps of 0.5.</span>
            </>
          ) : (
            <span className="text-[11px] text-ink-3">
              Pick a day — on the calendar or the chart — to weight it.
            </span>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {CURVE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => applyPreset(preset)}
                title={preset.title}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onResetAll}
              disabled={overrideCount === 0}
            >
              <RotateCcw className="h-3 w-3" />
              Clear all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A number input with its unit INSIDE the bordered box — never loose text
 * floating beside it. The title sits on the wrapper: a disabled input takes no
 * pointer events, so a tooltip on the input itself would never show.
 */
