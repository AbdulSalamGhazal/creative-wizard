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

// Only the auth boundary is faked — validation, the upsert and the account
// scoping below it all run for real.
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { audienceSnapshots } from "@/db/schema";
import {
  deleteAudienceSnapshot,
  recordAudienceSnapshots,
  updateAudienceSnapshot,
} from "@/app/actions/audience";
import {
  audienceSnapshotSeries,
  latestAudienceSnapshots,
  recentAudienceSnapshots,
} from "@/db/queries/audience";
import { resetAndSeed } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

/** Write a snapshot straight to the table (bypassing the action's date guard,
 *  so a fixture can sit wherever the test needs it). */
async function seedSnapshot(
  accountId: string,
  platform: "instagram" | "facebook" | "tiktok" | "snapchat",
  stage: "Awareness" | "Activation" | "Retargeting",
  date: string,
  size: number,
) {
  await db.insert(audienceSnapshots).values({ accountId, platform, stage, date, size });
}

beforeEach(async () => {
  await resetAndSeed();
  await db.delete(audienceSnapshots);
  setAccount(ACCOUNT_A);
});

describe("audience snapshots — recording", () => {
  it("upserts on (account, platform, stage, date): re-measuring corrects, never duplicates", async () => {
    const first = await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [
        { platform: "instagram", stage: "Awareness", size: 100_000 },
        { platform: "facebook", stage: "Retargeting", size: 4_000 },
      ],
    });
    expect(first.ok).toBe(true);
    expect(first.recorded).toBe(2);

    const again = await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [{ platform: "instagram", stage: "Awareness", size: 111_000 }],
    });
    expect(again.ok).toBe(true);

    const rows = await db
      .select()
      .from(audienceSnapshots)
      .where(eq(audienceSnapshots.accountId, ACCOUNT_A));
    expect(rows).toHaveLength(2); // corrected in place, not appended
    const ig = rows.find((r) => r.platform === "instagram");
    expect(ig?.size).toBe(111_000);
  });

  it("a single cell is a complete record — untouched pairs write nothing", async () => {
    await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [{ platform: "tiktok", stage: "Activation", size: 25_000 }],
    });
    const rows = await db.select().from(audienceSnapshots);
    expect(rows).toHaveLength(1);
  });

  it("refuses the future, a bad date, a negative size and a duplicated pair", async () => {
    const future = await recordAudienceSnapshots({
      date: "2999-01-01",
      entries: [{ platform: "instagram", stage: "Awareness", size: 10 }],
    });
    expect(future.ok).toBe(false);

    const badDate = await recordAudienceSnapshots({
      date: "2026-02-30",
      entries: [{ platform: "instagram", stage: "Awareness", size: 10 }],
    });
    expect(badDate.ok).toBe(false);

    const negative = await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [{ platform: "instagram", stage: "Awareness", size: -1 }],
    });
    expect(negative.ok).toBe(false);

    const dupe = await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [
        { platform: "instagram", stage: "Awareness", size: 10 },
        { platform: "instagram", stage: "Awareness", size: 20 },
      ],
    });
    expect(dupe.ok).toBe(false);

    // "Other" is a budget bucket, not a funnel stage.
    const notAStage = await recordAudienceSnapshots({
      date: "2026-01-10",
      entries: [{ platform: "instagram", stage: "Other", size: 10 }],
    });
    expect(notAStage.ok).toBe(false);

    expect(await db.select().from(audienceSnapshots)).toHaveLength(0);
  });

  it("corrects and deletes only within the active account", async () => {
    await seedSnapshot(ACCOUNT_B, "instagram", "Awareness", "2026-01-05", 9_999);
    const [foreign] = await db
      .select()
      .from(audienceSnapshots)
      .where(eq(audienceSnapshots.accountId, ACCOUNT_B));

    setAccount(ACCOUNT_A);
    const update = await updateAudienceSnapshot({ id: foreign!.id, size: 1 });
    expect(update.ok).toBe(false); // another brand's row is simply not there

    const del = await deleteAudienceSnapshot({ id: foreign!.id });
    expect(del.ok).toBe(false);

    const [still] = await db
      .select()
      .from(audienceSnapshots)
      .where(eq(audienceSnapshots.id, foreign!.id));
    expect(still?.size).toBe(9_999);

    // The same operations DO work on the caller's own row.
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2026-01-05", 500);
    const [mine] = await db
      .select()
      .from(audienceSnapshots)
      .where(
        and(
          eq(audienceSnapshots.accountId, ACCOUNT_A),
          eq(audienceSnapshots.date, "2026-01-05"),
        ),
      );
    expect((await updateAudienceSnapshot({ id: mine!.id, size: 600 })).ok).toBe(true);
    expect((await deleteAudienceSnapshot({ id: mine!.id })).ok).toBe(true);
  });
});

