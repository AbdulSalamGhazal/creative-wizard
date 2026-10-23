import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * The ads commit is ALL-OR-NOTHING in upsert mode too (W1-8, audit B-10,
 * 2026-10-23). An upsert session fixes its matched record ids at validate
 * time; when one is removed before the commit (a rollback, a cleanup), its
 * UPDATE used to touch nothing and the route still answered 200 — the row
 * was neither updated nor inserted. Now the commit rolls back and says so.
 * Through the REAL route handler.
 */
const ADMIN = "11111111-1111-1111-1111-111111111111";
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

import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { performanceRecords, uploadValidationSessions } from "@/db/schema";
import { POST as commitRoute } from "@/app/api/uploads/commit/route";
import { CAMPAIGN_1, CREATIVE_1, resetAndSeed } from "./fixtures";

/** A 1-row upsert session whose row matched record `recordId` at validate time. */
async function upsertSession(recordId: number, spend: number) {
  const row = {
    rowNumber: 2, creativeName: "A-Creative-1", landingCode: null, campaignName: "Camp One ➤ Broad (IG)",
    date: "2026-01-01", spend, impressions: 10, clicks: 1, conversions: 0, conversionValue: 0,
    landingPageViews: 0, addToCart: 0, addPayment: 0, videoViews2s: 0, videoViews25: 0, videoViews50: 0,
    videoViews75: 0, videoViews100: 0, rawPayload: {},
  };
  const [s] = await db.insert(uploadValidationSessions).values({
    accountId: ACCOUNT_A, platform: "instagram", fileName: "upsert.csv", uploadedByUserId: ADMIN,
    payload: {
      summary: { rows: 1, creatives: 1, dateRange: null, upsert: true, newRows: 0, updatedRows: 1 },
      rows: [row], warnings: [], existingIds: [recordId],
    },
    expiresAt: new Date(Date.now() + 600_000),
  }).returning({ token: uploadValidationSessions.token });
  return s!.token;
}
const commit = (token: string) =>
  commitRoute(
    new NextRequest("http://localhost/api/uploads/commit", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "content-type": "application/json" },
    }),
  );
async function theRecord() {
  const [rec] = await db.select({ id: performanceRecords.id, spend: performanceRecords.spend })
    .from(performanceRecords)
    .where(and(
      eq(performanceRecords.creativeId, CREATIVE_1),
      eq(performanceRecords.campaignId, CAMPAIGN_1),
      eq(performanceRecords.date, "2026-01-01"),
    ))
    .limit(1);
  return rec;
}

beforeEach(async () => {
  await resetAndSeed();
});

describe("upsert commit", () => {
  it("updates the matched record in place", async () => {
    const rec = (await theRecord())!;
    const res = await commit(await upsertSession(rec.id, 123));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rowsUpdated: 1, rowsImported: 0, upsert: true });
    expect(Number((await theRecord())!.spend)).toBe(123);
  });

  it("refuses — and writes nothing — when a matched record vanished after validate", async () => {
    const rec = (await theRecord())!;
    const token = await upsertSession(rec.id, 123);
    // Between validate and commit, that record is removed (a rollback or a cleanup).
    await db.delete(performanceRecords).where(eq(performanceRecords.id, rec.id));

    const res = await commit(token);
    // Before: 200 {batchId:null, rowsImported:0, rowsUpdated:0} — "done", with the row lost.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Some records changed since validation. Validate the file again.",
    });
    const [{ n }] = (await db.execute(
      sql`select count(*)::int as n from performance_records where creative_id = ${CREATIVE_1} and date = '2026-01-01' and platform = 'instagram'`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});
