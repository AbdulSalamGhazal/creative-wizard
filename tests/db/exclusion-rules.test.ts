import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { exclusionRules, performanceRecords } from "@/db/schema";
import {
  applyRule,
  unapplyRule,
  resweepActiveRules,
  previewRuleApply,
  previewRuleUnapply,
  stampAgainstActiveRules,
  deleteRulesTargeting,
  releaseStaleObjectiveStamps,
  listExclusionRules,
} from "@/db/queries/exclusion-rules";
import { campaigns } from "@/db/schema";
import { resetAndSeed, CAMPAIGN_1, CAMPAIGN_2, CREATIVE_1 } from "./fixtures";

// Fixture literals (fixtures.ts doesn't export these).
const USER = "11111111-1111-1111-1111-111111111111";
const BATCH_A = "55555555-5555-5555-5555-555555555001";
const setAccount = (id: string) =>
  vi.mocked(getActiveAccountId).mockResolvedValue(id);

/** Insert a rule row and return the engine-shaped rule. */
async function insertRule(over: {
  kind: "campaign_objective" | "campaign" | "creative";
  objective?: string | null;
  campaignId?: string | null;
  creativeId?: string | null;
  active?: boolean;
}) {
  const [row] = await db
    .insert(exclusionRules)
    .values({
      accountId: ACCOUNT_A,
      kind: over.kind,
      objective: (over.objective ?? null) as "Sales" | null,
      campaignId: over.campaignId ?? null,
      creativeId: over.creativeId ?? null,
      active: over.active ?? true,
      createdByUserId: USER,
    })
    .returning();
  return row!;
}

const flagsFor = async (accountId: string) =>
  db
    .select({
      id: performanceRecords.id,
      campaignId: performanceRecords.campaignId,
      excluded: performanceRecords.excludedFromAggregates,
      source: performanceRecords.excludedSource,
      ruleId: performanceRecords.excludedRuleId,
    })
    .from(performanceRecords)
    .where(eq(performanceRecords.accountId, accountId));

beforeEach(async () => {
  // Full reset per test — apply/unapply mutate flags, and cheap at this size.
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});
beforeAll(async () => {
  await resetAndSeed();
});

