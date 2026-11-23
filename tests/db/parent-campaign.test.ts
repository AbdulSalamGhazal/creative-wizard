import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * CAMPAIGNS ABOVE AD SETS (2026-11). A campaign is a `parent_campaigns` row;
 * its ad sets are the `campaigns` rows under it. Pinned here, against a real
 * database at production pool size (a `db` query inside a transaction would
 * hang the test):
 *  · the roll-up is the COMPONENT SUM of the ad sets' records, honours the
 *    Excluded filter and never crosses brands;
 *  · the registry-first reads (a campaign / an ad set with no data still
 *    shows);
 *  · create (campaign + ad sets), add, rename (every ad set follows) and
 *    delete (records, rules, ad sets — creatives kept), through the actions;
 *  · the backfill SQL of the `parent_campaigns_reconcile` migration reads a
 *    stored name EXACTLY as
 *    `parseCampaignName` does.
 */
const USER = "11111111-1111-1111-1111-111111111111"; // seeded by the fixtures

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  // A 24h window: only a platform's own latest spend day counts as Active.
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: vi.fn(async () => ({ id: USER, role: "admin" })),
  auth: vi.fn(async () => ({ id: USER, role: "admin" })),
  can: vi.fn(() => true),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveAccountId } from "@/lib/tenant";
import {
  auditEventEntities,
  auditEvents,
  campaigns,
  creatives,
  exclusionRules,
  parentCampaigns,
  performanceRecords,
} from "@/db/schema";
import {
  addAdSets,
  createParentCampaign,
  deleteParentCampaign,
  updateParentCampaign,
} from "@/app/actions/campaign";
import { portfolioParentCampaigns } from "@/db/queries/portfolio";
import {
  parentCampaignAdSets,
  parentCampaignDeletionSummary,
  parentCampaignMeta,
} from "@/db/queries/parent-campaign";
import { campaignAnalytics, campaignMeta } from "@/db/queries/campaign";
import { resolveAnchorPath } from "@/db/queries/comments";
import { adNetwork, parseCampaignName } from "@/lib/campaign";
import {
  BATCH_A,
  CAMPAIGN_1,
  CAMPAIGN_2,
  CREATIVE_1,
  CREATIVE_2,
  PARENT_1,
  PARENT_2,
  PARENT_B,
  resetAndSeed,
} from "./fixtures";

const RANGE = { from: "2026-01-01", to: "2026-01-31" };

/** A second ad set under "Camp One" (the Facebook half), with one record. */
const CAMPAIGN_1F = "44444444-4444-4444-4444-4444444440f1";
/** A registered ad set that has never run, under its own never-run campaign. */
const PARENT_NEW = "66666666-6666-6666-6666-6666666660e1";
const AD_SET_NEW = "44444444-4444-4444-4444-4444444440e1";

beforeEach(async () => {
  await resetAndSeed();
  vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_A);
  await db.insert(parentCampaigns).values({
    id: PARENT_NEW, accountId: ACCOUNT_A, name: "Fresh", network: "tiktok", createdByUserId: USER,
  });
  await db.insert(campaigns).values([
    { id: CAMPAIGN_1F, accountId: ACCOUNT_A, parentId: PARENT_1, adsetName: "Broad", name: "Camp One ➤ Broad (FB)", platform: "facebook", objective: "Prospecting", createdByUserId: USER },
    { id: AD_SET_NEW, accountId: ACCOUNT_A, parentId: PARENT_NEW, adsetName: "Broad", name: "Fresh ➤ Broad", platform: "tiktok", objective: "Sales", createdByUserId: USER },
  ]);
  // Camp One's Facebook ad set: spend 300 → revenue 300 (ROAS 1), Jan 2.
  await db.insert(performanceRecords).values({
    accountId: ACCOUNT_A, uploadBatchId: BATCH_A, creativeId: CREATIVE_2, platform: "facebook",
    campaignId: CAMPAIGN_1F, date: "2026-01-02", spend: "300", impressions: 1000, clicks: 10,
    conversions: 3, conversionValue: "300", landingPageViews: 30, rawPayload: {},
  });
});

