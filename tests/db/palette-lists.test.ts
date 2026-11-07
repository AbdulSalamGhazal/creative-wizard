import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

const active = vi.hoisted(() => ({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }));
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => active.id),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { db } from "@/lib/db";
import { summaryViews } from "@/db/schema";
import { listPaletteCampaigns } from "@/db/queries/campaign";
import { listSavedViewOptions } from "@/db/queries/summary-views";
import { resetAndSeed } from "./fixtures";

/** The ⌘K palette's campaign and saved-view lists (R-027): brand-scoped. */
describe("palette lists", () => {
  beforeEach(async () => {
    active.id = ACCOUNT_A;
    await resetAndSeed();
  });

  it("lists only the active brand's campaigns, by name, with their platform", async () => {
    const a = await listPaletteCampaigns();
    expect(a.map((c) => c.name)).toEqual(["Camp One ➤ Broad (IG)", "Camp Two ➤ Broad (FB)"]);
    expect(a[0]!.platform).toBe("instagram");
    active.id = ACCOUNT_B;
    expect((await listPaletteCampaigns()).map((c) => c.name)).toEqual(["Camp B ➤ Broad (IG)"]);
  });

  it("lists the caller's own views across pages, in the active brand only", async () => {
    await db.insert(summaryViews).values([
      { accountId: ACCOUNT_A, ownerUserId: USER, name: "Winners", page: "summary", query: "rate=total:good" },
      { accountId: ACCOUNT_A, ownerUserId: USER, name: "Videos", page: "creatives", query: "types=video" },
      { accountId: ACCOUNT_B, ownerUserId: USER, name: "Other brand", page: "summary", query: "" },
    ]);
    const views = await listSavedViewOptions(USER);
    expect(views.map((v) => [v.name, v.page])).toEqual([
      ["Videos", "creatives"],
      ["Winners", "summary"],
    ]);
  });
});
