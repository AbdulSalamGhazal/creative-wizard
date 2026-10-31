import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The PLAIN (insert) ads commit, through the REAL route handler — the only
 * entry path into `performance_records`. upload-commit.test.ts pins the
 * upsert branch; this file pins the insert branch: one parent batch per
 * commit, the session's brand (never the cookie's), single-use tokens, video
 * metrics NULL on non-video creatives, active rules stamped in the same
 * transaction, and ALL-OR-NOTHING when the database refuses one row.
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
const BOTH = [
  { id: ACCOUNT_A, name: "Account A", slug: "a", statusWindowHours: 24 },
  { id: ACCOUNT_B, name: "Account B", slug: "b", statusWindowHours: 24 },
];
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  // The COOKIE says brand B throughout: the session's brand must win.
  getActiveAccountId: vi.fn(async () => ACCOUNT_B),
  getActiveAccount: vi.fn(async () => BOTH[1]),
  listAccounts: vi.fn(async () => BOTH),
  listAllAccounts: vi.fn(async () => BOTH),
  allowedAccountsForUser: vi.fn(async () => BOTH),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  exclusionRules,
  performanceRecords,
  uploadBatches,
  uploadValidationSessions,
} from "@/db/schema";
import { POST as commitRoute } from "@/app/api/uploads/commit/route";
import { CAMPAIGN_1, CREATIVE_1, CREATIVE_2, resetAndSeed } from "./fixtures";

type Row = { creativeName: string; date: string; spend: number };
const parsedRow = (r: Row, i: number) => ({
  rowNumber: i + 2, creativeName: r.creativeName, landingCode: null, campaignName: "Camp One ➤ Broad (IG)",
  date: r.date, spend: r.spend, impressions: 100, clicks: 10, conversions: 1, conversionValue: 50,
  landingPageViews: 5, addToCart: 0, addPayment: 0, videoViews2s: 40, videoViews25: 30, videoViews50: 20,
  videoViews75: 10, videoViews100: 5, rawPayload: {},
});

/** A validated, not-yet-committed INSERT session for brand A. */
async function insertSession(rows: Row[], expiresInMs = 600_000) {
  const [s] = await db.insert(uploadValidationSessions).values({
    accountId: ACCOUNT_A, platform: "instagram", fileName: "zz-a06-insert.csv", uploadedByUserId: ADMIN,
    payload: {
      summary: { rows: rows.length, creatives: new Set(rows.map((r) => r.creativeName)).size, dateRange: null },
      rows: rows.map(parsedRow),
      warnings: [],
    },
    expiresAt: new Date(Date.now() + expiresInMs),
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
const counts = async () => ({
  records: (await db.select({ id: performanceRecords.id }).from(performanceRecords)).length,
  batches: (await db.select({ id: uploadBatches.id }).from(uploadBatches)).length,
});
const sessionExists = async (token: string) =>
  (await db.select().from(uploadValidationSessions).where(eq(uploadValidationSessions.token, token))).length === 1;

const NEW_ROWS: Row[] = [
  { creativeName: "A-Creative-1", date: "2026-02-01", spend: 11 }, // video
  { creativeName: "A-Creative-2", date: "2026-02-01", spend: 22 }, // image
];

beforeEach(async () => {
  await resetAndSeed();
});

describe("plain commit — one batch, the session's brand", () => {
  it("writes every row under ONE new parent batch, in brand A while the cookie says B", async () => {
    const res = await commit(await insertSession(NEW_ROWS));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ rowsImported: 2, rowsUpdated: 0, upsert: false });

    const [batch] = await db.select().from(uploadBatches).where(eq(uploadBatches.id, body.batchId));
    expect(batch).toMatchObject({ accountId: ACCOUNT_A, platform: "instagram", rowsImported: 2 });
    const rows = await db.select().from(performanceRecords).where(eq(performanceRecords.uploadBatchId, body.batchId));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.accountId).toBe(ACCOUNT_A);
      expect(r.campaignId).toBe(CAMPAIGN_1);
    }
  });

  it("video metrics land only on the video creative — NULL on the image", async () => {
    const res = await commit(await insertSession(NEW_ROWS));
    const { batchId } = await res.json();
    const rows = await db.select().from(performanceRecords).where(eq(performanceRecords.uploadBatchId, batchId));
    const byCreative = new Map(rows.map((r) => [r.creativeId, r]));
    expect(byCreative.get(CREATIVE_1)).toMatchObject({ videoViews2s: 40, videoViews100: 5 });
    expect(byCreative.get(CREATIVE_2)).toMatchObject({ videoViews2s: null, videoViews100: null });
  });

  it("an active rule stamps the new rows inside the same commit", async () => {
    const [rule] = await db.insert(exclusionRules).values({
      accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_1, active: true, createdByUserId: ADMIN,
    }).returning();
    const { batchId } = await (await commit(await insertSession(NEW_ROWS))).json();
    const rows = await db.select().from(performanceRecords).where(eq(performanceRecords.uploadBatchId, batchId));
    expect(rows.map((r) => [r.excludedFromAggregates, r.excludedSource, r.excludedRuleId])).toEqual([
      [true, "rule", rule!.id],
      [true, "rule", rule!.id],
    ]);
  });
});

describe("plain commit — the token", () => {
  it("is single-use: the second POST is a 410 and writes nothing", async () => {
    const token = await insertSession(NEW_ROWS);
    expect((await commit(token)).status).toBe(200);
    const after = await counts();
    const again = await commit(token);
    expect(again.status).toBe(410);
    expect(await counts()).toEqual(after);
  });

  it("an expired session is a 410 and writes nothing", async () => {
    const before = await counts();
    const res = await commit(await insertSession(NEW_ROWS, -1_000));
    expect(res.status).toBe(410);
    expect(await counts()).toEqual(before);
  });
});

describe("plain commit — all-or-nothing", () => {
  it("a creative removed after validate is a 422 naming it; the token survives for a retry", async () => {
    const token = await insertSession([{ creativeName: "Gone-Since-Validate", date: "2026-02-01", spend: 1 }, ...NEW_ROWS]);
    const before = await counts();
    const res = await commit(token);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ missing: ["Gone-Since-Validate"] });
    expect(await counts()).toEqual(before);
    expect(await sessionExists(token)).toBe(true);
  });

  it("one row the database refuses (a duplicate identity) rolls back the batch, every row and the claim", async () => {
    // Fixture record 1 is A-Creative-1 · instagram · camp1 · 2026-01-01 · no landing page.
    const token = await insertSession([...NEW_ROWS, { creativeName: "A-Creative-1", date: "2026-01-01", spend: 9 }]);
    const before = await counts();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await commit(token);
    errSpy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong while importing. No data was committed." });
    expect(await counts()).toEqual(before);
    expect(await sessionExists(token)).toBe(true);
  });
});
