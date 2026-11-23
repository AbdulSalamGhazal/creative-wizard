import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { db } from "@/lib/db";
import {
  campaigns,
  exclusionRules,
  parentCampaigns,
  performanceRecords,
  uploadBatches,
} from "@/db/schema";
import {
  changeBreakdown,
  compareDimensions,
  kpis,
  metricBreakdown,
  metricOverTime,
  typeDimensionSpend,
} from "@/db/queries/performance";
import { campaignFunnel, platformCampaignFunnel } from "@/db/queries/funnel";
import { statusFlowBreakdown } from "@/db/queries/creative-status";
import { canvasFocusName, canvasGraph } from "@/db/queries/canvas";
import {
  applyRule,
  listExclusionRules,
  previewRuleApply,
  resweepActiveRules,
  ruleExcludingRecord,
  stampAgainstActiveRules,
  unapplyRule,
} from "@/db/queries/exclusion-rules";
import {
  deleteParentCampaignRows,
  listParentCampaignOptions,
} from "@/db/queries/parent-campaign";
import { campaignNodeId, creativeNodeId, parentNodeId } from "@/lib/canvas";
import { CREATIVE_STATUSES } from "@/lib/creative-status";
import {
  resetAndSeed,
  perf,
  BATCH_A,
  CAMPAIGN_1,
  CREATIVE_1,
  CREATIVE_2,
  PARENT_1,
  PARENT_2,
  PARENT_B,
  USER,
} from "./fixtures";

/**
 * THE CAMPAIGN LEVEL (delivery 2, 2026-11): every screen that worked per ad
 * set reads a CAMPAIGN as ONE group over the records of its ad sets. These pin
 * that against a real database — component sums (never a roll-up of ad-set
 * ratios), the Excluded toggle, tenancy, and the whole-campaign exclusion rule.
 *
 * On top of the shared fixtures (Camp One = one IG ad set, Camp Two = one FB
 * ad set), account A gets:
 *
 *   "Multi" on META   — two ad sets:
 *       Multi ➤ Broad (IG) · Sales        C1 Jan 2: $100 → $100 revenue (1×)
 *                                         C2 Jan 2: $50, EXCLUDED
 *       Multi ➤ Broad (FB) · Prospecting  C1 Jan 3: $300 → $1,500 revenue (5×)
 *     → the campaign: $400 → $1,600 = 4× (a mean of the ad sets' ROAS says 3×)
 *   "Multi" on TIKTOK — the SAME name on another network, one ad set:
 *       Multi ➤ All · Sales               C1 Jan 1: $60 → $120
 *   and Camp One spends $10 on Jan 4, so Instagram's latest spend day (Jan 4)
 *   is past the Multi IG ad set's last day (Jan 2).
 */
const PARENT_M = "66666666-6666-6666-6666-6666666660a1";
const PARENT_T = "66666666-6666-6666-6666-6666666660a2";
const AS_IG = "44444444-4444-4444-4444-4444444440a1";
const AS_FB = "44444444-4444-4444-4444-4444444440a2";
const AS_TT = "44444444-4444-4444-4444-4444444440a3";

const JAN = { from: "2026-01-01", to: "2026-01-31" };
const ALL = [...CREATIVE_STATUSES];
const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

async function seed() {
  await resetAndSeed();
  await db.insert(parentCampaigns).values([
    { id: PARENT_M, accountId: ACCOUNT_A, name: "Multi", network: "meta", createdByUserId: USER },
    { id: PARENT_T, accountId: ACCOUNT_A, name: "Multi", network: "tiktok", createdByUserId: USER },
  ]);
  await db.insert(campaigns).values([
    { id: AS_IG, accountId: ACCOUNT_A, parentId: PARENT_M, adsetName: "Broad", name: "Multi ➤ Broad (IG)", platform: "instagram", objective: "Sales", createdByUserId: USER },
    { id: AS_FB, accountId: ACCOUNT_A, parentId: PARENT_M, adsetName: "Broad", name: "Multi ➤ Broad (FB)", platform: "facebook", objective: "Prospecting", createdByUserId: USER },
    { id: AS_TT, accountId: ACCOUNT_A, parentId: PARENT_T, adsetName: "All", name: "Multi ➤ All", platform: "tiktok", objective: "Sales", createdByUserId: USER },
  ]);
  const row = { accountId: ACCOUNT_A, batchId: BATCH_A };
  await db.insert(performanceRecords).values([
    perf({ ...row, creativeId: CREATIVE_1, platform: "instagram", campaignId: AS_IG, date: "2026-01-02", spend: 100, impressions: 1000, clicks: 50, conversions: 1, conversionValue: 100, landingPageViews: 40 }),
    perf({ ...row, creativeId: CREATIVE_2, platform: "instagram", campaignId: AS_IG, date: "2026-01-02", spend: 50, impressions: 500, clicks: 5, conversions: 1, conversionValue: 50, landingPageViews: 5, excluded: true }),
    perf({ ...row, creativeId: CREATIVE_1, platform: "facebook", campaignId: AS_FB, date: "2026-01-03", spend: 300, impressions: 3000, clicks: 150, conversions: 9, conversionValue: 1500, landingPageViews: 120 }),
    perf({ ...row, creativeId: CREATIVE_1, platform: "tiktok", campaignId: AS_TT, date: "2026-01-01", spend: 60, impressions: 600, clicks: 30, conversions: 3, conversionValue: 120, landingPageViews: 20 }),
    perf({ ...row, creativeId: CREATIVE_1, platform: "instagram", campaignId: CAMPAIGN_1, date: "2026-01-04", spend: 10, impressions: 100, clicks: 1, conversions: 0, conversionValue: 0, landingPageViews: 1 }),
  ]);
}

