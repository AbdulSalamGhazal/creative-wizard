import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// The actions are the unit under test, so only the auth boundary is faked —
// everything below it (validation, the transaction, the writes) runs for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { budgetPlanRevisions } from "@/db/schema";
import {
  convertPlanToCurve,
  copyBudgetFromMonth,
  restorePlanRevision,
  saveBudgetMonth,
} from "@/app/actions/budget";
import {
  budgetPlansForMonths,
  dailyPlannedMonths,
  getBudgetMonth,
  listPlanRevisions,
  planSeriesForMonth,
  plannedMonths,
} from "@/db/queries/budget";
import { resetAndSeed } from "./fixtures";

const MONTH = "2026-01";
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const PLAN_A = {
  month: MONTH,
  allocations: [
    { platform: "instagram", objective: "Other", plannedSpend: 1000 },
    { platform: "facebook", objective: "Awareness", plannedSpend: 500 },
  ],
  plannedRevenueSar: 25_000,
  reserveSpendUsd: 250,
  dayWeights: [{ day: 15, weight: 2 }],
};

const PLAN_B = {
  month: MONTH,
  allocations: [{ platform: "tiktok", objective: "Retargeting", plannedSpend: 800 }],
  plannedRevenueSar: null,
  reserveSpendUsd: 0,
  dayWeights: [],
};

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

describe("plan revisions — written on every write", () => {
  it("a save records the plan as it stands AFTER the save, with the note", async () => {
    const res = await saveBudgetMonth({ ...PLAN_A, note: "Q1 kickoff" });
    expect(res.ok).toBe(true);

    const revisions = await listPlanRevisions(MONTH);
    expect(revisions).toHaveLength(1);
    const rev = revisions[0]!;
    expect(rev.note).toBe("Q1 kickoff");
    expect(rev.savedBy).toBe("Harness");
    expect(rev.allocationCount).toBe(2);
    expect(rev.plannedTotal).toBeCloseTo(1500, 4);
    expect(rev.plannedRevenueSar).toBe(25_000);
    expect(rev.reserveSpendUsd).toBeCloseTo(250, 4);
    expect(rev.weightOverrides).toBe(1);
    expect(rev.snapshot?.dayWeights).toEqual({ "15": 2 });
  });

  it("saves stack up, newest first, and a note is optional", async () => {
    await saveBudgetMonth({ ...PLAN_A, note: "first" });
    await saveBudgetMonth(PLAN_B);

    const revisions = await listPlanRevisions(MONTH);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]!.note).toBeNull(); // newest — the un-noted PLAN_B save
    expect(revisions[0]!.allocationCount).toBe(1);
    expect(revisions[1]!.note).toBe("first");
  });

  it("a copy records a revision on the DESTINATION month", async () => {
    await saveBudgetMonth(PLAN_A); // January
    const res = await copyBudgetFromMonth({ month: "2026-02", from: MONTH });
    expect(res.ok).toBe(true);

    const feb = await listPlanRevisions("2026-02");
    expect(feb).toHaveLength(1);
    expect(feb[0]!.note).toBe("Copied from January 2026");
    expect(feb[0]!.plannedTotal).toBeCloseTo(1500, 4);
    // January keeps only its own save.
    expect(await listPlanRevisions(MONTH)).toHaveLength(1);
  });

  it("refuses to copy a month onto itself", async () => {
    await saveBudgetMonth(PLAN_A);
    const res = await copyBudgetFromMonth({ month: MONTH, from: MONTH });
    expect(res.ok).toBe(false);
    expect(await listPlanRevisions(MONTH)).toHaveLength(1);
  });

  it("is account-scoped — B cannot see A's revisions", async () => {
    await saveBudgetMonth(PLAN_A);
    setAccount(ACCOUNT_B);
    expect(await listPlanRevisions(MONTH)).toHaveLength(0);
  });
});

