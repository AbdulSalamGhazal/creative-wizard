import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The MANUAL writer of `excluded_from_aggregates` (exclusions.md: exactly two
 * writers — manual and rule). Through the real actions, so the provenance
 * stamp, the account scoping and the rule refusal are pinned where they live:
 * `excludeRecord` / `includeRecord` in app/actions/exclusion.ts.
 */
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

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

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { auditEvents, exclusionRules, performanceRecords } from "@/db/schema";
import { excludeRecord, includeRecord } from "@/app/actions/exclusion";
import { kpis } from "@/db/queries/performance";
import { CAMPAIGN_1, resetAndSeed } from "./fixtures";

// The fixtures insert with RESTART IDENTITY, so record ids follow insertion
// order: 1–2 A·instagram·camp1, 3 A·facebook·camp2, 4 A·excluded, 5 B.
const A_RECORD = 1; // spend 100
const B_RECORD = 5; // spend 777 — the isolation sentinel

const flag = async (id: number) =>
  (
    await db
      .select({
        excluded: performanceRecords.excludedFromAggregates,
        source: performanceRecords.excludedSource,
        ruleId: performanceRecords.excludedRuleId,
        reason: performanceRecords.excludedReason,
        by: performanceRecords.excludedByUserId,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.id, id))
  )[0]!;

const auditRows = (action: string) =>
  db.select().from(auditEvents).where(eq(auditEvents.action, action));

beforeEach(async () => {
  await resetAndSeed();
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
});

describe("excludeRecord — the manual writer", () => {
  it("stamps manual provenance and drops the row from aggregates", async () => {
    expect((await kpis({})).spend).toBeCloseTo(400, 4);

    const res = await excludeRecord(A_RECORD, "Test spend, not real");
    expect(res).toEqual({ ok: true });

    expect(await flag(A_RECORD)).toEqual({
      excluded: true,
      source: "manual",
      ruleId: null,
      reason: "Test spend, not real",
      by: USER,
    });
    expect((await kpis({})).spend).toBeCloseTo(300, 4);
    const [audit] = await auditRows("exclusion.exclude");
    expect(audit).toMatchObject({ accountId: ACCOUNT_A, entityId: String(A_RECORD) });
  });

  it("cannot reach another brand's record — B's row and the audit log stay untouched", async () => {
    const res = await excludeRecord(B_RECORD, "cross-brand");
    expect(res).toEqual({ ok: false, error: "Record not found" });
    expect(await flag(B_RECORD)).toMatchObject({ excluded: false, source: null });
    expect(await auditRows("exclusion.exclude")).toHaveLength(0);
  });

  it("refuses an already-excluded row, so a rule's row never flips to 'manual'", async () => {
    const [rule] = await db
      .insert(exclusionRules)
      .values({ accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_1, active: true, createdByUserId: USER })
      .returning();
    await db
      .update(performanceRecords)
      .set({ excludedFromAggregates: true, excludedSource: "rule", excludedRuleId: rule!.id })
      .where(eq(performanceRecords.id, A_RECORD));

    const res = await excludeRecord(A_RECORD, "overwrite me");
    expect(res).toEqual({ ok: false, error: "Already excluded." });
    expect(await flag(A_RECORD)).toMatchObject({ source: "rule", ruleId: rule!.id, reason: null });
  });

  it("requires a reason (1–200 chars) and writes nothing without one", async () => {
    expect((await excludeRecord(A_RECORD, "")).ok).toBe(false);
    expect((await excludeRecord(A_RECORD, "x".repeat(201))).ok).toBe(false);
    expect(await flag(A_RECORD)).toMatchObject({ excluded: false });
  });

  it("a caller without record.exclude is refused before any write", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Missing permission: record.exclude"));
    const res = await excludeRecord(A_RECORD, "no perm");
    expect(res.ok).toBe(false);
    expect(await flag(A_RECORD)).toMatchObject({ excluded: false });
  });
});

describe("includeRecord — the manual un-exclude", () => {
  it("clears every provenance column on a manual exclusion", async () => {
    await excludeRecord(A_RECORD, "temporary");
    const res = await includeRecord(A_RECORD);
    expect(res).toEqual({ ok: true });
    expect(await flag(A_RECORD)).toEqual({ excluded: false, source: null, ruleId: null, reason: null, by: null });
    expect((await kpis({})).spend).toBeCloseTo(400, 4);
  });

  it("refuses a rule's row and names the rule — the flag stays the rule's", async () => {
    const [rule] = await db
      .insert(exclusionRules)
      .values({ accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_1, active: true, createdByUserId: USER })
      .returning();
    await db
      .update(performanceRecords)
      .set({ excludedFromAggregates: true, excludedSource: "rule", excludedRuleId: rule!.id })
      .where(eq(performanceRecords.id, A_RECORD));

    const res = await includeRecord(A_RECORD);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Excluded by rule «.+» — deactivate the rule/);
    expect(await flag(A_RECORD)).toMatchObject({ excluded: true, source: "rule", ruleId: rule!.id });
  });

  it("cannot un-exclude another brand's record", async () => {
    await db
      .update(performanceRecords)
      .set({ excludedFromAggregates: true, excludedSource: "manual", excludedReason: "B's own call" })
      .where(and(eq(performanceRecords.accountId, ACCOUNT_B), eq(performanceRecords.id, B_RECORD)));

    const res = await includeRecord(B_RECORD);
    expect(res).toEqual({ ok: false, error: "Record not found" });
    expect(await flag(B_RECORD)).toMatchObject({ excluded: true, source: "manual", reason: "B's own call" });
    expect(await auditRows("exclusion.include")).toHaveLength(0);
  });
});