beforeEach(async () => {
  await seed();
  setAccount(ACCOUNT_A);
});

describe("Compare — a side that is a whole campaign", () => {
  it("sums every ad set under the campaign: component sums, not a mean of ad-set ratios", async () => {
    const k = await kpis({ ...JAN, parentCampaignIds: [PARENT_M] });
    expect(k.spend).toBe(400);
    expect(k.conversionValue).toBe(1600);
    expect(k.roas).toBe(4); // Σ1600 ÷ Σ400 — never (1× + 5×) ÷ 2
    expect(k.ctr).toBe(200 / 4000);
  });

  it("honours the Excluded toggle", async () => {
    const k = await kpis({ ...JAN, parentCampaignIds: [PARENT_M], includeExcluded: true });
    expect(k.spend).toBe(450);
  });

  it("with ad sets picked too, it is those ad sets INSIDE the campaign", async () => {
    const inside = await kpis({
      ...JAN,
      parentCampaignIds: [PARENT_M],
      campaignNames: ["Multi ➤ Broad (FB)"],
    });
    expect(inside.spend).toBe(300);
    const outside = await kpis({
      ...JAN,
      parentCampaignIds: [PARENT_M],
      campaignNames: ["Camp One ➤ Broad (IG)"],
    });
    expect(outside.spend ?? 0).toBe(0);
  });

  it("another brand's campaign id matches nothing here", async () => {
    const k = await kpis({ ...JAN, parentCampaignIds: [PARENT_B] });
    expect(k.spend ?? 0).toBe(0);
  });

  it("the pickers carry each ad set's campaign", async () => {
    const dims = await compareDimensions();
    const fb = dims.find((d) => d.campaign === "Multi ➤ Broad (FB)")!;
    expect(fb).toMatchObject({ parentId: PARENT_M, parentName: "Multi", parentNetwork: "meta" });
    const tt = dims.find((d) => d.campaign === "Multi ➤ All")!;
    expect(tt).toMatchObject({ parentId: PARENT_T, parentNetwork: "tiktok" });
  });
});

