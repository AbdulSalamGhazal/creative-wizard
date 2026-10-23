import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A } from "./config";

/**
 * A campaign's platform is LOCKED once it has records (D9, 2026-10-23). Each
 * record carries its own platform; re-tagging the campaign (Holiday ➤ Broad
 * (IG) → (FB)) made the two disagree, and the old name's next upload hit
 * E061. Through the real action.
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

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns } from "@/db/schema";
import { updateCampaign } from "@/app/actions/campaign";
import { CAMPAIGN_PLATFORM_LOCKED } from "@/lib/campaign";
import { CAMPAIGN_1, resetAndSeed } from "./fixtures";

const EMPTY = "44444444-4444-4444-4444-4444444440e1";

beforeEach(async () => {
  await resetAndSeed();
  await db.insert(campaigns).values({
    id: EMPTY, accountId: ACCOUNT_A, name: "Fresh ➤ Broad (IG)", platform: "instagram",
    objective: "Sales", createdByUserId: USER,
  });
});

const row = async (id: string) =>
  (await db.select({ name: campaigns.name, platform: campaigns.platform }).from(campaigns).where(eq(campaigns.id, id)))[0]!;

describe("the campaign platform once records exist", () => {
  it("is refused, and nothing about the campaign changes", async () => {
    const res = await updateCampaign({
      id: CAMPAIGN_1, campaign: "Camp One", adset: "Broad", platform: "facebook", objective: "Sales",
    });
    expect(res).toMatchObject({ ok: false, error: CAMPAIGN_PLATFORM_LOCKED });
    expect(await row(CAMPAIGN_1)).toEqual({ name: "Camp One ➤ Broad (IG)", platform: "instagram" });
  });

  it("other edits to a campaign with records still save", async () => {
    const res = await updateCampaign({
      id: CAMPAIGN_1, campaign: "Camp One", adset: "Broad", platform: "instagram", objective: "Awareness",
    });
    expect(res).toMatchObject({ ok: true });
  });

  it("a campaign with no records can still change platform", async () => {
    const res = await updateCampaign({
      id: EMPTY, campaign: "Fresh", adset: "Broad", platform: "facebook", objective: "Sales",
    });
    expect(res).toMatchObject({ ok: true, name: "Fresh ➤ Broad (FB)" });
    expect((await row(EMPTY)).platform).toBe("facebook");
  });
});