describe("plan revisions — restore", () => {
  it("round-trips: the restored plan equals the snapshot exactly", async () => {
    await saveBudgetMonth({ ...PLAN_A, note: "the good one" });
    const [original] = await listPlanRevisions(MONTH);
    await saveBudgetMonth(PLAN_B); // wipe it out

    const wiped = await getBudgetMonth(MONTH);
    expect(wiped.allocations).toHaveLength(1);
    expect(wiped.plannedRevenueSar).toBeNull();

    const res = await restorePlanRevision({ revisionId: original!.id });
    expect(res.ok).toBe(true);

    const restored = await getBudgetMonth(MONTH);
    expect(
      restored.allocations
        .map((a) => `${a.platform}|${a.objective}|${a.plannedSpend}`)
        .sort(),
    ).toEqual(["facebook|Awareness|500", "instagram|Other|1000"]);
    expect(restored.plannedRevenueSar).toBe(25_000);
    expect(restored.reserveSpendUsd).toBeCloseTo(250, 4);
    expect(restored.dayWeightOverrides).toEqual({ 15: 2 });
  });

  it("the restore is itself a revision, so nothing is lost by restoring", async () => {
    await saveBudgetMonth(PLAN_A);
    const [original] = await listPlanRevisions(MONTH);
    await saveBudgetMonth(PLAN_B);
    await restorePlanRevision({ revisionId: original!.id });

    const revisions = await listPlanRevisions(MONTH);
    expect(revisions).toHaveLength(3);
    expect(revisions[0]!.note).toMatch(/^Restored from /);
    expect(revisions[0]!.plannedTotal).toBeCloseTo(1500, 4);
  });

  it("cannot restore another brand's revision", async () => {
    await saveBudgetMonth(PLAN_A);
    const [mine] = await listPlanRevisions(MONTH);

    setAccount(ACCOUNT_B);
    const res = await restorePlanRevision({ revisionId: mine!.id });
    expect(res.ok).toBe(false);
    // …and B's own month is untouched.
    expect((await getBudgetMonth(MONTH)).allocations).toHaveLength(0);
  });

  it("restores a pre-bucket snapshot by folding its objectives into Other", async () => {
    await saveBudgetMonth(PLAN_B);
    // A snapshot written before Budget got its own objective axis: campaign
    // objectives, two of which now collapse onto the same bucket + platform.
    await db.insert(budgetPlanRevisions).values({
      accountId: ACCOUNT_A,
      month: "2026-01-01",
      snapshot: {
        allocations: [
          { platform: "instagram", objective: "Sales", plannedSpend: 600 },
          { platform: "instagram", objective: "Prospecting", plannedSpend: 400 },
          { platform: "instagram", objective: "Awareness", plannedSpend: 250 },
        ],
        plannedRevenueSar: 12_000,
        reserveSpendUsd: 0,
        dayWeights: {},
      },
      note: "legacy",
      savedBy: USER,
    });
    const [legacy] = await db
      .select({ id: budgetPlanRevisions.id })
      .from(budgetPlanRevisions)
      .where(
        and(
          eq(budgetPlanRevisions.accountId, ACCOUNT_A),
          eq(budgetPlanRevisions.note, "legacy"),
        ),
      );

    const res = await restorePlanRevision({ revisionId: legacy!.id });
    expect(res.ok).toBe(true);

    const after = await getBudgetMonth(MONTH);
    // Sales + Prospecting merged into ONE Other row carrying both amounts —
    // no money invented, none lost, and no unique-index collision.
    expect(
      after.allocations.map((a) => `${a.platform}|${a.objective}|${a.plannedSpend}`).sort(),
    ).toEqual(["instagram|Awareness|250", "instagram|Other|1000"]);
    expect(after.allocations.reduce((s, a) => s + a.plannedSpend, 0)).toBeCloseTo(1250, 4);
    expect(after.plannedRevenueSar).toBe(12_000);
  });

  it("still fails LOUDLY on a snapshot that is not a valid plan", async () => {
    await saveBudgetMonth(PLAN_A);
    await db.insert(budgetPlanRevisions).values({
      accountId: ACCOUNT_A,
      month: "2026-01-01",
      snapshot: {
        // A platform that no longer exists can't be folded into anything.
        allocations: [{ platform: "myspace", objective: "Awareness", plannedSpend: 10 }],
        plannedRevenueSar: null,
        reserveSpendUsd: 0,
        dayWeights: {},
      },
      note: "bad-platform",
      savedBy: USER,
    });
    const [bad] = await db
      .select({ id: budgetPlanRevisions.id })
      .from(budgetPlanRevisions)
      .where(
        and(
          eq(budgetPlanRevisions.accountId, ACCOUNT_A),
          eq(budgetPlanRevisions.note, "bad-platform"),
        ),
      );

    const res = await restorePlanRevision({ revisionId: bad!.id });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/can't be restored/i);
    // The live plan is exactly what it was — no partial application.
    const after = await getBudgetMonth(MONTH);
    expect(after.allocations).toHaveLength(2);
    expect(after.plannedRevenueSar).toBe(25_000);
  });

});