describe("the campaign breakdown dimension (Dashboard, MCP)", () => {
  it("one row per campaign; the same name on two networks gets its network", async () => {
    const rows = await metricBreakdown(JAN, "parent_campaign");
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect([...byKey.keys()].sort()).toEqual(
      ["Camp One", "Camp Two", "Multi (Meta)", "Multi (TikTok)"].sort(),
    );
    expect(byKey.get("Multi (Meta)")).toMatchObject({ spend: 400, conversionValue: 1600, roas: 4 });
    expect(byKey.get("Multi (TikTok)")).toMatchObject({ spend: 60, roas: 2 });
    expect(byKey.get("Camp One")!.spend).toBe(210);
  });

  it("pinned to one platform it is that platform's share — and the plain name", async () => {
    const rows = await metricBreakdown({ ...JAN, platforms: ["facebook"] }, "parent_campaign");
    const byKey = new Map(rows.map((r) => [r.key, r.spend]));
    // One network in scope: a name is unique there, so it needs no suffix —
    // though the brand has a TikTok campaign of the same name.
    expect(byKey.get("Multi")).toBe(300);
    expect(byKey.get("Camp Two")).toBe(200);
    expect([...byKey.keys()].some((k) => k.includes("("))).toBe(false);
    // Instagram + Facebook is still ONE network (Meta).
    const meta = await metricBreakdown(
      { ...JAN, platforms: ["instagram", "facebook"] },
      "parent_campaign",
    );
    expect(meta.find((r) => r.key === "Multi")!.spend).toBe(400);
    // Two networks in scope: the collision is real again.
    const both = await metricBreakdown(
      { ...JAN, platforms: ["facebook", "tiktok"] },
      "parent_campaign",
    );
    expect(both.map((r) => r.key).sort()).toEqual(["Camp Two", "Multi (Meta)", "Multi (TikTok)"]);
  });

  it("includes excluded records only when asked", async () => {
    const shown = await metricBreakdown({ ...JAN, includeExcluded: true }, "parent_campaign");
    expect(shown.find((r) => r.key === "Multi (Meta)")!.spend).toBe(450);
  });

  it("never reads another brand", async () => {
    setAccount(ACCOUNT_B);
    const rows = await metricBreakdown(JAN, "parent_campaign");
    expect(rows.map((r) => r.key)).toEqual(["Camp B"]);
    expect(rows[0]!.spend).toBe(777);
  });

  it("the daily series and the type mix group the same way", async () => {
    const series = await metricOverTime(JAN, "parent_campaign");
    const meta = series.filter((p) => p.key === "Multi (Meta)");
    expect(meta.find((p) => p.date === "2026-01-02")!.spend).toBe(100);
    expect(meta.find((p) => p.date === "2026-01-03")!.spend).toBe(300);
    const types = await typeDimensionSpend(JAN, "parent_campaign");
    expect(types.find((t) => t.key === "Multi (Meta)" && t.type === "video")!.spend).toBe(400);
  });

  it("the status flow breaks a platform out by campaign", async () => {
    const scopes = await statusFlowBreakdown(JAN, "parent_campaign", "instagram");
    // Instagram's campaigns by spend in the window: Camp One (210), Multi (100).
    expect(scopes.map((s) => s.key)).toEqual(["Camp One", "Multi"]);
  });
});

describe("Trends › Changes — by campaign", () => {
  it("one entity per campaign, keyed by id, with its network", async () => {
    const { rows } = await changeBreakdown({ from: "2026-01-01", to: "2026-01-04" }, "parent_campaign");
    const multi = rows.find((r) => r.key === PARENT_M)!;
    expect(multi).toMatchObject({ label: "Multi", network: "meta", sub: "Meta" });
    expect(multi.cur.spend).toBe(400);
    expect(multi.cur.conversionValue).toBe(1600);
    // Its namesake on TikTok is its own entity.
    expect(rows.find((r) => r.key === PARENT_T)).toMatchObject({ label: "Multi", network: "tiktok", sub: "TikTok" });
    expect(rows).toHaveLength(4);
  });

  it("the ad-set dimension is unchanged", async () => {
    const { rows } = await changeBreakdown({ from: "2026-01-01", to: "2026-01-04" }, "campaign");
    expect(rows.find((r) => r.key === "Multi ➤ Broad (FB)")!.cur.spend).toBe(300);
    expect(rows.every((r) => r.network === null)).toBe(true);
  });
});

describe("Funnel — by campaign", () => {
  it("one row per campaign, across its platforms, weighted over its own sums", async () => {
    const rows = await campaignFunnel(JAN, "campaign");
    const multi = rows.find((r) => r.parentId === PARENT_M)!;
    expect(multi).toMatchObject({
      campaign: "Multi",
      network: "meta",
      platforms: ["instagram", "facebook"],
      objectives: ["Sales", "Prospecting"],
      spend: 400,
      impressions: 4000,
      clicks: 200,
      conversions: 10,
      conversionValue: 1600,
    });
    expect(multi.ctr).toBe(200 / 4000);
    expect(multi.roas).toBe(4);
    // Four campaigns ran; the TikTok namesake is its own row.
    expect(rows.map((r) => r.parentId).sort()).toEqual([PARENT_1, PARENT_2, PARENT_M, PARENT_T].sort());
  });

  it("the default level is still one row per ad set and platform", async () => {
    const rows = await campaignFunnel(JAN);
    expect(rows.find((r) => r.campaign === "Multi ➤ Broad (FB)")).toMatchObject({
      platform: "facebook",
      spend: 300,
    });
    expect(rows.every((r) => r.parentId === undefined)).toBe(true);
  });

  it("a platform expands into its campaigns — each with that platform's share", async () => {
    const rows = await platformCampaignFunnel(JAN, "campaign");
    const pick = (platform: string, campaign: string) =>
      rows.find((r) => r.platform === platform && r.campaign === campaign);
    expect(pick("instagram", "Multi")!.spend).toBe(100);
    expect(pick("facebook", "Multi")).toMatchObject({ spend: 300, objectives: ["Prospecting"] });
    expect(pick("tiktok", "Multi")!.spend).toBe(60);
    expect(pick("instagram", "Camp One")!.spend).toBe(210);
  });
});

