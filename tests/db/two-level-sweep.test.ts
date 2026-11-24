import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The sweep after the campaign / ad set split (2026-11-24). Each block pins
 * one place that still treated the two levels as one:
 *
 *  - E060 asked only the stored RECORDS, never the REGISTRY;
 *  - a list's Creatives total summed its rows;
 *  - an ad-set row could not name its campaign;
 *  - searching the Campaigns list returned partial campaigns;
 *  - the cleanup tool could not pick a whole campaign;
 *  - a whole-campaign rule was missing from the campaign's Activity, and a
 *    campaign's rename from its ad sets'.
 */
vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import { performanceRecords } from "@/db/schema";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { campaignPlatformCollisions } from "@/csv/cross-platform";
import { adSetNamesOnOtherPlatforms } from "@/db/queries/campaign";
import { listAccountParentCampaigns, previewCleanup } from "@/db/queries/cleanup";
import { entityActivityPage } from "@/db/queries/entity-activity";
import { campaignMix } from "@/db/queries/performance";
import { portfolioCampaignList, portfolioParentCampaignList } from "@/db/queries/portfolio";
import {
  BATCH_A,
  CAMPAIGN_1,
  CREATIVE_1,
  PARENT_1,
  PARENT_2,
  USER,
  perf,
  resetAndSeed,
  seedAdSet,
} from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const RANGE = { from: "2026-01-01", to: "2026-01-31" };
const LOOKALIKE = "44444444-4444-4444-4444-444444444077";

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

/** A second ad set under "Camp One", with one $50 day by CREATIVE_1. */
async function seedLookalike() {
  await seedAdSet({
    id: LOOKALIKE,
    accountId: ACCOUNT_A,
    campaign: "Camp One",
    adset: "Lookalike",
    platform: "instagram",
  });
  await db.insert(performanceRecords).values(
    perf({
      accountId: ACCOUNT_A,
      batchId: BATCH_A,
      creativeId: CREATIVE_1,
      platform: "instagram",
      campaignId: LOOKALIKE,
      date: "2026-01-01",
      spend: 50,
      impressions: 500,
      clicks: 50,
      conversions: 5,
      conversionValue: 100,
      landingPageViews: 100,
    }),
  );
}

describe("E060 asks the REGISTRY as well as the stored records", () => {
  it("a name registered on another platform, with no records yet, is found", async () => {
    // TikTok names carry no tag: a Snapchat file builds the very same name.
    const { name } = await seedAdSet({
      id: "44444444-4444-4444-4444-444444444078",
      accountId: ACCOUNT_A,
      campaign: "Launch",
      adset: "Broad",
      platform: "tiktok",
    });
    expect(name).toBe("Launch ➤ Broad");

    const found = await adSetNamesOnOtherPlatforms(ACCOUNT_A, [name], "snapchat");
    expect(found).toEqual([{ campaignName: name, platform: "tiktok" }]);
    const errors = campaignPlatformCollisions("snapchat", [name], found);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "E060", value: name });

    // Its own platform is no collision; another brand's registry is not asked.
    expect(await adSetNamesOnOtherPlatforms(ACCOUNT_A, [name], "tiktok")).toEqual([]);
    expect(await adSetNamesOnOtherPlatforms(ACCOUNT_B, [name], "snapchat")).toEqual([]);
  });

  it("still finds a name by its records, once per error", async () => {
    const name = "Camp One ➤ Broad (IG)";
    const found = await adSetNamesOnOtherPlatforms(ACCOUNT_A, [name], "facebook");
    // Records AND registry both say instagram — one error, not two.
    expect(found.every((f) => f.platform === "instagram")).toBe(true);
    expect(campaignPlatformCollisions("facebook", [name], found)).toHaveLength(1);
  });

  it("no names, no query", async () => {
    expect(await adSetNamesOnOtherPlatforms(ACCOUNT_A, [], "facebook")).toEqual([]);
  });
});

describe("an ad-set row names its campaign", () => {
  it("the Ad sets list carries the campaign and its network", async () => {
    const { rows } = await portfolioCampaignList({ ...RANGE });
    const byName = new Map(rows.map((r) => [r.campaign, r]));
    expect(byName.get("Camp One ➤ Broad (IG)")).toMatchObject({
      parentCampaign: "Camp One",
      network: "meta",
    });
    expect(byName.get("Camp Two ➤ Broad (FB)")).toMatchObject({
      parentCampaign: "Camp Two",
      network: "meta",
    });
  });

  it("a creative's ad-set breakdown does too", async () => {
    const mix = await campaignMix({ creativeIds: [CREATIVE_1], ...RANGE });
    expect(mix.map((m) => [m.campaign, m.parentCampaign, m.network]).sort()).toEqual([
      ["Camp One ➤ Broad (IG)", "Camp One", "meta"],
      ["Camp Two ➤ Broad (FB)", "Camp Two", "meta"],
    ]);
  });
});