describe("exclusion rules engine — apply/unapply with provenance", () => {
  it("apply flags only not-yet-excluded matches; preview agrees; unapply restores only its own", async () => {
    // Fixtures: A has 3 non-excluded rows (2×camp1 IG, 1×camp2 FB) + 1 already
    // excluded (camp1, CREATIVE_2). All campaigns' objective = "Sales".
    const preview = await previewRuleApply({
      kind: "campaign_objective",
      objective: "Sales",
      campaignId: null,
      creativeId: null,
    });
    expect(preview.records).toBe(3); // the pre-excluded row is not double-counted

    const rule = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    const flipped = await applyRule(db, rule, ACCOUNT_A);
    expect(flipped).toBe(preview.records);

    const rows = await flagsFor(ACCOUNT_A);
    const ruleRows = rows.filter((r) => r.ruleId === rule.id);
    expect(ruleRows).toHaveLength(3);
    expect(ruleRows.every((r) => r.excluded && r.source === "rule")).toBe(true);
    // The fixture's pre-excluded row keeps its state, untouched by the rule.
    const pre = rows.find((r) => r.ruleId === null && r.excluded);
    expect(pre).toBeDefined();
    expect(pre!.source).toBeNull();

    // Unapply restores exactly the rule's rows.
    expect(await previewRuleUnapply(rule.id)).toMatchObject({ records: 3 });
    const restored = await unapplyRule(db, rule.id, ACCOUNT_A);
    expect(restored).toBe(3);
    const after = await flagsFor(ACCOUNT_A);
    expect(after.filter((r) => r.excluded)).toHaveLength(1); // just the fixture one
    expect(after.every((r) => r.ruleId === null)).toBe(true);
  });

  it("never overwrites a manual exclusion — and it survives the rule's unapply", async () => {
    // Manually exclude one camp1 row first (the action's write shape).
    const [manual] = await db
      .update(performanceRecords)
      .set({ excludedFromAggregates: true, excludedSource: "manual" })
      .where(
        and(
          eq(performanceRecords.accountId, ACCOUNT_A),
          eq(performanceRecords.campaignId, CAMPAIGN_1),
          eq(performanceRecords.excludedFromAggregates, false),
        ),
      )
      .returning({ id: performanceRecords.id });

    const rule = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    await applyRule(db, rule, ACCOUNT_A);

    const rows = await flagsFor(ACCOUNT_A);
    const manualRow = rows.find((r) => r.id === manual!.id)!;
    expect(manualRow.source).toBe("manual"); // not overwritten
    expect(manualRow.ruleId).toBeNull();

    await unapplyRule(db, rule.id, ACCOUNT_A);
    const after = await flagsFor(ACCOUNT_A);
    expect(after.find((r) => r.id === manual!.id)!.excluded).toBe(true); // still excluded
  });

  it("overlapping rules: a record keeps its FIRST rule; the second only takes the rest", async () => {
    const ruleA = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    await applyRule(db, ruleA, ACCOUNT_A); // takes camp1's 2 open rows

    const ruleB = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    const flippedB = await applyRule(db, ruleB, ACCOUNT_A);
    expect(flippedB).toBe(1); // only camp2's row was still open

    // Unapplying B leaves A's rows excluded.
    await unapplyRule(db, ruleB.id, ACCOUNT_A);
    const rows = await flagsFor(ACCOUNT_A);
    expect(rows.filter((r) => r.ruleId === ruleA.id)).toHaveLength(2);
    expect(rows.filter((r) => r.campaignId === CAMPAIGN_2 && r.excluded)).toHaveLength(0);
  });

  it("commit stamping: batch-scoped (strict) and id-scoped (upsert) both respect scope", async () => {
    const rule = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    // Simulate the commit route: stamp only rows of one batch.
    const flipped = await stampAgainstActiveRules(db, ACCOUNT_A, [
      eq(performanceRecords.uploadBatchId, BATCH_A),
    ]);
    expect(flipped).toBe(2); // camp1's two open rows (all fixture rows share BATCH_A)

    // Upsert path: re-stamping the same ids is a no-op (already excluded)…
    const ids = (await flagsFor(ACCOUNT_A)).map((r) => r.id);
    const again = await stampAgainstActiveRules(db, ACCOUNT_A, [
      inArray(performanceRecords.id, ids),
    ]);
    expect(again).toBe(0);
    // …and an INACTIVE rule stamps nothing.
    await db
      .update(exclusionRules)
      .set({ active: false })
      .where(eq(exclusionRules.id, rule.id));
    await unapplyRule(db, rule.id, ACCOUNT_A);
    expect(
      await stampAgainstActiveRules(db, ACCOUNT_A, [
        inArray(performanceRecords.id, ids),
      ]),
    ).toBe(0);
  });

  it("is account-scoped — an Account A rule never flags Account B's rows", async () => {
    const rule = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    await applyRule(db, rule, ACCOUNT_A);
    const bRows = await flagsFor(ACCOUNT_B);
    expect(bRows.some((r) => r.excluded)).toBe(false); // B's Sales row untouched

    setAccount(ACCOUNT_B);
    expect((await previewRuleUnapply(rule.id)).records).toBe(0); // B can't even see it
  });

  it("a drifted manual row (rule id still set) survives unapplyRule — manual always wins", async () => {
    // Pins the rule-then-direct-manual sequence: if a rule-excluded row ever
    // drifts to source='manual' (e.g. a historic write path), removing the
    // rule must NOT un-exclude it — unapply only touches source='rule' rows.
    const rule = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    await applyRule(db, rule, ACCOUNT_A); // camp1's 2 open rows

    const [drifted] = await db
      .update(performanceRecords)
      .set({ excludedSource: "manual" })
      .where(
        and(
          eq(performanceRecords.accountId, ACCOUNT_A),
          eq(performanceRecords.excludedRuleId, rule.id),
        ),
      )
      .returning({ id: performanceRecords.id });
    // (that set BOTH rows to manual; re-point one back to 'rule')
    await db
      .update(performanceRecords)
      .set({ excludedSource: "rule" })
      .where(eq(performanceRecords.id, drifted!.id));

    const restored = await unapplyRule(db, rule.id, ACCOUNT_A);
    expect(restored).toBe(1); // only the still-'rule' row

    const rows = await flagsFor(ACCOUNT_A);
    const manualDrift = rows.find((r) => r.source === "manual" && r.ruleId === rule.id);
    expect(manualDrift).toBeDefined();
    expect(manualDrift!.excluded).toBe(true); // survived the rule's removal
  });

  it("removing rule A re-sweeps: overlapping rows get re-stamped by rule B, not released", async () => {
    // Row matched by A (campaign) AND B (objective). Mimics
    // deleteExclusionRule's transaction: unapply A → delete A → resweep.
    const ruleA = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    await applyRule(db, ruleA, ACCOUNT_A); // camp1's rows stamped by A (first)
    const ruleB = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    await applyRule(db, ruleB, ACCOUNT_A); // camp2's row only

    await db.transaction(async (tx) => {
      await unapplyRule(tx, ruleA.id, ACCOUNT_A);
      await tx.delete(exclusionRules).where(eq(exclusionRules.id, ruleA.id));
      await resweepActiveRules(tx, ACCOUNT_A);
    });

    const rows = await flagsFor(ACCOUNT_A);
    const camp1Rows = rows.filter((r) => r.campaignId === CAMPAIGN_1 && r.ruleId !== null);
    expect(camp1Rows.length).toBeGreaterThan(0);
    // Still excluded — now stamped by B, the surviving rule.
    expect(camp1Rows.every((r) => r.excluded && r.ruleId === ruleB.id)).toBe(true);
  });

  it("deleteRulesTargeting removes a deleted entity's rules (deleteCampaign path)", async () => {
    const rule = await insertRule({ kind: "campaign", campaignId: CAMPAIGN_1 });
    const other = await insertRule({ kind: "creative", creativeId: CREATIVE_1 });
    await db.transaction(async (tx) => {
      // Mirrors deleteCampaign: records first, then the entity's rules.
      await unapplyRule(tx, rule.id, ACCOUNT_A);
      await tx
        .delete(performanceRecords)
        .where(eq(performanceRecords.campaignId, CAMPAIGN_1));
      const removed = await deleteRulesTargeting(tx, ACCOUNT_A, {
        campaignId: CAMPAIGN_1,
      });
      expect(removed).toBe(1);
    });
    const left = await db.select().from(exclusionRules);
    expect(left.map((r) => r.id)).toEqual([other.id]); // the creative rule survives
  });
});