describe("Canvas — the campaign level", () => {
  const RANGE = { from: "2026-01-01", to: "2026-01-04" };

  it("folds a campaign's ad sets into ONE pairing per creative", async () => {
    const g = await canvasGraph({ ...RANGE, statuses: ALL, level: "campaign" });
    expect(g.level).toBe("campaign");
    expect(g.campaigns.map((c) => c.id).sort()).toEqual(
      [PARENT_1, PARENT_2, PARENT_M, PARENT_T].map(parentNodeId).sort(),
    );
    const edge = g.edges.find(
      (e) => e.id === `${parentNodeId(PARENT_M)}|${creativeNodeId(CREATIVE_1)}`,
    )!;
    expect(edge.spend).toBe(400);
    expect(edge.roas).toBe(4);
    // Coloured by the platform that spent most in the pairing; both named.
    expect(edge.platform).toBe("facebook");
    expect(edge.platforms).toEqual(["facebook", "instagram"]);
    // One creative × four campaigns = four pairings (five at ad-set level).
    expect(g.edges).toHaveLength(4);
  });

  it("the campaign node carries true totals, its network and its registered ad sets", async () => {
    const g = await canvasGraph({ ...RANGE, statuses: ALL, level: "campaign" });
    const multi = g.campaigns.find((c) => c.id === parentNodeId(PARENT_M))!;
    expect(multi).toMatchObject({
      level: "campaign",
      campaignId: PARENT_M,
      parentId: PARENT_M,
      name: "Multi",
      network: "meta",
      adSets: 2,
      platform: "facebook",
      platforms: ["facebook", "instagram"],
      spend: 400,
      revenue: 1600,
      totalChildren: 1,
    });
    expect(multi.objective.split(" · ").sort()).toEqual(["Prospecting", "Sales"]);
    // The creative's own total is the same at either level.
    const c1 = g.creatives.find((c) => c.creativeId === CREATIVE_1)!;
    expect(c1.spend).toBe(100 + 100 + 10 + 200 + 100 + 300 + 60);
  });

  it("is live when live on ANY platform — each on its own clock", async () => {
    const adSets = await canvasGraph({ ...RANGE, statuses: ALL });
    const live = (id: string) =>
      adSets.edges.find((e) => e.id === `${campaignNodeId(id)}|${creativeNodeId(CREATIVE_1)}`)!.live;
    // Instagram's latest spend day is Jan 4: the IG ad set (last spend Jan 2)
    // has stopped. Facebook's is Jan 3: the FB ad set is spending now.
    expect(live(AS_IG)).toBe(false);
    expect(live(AS_FB)).toBe(true);

    const g = await canvasGraph({ ...RANGE, statuses: ALL, level: "campaign" });
    const edge = g.edges.find(
      (e) => e.id === `${parentNodeId(PARENT_M)}|${creativeNodeId(CREATIVE_1)}`,
    )!;
    expect(edge.live).toBe(true);
    expect(edge.lastSpendDay).toBe("2026-01-03");
    const multi = g.campaigns.find((c) => c.id === parentNodeId(PARENT_M))!;
    expect(multi.liveChildren).toBe(1);
  });

  it("a campaign launched only if NONE of its ad sets spent before the range", async () => {
    const whole = await canvasGraph({ ...RANGE, statuses: ALL, level: "campaign" });
    expect(whole.campaigns.find((c) => c.id === parentNodeId(PARENT_M))!.launchedOn).toBe("2026-01-02");

    const late = { from: "2026-01-03", to: "2026-01-04" };
    // The FB ad set first spent on Jan 3 — a launch at ad-set level…
    const adSets = await canvasGraph({ ...late, statuses: ALL });
    expect(adSets.campaigns.find((c) => c.id === campaignNodeId(AS_FB))!.launchedOn).toBe("2026-01-03");
    // …but its campaign had already spent (the IG ad set, Jan 2).
    const g = await canvasGraph({ ...late, statuses: ALL, level: "campaign" });
    expect(g.campaigns.find((c) => c.id === parentNodeId(PARENT_M))!.launchedOn).toBeNull();
  });

  it("excluded records stay out unless asked; the default level is unchanged", async () => {
    const g = await canvasGraph({ ...RANGE, statuses: ALL, level: "campaign", includeExcluded: true });
    expect(g.campaigns.find((c) => c.id === parentNodeId(PARENT_M))!.spend).toBe(450);
    const adSets = await canvasGraph({ ...RANGE, statuses: ALL });
    expect(adSets.level).toBe("adset");
    expect(adSets.campaigns.every((c) => c.id.startsWith("c:") && c.adSets === 1)).toBe(true);
    expect(adSets.campaigns.find((c) => c.id === campaignNodeId(AS_FB))!.parentId).toBe(PARENT_M);
  });

  it("a ?focus= campaign is named within its brand only", async () => {
    expect(await canvasFocusName({ kind: "parent_campaign", id: PARENT_M })).toBe("Multi");
    expect(await canvasFocusName({ kind: "parent_campaign", id: PARENT_B })).toBeNull();
  });
});