describe("DAILY plans — the upload path, one writer, one mode at a time", () => {
  /** A daily upload as the dialog sends it (allocations empty on purpose). */
  const upload = (
    days: Array<{ day: number; platform: string; objective: string; plannedSpend: number }>,
    over: Record<string, unknown> = {},
  ) => ({
    month: MONTH,
    mode: "daily",
    source: "upload",
    days,
    allocations: [],
    plannedRevenueSar: null,
    reserveSpendUsd: 300,
    targetRoas: 2,
    dayWeights: [],
    note: "Uploaded from file",
    ...over,
  });
  const DAYS = [
    { day: 1, platform: "instagram", objective: "Awareness", plannedSpend: 100.1 },
    { day: 2, platform: "instagram", objective: "Awareness", plannedSpend: 0.2 },
    { day: 2, platform: "tiktok", objective: "Other", plannedSpend: 50 },
    { day: 31, platform: "tiktok", objective: "Other", plannedSpend: 49.7 },
  ];
  const sortCells = (cells: Array<{ day: number; platform: string; objective: string; plannedSpend: number }>) =>
    cells.map((c) => `${c.day}|${c.platform}|${c.objective}|${c.plannedSpend}`).sort();

  it("CONFIRM: days stored, mode + ROAS set, allocations = the SUMS, one revision", async () => {
    const res = await saveBudgetMonth(upload(DAYS));
    expect(res.ok).toBe(true);

    const data = await getBudgetMonth(MONTH);
    expect(data.planMode).toBe("daily");
    expect(data.targetRoas).toBe(2);
    expect(sortCells(data.planDays)).toEqual(sortCells(DAYS));
    // The invariant every monthly consumer relies on: allocations are the
    // cells' sums, derived by the writer (the client sent none).
    expect(data.allocations.map((a) => `${a.platform}|${a.objective}|${a.plannedSpend}`).sort()).toEqual([
      "instagram|Awareness|100.3",
      "tiktok|Other|99.7",
    ]);
    expect(data.reserveSpendUsd).toBe(300);
    // Revenue target = Σ cells × ROAS × rate (fixtures' brand rate).
    expect(data.plannedRevenueSar).toBeCloseTo(200 * 2 * data.usdToSarRate, 2);

    const revs = await listPlanRevisions(MONTH);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.mode).toBe("daily");
    expect(revs[0]!.dayCells).toBe(4);
    expect(revs[0]!.plannedTotal).toBeCloseTo(200, 2);
  });

  it("planSeriesForMonth: a daily month's sums equal its cells", async () => {
    await saveBudgetMonth(upload(DAYS));
    const series = await planSeriesForMonth(MONTH);
    expect(series.mode).toBe("daily");
    const days = series.spendDays();
    expect(days).toHaveLength(31);
    expect(days[1]).toBeCloseTo(50.2, 9);
    expect(series.spendToDate(0, 31)).toBeCloseTo(200, 9);
    expect(series.spendToDate(0, 2, (p) => p === "instagram")).toBeCloseTo(100.3, 9);
  });

  it("planSeriesForMonth: a curve month is the curve (regression)", async () => {
    await saveBudgetMonth(PLAN_A); // 1500 allocated, day 15 ×2, revenue 25k
    const series = await planSeriesForMonth(MONTH);
    expect(series.mode).toBe("curve");
    // 31 days, weights sum 32: day 15 carries 2/32 of the plan.
    expect(series.spendDays()[14]).toBeCloseTo((1500 * 2) / 32, 9);
    expect(series.revenueToDate(31)).toBeCloseTo(25_000, 6);
  });

  it("the stored day curve is left UNTOUCHED (dormant) by a daily write", async () => {
    await saveBudgetMonth(PLAN_A); // day 15 ×2
    await saveBudgetMonth(upload(DAYS));
    expect((await getBudgetMonth(MONTH)).dayWeightOverrides).toEqual({ 15: 2 });
  });

  it("ONE MODE AT A TIME: the editor can't save over a daily month", async () => {
    await saveBudgetMonth(upload(DAYS));
    const res = await saveBudgetMonth(PLAN_A);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("day by day");
    expect((await getBudgetMonth(MONTH)).planMode).toBe("daily");
  });

  it("re-upload to edit: a second sheet fully REPLACES the first's cells", async () => {
    await saveBudgetMonth(upload(DAYS));
    await saveBudgetMonth(upload([{ day: 5, platform: "google", objective: "Other", plannedSpend: 10 }]));
    const data = await getBudgetMonth(MONTH);
    expect(sortCells(data.planDays)).toEqual(["5|google|Other|10"]);
    expect(data.allocations).toHaveLength(1);
  });

  it("refuses a day past the month's end, and duplicate cells", async () => {
    const feb = await saveBudgetMonth(
      upload([{ day: 30, platform: "instagram", objective: "Awareness", plannedSpend: 1 }], {
        month: "2026-02",
      }),
    );
    expect(feb.ok).toBe(false);
    const dup = await saveBudgetMonth(upload([DAYS[0]!, DAYS[0]!]));
    expect(dup.ok).toBe(false);
    expect(await listPlanRevisions(MONTH)).toHaveLength(0);
  });

  it("CONVERT: collapses to monthly sums, linear curve, SAR target, curve mode", async () => {
    await saveBudgetMonth(PLAN_A); // leaves day 15 ×2 behind, dormant
    await saveBudgetMonth(upload(DAYS));
    const before = await getBudgetMonth(MONTH);

    const res = await convertPlanToCurve({ month: MONTH });
    expect(res.ok).toBe(true);
    const after = await getBudgetMonth(MONTH);
    expect(after.planMode).toBe("curve");
    expect(after.planDays).toEqual([]);
    expect(after.targetRoas).toBeNull();
    // The monthly totals survive exactly; the target becomes a plain SAR one.
    expect(after.allocations).toEqual(before.allocations.map((a) => ({ ...a, id: expect.any(String) })));
    expect(after.plannedRevenueSar).toBeCloseTo(before.plannedRevenueSar!, 2);
    expect(after.reserveSpendUsd).toBe(300);
    // LINEAR thereafter — the dormant curve does not come back.
    expect(after.dayWeightOverrides).toEqual({});

    // Nothing is lost: the daily revision is still there to restore.
    const revs = await listPlanRevisions(MONTH);
    expect(revs[0]!.mode).toBe("curve");
    expect(revs[0]!.note).toContain("collapsed");
    expect(revs[1]!.mode).toBe("daily");

    // Converting a curve month is refused.
    expect((await convertPlanToCurve({ month: MONTH })).ok).toBe(false);
  });

  it("RESTORE across modes: a daily revision comes back daily; a curve one, curve", async () => {
    await saveBudgetMonth(upload(DAYS));
    await convertPlanToCurve({ month: MONTH });
    const [curveRev, dailyRev] = await listPlanRevisions(MONTH);

    expect((await restorePlanRevision({ revisionId: dailyRev!.id })).ok).toBe(true);
    let data = await getBudgetMonth(MONTH);
    expect(data.planMode).toBe("daily");
    expect(sortCells(data.planDays)).toEqual(sortCells(DAYS));
    expect(data.targetRoas).toBe(2);

    expect((await restorePlanRevision({ revisionId: curveRev!.id })).ok).toBe(true);
    data = await getBudgetMonth(MONTH);
    expect(data.planMode).toBe("curve");
    expect(data.planDays).toEqual([]);
  });

  it("a LEGACY snapshot (written before modes) restores as a curve month", async () => {
    await saveBudgetMonth(upload(DAYS));
    // Hand-write a pre-0048 snapshot: no mode, no days, no ROAS.
    await db.insert(budgetPlanRevisions).values({
      accountId: ACCOUNT_A,
      month: "2026-01-01",
      snapshot: {
        allocations: [{ platform: "facebook", objective: "Awareness", plannedSpend: 700 }],
        plannedRevenueSar: 9000,
        reserveSpendUsd: 0,
        dayWeights: { "3": 2 },
      },
      note: "legacy",
      savedBy: USER,
    });
    const legacy = (await listPlanRevisions(MONTH)).find((r) => r.note === "legacy")!;
    expect(legacy.mode).toBe("curve");
    expect((await restorePlanRevision({ revisionId: legacy.id })).ok).toBe(true);
    const data = await getBudgetMonth(MONTH);
    expect(data.planMode).toBe("curve");
    expect(data.planDays).toEqual([]);
    expect(data.dayWeightOverrides).toEqual({ 3: 2 });
    expect(data.plannedRevenueSar).toBe(9000);
  });

  it("COPY of a daily month copies its days + mode (days past the end dropped)", async () => {
    await saveBudgetMonth(upload(DAYS)); // January: has a day-31 cell
    const res = await copyBudgetFromMonth({ month: "2026-02", from: MONTH });
    expect(res.ok).toBe(true);
    const feb = await getBudgetMonth("2026-02");
    expect(feb.planMode).toBe("daily");
    expect(feb.targetRoas).toBe(2);
    expect(sortCells(feb.planDays)).toEqual(sortCells(DAYS.filter((d) => d.day <= 28)));
    // Allocations re-derived from the days that SURVIVED (49.7 on day 31 is gone).
    expect(feb.allocations.find((a) => a.platform === "tiktok")!.plannedSpend).toBe(50);
    const revs = await listPlanRevisions("2026-02");
    expect(revs[0]!.mode).toBe("daily");
  });

  it("COPY of a curve month over a daily one makes it a curve month again", async () => {
    await saveBudgetMonth({ ...PLAN_A, month: "2026-03" });
    await saveBudgetMonth(upload(DAYS));
    expect((await copyBudgetFromMonth({ month: MONTH, from: "2026-03" })).ok).toBe(true);
    const data = await getBudgetMonth(MONTH);
    expect(data.planMode).toBe("curve");
    expect(data.planDays).toEqual([]);
  });

  it("budgetPlansForMonths carries the mode and cells for Pacing", async () => {
    await saveBudgetMonth(upload(DAYS));
    await saveBudgetMonth({ ...PLAN_A, month: "2026-02" });
    const [jan, feb] = await budgetPlansForMonths(["2026-01", "2026-02"]);
    expect(jan!.planMode).toBe("daily");
    expect(jan!.planDays).toHaveLength(4);
    expect(jan!.targetRoas).toBe(2);
    expect(feb!.planMode).toBe("curve");
    expect(feb!.planDays).toEqual([]);
  });

  it("dailyPlannedMonths lists the daily ones, account-scoped", async () => {
    await saveBudgetMonth(upload(DAYS));
    await saveBudgetMonth({ ...PLAN_A, month: "2026-02" });
    expect(await dailyPlannedMonths()).toEqual([MONTH]);
    setAccount(ACCOUNT_B);
    expect(await dailyPlannedMonths()).toEqual([]);
  });
});

describe("plannedMonths()", () => {
  it("lists every month with a plan, newest first, and is account-scoped", async () => {
    await saveBudgetMonth(PLAN_A); // 2026-01 (allocations + target)
    await saveBudgetMonth({
      month: "2026-03",
      allocations: [],
      plannedRevenueSar: 9_000, // a target-only month still counts
      reserveSpendUsd: 0,
      dayWeights: [],
    });

    expect(await plannedMonths()).toEqual(["2026-03", "2026-01"]);
    setAccount(ACCOUNT_B);
    expect(await plannedMonths()).toEqual([]);
  });
});