const audit = (action: string) => db.select().from(auditEvents).where(eq(auditEvents.action, action));
const adSetNames = async (parentId: string) =>
  (
    await db
      .select({ name: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.parentId, parentId))
  )
    .map((r) => r.name)
    .sort();

describe("portfolioParentCampaigns — the Campaigns list", () => {
  it("rolls a campaign up from the SUMMED records of its ad sets, never from their ratios", async () => {
    const rows = await portfolioParentCampaigns({ ...RANGE });
    const one = rows.find((r) => r.campaignId === PARENT_1)!;
    // IG ad set 200 + FB ad set 300.
    expect(one.spend).toBeCloseTo(500, 4);
    expect(one.revenue).toBeCloseTo(1300, 4);
    // Σrevenue ÷ Σspend = 2.6 — the mean of the two ad sets' ROAS (5 and 1) is 3.
    expect(one.roas).toBeCloseTo(1300 / 500, 6);
    expect(one.ctr).toBeCloseTo(210 / 3000, 6);
    expect(one.adSets).toBe(2);
    expect(one.network).toBe("meta");
    expect(one.objectives).toEqual(["Sales", "Prospecting"]);
    expect([...one.platforms].sort()).toEqual(["facebook", "instagram"]);
    // One creative in each ad set — two distinct creatives, counted once each.
    expect(one.creatives).toBe(2);
    expect(one.hasData).toBe(true);
  });

  it("honours the Excluded filter", async () => {
    const hidden = (await portfolioParentCampaigns({ ...RANGE })).find((r) => r.campaignId === PARENT_1)!;
    const shown = (await portfolioParentCampaigns({ ...RANGE, includeExcluded: true })).find(
      (r) => r.campaignId === PARENT_1,
    )!;
    // The 1000-spend excluded record sits on Camp One's Instagram ad set.
    expect(shown.spend - hidden.spend).toBeCloseTo(1000, 4);
  });

  it("is active when ANY ad set is, by each platform's own latest day", async () => {
    const rows = await portfolioParentCampaigns({ ...RANGE });
    // Facebook's latest spend day is now Jan 2 (Camp One's FB ad set), so
    // Camp Two — last spend Jan 1 — is inactive; Camp One is live on both.
    expect(rows.find((r) => r.campaignId === PARENT_1)!.status).toBe("active");
    expect(rows.find((r) => r.campaignId === PARENT_2)!.status).toBe("inactive");
    const active = await portfolioParentCampaigns({ ...RANGE, statuses: ["active"] });
    expect(active.map((r) => r.campaignId)).toEqual([PARENT_1]);
  });

  it("lists a campaign that has never run, with no numbers — after the ones with data", async () => {
    const rows = await portfolioParentCampaigns({ ...RANGE });
    const fresh = rows.find((r) => r.campaignId === PARENT_NEW)!;
    expect(fresh).toMatchObject({ hasData: false, adSets: 1, status: "inactive", roas: null });
    expect(rows.indexOf(fresh)).toBe(rows.length - 1);
    // …held to the same filters, read off the registry.
    expect(
      (await portfolioParentCampaigns({ ...RANGE, platforms: ["instagram"] })).some(
        (r) => r.campaignId === PARENT_NEW,
      ),
    ).toBe(false);
    expect(
      (await portfolioParentCampaigns({ ...RANGE, q: "fres" })).map((r) => r.campaignId),
    ).toEqual([PARENT_NEW]);
  });

  it("a platform filter narrows the records the row totals", async () => {
    const one = (await portfolioParentCampaigns({ ...RANGE, platforms: ["facebook"] })).find(
      (r) => r.campaignId === PARENT_1,
    )!;
    expect(one.spend).toBeCloseTo(300, 4);
  });

  it("is account-scoped", async () => {
    const a = await portfolioParentCampaigns({ ...RANGE });
    expect(a.some((r) => r.campaignId === PARENT_B)).toBe(false);
    vi.mocked(getActiveAccountId).mockResolvedValue(ACCOUNT_B);
    const b = await portfolioParentCampaigns({ ...RANGE });
    expect(b.map((r) => r.campaignId)).toEqual([PARENT_B]);
    expect(b[0]!.spend).toBeCloseTo(777, 4);
  });
});

