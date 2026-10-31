import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * Two of the four sanctioned EXIT paths from `performance_records` (CLAUDE.md
 * Database rules): deleting a creative (exit 3) and deleting a campaign
 * (exit 4). Neither FK cascades, so each action removes the records itself
 * inside one transaction. Pinned through the real actions: exactly the
 * confirm summary's records go, the creatives of a deleted campaign stay,
 * the rules that targeted the deleted row go with it, and another brand's id
 * is refused before anything is touched.
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

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import {
  auditEvents,
  campaigns,
  creativeAngles,
  creatives,
  exclusionRules,
  performanceRecords,
} from "@/db/schema";
import { deleteCreative } from "@/app/actions/creative";
import { deleteCampaign } from "@/app/actions/campaign";
import { creativeDeletionSummary } from "@/db/queries/creatives";
import { campaignDeletionSummary } from "@/db/queries/campaign";
import {
  CAMPAIGN_1,
  CAMPAIGN_2,
  CAMPAIGN_B,
  CREATIVE_1,
  CREATIVE_2,
  CREATIVE_B,
  resetAndSeed,
} from "./fixtures";

// Fixture record ids (RESTART IDENTITY, insertion order):
//   1–2 CREATIVE_1·camp1 · 3 CREATIVE_1·camp2 · 4 CREATIVE_2·camp1 (excluded) · 5 B.
const recordIds = async () =>
  (await db.select({ id: performanceRecords.id }).from(performanceRecords)).map((r) => r.id).sort((a, b) => a - b);
const hasCreative = async (id: string) =>
  (await db.select({ id: creatives.id }).from(creatives).where(eq(creatives.id, id))).length === 1;
const hasCampaign = async (id: string) =>
  (await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id))).length === 1;
const ruleTargets = async () =>
  (await db.select({ c: exclusionRules.creativeId, k: exclusionRules.campaignId }).from(exclusionRules))
    .map((r) => r.c ?? r.k)
    .sort();
const audit = (action: string) => db.select().from(auditEvents).where(eq(auditEvents.action, action));

beforeEach(async () => {
  await resetAndSeed();
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
  await db.insert(creativeAngles).values([
    { creativeId: CREATIVE_1, angle: "Pain" },
    { creativeId: CREATIVE_2, angle: "Pain" },
  ]);
  await db.insert(exclusionRules).values([
    { accountId: ACCOUNT_A, kind: "creative", creativeId: CREATIVE_1, active: false, createdByUserId: USER },
    { accountId: ACCOUNT_A, kind: "creative", creativeId: CREATIVE_2, active: false, createdByUserId: USER },
    { accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_1, active: false, createdByUserId: USER },
    { accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_2, active: false, createdByUserId: USER },
  ]);
});

describe("deleteCreative — exit path 3", () => {
  it("removes exactly the records its confirm summary showed, then the creative", async () => {
    const summary = await creativeDeletionSummary(CREATIVE_1);
    expect(summary.records).toBe(3);

    const res = await deleteCreative(CREATIVE_1);
    expect(res).toEqual({ ok: true, recordsDeleted: summary.records });

    expect(await recordIds()).toEqual([4, 5]); // CREATIVE_2's row and B's sentinel survive
    expect(await hasCreative(CREATIVE_1)).toBe(false);
    expect(await hasCreative(CREATIVE_2)).toBe(true);
    // Angles cascade with the creative; a rule targeting it goes too.
    const angleRows = await db.select().from(creativeAngles);
    expect(angleRows.map((r) => r.creativeId)).toEqual([CREATIVE_2]);
    expect(await ruleTargets()).toEqual([CAMPAIGN_1, CAMPAIGN_2, CREATIVE_2].sort());
    const [row] = await audit("creative.delete");
    expect(row).toMatchObject({ accountId: ACCOUNT_A, entityId: CREATIVE_1, meta: { recordsDeleted: 3 } });
  });

  it("another brand's creative is not found — nothing is deleted", async () => {
    expect(await deleteCreative(CREATIVE_B)).toEqual({ ok: false, error: "Creative not found." });
    expect(await recordIds()).toEqual([1, 2, 3, 4, 5]);
    expect(await hasCreative(CREATIVE_B)).toBe(true);
    expect(await audit("creative.delete")).toHaveLength(0);
  });

  it("without creative.delete it refuses before the transaction", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Missing permission: creative.delete"));
    expect((await deleteCreative(CREATIVE_1)).ok).toBe(false);
    expect(await recordIds()).toEqual([1, 2, 3, 4, 5]);
    expect(await hasCreative(CREATIVE_1)).toBe(true);
  });
});

describe("deleteCampaign — exit path 4", () => {
  it("removes the campaign's records (excluded ones too) and KEEPS its creatives", async () => {
    const summary = await campaignDeletionSummary(CAMPAIGN_1);
    expect(summary).toMatchObject({ records: 3, creatives: 2 });

    const res = await deleteCampaign(CAMPAIGN_1);
    expect(res).toEqual({ ok: true, recordsDeleted: summary.records });

    expect(await recordIds()).toEqual([3, 5]); // camp2's row and B's sentinel survive
    expect(await hasCampaign(CAMPAIGN_1)).toBe(false);
    expect(await hasCampaign(CAMPAIGN_2)).toBe(true);
    expect(await hasCreative(CREATIVE_1)).toBe(true);
    expect(await hasCreative(CREATIVE_2)).toBe(true);
    expect(await ruleTargets()).toEqual([CAMPAIGN_2, CREATIVE_1, CREATIVE_2].sort());
    const [row] = await audit("campaign.delete");
    expect(row).toMatchObject({ accountId: ACCOUNT_A, entityId: CAMPAIGN_1, meta: { recordsDeleted: 3 } });
  });

  it("another brand's campaign is not found, and its summary is empty from here", async () => {
    expect((await campaignDeletionSummary(CAMPAIGN_B)).records).toBe(0);
    expect(await deleteCampaign(CAMPAIGN_B)).toEqual({ ok: false, error: "Campaign not found." });
    expect(await recordIds()).toEqual([1, 2, 3, 4, 5]);
    expect(await hasCampaign(CAMPAIGN_B)).toBe(true);
  });

  it("without campaign.delete it refuses before the transaction", async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new Error("Missing permission: campaign.delete"));
    expect((await deleteCampaign(CAMPAIGN_1)).ok).toBe(false);
    expect(await recordIds()).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a non-uuid id without touching the database", async () => {
    expect(await deleteCampaign("1 OR 1=1")).toEqual({ ok: false, error: "Invalid campaign id." });
    expect(await deleteCreative("not-a-uuid")).toEqual({ ok: false, error: "Invalid creative id." });
    expect(await recordIds()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("creativeDeletionSummary — scoped even when called with a foreign id", () => {
  it("counts nothing for brand B's creative from brand A", async () => {
    expect((await creativeDeletionSummary(CREATIVE_B)).records).toBe(0);
  });

  it("is brand-correct inside its own brand", async () => {
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_B);
    expect((await creativeDeletionSummary(CREATIVE_B)).records).toBe(1);
  });
});