describe("exclusion rule — a whole campaign", () => {
  const BATCH_NEW = "55555555-5555-5555-5555-5555555550a9";
  const AS_NEW = "44444444-4444-4444-4444-4444444440a9";

  async function insertRule(over: Partial<typeof exclusionRules.$inferInsert> = {}) {
    const [row] = await db
      .insert(exclusionRules)
      .values({
        accountId: ACCOUNT_A,
        kind: "parent_campaign",
        parentCampaignId: PARENT_M,
        createdByUserId: USER,
        ...over,
      })
      .returning();
    return row!;
  }
  const flags = async () =>
    db
      .select({
        campaignId: performanceRecords.campaignId,
        creativeId: performanceRecords.creativeId,
        excluded: performanceRecords.excludedFromAggregates,
        source: performanceRecords.excludedSource,
        ruleId: performanceRecords.excludedRuleId,
      })
      .from(performanceRecords)
      .where(eq(performanceRecords.accountId, ACCOUNT_A));

  it("the preview and the sweep cover every ad set under it — and only it", async () => {
    const rule = await insertRule();
    const preview = await previewRuleApply(rule);
    // Two not-yet-excluded records, across both ad sets, one creative.
    expect(preview).toMatchObject({ records: 2, campaigns: 2, creatives: 1 });

    expect(await applyRule(db, rule, ACCOUNT_A)).toBe(2);
    const rows = await flags();
    const stamped = rows.filter((r) => r.ruleId === rule.id);
    expect(stamped.map((r) => r.campaignId).sort()).toEqual([AS_FB, AS_IG].sort());
    expect(stamped.every((r) => r.source === "rule" && r.excluded)).toBe(true);
    // The already-excluded row keeps its own provenance (never overwritten)…
    const prior = rows.find((r) => r.campaignId === AS_IG && r.creativeId === CREATIVE_2)!;
    expect(prior).toMatchObject({ excluded: true, ruleId: null });
    // …and the TikTok campaign of the SAME NAME is untouched.
    expect(rows.find((r) => r.campaignId === AS_TT)!.excluded).toBe(false);
    expect(rows.find((r) => r.campaignId === CAMPAIGN_1 && !r.excluded)).toBeDefined();
  });

  it("an ad set added LATER is covered: its first upload lands excluded", async () => {
    const rule = await insertRule();
    await applyRule(db, rule, ACCOUNT_A);

    await db.insert(campaigns).values({
      id: AS_NEW, accountId: ACCOUNT_A, parentId: PARENT_M, adsetName: "Lookalike",
      name: "Multi ➤ Lookalike (IG)", platform: "instagram", objective: "Sales", createdByUserId: USER,
    });
    await db.insert(uploadBatches).values({
      id: BATCH_NEW, accountId: ACCOUNT_A, platform: "instagram", fileName: "later.csv",
      uploadedByUserId: USER, rowsImported: 1,
    });
    await db.insert(performanceRecords).values(
      perf({ accountId: ACCOUNT_A, batchId: BATCH_NEW, creativeId: CREATIVE_1, platform: "instagram", campaignId: AS_NEW, date: "2026-01-05", spend: 20, impressions: 200, clicks: 2, conversions: 0, conversionValue: 0, landingPageViews: 1 }),
    );
    // What the commit route runs inside its transaction, scoped to the batch.
    const stamped = await stampAgainstActiveRules(db, ACCOUNT_A, [
      eq(performanceRecords.uploadBatchId, BATCH_NEW),
    ]);
    expect(stamped).toBe(1);
    const [row] = await db
      .select({ excluded: performanceRecords.excludedFromAggregates, ruleId: performanceRecords.excludedRuleId })
      .from(performanceRecords)
      .where(eq(performanceRecords.campaignId, AS_NEW));
    expect(row).toEqual({ excluded: true, ruleId: rule.id });
  });

  it("the rules list names the campaign and its network, with a live count", async () => {
    const rule = await insertRule();
    await applyRule(db, rule, ACCOUNT_A);
    const [listed] = await listExclusionRules();
    expect(listed).toMatchObject({
      kind: "parent_campaign",
      parentCampaignId: PARENT_M,
      campaignId: null,
      targetLabel: "Multi",
      targetNetwork: "meta",
      excludedCount: 2,
    });
    // A rule-excluded row names its rule by the campaign (the refusal message).
    const [stampedRow] = await db
      .select({ id: performanceRecords.id })
      .from(performanceRecords)
      .where(and(eq(performanceRecords.campaignId, AS_FB), eq(performanceRecords.excludedRuleId, rule.id)));
    expect(await ruleExcludingRecord(stampedRow!.id)).toMatchObject({
      kind: "parent_campaign",
      targetLabel: "Multi",
    });
  });

  it("removing it re-sweeps: an ad-set rule under it keeps its rows excluded", async () => {
    const parentRule = await insertRule();
    await applyRule(db, parentRule, ACCOUNT_A);
    // A LATER rule on the FB ad set alone finds nothing left to stamp.
    const adSetRule = await insertRule({ kind: "campaign", parentCampaignId: null, campaignId: AS_FB });
    expect(await applyRule(db, adSetRule, ACCOUNT_A)).toBe(0);

    expect(await unapplyRule(db, parentRule.id, ACCOUNT_A)).toBe(2);
    await db.delete(exclusionRules).where(eq(exclusionRules.id, parentRule.id));
    expect(await resweepActiveRules(db, ACCOUNT_A)).toBe(1);

    const rows = await flags();
    expect(rows.find((r) => r.campaignId === AS_FB)).toMatchObject({ excluded: true, ruleId: adSetRule.id });
    expect(rows.find((r) => r.campaignId === AS_IG && r.creativeId === CREATIVE_1)).toMatchObject({
      excluded: false,
      ruleId: null,
    });
  });

  it("never reaches another brand's campaign", async () => {
    const rule = await insertRule({ parentCampaignId: PARENT_B });
    expect(await applyRule(db, rule, ACCOUNT_A)).toBe(0);
    const [b] = await db
      .select({ excluded: performanceRecords.excludedFromAggregates })
      .from(performanceRecords)
      .where(eq(performanceRecords.accountId, ACCOUNT_B));
    expect(b!.excluded).toBe(false);
  });

  it("deleting the campaign takes its rule with it (and its ad sets' rules)", async () => {
    const parentRule = await insertRule();
    await applyRule(db, parentRule, ACCOUNT_A);
    await insertRule({ kind: "campaign", parentCampaignId: null, campaignId: AS_IG });

    const deleted = await db.transaction((tx) => deleteParentCampaignRows(tx, ACCOUNT_A, PARENT_M));
    expect(deleted.records).toBe(3);
    expect(await db.select().from(exclusionRules)).toHaveLength(0);
    expect(
      await db.select().from(parentCampaigns).where(eq(parentCampaigns.id, PARENT_M)),
    ).toHaveLength(0);
    // The TikTok namesake and its records are untouched.
    const rows = await flags();
    expect(rows.find((r) => r.campaignId === AS_TT)).toBeDefined();
  });

  it("the database itself refuses a rule with two targets, or a second rule for one campaign", async () => {
    await expect(insertRule({ campaignId: AS_IG })).rejects.toThrow();
    await expect(insertRule({ kind: "campaign", campaignId: null })).rejects.toThrow();
    await insertRule();
    await expect(insertRule()).rejects.toThrow();
  });

  it("the picker lists every registered campaign with its network and ad-set count", async () => {
    const options = await listParentCampaignOptions();
    expect(options.filter((o) => o.name === "Multi")).toEqual([
      { id: PARENT_M, name: "Multi", network: "meta", adSets: 2 },
      { id: PARENT_T, name: "Multi", network: "tiktok", adSets: 1 },
    ]);
  });
});