describe("a campaign's page reads — registry-first", () => {
  it("finds a campaign by network + name, with every registered ad set", async () => {
    const meta = (await parentCampaignMeta("meta", "Camp One"))!;
    expect(meta.id).toBe(PARENT_1);
    expect(meta.adSets.map((a) => a.name).sort()).toEqual([
      "Camp One ➤ Broad (FB)",
      "Camp One ➤ Broad (IG)",
    ]);
    expect(meta.status).toBe("active");
    expect(meta.creativeCount).toBe(2);
    // The same name on another network is another campaign — here, none.
    expect(await parentCampaignMeta("tiktok", "Camp One")).toBeNull();
    expect(await parentCampaignMeta("not-a-network", "Camp One")).toBeNull();
  });

  it("opens before any upload", async () => {
    const meta = (await parentCampaignMeta("tiktok", "Fresh"))!;
    expect(meta).toMatchObject({ hasRecords: false, creativeCount: 0, firstDate: null });
    expect(meta.adSets).toHaveLength(1);
    const rows = await parentCampaignAdSets(meta.id, RANGE);
    // The ad set that never ran is still a row — every figure null.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ adsetName: "Broad", spend: null, roas: null, creatives: 0 });
  });

  it("an AD SET with no records has a page too", async () => {
    const meta = (await campaignMeta("Fresh ➤ Broad"))!;
    expect(meta).toMatchObject({
      id: AD_SET_NEW,
      hasRecords: false,
      platforms: ["tiktok"],
      adsetName: "Broad",
      parent: { id: PARENT_NEW, name: "Fresh", network: "tiktok" },
    });
    expect(await campaignMeta("Nobody ➤ Here")).toBeNull();
  });

  it("the ad sets table and the campaign totals agree", async () => {
    const rows = await parentCampaignAdSets(PARENT_1, RANGE);
    const totals = (await campaignAnalytics({ parentId: PARENT_1 }, RANGE)).totals;
    expect(rows.reduce((s, r) => s + (r.spend ?? 0), 0)).toBeCloseTo(totals.spend ?? 0, 4);
    expect(totals.roas).toBeCloseTo(1300 / 500, 6);
    // Another brand's campaign id reads as empty here.
    expect(await parentCampaignAdSets(PARENT_B, RANGE)).toEqual([]);
  });
});

describe("a campaign as a comment / activity anchor", () => {
  it("resolves to its page by network + name, and refuses across brands", async () => {
    expect(await resolveAnchorPath("parent_campaign", PARENT_1, ACCOUNT_A)).toEqual({
      path: "/campaigns/meta/Camp%20One",
      label: "Camp One",
    });
    expect(await resolveAnchorPath("parent_campaign", PARENT_B, ACCOUNT_A)).toBeNull();
    // Its ad set still resolves under /ad-sets — the stored anchor key is `campaign`.
    expect((await resolveAnchorPath("campaign", CAMPAIGN_1, ACCOUNT_A))?.path).toBe(
      `/ad-sets/${encodeURIComponent("Camp One ➤ Broad (IG)")}`,
    );
  });
});

