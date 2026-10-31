import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * Exit path 1 — batch rollback (app/actions/rollback.ts), through the real
 * action. wave1-small pins the concurrent-rollback race and wave3 the
 * notification; this file pins the boundaries: another brand's batch id, the
 * 24-hour window, and that the count reported is what was ACTUALLY removed.
 */
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const BATCH_A = "55555555-5555-5555-5555-555555555001"; // fixtures: 4 rows in A
const BATCH_B = "55555555-5555-5555-5555-5555555550b1"; // fixtures: 1 row in B

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

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, uploadBatches } from "@/db/schema";
import { rollbackBatch } from "@/app/actions/rollback";
import { ROLLBACK_WINDOW_HOURS } from "@/lib/upload-batches";
import { resetAndSeed } from "./fixtures";

const rowsOf = async (batchId: string) =>
  (await db.select({ id: performanceRecords.id }).from(performanceRecords).where(eq(performanceRecords.uploadBatchId, batchId))).length;
const statusOf = async (batchId: string) =>
  (await db.select({ s: uploadBatches.status }).from(uploadBatches).where(eq(uploadBatches.id, batchId)))[0]!.s;

beforeEach(async () => {
  await resetAndSeed();
});

describe("rollbackBatch — boundaries", () => {
  it("another brand's batch is not found — its rows and status survive", async () => {
    expect(await rollbackBatch(BATCH_B)).toEqual({ ok: false, error: "Batch not found." });
    expect(await rowsOf(BATCH_B)).toBe(1);
    expect(await statusOf(BATCH_B)).toBe("active");
  });

  it("a batch past the window is refused and nothing moves", async () => {
    const past = new Date(Date.now() - (ROLLBACK_WINDOW_HOURS * 3600 + 60) * 1000);
    await db.update(uploadBatches).set({ uploadedAt: past }).where(eq(uploadBatches.id, BATCH_A));

    const res = await rollbackBatch(BATCH_A);
    expect(res).toEqual({
      ok: false,
      error: `Rollback window (${ROLLBACK_WINDOW_HOURS} h) has elapsed for this batch.`,
    });
    expect(await rowsOf(BATCH_A)).toBe(4);
    expect(await statusOf(BATCH_A)).toBe("active");
  });

  it("reports the rows it actually removed, not the batch's recorded rowsImported", async () => {
    // A cleanup removed one of the batch's four rows after the import.
    await db.delete(performanceRecords).where(eq(performanceRecords.id, 3));

    expect(await rollbackBatch(BATCH_A)).toEqual({ ok: true, removed: 3 });
    expect(await rowsOf(BATCH_A)).toBe(0);
    expect(await statusOf(BATCH_A)).toBe("rolled_back");
    expect(await rowsOf(BATCH_B)).toBe(1);
  });

  it("a rolled-back batch can't be rolled back again", async () => {
    await rollbackBatch(BATCH_A);
    expect(await rollbackBatch(BATCH_A)).toEqual({ ok: false, error: "Batch is not active." });
  });
});