describe("audience snapshots — reading", () => {
  it("seeds the range with the latest snapshot BEFORE it, one row per pair", async () => {
    // Two earlier measurements for the same pair: only the later one seeds.
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2025-11-01", 50_000);
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2025-12-20", 60_000);
    await seedSnapshot(ACCOUNT_A, "facebook", "Retargeting", "2025-12-28", 3_000);
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2026-01-15", 70_000);

    const { inRange, seed } = await audienceSnapshotSeries("2026-01-01", "2026-01-31");

    expect(inRange.map((r) => r.date)).toEqual(["2026-01-15"]);
    expect(seed).toHaveLength(2);
    const igSeed = seed.find((r) => r.platform === "instagram");
    expect(igSeed?.date).toBe("2025-12-20");
    expect(igSeed?.size).toBe(60_000); // the LATEST prior one, not the first
    expect(seed.find((r) => r.platform === "facebook")?.size).toBe(3_000);
  });

  it("scopes every read to the active account", async () => {
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2026-01-10", 100);
    await seedSnapshot(ACCOUNT_B, "instagram", "Awareness", "2026-01-10", 777);
    await seedSnapshot(ACCOUNT_B, "tiktok", "Activation", "2025-12-01", 888);

    const a = await audienceSnapshotSeries("2026-01-01", "2026-01-31");
    expect(a.inRange.map((r) => r.size)).toEqual([100]);
    expect(a.seed).toHaveLength(0); // B's December row must not seed A's range
    expect((await latestAudienceSnapshots()).map((r) => r.size)).toEqual([100]);

    setAccount(ACCOUNT_B);
    const b = await audienceSnapshotSeries("2026-01-01", "2026-01-31");
    expect(b.inRange.map((r) => r.size)).toEqual([777]);
    expect(b.seed.map((r) => r.size)).toEqual([888]);
    expect((await recentAudienceSnapshots()).map((r) => r.size)).toEqual([777, 888]);
  });

  it("latest = the newest measurement per pair, whenever it was taken", async () => {
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2025-06-01", 10);
    await seedSnapshot(ACCOUNT_A, "instagram", "Awareness", "2026-02-01", 20);
    await seedSnapshot(ACCOUNT_A, "instagram", "Activation", "2025-09-09", 30);

    const latest = await latestAudienceSnapshots();
    expect(latest).toHaveLength(2); // one per (platform, stage)
    expect(latest.find((r) => r.stage === "Awareness")?.size).toBe(20);
    expect(latest.find((r) => r.stage === "Activation")?.date).toBe("2025-09-09");
  });

  it("the corrections list is newest-first and bounded", async () => {
    for (let day = 1; day <= 12; day++) {
      const iso = `2026-01-${String(day).padStart(2, "0")}`;
      await seedSnapshot(ACCOUNT_A, "snapchat", "Awareness", iso, day * 10);
    }
    const rows = await recentAudienceSnapshots(5);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-01-12", "2026-01-11", "2026-01-10", "2026-01-09", "2026-01-08",
    ]);
  });
});
