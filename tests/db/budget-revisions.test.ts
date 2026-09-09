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
  copyBudgetFromMonth,
  restorePlanRevision,
  saveBudgetMonth,
} from "@/app/actions/budget";
import { getBudgetMonth, listPlanRevisions, plannedMonths } from "@/db/queries/budget";
import { resetAndSeed } from "./fixtures";

const MONTH = "2026-01";
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

const PLAN_A = {
  month: MONTH,
  allocations: [
    { platform: "instagram", objective: "Sales", plannedSpend: 1000 },
    { platform: "facebook", objective: "Awareness", plannedSpend: 500 },
  ],
  plannedRevenueSar: 25_000,
  reserveSpendUsd: 250,
  dayWeights: [{ day: 15, weight: 2 }],
};

const PLAN_B = {
  month: MONTH,
  allocations: [{ platform: "tiktok", objective: "Prospecting", plannedSpend: 800 }],
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
    ).toEqual(["facebook|Awareness|500", "instagram|Sales|1000"]);
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

  it("fails LOUDLY on a snapshot whose vocabulary no longer validates", async () => {
    await saveBudgetMonth(PLAN_A);
    // A snapshot written before an objective was retired: structurally fine,
    // but planSchema must refuse it rather than half-applying the rest.
    await db.insert(budgetPlanRevisions).values({
      accountId: ACCOUNT_A,
      month: "2026-01-01",
      snapshot: {
        allocations: [
          { platform: "instagram", objective: "Sales", plannedSpend: 10 },
          { platform: "instagram", objective: "Video Views", plannedSpend: 90 },
        ],
        plannedRevenueSar: null,
        reserveSpendUsd: 0,
        dayWeights: {},
      },
      note: "legacy",
      savedBy: USER,
    });
    const [stale] = await db
      .select({ id: budgetPlanRevisions.id })
      .from(budgetPlanRevisions)
      .where(
        and(
          eq(budgetPlanRevisions.accountId, ACCOUNT_A),
          eq(budgetPlanRevisions.note, "legacy"),
        ),
      );

    const res = await restorePlanRevision({ revisionId: stale!.id });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/can't be restored/i);
    // The live plan is exactly what it was — no partial application.
    const after = await getBudgetMonth(MONTH);
    expect(after.allocations).toHaveLength(2);
    expect(after.plannedRevenueSar).toBe(25_000);
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
