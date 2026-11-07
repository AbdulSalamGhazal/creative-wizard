import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The audit → entity links (`audit_event_entities`, 2026-11): every writer
 * that affects a creative, a campaign or a budget month names it through
 * `writeAudit({ touches })`, resolved INSIDE its transaction BEFORE any
 * delete. Through the REAL actions and the REAL commit route, at production
 * pool size (a `db` query inside a transaction hangs a test here instead of
 * shipping). Plus the backfill migration's idempotency.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures
const actor = {
  id: ADMIN, email: "harness@test.local", name: "Harness", role: "admin" as const,
  permissions: null, allAccounts: true, avatarUrl: null,
};
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    auth: vi.fn(async () => actor),
    requireAuth: vi.fn(async () => actor),
    requirePermission: vi.fn(async () => actor),
  };
});
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(async () => ({ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 })),
  listAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  listAllAccounts: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  allowedAccountsForUser: vi.fn(async () => [{ id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 }]),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { readFileSync } from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  angles,
  auditEventEntities,
  auditEvents,
  campaigns,
  creativeAngles,
  exclusionRules,
  uploadBatches,
  uploadValidationSessions,
} from "@/db/schema";
import { AUDIT_ACTIONS, logAudit, writeAudit } from "@/lib/audit";
import { rollbackBatch } from "@/app/actions/rollback";
import { previewCleanupAction, runCleanup } from "@/app/actions/cleanup";
import { excludeRecord, includeRecord } from "@/app/actions/exclusion";
import {
  createExclusionRule,
  deleteExclusionRule,
  toggleExclusionRule,
} from "@/app/actions/exclusion-rules";
import { deleteCampaign, updateCampaign } from "@/app/actions/campaign";
import { deleteCreative, patchCreative } from "@/app/actions/creative";
import { commitBulkCreatives } from "@/app/actions/creative-bulk";
import { deleteAngle, renameAngle } from "@/app/actions/angle";
import { POST as commitRoute } from "@/app/api/uploads/commit/route";
import {
  CAMPAIGN_1,
  CAMPAIGN_2,
  CAMPAIGN_B,
  CREATIVE_1,
  CREATIVE_2,
  CREATIVE_B,
  resetAndSeed,
} from "./fixtures";

// Fixture records (account A, RESTART IDENTITY):
//   1 C1·K1·ig·01-01 · 2 C1·K1·ig·01-02 · 3 C1·K2·fb·01-01 · 4 C2·K1·ig·01-03 (excluded) · 5 B.

/** The latest event of an action, with its links grouped by type. */
async function latest(action: string) {
  const [ev] = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, action))
    .orderBy(desc(auditEvents.id))
    .limit(1);
  if (!ev) throw new Error(`no ${action} event`);
  const links = await db
    .select()
    .from(auditEventEntities)
    .where(eq(auditEventEntities.auditEventId, ev.id))
    .orderBy(asc(auditEventEntities.entityType), asc(auditEventEntities.entityId));
  const by = (t: string) => links.filter((l) => l.entityType === t).map((l) => l.entityId).sort();
  return {
    event: ev,
    accounts: [...new Set(links.map((l) => l.accountId))],
    creative: by("creative"),
    campaign: by("campaign"),
    budget_month: by("budget_month"),
  };
}

const sorted = (...ids: string[]) => [...ids].sort();

beforeEach(async () => {
  await resetAndSeed();
});

