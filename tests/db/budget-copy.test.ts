import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * "Copy from month" on a month with NO plan leaves the destination alone
 * (W1-9, audit B-11, 2026-10-23). Reachable through a stale Copy dialog after
 * someone deleted the source: the action said "has no plan to copy" while the
 * writer had already replaced the destination with nothing — committed, with
 * no revision to restore from. Through the real action, at pool size 1.
 */
const USER = "11111111-1111-1111-1111-111111111111";
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { copyBudgetFromMonth, saveBudgetMonth } from "@/app/actions/budget";
import { getBudgetMonth, listPlanRevisions } from "@/db/queries/budget";
import { resetAndSeed } from "./fixtures";

const DEST = "2026-03";
const PLAN = {
  month: DEST,
  allocations: [{ platform: "instagram", objective: "Awareness", plannedSpend: 1000 }],
  plannedRevenueSar: 20_000,
  reserveSpendUsd: 100,
  dayWeights: [{ day: 10, weight: 2 }],
};

beforeEach(async () => {
  await resetAndSeed();
});

describe("copy from a month with no plan", () => {
  it("refuses and leaves the destination exactly as it was", async () => {
    expect((await saveBudgetMonth(PLAN)).ok).toBe(true);
    const before = await getBudgetMonth(DEST);
    const revsBefore = await listPlanRevisions(DEST);

    const res = await copyBudgetFromMonth({ month: DEST, from: "2020-01" });
    expect(res).toEqual({ ok: false, error: "January 2020 has no plan to copy." });

    const after = await getBudgetMonth(DEST);
    // Before: 0 allocations, revenue null, reserve 0, weights gone — and no revision.
    expect(after.allocations.map((a) => a.plannedSpend)).toEqual([1000]);
    expect(after.plannedRevenueSar).toBe(20_000);
    expect(after.reserveSpendUsd).toBe(100);
    expect(after.dayWeightOverrides).toEqual(before.dayWeightOverrides);
    expect((await listPlanRevisions(DEST)).length).toBe(revsBefore.length);
  });

  it("a month WITH a plan still copies", async () => {
    expect((await saveBudgetMonth({ ...PLAN, month: "2026-02" })).ok).toBe(true);
    expect(await copyBudgetFromMonth({ month: DEST, from: "2026-02" })).toMatchObject({ ok: true });
    expect((await getBudgetMonth(DEST)).allocations.map((a) => a.plannedSpend)).toEqual([1000]);
  });
});
