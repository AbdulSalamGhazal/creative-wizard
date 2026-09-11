"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  CopyPlus,
  Pencil,
  RotateCcw,
  Scale,
  Split,
  Wallet,
  Wand2,
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
import { SegmentedControl } from "@/components/ui/segmented-control";
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
  monthDayIncrements,
  monthLabel,
  moveMoney,
  normalizeShares,
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
import type {
  BudgetMonthData,
  MonthPlanRow,
  PlanRevisionRow,
} from "@/db/queries/budget";
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
  seed,
  revisions,
  canManage,
}: {
  month: string; // YYYY-MM
  today: string; // ISO date
  data: BudgetMonthData;
  /** Months that already have a plan — the Copy dialog's options. */
  plannedMonths: string[];
  /**
   * The most recent planned month BEFORE this one, with its plan — the source
   * for "start from its shares". Null when there is no earlier plan; fetched
   * only in that case, so an unplanned brand pays nothing for it.
   */
  seed: { month: string; plan: MonthPlanRow } | null;
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
  /** Same idea for the reserve's % field: the raw text while it has focus. */
  const [reservePctRaw, setReservePctRaw] = useState<string | null>(null);
  const [totalFocused, setTotalFocused] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveAmount, setMoveAmount] = useState("");
  const [movePlatform, setMovePlatform] = useState<string>(ALL_PLATFORMS[0]);
  /** "reserve" · "new" · a platform key. */
  const [moveFrom, setMoveFrom] = useState<string>("reserve");
  const [copyMode, setCopyMode] = useState<"amounts" | "shares">("amounts");
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  /**
   * Phone + keyboard flow for every numeric field in the cascade. One ref on
   * the form container; Enter walks to the next `data-budget-field` input in
   * DOM order (which IS visual order here), Escape blurs, and focus selects so
   * a correction overwrites instead of appending to what's there.
   */
  const formRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const fieldProps = {
    inputMode: "decimal" as const,
    "data-budget-field": true,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.currentTarget.blur();
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const fields = Array.from(
        formRef.current?.querySelectorAll<HTMLInputElement>("[data-budget-field]") ?? [],
      ).filter((el) => !el.disabled);
      const next = fields[fields.indexOf(e.currentTarget) + 1];
      if (next) {
        next.focus();
        next.select();
      } else {
        e.currentTarget.blur();
      }
    },
  };

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
    setNote("");
    setShareEdit(null);
    setReservePctRaw(null);
    setSelectedDay(null);
    setEditing(true);
  };
  const stopEditing = () => {
    setEditing(false);
    setDraft(emptyDraft);
    setWeightsDraft({});
    setNote("");
    setShareEdit(null);
    setReservePctRaw(null);
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
  };

  /** Scale a level's shares to exactly 100%, keeping their proportions. */
  const normalizePlatforms = () => {
    const fixed = normalizeShares(platformShareList);
    setDraft((d) => {
      const next = { ...d.platformShares };
      activePlatforms.forEach((p, i) => (next[p] = String(fixed[i] ?? 0)));
      return { ...d, platformShares: next };
    });
  };
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

    setDraft((d) => {
      const shares = { ...d.platformShares };
      activePlatforms.forEach((p, i) => (shares[p] = String(result.shares[i] ?? 0)));
      return {
        ...d,
        total: String(result.total),
        reserve: result.reserve > 0 ? String(result.reserve) : "",
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

  // ── Seed a plan from another month's SHARES ────────────────────────────────
  /**
   * "Same split, new total" — the common real task. This writes NOTHING: it
   * opens edit mode with the source month's shares (and its curve) already in
   * the draft, leaving the planner to type a total and save. Deliberately not
   * the Copy action, which replaces the stored plan outright.
   */
  const startFromShares = (source: MonthPlanRow) => {
    const allocated = round2(
      source.allocations.reduce((sum, a) => sum + a.plannedSpend, 0),
    );
    const platformShares: Record<string, string> = {};
    const objectiveShares: Record<string, string> = {};
    for (const platform of ALL_PLATFORMS) {
      const rows = source.allocations.filter((a) => a.platform === platform);
      if (rows.length === 0) continue;
      const platformSum = round2(rows.reduce((sum, a) => sum + a.plannedSpend, 0));
      platformShares[platform] = String(shareFromAmount(platformSum, allocated));
      for (const row of rows) {
        objectiveShares[budgetComboKey(platform, row.objective)] = String(
          shareFromAmount(row.plannedSpend, platformSum),
        );
      }
    }
    setDraft({
      // The shares come across; the money does not — that's the point.
      total: "",
      reserve: "",
      revenue: "",
      platformShares,
      objectiveShares,
    });
    setWeightsDraft(
      Object.fromEntries(
        Object.entries(source.dayWeights).map(([day, w]) => [
          Number(day),
          Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w)),
        ]),
      ),
    );
    setNote(`Started from ${monthLabel(source.month)}'s shares`);
    setShareEdit(null);
    setReservePctRaw(null);
    setSelectedDay(null);
    setCopyOpen(false);
    setEditing(true);
    // The one thing left to decide.
    window.setTimeout(() => totalRef.current?.focus(), 0);
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
  /** Shares-mode needs the source month's PLAN, and only the seed month's is
   *  fetched — a deliberate limit, so Plan doesn't fetch every planned month. */
  const copySeed = seed && seed.month === copyFrom ? seed.plan : null;
  /** Open the Copy dialog already pointed at a month, in amounts mode. */
  const setCopySeedAndOpen = (from: string) => {
    setCopyFrom(from);
    setCopyMode("amounts");
    setCopyOpen(true);
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
            {seed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startFromShares(seed.plan)}
                title={`Reuse ${monthLabel(seed.month)}'s split with a new total`}
              >
                <Wand2 className="h-3.5 w-3.5" />
                Start from {monthLabel(seed.month)}&rsquo;s shares
              </Button>
            )}
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
          <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div>
              <h3 className="text-sm font-medium text-ink">Targets</h3>
              <p className="text-[11px] text-ink-3">
                The reserve is part of the total, held back to decide later —
                everything below shares out what&rsquo;s left.
              </p>
            </div>
            {/* One baseline grid: every field is a single-line label over an
                h-9 input with its unit inside the box. The reserve column is a
                little wider because it holds a pair. */}
            <div className="grid gap-x-6 gap-y-3 sm:max-w-3xl sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
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
              <div className="min-w-0 space-y-1">
                <span className="block truncate text-label text-ink-3">Reserve (of the total)</span>
                <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-1.5">
                  <UnitInput
                    unit="USD"
                    {...fieldProps}
                    value={draft.reserve}
                    onChange={(e) => {
                      setReservePctRaw(null);
                      setField({ reserve: numeric(e.target.value) });
                    }}
                    placeholder="0"
                    aria-label="Reserve (USD)"
                  />
                  {/* Buffered like the share inputs: while focused it holds the
                      raw text (so "1" isn't reformatted to "1.0" under the
                      caret) and commits the derived reserve on every change;
                      blur hands it back to the formatted 1dp value. */}
                  <UnitInput
                    unit="%"
                    {...fieldProps}
                    value={
                      reservePctRaw ??
                      (total > 0 && reserve > 0
                        ? (reserveShare(reserve, total) ?? 0).toFixed(1)
                        : "")
                    }
                    onChange={(e) => {
                      const raw = numeric(e.target.value);
                      setReservePctRaw(raw);
                      const next = raw === "" ? 0 : reserveFromShare(parse(raw), total);
                      setField({ reserve: next > 0 ? String(next) : "" });
                    }}
                    onBlur={() => setReservePctRaw(null)}
                    placeholder="0"
                    aria-label="Reserve (% of total)"
                    disabled={total <= 0}
                    title={total <= 0 ? "Set a total budget first" : undefined}
                  />
                </div>
              </div>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {/* Each label + value wraps as a unit at 375px. */}
              <span className="whitespace-nowrap">
                <span className="text-label text-ink-3">Allocatable</span>{" "}
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
                a platform on 50% stays on 50%. To hand money to ONE platform, use
                Move money instead.
              </p>
            )}
          </section>

          {/* ── 2 + 3. Platform shares → objective shares ──────────────── */}
          <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-ink">Split the budget</h3>
                <p className="text-[11px] text-ink-3">
                  Each platform takes a share of the allocatable; inside it, each
                  objective takes a share of the platform.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  <>
                    <Button type="button" variant="outline" size="xs" onClick={distributePlatforms}>
                      <Split className="h-3 w-3" />
                      Distribute remaining evenly
                    </Button>
                    {/* Two different intents: pad the gap equally, or scale
                        what's there so the ratios survive. */}
                    {platformShareList.reduce((sum, v) => sum + v, 0) > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={normalizePlatforms}
                        title="Scale these shares proportionally so they total 100%"
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
                            `${label} share of the allocatable budget`,
                            `${label} amount in USD`,
                            allocatable <= 0 ? { amount: "Set a total budget first" } : {},
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
              {canManage && seed ? (
                <>
                  <p className="mt-1 text-xs text-ink-3">
                    {monthLabel(seed.month)} has one — reuse it, or start from a
                    blank month.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setCopySeedAndOpen(seed.month)}
                      disabled={isPending}
                    >
                      <CopyPlus className="h-3.5 w-3.5" />
                      Copy {monthLabel(seed.month)}&rsquo;s plan
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startFromShares(seed.plan)}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Start from its shares
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
                      Start blank
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-ink-3">
                  {canManage
                    ? "Set a total budget to start planning."
                    : "Ask someone with budget access to add a plan."}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ── 4. Day curve ─────────────────────────────────────────────── */}
      <DayCurveEditor
        month={month}
        totalDays={totalDays}
        weightOf={weightOf}
        /** The pot the bars divide up: the draft's allocatable while editing,
         *  the stored allocated total otherwise. */
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
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="text-label text-ink-3">What to copy</span>
              <SegmentedControl<"amounts" | "shares">
                ariaLabel="What to copy"
                value={copyMode}
                onChange={setCopyMode}
                options={[
                  { value: "amounts", label: "Copy amounts" },
                  { value: "shares", label: "Start from its shares" },
                ]}
              />
              <p className="text-[11px] text-ink-3">
                {copyMode === "amounts"
                  ? "Replaces this month's plan with that month's, dollar for dollar."
                  : "Opens the editor with that month's split and curve — nothing is saved until you set a total and save."}
              </p>
            </div>
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
              onClick={() => {
                if (copyMode === "shares") {
                  const source = copySeed;
                  if (!source) {
                    toast.error("That month's plan isn't loaded — use Copy amounts.");
                    return;
                  }
                  startFromShares(source);
                  return;
                }
                void doCopy();
              }}
              disabled={isPending || !copyFrom}
            >
              {copyMode === "shares"
                ? "Start from its shares"
                : hasPlan
                  ? "Replace this month"
                  : "Copy plan"}
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
  const peak = Math.max(...perDay, 1);
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
          <div
            className="flex h-28 items-end gap-px"
            role="img"
            aria-label={`Planned spend per day — ${label(normalDay)} on a normal day`}
          >
            {Array.from({ length: totalDays }, (_, i) => {
              const day = i + 1;
              const value = dayValue(day);
              const overridden = weightOf(day) !== 1;
              const selected = selectedDay === day;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!editing}
                  onClick={() => onSelectDay(selected ? null : day)}
                  title={`Day ${day} · ×${weightOf(day)} · ${label(value)}`}
                  aria-label={`Day ${day}, ${label(value)}`}
                  className={cn(
                    "min-w-0 flex-1 rounded-t-[2px] transition-all",
                    selected
                      ? "bg-[var(--brand)]"
                      : overridden
                        ? "bg-[var(--brand)]/60"
                        : "bg-surface-3",
                    editing && "cursor-pointer hover:bg-[var(--brand)]/40",
                  )}
                  style={{ height: `${Math.max(3, (value / peak) * 100)}%` }}
                />
              );
            })}
          </div>
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
function UnitInput({
  unit,
  title,
  wrapperClassName,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string; wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)} title={title}>
      <Input
        {...props}
        className={cn("peer text-right num", unit.length > 1 ? "pr-11" : "pl-2 pr-6", className)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-ink-3 peer-disabled:opacity-50"
      >
        {unit}
      </span>
    </div>
  );
}