describe("writeAudit / logAudit", () => {
  it("links the event to itself and to its touches, deduped, in the event's brand", async () => {
    const id = await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_UPDATE,
      entityType: "creative",
      entityId: CREATIVE_1,
      actorUserId: ADMIN,
      accountId: ACCOUNT_B,
      touches: { creative: [CREATIVE_1, CREATIVE_2, CREATIVE_2], budget_month: ["2026-01-15"] },
    });
    expect(id).not.toBeNull();
    const l = await latest(AUDIT_ACTIONS.CREATIVE_UPDATE);
    expect(l.creative).toEqual(sorted(CREATIVE_1, CREATIVE_2));
    expect(l.budget_month).toEqual(["2026-01"]);
    expect(l.accounts).toEqual([ACCOUNT_B]);
  });

  it("a budget-plan event links its month by itself", async () => {
    await logAudit({
      action: AUDIT_ACTIONS.BUDGET_UPDATE,
      entityType: "budget",
      entityId: "2026-10-01",
      actorUserId: ADMIN,
    });
    expect((await latest(AUDIT_ACTIONS.BUDGET_UPDATE)).budget_month).toEqual(["2026-10"]);
  });

  it("an event with nothing to link writes no link rows", async () => {
    await logAudit({ action: AUDIT_ACTIONS.PRODUCT_CREATE, entityType: "product", entityId: "p", actorUserId: ADMIN });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from audit_event_entities`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });

  it("runs inside a caller's transaction on the one connection (no `db` inside)", async () => {
    await db.transaction((tx) =>
      writeAudit(tx, {
        action: AUDIT_ACTIONS.CAMPAIGN_UPDATE,
        entityType: "campaign",
        entityId: CAMPAIGN_1,
        accountId: ACCOUNT_A,
        touches: { creative: [CREATIVE_1] },
      }),
    );
    const l = await latest(AUDIT_ACTIONS.CAMPAIGN_UPDATE);
    expect(l.campaign).toEqual([CAMPAIGN_1]);
    expect(l.creative).toEqual([CREATIVE_1]);
  });
});

describe("record writers name what they touched", () => {
  it("upload.commit — creatives, campaigns and months of the rows it wrote", async () => {
    const row = (creativeName: string, campaignName: string, date: string) => ({
      rowNumber: 2, creativeName, landingCode: null, campaignName, date, spend: 1, impressions: 10,
      clicks: 1, conversions: 0, conversionValue: 0, landingPageViews: 0, addToCart: 0, addPayment: 0,
      videoViews2s: 0, videoViews25: 0, videoViews50: 0, videoViews75: 0, videoViews100: 0, rawPayload: {},
    });
    const rows = [
      row("A-Creative-1", "Camp One ➤ Broad (IG)", "2026-03-05"),
      row("A-Creative-2", "Camp One ➤ Broad (IG)", "2026-04-01"),
    ];
    const [s] = await db.insert(uploadValidationSessions).values({
      accountId: ACCOUNT_A, platform: "instagram", fileName: "touch.csv", uploadedByUserId: ADMIN,
      payload: { summary: { rows: 2, creatives: 2, dateRange: null }, rows, warnings: [] },
      expiresAt: new Date(Date.now() + 600_000),
    }).returning({ token: uploadValidationSessions.token });
    const res = await commitRoute(
      new NextRequest("http://localhost/api/uploads/commit", {
        method: "POST",
        body: JSON.stringify({ token: s!.token }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const l = await latest(AUDIT_ACTIONS.UPLOAD_COMMIT);
    expect(l.creative).toEqual(sorted(CREATIVE_1, CREATIVE_2));
    expect(l.campaign).toEqual([CAMPAIGN_1]);
    expect(l.budget_month).toEqual(["2026-03", "2026-04"]);
  });

  it("upload.rollback — captured from the records it deleted", async () => {
    const [batch] = await db.select({ id: uploadBatches.id }).from(uploadBatches)
      .where(eq(uploadBatches.accountId, ACCOUNT_A));
    expect(await rollbackBatch(batch!.id)).toEqual({ ok: true, removed: 4 });
    const l = await latest(AUDIT_ACTIONS.UPLOAD_ROLLBACK);
    expect(l.creative).toEqual(sorted(CREATIVE_1, CREATIVE_2));
    expect(l.campaign).toEqual(sorted(CAMPAIGN_1, CAMPAIGN_2));
    expect(l.budget_month).toEqual(["2026-01"]);
    expect(l.accounts).toEqual([ACCOUNT_A]);
  });

  it("upload.bulk_delete — the cleanup's deleted records", async () => {
    const filters = { platforms: ["facebook"] };
    const p = await previewCleanupAction(filters);
    expect(await runCleanup({ ...filters, expectedRows: p.preview!.rows })).toEqual({ ok: true, deleted: 1 });
    const l = await latest(AUDIT_ACTIONS.RECORDS_BULK_DELETE);
    expect(l.creative).toEqual([CREATIVE_1]);
    expect(l.campaign).toEqual([CAMPAIGN_2]);
    expect(l.budget_month).toEqual(["2026-01"]);
  });

  it("exclusion.exclude / include — the record's creative and campaign, no month", async () => {
    expect(await excludeRecord(3, "test")).toEqual({ ok: true });
    let l = await latest(AUDIT_ACTIONS.EXCLUSION_EXCLUDE);
    expect([l.creative, l.campaign, l.budget_month]).toEqual([[CREATIVE_1], [CAMPAIGN_2], []]);
    expect((l.event.meta as { campaignId: string }).campaignId).toBe(CAMPAIGN_2);

    expect(await includeRecord(4)).toEqual({ ok: true });
    l = await latest(AUDIT_ACTIONS.EXCLUSION_INCLUDE);
    expect([l.creative, l.campaign]).toEqual([[CREATIVE_2], [CAMPAIGN_1]]);
  });

  it("exclusion rules — create, switch off and delete each name the swept records; delete keeps the target", async () => {
    const created = await createExclusionRule({ target: { kind: "campaign", campaignId: CAMPAIGN_2 } });
    expect(created).toEqual({ ok: true, affected: 1 });
    let l = await latest(AUDIT_ACTIONS.EXCLUSION_RULE_CREATE);
    expect([l.creative, l.campaign]).toEqual([[CREATIVE_1], [CAMPAIGN_2]]);

    const [rule] = await db.select({ id: exclusionRules.id }).from(exclusionRules);
    expect(await toggleExclusionRule({ id: rule!.id, active: false })).toEqual({ ok: true, affected: 1 });
    l = await latest(AUDIT_ACTIONS.EXCLUSION_RULE_TOGGLE);
    expect([l.creative, l.campaign]).toEqual([[CREATIVE_1], [CAMPAIGN_2]]);

    await toggleExclusionRule({ id: rule!.id, active: true });
    expect(await deleteExclusionRule(rule!.id)).toEqual({ ok: true, affected: 1 });
    l = await latest(AUDIT_ACTIONS.EXCLUSION_RULE_DELETE);
    expect([l.creative, l.campaign]).toEqual([[CREATIVE_1], [CAMPAIGN_2]]);
    expect(l.event.meta).toMatchObject({ restored: 1, kind: "campaign", campaignId: CAMPAIGN_2 });
  });

  it("a creative rule on a creative with no records still links its target", async () => {
    const [extra] = await db.execute(sql`
      insert into creatives (account_id, name, product_id, type, created_by_user_id)
      select ${ACCOUNT_A}, 'No-Data', product_id, 'video', ${ADMIN} from creatives where id = ${CREATIVE_1}
      returning id`) as unknown as [{ id: string }];
    await createExclusionRule({ target: { kind: "creative", creativeId: extra!.id } });
    const l = await latest(AUDIT_ACTIONS.EXCLUSION_RULE_CREATE);
    expect([l.creative, l.campaign]).toEqual([[extra!.id], []]);
  });

  it("campaign.delete — the creatives that lost records, captured before the delete", async () => {
    expect(await deleteCampaign(CAMPAIGN_2)).toEqual({ ok: true, recordsDeleted: 1 });
    const l = await latest(AUDIT_ACTIONS.CAMPAIGN_DELETE);
    expect([l.campaign, l.creative, l.budget_month]).toEqual([[CAMPAIGN_2], [CREATIVE_1], ["2026-01"]]);
  });

  it("creative.delete — the campaigns that lost records", async () => {
    expect(await deleteCreative(CREATIVE_1)).toEqual({ ok: true, recordsDeleted: 3 });
    const l = await latest(AUDIT_ACTIONS.CREATIVE_DELETE);
    expect([l.creative, l.campaign]).toEqual([[CREATIVE_1], sorted(CAMPAIGN_1, CAMPAIGN_2)]);
  });
});

describe("entity writers record the other side", () => {
  it("campaign.update — an objective re-sweep links the creatives it moved; a platform change keeps the old one", async () => {
    await createExclusionRule({ target: { kind: "campaign_objective", objective: "Sales" } });
    const res = await updateCampaign({
      id: CAMPAIGN_2, campaign: "Camp Two", adset: "Broad", platform: "facebook", objective: "Awareness",
    });
    expect(res).toMatchObject({ ok: true });
    let l = await latest(AUDIT_ACTIONS.CAMPAIGN_UPDATE);
    expect([l.campaign, l.creative]).toEqual([[CAMPAIGN_2], [CREATIVE_1]]);

    const EMPTY = "44444444-4444-4444-4444-4444444440e1";
    await db.insert(campaigns).values({
      id: EMPTY, accountId: ACCOUNT_A, name: "Fresh ➤ Broad (IG)", platform: "instagram",
      objective: "Sales", createdByUserId: ADMIN,
    });
    await updateCampaign({ id: EMPTY, campaign: "Fresh", adset: "Broad", platform: "facebook", objective: "Sales" });
    l = await latest(AUDIT_ACTIONS.CAMPAIGN_UPDATE);
    expect(l.event.meta).toMatchObject({ platform: "facebook", platformChangedFrom: "instagram" });
    expect([l.campaign, l.creative]).toEqual([[EMPTY], []]);
  });

  it("creative.update — stages from→to and the angles added and removed", async () => {
    await db.insert(creativeAngles).values([
      { creativeId: CREATIVE_1, angle: "Pain" },
      { creativeId: CREATIVE_1, angle: "Old" },
    ]);
    const res = await patchCreative({ id: CREATIVE_1, stages: ["Awareness"], angles: ["Pain", "Hook"] });
    expect(res).toMatchObject({ ok: true });
    const l = await latest(AUDIT_ACTIONS.CREATIVE_UPDATE);
    expect(l.creative).toEqual([CREATIVE_1]);
    expect(l.event.meta).toMatchObject({
      changes: { stages: { from: [], to: ["Awareness"] } },
      anglesCount: 2,
      anglesAdded: ["Hook"],
      anglesRemoved: ["Old"],
    });
  });

  it("creative.bulk_create — every new creative by id", async () => {
    const fd = new FormData();
    fd.set("file", new File([["name,product,type", "Bulk-1,Product A,video", "Bulk-2,Product A,image"].join("\n")], "c.csv", { type: "text/csv" }));
    expect(await commitBulkCreatives(fd)).toMatchObject({ ok: true, created: 2 });
    const ids = (await db.execute(sql`select id from creatives where name like 'Bulk-%' order by id`)) as unknown as Array<{ id: string }>;
    const l = await latest(AUDIT_ACTIONS.CREATIVE_BULK_CREATE);
    expect(l.creative).toEqual(ids.map((r) => r.id).sort());
  });

  it("angle.rename / delete — the creatives holding the angle, never another brand's", async () => {
    await db.insert(angles).values([
      { accountId: ACCOUNT_A, name: "Pain", createdByUserId: ADMIN },
      { accountId: ACCOUNT_B, name: "Pain", createdByUserId: ADMIN },
    ]);
    await db.insert(creativeAngles).values([
      { creativeId: CREATIVE_1, angle: "Pain" },
      { creativeId: CREATIVE_2, angle: "Pain" },
      { creativeId: CREATIVE_B, angle: "Pain" },
    ]);
    const [a] = await db.select({ id: angles.id }).from(angles)
      .where(and(eq(angles.accountId, ACCOUNT_A), eq(angles.name, "Pain")));
    expect(await renameAngle(a!.id, "Pain v2")).toEqual({ ok: true });
    let l = await latest(AUDIT_ACTIONS.ANGLE_RENAME);
    expect(l.creative).toEqual(sorted(CREATIVE_1, CREATIVE_2));
    expect(l.accounts).toEqual([ACCOUNT_A]);

    expect(await deleteAngle(a!.id)).toEqual({ ok: true });
    l = await latest(AUDIT_ACTIONS.ANGLE_DELETE);
    expect(l.creative).toEqual(sorted(CREATIVE_1, CREATIVE_2));
  });
});

describe("the backfill (migration 0069)", () => {
  const BACKFILL = readFileSync(
    path.join(process.cwd(), "db/migrations/0069_backfill_audit_event_entities.sql"),
    "utf8",
  );
  const runBackfill = async () => {
    for (const stmt of BACKFILL.split("--> statement-breakpoint")) {
      if (stmt.replace(/--.*$/gm, "").trim()) await db.execute(sql.raw(stmt));
    }
  };
  const linkCount = async () =>
    ((await db.execute(sql`select count(*)::int as n from audit_event_entities`)) as unknown as [{ n: number }])[0].n;

  it("links old rows from what they stored, scoped to their brand, and a re-run adds nothing", async () => {
    const [batchA] = await db.select({ id: uploadBatches.id }).from(uploadBatches)
      .where(eq(uploadBatches.accountId, ACCOUNT_A));
    const [batchB] = await db.select({ id: uploadBatches.id }).from(uploadBatches)
      .where(eq(uploadBatches.accountId, ACCOUNT_B));
    // Legacy rows: written straight to audit_events, as before the links existed.
    const legacy = await db.insert(auditEvents).values([
      { accountId: ACCOUNT_A, action: "creative.update", entityType: "creative", entityId: CREATIVE_1 },
      { accountId: ACCOUNT_A, action: "campaign.delete", entityType: "campaign", entityId: CAMPAIGN_2 },
      { accountId: ACCOUNT_A, action: "budget.update", entityType: "budget", entityId: "2026-09-01" },
      { accountId: ACCOUNT_A, action: "budget.update", entityType: "budget", entityId: null },
      { accountId: ACCOUNT_A, action: "exclusion.exclude", entityType: "exclusion", entityId: "4", meta: { creativeId: CREATIVE_2 } },
      { accountId: ACCOUNT_A, action: "upload.commit", entityType: "upload", entityId: batchA!.id },
      { accountId: ACCOUNT_B, action: "upload.commit", entityType: "upload", entityId: batchB!.id },
      { accountId: ACCOUNT_A, action: "upload.commit", entityType: "upload", entityId: null },
      { accountId: ACCOUNT_A, action: "upload.rollback", entityType: "upload", entityId: batchA!.id },
    ]).returning({ id: auditEvents.id, action: auditEvents.action, accountId: auditEvents.accountId });

    await runBackfill();
    const first = await linkCount();
    await runBackfill();
    expect(await linkCount()).toBe(first);

    const linksOf = async (i: number) =>
      (await db.select().from(auditEventEntities).where(eq(auditEventEntities.auditEventId, legacy[i]!.id)))
        .map((l) => `${l.accountId === ACCOUNT_A ? "A" : "B"}:${l.entityType}:${l.entityId}`)
        .sort();
    expect(await linksOf(0)).toEqual([`A:creative:${CREATIVE_1}`]);
    expect(await linksOf(1)).toEqual([`A:campaign:${CAMPAIGN_2}`]);
    expect(await linksOf(2)).toEqual(["A:budget_month:2026-09"]);
    expect(await linksOf(3)).toEqual([]);
    expect(await linksOf(4)).toEqual([`A:creative:${CREATIVE_2}`]);
    expect(await linksOf(5)).toEqual(
      [
        `A:creative:${CREATIVE_1}`, `A:creative:${CREATIVE_2}`,
        `A:campaign:${CAMPAIGN_1}`, `A:campaign:${CAMPAIGN_2}`,
        "A:budget_month:2026-01",
      ].sort(),
    );
    expect(await linksOf(6)).toEqual(
      [`B:creative:${CREATIVE_B}`, `B:campaign:${CAMPAIGN_B}`, "B:budget_month:2026-01"].sort(),
    );
    expect(await linksOf(7)).toEqual([]);
    // A rollback's records are gone — unrecoverable, documented in the migration.
    expect(await linksOf(8)).toEqual([]);
  });

  it("links cascade away with their event", async () => {
    await logAudit({ action: AUDIT_ACTIONS.CREATIVE_UPDATE, entityType: "creative", entityId: CREATIVE_1 });
    expect(await linkCount()).toBe(1);
    await db.delete(auditEvents);
    expect(await linkCount()).toBe(0);
  });
});