describe("createParentCampaign / addAdSets", () => {
  it("registers the campaign and its ad sets together — one row per platform", async () => {
    const res = await createParentCampaign({
      name: "Launch",
      network: "meta",
      adSets: [
        { name: "Broad", objective: "Sales", platforms: ["instagram", "facebook"] },
        { name: "Retarget 30d", objective: "Retargeting", platforms: ["instagram"] },
      ],
    });
    expect(res).toMatchObject({ ok: true, name: "Launch", network: "meta" });
    const [parent] = await db
      .select()
      .from(parentCampaigns)
      .where(and(eq(parentCampaigns.accountId, ACCOUNT_A), eq(parentCampaigns.name, "Launch")));
    expect(await adSetNames(parent!.id)).toEqual([
      "Launch ➤ Broad (FB)",
      "Launch ➤ Broad (IG)",
      "Launch ➤ Retarget 30d (IG)",
    ]);
    expect(await audit("parent_campaign.create")).toHaveLength(1);
    // One line per ad set, each linked to the campaign's Activity too.
    const created = await audit("campaign.create");
    expect(created).toHaveLength(3);
    const links = await db
      .select()
      .from(auditEventEntities)
      .where(
        and(
          eq(auditEventEntities.entityType, "parent_campaign"),
          eq(auditEventEntities.entityId, parent!.id),
        ),
      );
    expect(links).toHaveLength(4); // its own create + three ad sets
  });

  it("refuses a campaign that already exists on that network — and writes nothing", async () => {
    const res = await createParentCampaign({
      name: "Camp One",
      network: "meta",
      adSets: [{ name: "New", objective: "Sales", platforms: ["instagram"] }],
    });
    expect(res.ok).toBe(false);
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(await adSetNames(PARENT_1)).toHaveLength(2);
  });

  it("the same name on another network is its own campaign; a repeated ad-set name is refused by platform", async () => {
    const tiktok = await createParentCampaign({
      name: "Camp One",
      network: "tiktok",
      adSets: [{ name: "Broad", objective: "Sales", platforms: ["tiktok"] }],
    });
    expect(tiktok.ok).toBe(true);
    // "Camp One ➤ Broad" now exists on TikTok — a stored name is unique per brand.
    const snap = await createParentCampaign({
      name: "Camp One",
      network: "snapchat",
      adSets: [{ name: "Broad", objective: "Sales", platforms: ["snapchat"] }],
    });
    expect(snap.ok).toBe(false);
    expect(snap.adSetErrors?.[0]).toMatch(/already exists on TikTok/);
    expect(
      await db.select().from(parentCampaigns).where(eq(parentCampaigns.network, "snapchat")),
    ).toHaveLength(0);
  });

  it("refuses a platform outside the network, the separator, and an empty ad-set list", async () => {
    const wrong = await createParentCampaign({
      name: "T",
      network: "tiktok",
      adSets: [{ name: "Broad", objective: "Sales", platforms: ["instagram"] }],
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.adSetErrors?.[0]).toMatch(/Instagram isn.t part of a TikTok campaign/);
    expect((await createParentCampaign({ name: "A ➤ B", network: "meta", adSets: [{ name: "x", objective: "Sales", platforms: ["instagram"] }] })).ok).toBe(false);
    expect((await createParentCampaign({ name: "Bare", network: "meta", adSets: [] })).ok).toBe(false);
  });

  it("adds ad sets to an existing campaign, and refuses one it already has", async () => {
    const res = await addAdSets({
      parentId: PARENT_1,
      adSets: [{ name: "Lookalike 1%", objective: "Prospecting", platforms: ["instagram"] }],
    });
    expect(res).toMatchObject({ ok: true });
    expect(await adSetNames(PARENT_1)).toContain("Camp One ➤ Lookalike 1% (IG)");
    const again = await addAdSets({
      parentId: PARENT_1,
      adSets: [{ name: "Broad", objective: "Sales", platforms: ["instagram"] }],
    });
    expect(again.ok).toBe(false);
    expect(again.adSetErrors?.[0]).toMatch(/already registered on Instagram in this campaign/);
    // Another brand's campaign id is not found.
    expect((await addAdSets({ parentId: PARENT_B, adSets: [{ name: "x", objective: "Sales", platforms: ["instagram"] }] })).ok).toBe(false);
  });
});

describe("updateParentCampaign — one rename, every ad set follows", () => {
  it("rebuilds each ad set's stored name; the records stay attached", async () => {
    const res = await updateParentCampaign({ id: PARENT_1, name: "Camp Uno" });
    expect(res).toMatchObject({ ok: true, name: "Camp Uno", network: "meta" });
    expect(await adSetNames(PARENT_1)).toEqual(["Camp Uno ➤ Broad (FB)", "Camp Uno ➤ Broad (IG)"]);
    // Same ids, so the records never moved.
    const totals = (await campaignAnalytics("Camp Uno ➤ Broad (IG)", RANGE)).totals;
    expect(totals.spend).toBeCloseTo(200, 4);
    const [event] = await audit("parent_campaign.update");
    expect(event!.meta).toMatchObject({ renamedFrom: "Camp One", adSetsRenamed: 2 });
    const touched = await db
      .select({ id: auditEventEntities.entityId })
      .from(auditEventEntities)
      .where(
        and(
          eq(auditEventEntities.auditEventId, event!.id),
          eq(auditEventEntities.entityType, "campaign"),
        ),
      );
    expect(touched.map((t) => t.id).sort()).toEqual([CAMPAIGN_1, CAMPAIGN_1F].sort());
  });

  it("refuses a name taken on the same network, and the separator", async () => {
    expect((await updateParentCampaign({ id: PARENT_1, name: "Camp Two" })).ok).toBe(false);
    expect((await updateParentCampaign({ id: PARENT_1, name: "A ➤ B" })).ok).toBe(false);
    expect(await adSetNames(PARENT_1)).toEqual(["Camp One ➤ Broad (FB)", "Camp One ➤ Broad (IG)"]);
    // Another brand's campaign is not found.
    expect((await updateParentCampaign({ id: PARENT_B, name: "Mine now" })).ok).toBe(false);
  });
});

describe("deleteParentCampaign — the campaign, its ad sets and their records", () => {
  it("the summary states exactly what goes", async () => {
    const s = await parentCampaignDeletionSummary(PARENT_1);
    expect(s).toMatchObject({ adSets: 2, records: 4, creatives: 2 });
    expect(s.platforms).toEqual([
      { platform: "instagram", records: 3 },
      { platform: "facebook", records: 1 },
    ]);
  });

  it("removes them in one go and keeps the creatives and every other campaign", async () => {
    await db.insert(exclusionRules).values({
      accountId: ACCOUNT_A, kind: "campaign", campaignId: CAMPAIGN_1, createdByUserId: USER,
    });
    const res = await deleteParentCampaign(PARENT_1);
    expect(res).toMatchObject({ ok: true, adSetsDeleted: 2, recordsDeleted: 4 });

    expect(await db.select().from(parentCampaigns).where(eq(parentCampaigns.id, PARENT_1))).toEqual([]);
    expect(await adSetNames(PARENT_1)).toEqual([]);
    expect(await db.select().from(exclusionRules)).toEqual([]);
    // Camp Two's record and the other brand's are untouched; creatives stay.
    const left = await db.select({ campaignId: performanceRecords.campaignId }).from(performanceRecords);
    expect(left).toHaveLength(2);
    expect(left.some((r) => r.campaignId === CAMPAIGN_2)).toBe(true);
    expect(await db.select().from(creatives).where(eq(creatives.accountId, ACCOUNT_A))).toHaveLength(2);

    const [event] = await audit("parent_campaign.delete");
    expect(event!.meta).toMatchObject({ adSetsDeleted: 2, recordsDeleted: 4 });
    const links = await db
      .select({ type: auditEventEntities.entityType, id: auditEventEntities.entityId })
      .from(auditEventEntities)
      .where(eq(auditEventEntities.auditEventId, event!.id));
    const of = (type: string) => links.filter((l) => l.type === type).map((l) => l.id).sort();
    expect(of("campaign")).toEqual([CAMPAIGN_1, CAMPAIGN_1F].sort());
    expect(of("creative")).toEqual([CREATIVE_1, CREATIVE_2].sort());
    expect(of("budget_month")).toEqual(["2026-01"]);
  });

  it("a campaign with no ad sets or records is just unregistered; another brand's id is refused", async () => {
    await db.delete(campaigns).where(eq(campaigns.id, AD_SET_NEW));
    expect(await deleteParentCampaign(PARENT_NEW)).toMatchObject({ ok: true, adSetsDeleted: 0, recordsDeleted: 0 });
    const refused = await deleteParentCampaign(PARENT_B);
    expect(refused.ok).toBe(false);
    expect(await db.select().from(parentCampaigns).where(eq(parentCampaigns.id, PARENT_B))).toHaveLength(1);
  });
});

describe("the parent_campaigns_reconcile migration reads a name exactly as parseCampaignName does", () => {
  // Found by NAME: its number follows whatever landed on main before it.
  const migrations = path.join(process.cwd(), "db/migrations");
  const file = readdirSync(migrations).find((f) => f.endsWith("_parent_campaigns_reconcile.sql"));
  if (!file) throw new Error("the parent_campaigns_reconcile migration is missing");
  const statements = readFileSync(path.join(migrations, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  const reconcile = async () => {
    for (const s of statements) await db.execute(sql.raw(s));
  };

  // Every shape a stored name can take, as rows the old code left behind
  // (no campaign, no ad-set name).
  const LEGACY: Array<[string, "instagram" | "facebook" | "tiktok" | "snapchat" | "google"]> = [
    ["Holiday ➤ Broad (IG)", "instagram"],
    ["Holiday ➤ Broad (FB)", "facebook"],
    ["Solo (IG)", "instagram"], // no ad set
    ["Deep ➤ One ➤ Two (FB)", "facebook"], // the ad set keeps a later separator
    ["Tagged ➤ Broad (IG)", "tiktok"], // not its platform's tag — kept
    ["NoSeparator", "snapchat"],
    ["Search ➤ Ad group 1", "google"],
    ["Trailing  ➤ x", "tiktok"], // nothing is trimmed
  ];

  it("gives every legacy row its campaign and ad-set name", async () => {
    await db.insert(campaigns).values(
      LEGACY.map(([name, platform]) => ({
        accountId: ACCOUNT_A, name, platform, objective: "Sales" as const, createdByUserId: USER,
      })),
    );
    await reconcile();
    const rows = await db
      .select({
        name: campaigns.name,
        platform: campaigns.platform,
        adsetName: campaigns.adsetName,
        parentName: parentCampaigns.name,
        network: parentCampaigns.network,
      })
      .from(campaigns)
      .leftJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(eq(campaigns.accountId, ACCOUNT_A));
    for (const [name, platform] of LEGACY) {
      const row = rows.find((r) => r.name === name)!;
      const parsed = parseCampaignName(name, platform);
      expect({ name, campaign: row.parentName, adset: row.adsetName, network: row.network }).toEqual({
        name,
        campaign: parsed.campaign,
        adset: parsed.adset,
        network: adNetwork(platform),
      });
    }
    // The two halves of one Meta ad set share ONE campaign.
    const holiday = await db
      .select({ id: parentCampaigns.id })
      .from(parentCampaigns)
      .where(and(eq(parentCampaigns.accountId, ACCOUNT_A), eq(parentCampaigns.name, "Holiday")));
    expect(holiday).toHaveLength(1);
  });

  it("is idempotent, leaves app-written rows alone, and repairs a rename the old code made", async () => {
    const before = await db.select().from(campaigns).orderBy(campaigns.id);
    const parentsBefore = await db.select().from(parentCampaigns);
    await reconcile();
    expect(await db.select().from(campaigns).orderBy(campaigns.id)).toEqual(before);
    expect(await db.select().from(parentCampaigns)).toHaveLength(parentsBefore.length);

    // The code deployed before the migration renames an ad set WITHOUT
    // touching the two new columns.
    await db.update(campaigns).set({ name: "Moved ➤ Wide (IG)" }).where(eq(campaigns.id, CAMPAIGN_1));
    await reconcile();
    const [row] = await db
      .select({ adsetName: campaigns.adsetName, parentName: parentCampaigns.name })
      .from(campaigns)
      .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(eq(campaigns.id, CAMPAIGN_1));
    expect(row).toEqual({ adsetName: "Wide", parentName: "Moved" });
  });
});