/**
 * Editing a campaign's OBJECTIVE changes which `campaign_objective` rules cover
 * its records. `applyRule` only ever ADDS stamps, so without an explicit
 * release the flags go stale the moment someone re-classifies a campaign. These
 * pin the release + re-sweep pair `updateCampaign` runs in its transaction.
 */
describe("campaign objective edits re-derive exclusion stamps", () => {
  // Rows the FIXTURES ship already excluded (source is not 'rule'): the engine
  // must neither claim nor release these, so assertions look past them.
  let preExcluded = new Set<number>();
  beforeEach(async () => {
    preExcluded = new Set(
      (await flagsFor(ACCOUNT_A)).filter((r) => r.excluded).map((r) => r.id),
    );
  });

  /** What updateCampaign does transactionally when the objective changes. */
  async function moveObjective(campaignId: string, to: "Sales" | "Awareness") {
    return db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ objective: to })
        .where(eq(campaigns.id, campaignId));
      const released = await releaseStaleObjectiveStamps(tx, ACCOUNT_A, campaignId, to);
      const restamped = await resweepActiveRules(tx, ACCOUNT_A);
      return { released, restamped };
    });
  }

  it("moving INTO an excluded objective excludes the campaign's historical rows", async () => {
    // Rule excludes Awareness; both fixture campaigns are Sales, so it starts empty.
    const rule = await insertRule({ kind: "campaign_objective", objective: "Awareness" });
    expect(await applyRule(db, rule, ACCOUNT_A)).toBe(0);

    const { restamped } = await moveObjective(CAMPAIGN_1, "Awareness");
    expect(restamped).toBeGreaterThan(0);

    const rows = await flagsFor(ACCOUNT_A);
    // The fixtures carry one PRE-excluded row on this campaign; a rule never
    // overwrites an existing exclusion, so judge only the rows it could claim.
    const moved = rows.filter((r) => r.campaignId === CAMPAIGN_1 && !preExcluded.has(r.id));
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((r) => r.excluded && r.source === "rule" && r.ruleId === rule.id)).toBe(true);
    // The campaign that did NOT move is untouched.
    expect(rows.filter((r) => r.campaignId === CAMPAIGN_2).every((r) => !r.excluded)).toBe(true);
  });

  it("moving OUT of an excluded objective releases the rule-stamped rows", async () => {
    const rule = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    const flipped = await applyRule(db, rule, ACCOUNT_A);
    expect(flipped).toBeGreaterThan(0);

    const { released } = await moveObjective(CAMPAIGN_1, "Awareness");
    expect(released).toBeGreaterThan(0);

    const rows = await flagsFor(ACCOUNT_A);
    const moved = rows.filter((r) => r.campaignId === CAMPAIGN_1 && !preExcluded.has(r.id));
    expect(moved.every((r) => !r.excluded && r.source === null && r.ruleId === null)).toBe(true);
    // CAMPAIGN_2 is still Sales, so the rule still covers it.
    const stayed = rows.filter((r) => r.campaignId === CAMPAIGN_2);
    expect(stayed.every((r) => r.excluded && r.ruleId === rule.id)).toBe(true);
  });

  it("a MANUAL exclusion on the moved campaign survives the release", async () => {
    const rule = await insertRule({ kind: "campaign_objective", objective: "Sales" });
    await applyRule(db, rule, ACCOUNT_A);

    // Re-stamp one of the campaign's rows as a manual exclusion.
    const [target] = (await flagsFor(ACCOUNT_A)).filter((r) => r.campaignId === CAMPAIGN_1);
    await db
      .update(performanceRecords)
      .set({ excludedSource: "manual", excludedRuleId: null })
      .where(eq(performanceRecords.id, target!.id));

    await moveObjective(CAMPAIGN_1, "Awareness");

    const [after] = await db
      .select({
        excluded: performanceRecords.excludedFromAggregates,
        source: performanceRecords.excludedSource,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.id, target!.id));
    expect(after!.excluded).toBe(true); // manual exclusions are never released
    expect(after!.source).toBe("manual");
  });

  it("an UNRELATED rule's rows are never touched by an objective edit", async () => {
    // A creative rule covering CAMPAIGN_2's rows via CREATIVE_1.
    const creativeRule = await insertRule({ kind: "creative", creativeId: CREATIVE_1 });
    await applyRule(db, creativeRule, ACCOUNT_A);
    const before = (await flagsFor(ACCOUNT_A)).filter((r) => r.ruleId === creativeRule.id);
    expect(before.length).toBeGreaterThan(0);

    await moveObjective(CAMPAIGN_1, "Awareness");

    const after = (await flagsFor(ACCOUNT_A)).filter((r) => r.ruleId === creativeRule.id);
    // Same rows, still stamped by the creative rule.
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.every((r) => r.excluded && r.source === "rule")).toBe(true);
  });

  it("the rules page's live count follows the edit", async () => {
    const rule = await insertRule({ kind: "campaign_objective", objective: "Awareness" });
    const emptyList = await listExclusionRules();
    expect(emptyList.find((r) => r.id === rule.id)?.excludedCount ?? 0).toBe(0);

    await moveObjective(CAMPAIGN_1, "Awareness");

    const list = await listExclusionRules();
    expect(list.find((r) => r.id === rule.id)!.excludedCount).toBeGreaterThan(0);
  });
});

