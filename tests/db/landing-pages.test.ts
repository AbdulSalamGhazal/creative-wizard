import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

// The actions are the unit under test, so only the auth boundary is faked.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { landingPages, performanceRecords, uploadBatches } from "@/db/schema";
import {
  createLandingPage,
  deleteLandingPage,
  updateLandingPage,
} from "@/app/actions/landing-page";
import { listLandingPages } from "@/db/queries/landing-pages";
import { creativeRecords } from "@/db/queries/creatives";
import { CAMPAIGN_1, CAMPAIGN_B, CREATIVE_1, CREATIVE_B, resetAndSeed } from "./fixtures";

const LP_A = "66666666-6666-6666-6666-6666666660a1";
const LP_B = "66666666-6666-6666-6666-6666666660b1";
const BATCH = "55555555-5555-5555-5555-5555555559a1";

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(landingPages).values([
    { id: LP_A, accountId: ACCOUNT_A, name: "Ramadan offer", code: "ramadan", url: "https://a.test/ramadan", createdByUserId: USER },
    { id: LP_B, accountId: ACCOUNT_B, name: "B page", code: "bpage", url: "https://b.test", createdByUserId: USER },
  ]);
  await db.insert(uploadBatches).values({
    id: BATCH, accountId: ACCOUNT_A, platform: "instagram", fileName: "lp.csv", uploadedByUserId: USER, rowsImported: 1,
  });
});

/** One account-A record for CREATIVE_1 / CAMPAIGN_1 on 2026-01-01 (the
 *  fixtures already hold its main-page row) — to the given landing page. */
const record = (landingPageId: string | null, accountId = ACCOUNT_A) => ({
  accountId,
  creativeId: accountId === ACCOUNT_A ? CREATIVE_1 : CREATIVE_B,
  platform: "instagram" as const,
  campaignId: accountId === ACCOUNT_A ? CAMPAIGN_1 : CAMPAIGN_B,
  date: "2026-01-01",
  landingPageId,
  spend: "5",
  impressions: 50,
  clicks: 5,
  rawPayload: {},
  uploadBatchId: BATCH,
});

/** Drizzle wraps the driver error; the Postgres code rides `cause`. */
const pgCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
};

describe("record identity includes the landing page (migration 0054)", () => {
  it("allows the same creative, campaign and day to a landing page beside the main page", async () => {
    await db.insert(performanceRecords).values(record(LP_A));
    const rows = await db
      .select({ id: performanceRecords.id })
      .from(performanceRecords)
      .where(eq(performanceRecords.creativeId, CREATIVE_1));
    expect(rows.length).toBe(4); // 3 fixture rows + this one
  });

  it("still rejects a second MAIN-page row for that day (NULLS NOT DISTINCT)", async () => {
    expect(await pgCode(db.insert(performanceRecords).values(record(null)))).toBe("23505");
  });

  it("rejects the same landing page twice for that day", async () => {
    await db.insert(performanceRecords).values(record(LP_A));
    expect(await pgCode(db.insert(performanceRecords).values(record(LP_A)))).toBe("23505");
  });
});

describe("landing-page actions", () => {
  it("creates one, forgiving a leading @, and refuses a case-only duplicate", async () => {
    const res = await createLandingPage({ name: "Eid", code: "@eid-2", url: "https://a.test/eid" });
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(landingPages).where(eq(landingPages.code, "eid-2"));
    expect(row?.accountId).toBe(ACCOUNT_A);
    expect(row?.description).toBeNull();

    const dup = await createLandingPage({ name: "Again", code: "RAMADAN", url: "https://a.test/x" });
    expect(dup.ok).toBe(false);
    expect(dup.fieldErrors?.code).toBe("Already in use");
  });

  it("lets the same code exist in another brand", async () => {
    const res = await createLandingPage({ name: "Mine", code: "bpage", url: "https://a.test/b" });
    expect(res.ok).toBe(true);
  });

  it("changes the code freely while unused, and locks it once a record points here", async () => {
    const free = await updateLandingPage({ id: LP_A, name: "Ramadan offer", code: "ramadan2", url: "https://a.test/ramadan" });
    expect(free.ok).toBe(true);

    await db.insert(performanceRecords).values(record(LP_A));
    const locked = await updateLandingPage({ id: LP_A, name: "Ramadan offer", code: "ramadan3", url: "https://a.test/ramadan" });
    expect(locked.ok).toBe(false);
    expect(locked.fieldErrors?.code).toBe("Locked");

    // Everything but the code stays editable.
    const renamed = await updateLandingPage({ id: LP_A, name: "Ramadan 2026", code: "ramadan2", url: "https://a.test/r26", description: "Hero offer" });
    expect(renamed.ok).toBe(true);
    const [row] = await db.select().from(landingPages).where(eq(landingPages.id, LP_A));
    expect(row).toMatchObject({ name: "Ramadan 2026", code: "ramadan2", url: "https://a.test/r26", description: "Hero offer" });
  });

  it("deletes only while unused", async () => {
    await db.insert(performanceRecords).values(record(LP_A));
    const refused = await deleteLandingPage(LP_A);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("1 record");

    await db.delete(performanceRecords).where(eq(performanceRecords.landingPageId, LP_A));
    expect((await deleteLandingPage(LP_A)).ok).toBe(true);
  });

  it("can't touch another brand's landing page", async () => {
    expect((await deleteLandingPage(LP_B)).ok).toBe(false);
    expect((await updateLandingPage({ id: LP_B, name: "x", code: "bpage", url: "https://b.test" })).ok).toBe(false);
  });
});

describe("landing-page reads", () => {
  it("lists the active brand's pages with their usage — never another brand's", async () => {
    await db.insert(performanceRecords).values(record(LP_A));
    const rows = await listLandingPages();
    expect(rows.map((r) => r.code)).toEqual(["ramadan"]);
    expect(rows[0]).toMatchObject({ creatives: 1, records: 1 });
  });

  it("carries the landing page on the creative's records (null = main page)", async () => {
    await db.insert(performanceRecords).values(record(LP_A));
    const rows = await creativeRecords(CREATIVE_1);
    const toPage = rows.filter((r) => r.landingPageCode === "ramadan");
    expect(toPage).toHaveLength(1);
    expect(toPage[0]?.landingPageName).toBe("Ramadan offer");
    expect(rows.filter((r) => r.landingPageCode === null)).toHaveLength(3);
  });
});