describe("a list's Creatives total is a union, never a sum of its rows", () => {
  it("one creative in two ad sets counts once", async () => {
    const { rows, creativesTotal } = await portfolioCampaignList({ ...RANGE });
    // CREATIVE_1 ran in both ad sets: each row says 1, the footer says 1.
    expect(rows.reduce((s, r) => s + r.creatives, 0)).toBe(2);
    expect(creativesTotal).toBe(1);
  });

  it("follows the Excluded filter, at both levels", async () => {
    const adSets = await portfolioCampaignList({ ...RANGE, includeExcluded: true });
    expect(adSets.creativesTotal).toBe(2); // + CREATIVE_2's excluded row
    const hidden = await portfolioParentCampaignList({ ...RANGE });
    const shown = await portfolioParentCampaignList({ ...RANGE, includeExcluded: true });
    expect(hidden.creativesTotal).toBe(1);
    expect(shown.creativesTotal).toBe(2);
  });
});

describe("searching the Campaigns list keeps a found campaign WHOLE", () => {
  it("a campaign found by one ad set's name shows the sum of ALL its ad sets", async () => {
    await seedLookalike();
    const { rows } = await portfolioParentCampaignList({ ...RANGE, q: "Lookalike" });
    const withData = rows.filter((r) => r.hasData);
    expect(withData.map((r) => r.campaign)).toEqual(["Camp One"]);
    // Broad (IG) $200 + Lookalike $50 — not Lookalike's $50 alone.
    expect(withData[0]!.spend).toBeCloseTo(250, 4);
    expect(withData[0]!.adSets).toBe(2);
  });

  it("the Ad sets list still narrows to the matching ad set", async () => {
    await seedLookalike();
    const { rows } = await portfolioCampaignList({ ...RANGE, q: "Lookalike" });
    expect(rows.map((r) => r.campaign)).toEqual(["Camp One ➤ Lookalike (IG)"]);
    expect(rows[0]!.spend).toBeCloseTo(50, 4);
  });

  it("a search that matches nothing shows no numbers", async () => {
    const { rows, creativesTotal } = await portfolioParentCampaignList({
      ...RANGE,
      q: "no-such-thing",
    });
    expect(rows.filter((r) => r.hasData)).toEqual([]);
    expect(creativesTotal).toBe(0);
  });
});

describe("the cleanup tool picks a whole campaign", () => {
  it("a campaign is the records of every ad set under it", async () => {
    await seedLookalike();
    const p = await previewCleanup({ parentCampaignIds: [PARENT_1] });
    // Camp One: Broad (IG) 2 rows $200 + its excluded row $1000 + Lookalike $50.
    expect(p.rows).toBe(4);
    expect(p.spend).toBeCloseTo(1250, 4);
    expect((await previewCleanup({ parentCampaignIds: [PARENT_2] })).rows).toBe(1);
  });

  it("ANDs with the other pickers", async () => {
    await seedLookalike();
    const one = await previewCleanup({
      parentCampaignIds: [PARENT_1],
      campaigns: ["Camp One ➤ Lookalike (IG)"],
    });
    expect(one.rows).toBe(1);
    const none = await previewCleanup({
      parentCampaignIds: [PARENT_1],
      campaigns: ["Camp Two ➤ Broad (FB)"],
    });
    expect(none.rows).toBe(0);
  });

  it("another brand's campaign id matches nothing", async () => {
    setAccount(ACCOUNT_B);
    expect((await previewCleanup({ parentCampaignIds: [PARENT_1] })).rows).toBe(0);
  });

  it("lists the campaigns that have records, with their network", async () => {
    expect(await listAccountParentCampaigns()).toEqual([
      { id: PARENT_1, name: "Camp One", network: "meta" },
      { id: PARENT_2, name: "Camp Two", network: "meta" },
    ]);
    setAccount(ACCOUNT_B);
    expect((await listAccountParentCampaigns()).map((c) => c.name)).toEqual(["Camp B"]);
  });
});

describe("Activity at the two levels", () => {
  const event = (
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    entityType: "exclusion" | "parent_campaign",
    touches: { campaign?: string[]; parent_campaign?: string[] },
  ) =>
    writeAudit(db, {
      accountId: ACCOUNT_A,
      action,
      entityType,
      entityId: PARENT_1,
      entityLabel: "Camp One",
      actorUserId: USER,
      meta: {},
      touches,
    });

  it("a whole-campaign rule shows in the campaign's Activity; an ad set's exclusion does not", async () => {
    await event(AUDIT_ACTIONS.EXCLUSION_RULE_CREATE, "exclusion", { parent_campaign: [PARENT_1] });
    await event(AUDIT_ACTIONS.EXCLUSION_EXCLUDE, "exclusion", { campaign: [CAMPAIGN_1] });
    const { rows } = await entityActivityPage("parent_campaign", PARENT_1, null);
    expect(rows.map((r) => r.action)).toEqual([AUDIT_ACTIONS.EXCLUSION_RULE_CREATE]);
  });

  it("a campaign's rename shows in each ad set it renamed", async () => {
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_UPDATE, "parent_campaign", {
      parent_campaign: [PARENT_1],
      campaign: [CAMPAIGN_1],
    });
    const adSet = await entityActivityPage("campaign", CAMPAIGN_1, null);
    expect(adSet.rows.map((r) => r.action)).toEqual([AUDIT_ACTIONS.PARENT_CAMPAIGN_UPDATE]);
    const campaign = await entityActivityPage("parent_campaign", PARENT_1, null);
    expect(campaign.rows).toHaveLength(1);
  });
});
