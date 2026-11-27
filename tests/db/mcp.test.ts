import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

// NOTE: this suite deliberately does NOT `vi.mock("@/lib/tenant")` — it
// exercises the REAL cookieless override (`runWithTenant` + AsyncLocalStorage +
// `getActiveAccountId`), which is the whole point of the MCP tenant path.

import { db } from "@/lib/db";
import { users, userAccounts, apiTokens, creatives, storeOrders } from "@/db/schema";
import { insertVersion } from "@/db/queries/price-structure";
import { sampleVersionData } from "@/price-structure/engine/sample";
import { eq } from "drizzle-orm";
import {
  runWithTenant,
  getActiveAccountId,
  allowedAccountsForUser,
} from "@/lib/tenant";
import { createApiToken, verifyApiToken, revokeApiToken } from "@/lib/api-token";
import { registerMcpTools } from "@/lib/mcp/tools";
import { runWithMcpActor } from "@/lib/mcp/runtime";
import type { SessionUser } from "@/lib/auth";
import { resetAndSeed } from "./fixtures";

const RESTRICTED_ID = "cccccccc-0000-0000-0000-0000000000c1"; // member of A only
const ADMIN_ID = "cccccccc-0000-0000-0000-0000000000ad"; // all_accounts

const restricted: SessionUser = {
  id: RESTRICTED_ID,
  email: "restricted@mcp.test",
  name: "Restricted",
  role: "editor",
  permissions: null,
  allAccounts: false,
  avatarUrl: null,
};

beforeAll(async () => {
  await resetAndSeed(); // seeds ACCOUNT_A (with perf data) + ACCOUNT_B
  await db.insert(users).values([
    { id: RESTRICTED_ID, email: "restricted@mcp.test", name: "Restricted", role: "editor", allAccounts: false },
    { id: ADMIN_ID, email: "admin@mcp.test", name: "Admin", role: "admin", allAccounts: true },
  ]);
  await db.insert(userAccounts).values({ userId: RESTRICTED_ID, accountId: ACCOUNT_A });
});

/** The shape every registered MCP tool callback returns. */
interface ToolResult {
  content: { text: string }[];
  isError?: boolean;
}
type ToolCallback = (args: unknown, extra: unknown) => Promise<ToolResult>;

/** Capture the registered tool callbacks without a real MCP server. */
function loadTools(): Map<string, ToolCallback> {
  const tools = new Map<string, ToolCallback>();
  const stub = {
    registerTool: (name: string, _cfg: unknown, cb: ToolCallback) => {
      tools.set(name, cb);
    },
  };
  registerMcpTools(stub as never);
  return tools;
}

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0]!.text);
}

describe("api tokens — create / verify / revoke round-trip", () => {
  it("verifies a fresh token to its owner, then rejects it once revoked", async () => {
    const { raw, row } = await createApiToken(RESTRICTED_ID, "Round-trip");

    const good = await verifyApiToken(`Bearer ${raw}`);
    expect(good?.user.id).toBe(RESTRICTED_ID);
    expect(good?.tokenId).toBe(row.id);

    // Garbage / wrong secret → null, no throw.
    expect(await verifyApiToken("Bearer cwz_not_a_real_token_value_here")).toBeNull();
    expect(await verifyApiToken(null)).toBeNull();
    expect(await verifyApiToken("Bearer xyz")).toBeNull();

    await revokeApiToken(row.id, RESTRICTED_ID);
    expect(await verifyApiToken(`Bearer ${raw}`)).toBeNull();
  });

  it("stamps last_used_at on use", async () => {
    const { raw, row } = await createApiToken(RESTRICTED_ID, "Stamp");
    const [before] = await db
      .select({ lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, row.id));
    expect(before!.lastUsedAt).toBeNull();
    await verifyApiToken(`Bearer ${raw}`);
    const [after] = await db
      .select({ lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.id, row.id));
    expect(after!.lastUsedAt).not.toBeNull();
  });
});

describe("runWithTenant override matrix", () => {
  it("override WINS: getActiveAccountId returns the injected account", async () => {
    const seen = await runWithTenant(ACCOUNT_A, RESTRICTED_ID, () => getActiveAccountId());
    expect(seen).toBe(ACCOUNT_A);
  });

  it("REJECTS a disallowed account for the user", async () => {
    await expect(
      runWithTenant(ACCOUNT_B, RESTRICTED_ID, async () => "unreachable"),
    ).rejects.toThrow(/not allowed/i);
  });

  it("an all-accounts user may enter any brand", async () => {
    const seen = await runWithTenant(ACCOUNT_B, ADMIN_ID, () => getActiveAccountId());
    expect(seen).toBe(ACCOUNT_B);
  });

  it("cookie fallback intact: OUTSIDE the override the injected account does not leak", async () => {
    // With no override AND no request cookies (vitest), getActiveAccountId takes
    // the cookie path — which can't resolve here, so it must NOT return ACCOUNT_A.
    await expect(getActiveAccountId()).rejects.toBeDefined();
  });
});

describe("MCP tools — brand scoping for a restricted user", () => {
  it("list_brands returns ONLY the user's allowed brand", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("list_brands")!({}, {}),
    );
    const out = JSON.parse(res.content[0]!.text);
    expect(out.brands.map((b: { id: string }) => b.id)).toEqual([ACCOUNT_A]);
  });

  it("get_kpis with no brand defaults to the single allowed brand and returns its numbers", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("get_kpis")!({}, {}),
    );
    const out = parse(res);
    expect(out.brand.id).toBe(ACCOUNT_A);
    // Fixture Account A non-excluded spend = 400 (see tests/db/fixtures.ts).
    expect(out.totals.spend).toBe(400);
  });

  it("get_creative names each campaign's objective in its per-campaign rows", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("get_creative")!({ name: "A-Creative-1", include_excluded: true }, {}),
    );
    const out = parse(res);
    expect(out.byCampaign.length).toBeGreaterThan(0);
    for (const row of out.byCampaign as Array<{ campaign: string; objective: string }>) {
      // Every fixture campaign runs under "Sales" (tests/db/fixtures.ts).
      expect(row.objective).toBe("Sales");
    }
  });

  it("list_campaigns keeps its ad-set grain, and rolls up per campaign on request (2026-11)", async () => {
    const tools = loadTools();
    const call = async (args: Record<string, unknown>) =>
      parse(
        await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
          tools.get("list_campaigns")!({ from: "2026-01-01", to: "2026-01-31", ...args }, {}),
        ),
      );
    // Default: one row per AD SET, as always — now naming its two parts.
    const adSets = await call({});
    expect(adSets.level).toBe("ad_set");
    const one = (adSets.campaigns as Array<Record<string, unknown>>).find(
      (c) => c.campaign === "Camp One ➤ Broad (IG)",
    )!;
    expect(one).toMatchObject({ parent_campaign: "Camp One", ad_set: "Broad", spend: 200 });
    // level "campaign": the campaign above it, its ad sets rolled up.
    const campaigns = await call({ level: "campaign" });
    expect(campaigns.level).toBe("campaign");
    const parent = (campaigns.campaigns as Array<Record<string, unknown>>).find(
      (c) => c.campaign === "Camp One",
    )!;
    expect(parent).toMatchObject({ network: "meta", ad_sets: 1, has_data: true, spend: 200 });
    expect(parent.objectives).toEqual(["Sales"]);
    // Another brand's campaign never appears.
    expect(
      (campaigns.campaigns as Array<Record<string, unknown>>).some((c) => c.campaign === "Camp B"),
    ).toBe(false);
  });

  it("get_campaign names the campaign an ad set sits under", async () => {
    const tools = loadTools();
    const out = parse(
      await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_campaign")!({ name: "Camp One ➤ Broad (IG)" }, {}),
      ),
    );
    expect(out.campaign).toMatchObject({
      name: "Camp One ➤ Broad (IG)",
      parent_campaign: "Camp One",
      network: "meta",
      ad_set: "Broad",
    });
  });

  it("get_campaign reads a whole CAMPAIGN on request (level: campaign, 2026-11)", async () => {
    const tools = loadTools();
    const call = (args: Record<string, unknown>) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_campaign")!({ from: "2026-01-01", to: "2026-01-31", ...args }, {}),
      );
    const out = parse(await call({ name: "Camp One", level: "campaign" }));
    expect(out.level).toBe("campaign");
    expect(out.campaign).toMatchObject({
      name: "Camp One",
      network: "meta",
      ad_sets: 1,
      objectives: ["Sales"],
      platforms: ["instagram"],
    });
    // The campaign's totals are its ad sets' records summed (excluded hidden).
    expect(out.totals.spend).toBe(200);
    expect(out.adSets).toHaveLength(1);
    expect(out.adSets[0]).toMatchObject({
      campaign: "Camp One ➤ Broad (IG)",
      ad_set: "Broad",
      platform: "instagram",
      has_data: true,
      spend: 200,
    });
    expect(out.dailyByAdSet.length).toBeGreaterThan(0);
    // The same name with a network that doesn't have it, an ad set's stored
    // name, and another brand's campaign: all "no such campaign", never data.
    for (const args of [
      { name: "Camp One", level: "campaign", network: "tiktok" },
      { name: "Camp One ➤ Broad (IG)", level: "campaign" },
      { name: "Camp B", level: "campaign" },
    ]) {
      const res = await call(args);
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toMatch(/No campaign named/);
    }
  });

  it("get_timeseries breaks down by campaign as well as by ad set", async () => {
    const tools = loadTools();
    const call = (dimension: string) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_timeseries")!({ from: "2026-01-01", to: "2026-01-03", dimension }, {}),
      ).then(parse);
    const byCampaign = await call("parent_campaign");
    expect(byCampaign.dimension).toBe("parent_campaign");
    const keys = new Set((byCampaign.points as Array<{ key: string }>).map((p) => p.key));
    expect([...keys].sort()).toEqual(["Camp One", "Camp Two"]);
    const total = (byCampaign.points as Array<{ key: string; spend: number }>)
      .filter((p) => p.key === "Camp One")
      .reduce((s, p) => s + p.spend, 0);
    expect(total).toBe(200);
    // "campaign" is still the AD SET, keyed by its stored name.
    const byAdSet = await call("campaign");
    expect(
      (byAdSet.points as Array<{ key: string }>).some((p) => p.key === "Camp One ➤ Broad (IG)"),
    ).toBe(true);
  });

  it("get_canvas_patterns folds to campaigns on request (level: campaign)", async () => {
    const tools = loadTools();
    const call = (args: Record<string, unknown>) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_canvas_patterns")!({ from: "2026-01-01", to: "2026-01-03", ...args }, {}),
      ).then(parse);
    expect((await call({})).level).toBe("ad_set");

    const out = await call({ level: "campaign" });
    expect(out.level).toBe("campaign");
    const shared = out.patterns.find((p: { key: string }) => p.key === "most_shared");
    expect(shared.label).toBe("Most shared: «A-Creative-1» feeds 2 campaigns");
    expect(shared.items[0].campaigns.map((c: { name: string }) => c.name).sort()).toEqual([
      "Camp One",
      "Camp Two",
    ]);
    // A campaign item says which network it is on and how many ad sets it has.
    const shown = await call({ level: "campaign", include_excluded: true });
    const lean = shown.patterns.find((p: { key: string }) => p.key === "leans_on_one");
    expect(lean.items[0]).toMatchObject({ name: "Camp One", network: "meta", ad_sets: 1 });
    expect(lean.items[0].top_share).toBe(0.83);
  });

  it("get_canvas_patterns returns the Canvas insight strip as data", async () => {
    const tools = loadTools();
    const call = (args: Record<string, unknown>) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_canvas_patterns")!(args, {}),
      ).then(parse);
    const JAN = { from: "2026-01-01", to: "2026-01-03" };

    // Default (excluded hidden): A-Creative-1 runs in both campaigns.
    const hidden = await call(JAN);
    expect(hidden.brand.id).toBe(ACCOUNT_A);
    expect(hidden.excluded_records).toBeDefined();
    const shared = hidden.patterns.find((p: { key: string }) => p.key === "most_shared");
    expect(shared.items[0].name).toBe("A-Creative-1");
    expect(shared.items[0].campaigns.map((c: { name: string }) => c.name).sort()).toEqual([
      "Camp One ➤ Broad (IG)",
      "Camp Two ➤ Broad (FB)",
    ]);
    // $200 pairings are under the default $500 min spend → rated N/A, so
    // no Rate pattern fires.
    expect(hidden.patterns.map((p: { key: string }) => p.key)).not.toContain("unscaled_winner");

    // Counting the excluded row: A-Creative-2 spent $1,000 at 9,999 in Camp
    // One — 83% of that campaign's $1,200, which ran 2 creatives.
    const shown = await call({ ...JAN, include_excluded: true });
    const lean = shown.patterns.find((p: { key: string }) => p.key === "leans_on_one");
    expect(lean.items).toHaveLength(1);
    expect(lean.items[0].name).toBe("Camp One ➤ Broad (IG)");
    expect(lean.items[0].creatives_in_range).toBe(2);
    expect(lean.items[0].top_creative.name).toBe("A-Creative-2");
    expect(lean.items[0].top_share).toBe(0.83);

    // LAUNCHED: Jan 1 is everyone's first spend day, so in JAN it is all a
    // launch; from Jan 2 on, only the excluded-only A-Creative-2 (shown).
    const launched = hidden.patterns.find((p: { key: string }) => p.key === "launched");
    expect(
      launched.items.find((i: { name: string }) => i.name === "A-Creative-1").first_spend_day,
    ).toBe("2026-01-01");
    const later = await call({ from: "2026-01-02", to: "2026-01-03", include_excluded: true });
    const l2 = later.patterns.find((p: { key: string }) => p.key === "launched");
    expect(l2.items.map((i: { name: string }) => i.name)).toEqual(["A-Creative-2"]);
    expect(l2.items[0].first_spend_day).toBe("2026-01-03");
  });

  it("get_kpis for a brand the user lacks → error result (never Account B data)", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor(
      { user: restricted, tokenId: "t" },
      () => tools.get("get_kpis")!({ brand: "Account B" }, {}),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unknown brand|allowed brands/i);
  });

  it("echoes the exclusion state, and include_excluded changes the numbers", async () => {
    const tools = loadTools();
    const call = (args: Record<string, unknown>) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("get_kpis")!(args, {}),
      );

    // Default: the app's convention — excluded records are HIDDEN, and the
    // envelope says so rather than leaving the caller to guess.
    const hidden = parse(await call({}));
    expect(hidden.excluded_records).toBe("hidden");
    expect(hidden.totals.spend).toBe(400);

    // Opting in counts the fixture's excluded 1,000 row.
    const included = parse(await call({ include_excluded: true }));
    expect(included.excluded_records).toBe("included");
    expect(included.totals.spend).toBe(1400);
  });

  it("every aggregate tool echoes excluded_records; non-aggregate tools stay quiet", async () => {
    const tools = loadTools();
    const echo = async (name: string, args: Record<string, unknown> = {}) =>
      parse(
        await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
          tools.get(name)!(args, {}),
        ),
      ).excluded_records;

    const range = { from: "2026-01-01", to: "2026-01-31" };
    expect(await echo("get_kpis")).toBe("hidden");
    expect(await echo("list_creatives")).toBe("hidden");
    expect(await echo("list_campaigns")).toBe("hidden");
    expect(await echo("get_summary")).toBe("hidden");
    // These callbacks are invoked directly, so the SDK's schema parsing — and
    // with it every zod `.default()` — hasn't run: pass what a real call would
    // have been given.
    expect(await echo("get_timeseries", { dimension: "platform" })).toBe("hidden");
    expect(await echo("get_funnel", range)).toBe("hidden");
    expect(await echo("get_summary", { include_excluded: true })).toBe("included");

    // Brand list and data freshness read no aggregates — no noise added there.
    expect(await echo("list_brands")).toBeUndefined();
    expect(await echo("get_data_freshness")).toBeUndefined();
  });

  it("list_creatives exposes stages and filters on them", async () => {
    // Account A's creatives: one declared Retargeting, one left unassigned.
    await db
      .update(creatives)
      .set({ stages: ["Retargeting"] })
      .where(eq(creatives.name, "A-Creative-1"));
    await db
      .update(creatives)
      .set({ stages: [] })
      .where(eq(creatives.name, "A-Creative-2"));

    const tools = loadTools();
    const call = (args: Record<string, unknown>) =>
      runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
        tools.get("list_creatives")!(args, {}),
      );

    const all = parse(await call({}));
    const one = all.creatives.find(
      (c: { name: string }) => c.name === "A-Creative-1",
    );
    expect(one.stages).toEqual(["Retargeting"]);

    // The filter narrows to the declared creative only.
    const filtered = parse(await call({ stages: ["Retargeting"] }));
    expect(filtered.creatives.map((c: { name: string }) => c.name)).toEqual([
      "A-Creative-1",
    ]);

    // A stage nobody carries returns nothing, not everything.
    const empty = parse(await call({ stages: ["Activation"] }));
    expect(empty.creatives).toHaveLength(0);
  });

  it("diagnose_campaign returns the bundle envelope, instructions and all", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
      tools.get("diagnose_campaign")!(
        { campaign: "Camp One ➤ Broad (IG)", window_days: 30, include_excluded: false },
        {},
      ),
    );
    expect(res.isError).toBeUndefined();
    const b = parse(res);
    // The house envelope: brand + range + the exclusion echo.
    expect(b.brand.id).toBe(ACCOUNT_A);
    expect(b.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.excluded_records).toBe("hidden");
    // …and the bundle's own sections, including the two authored blocks that
    // make it usable by a model that has never seen this system.
    for (const key of [
      "meta",
      "series",
      "creatives",
      "benchmarks",
      "budget",
      "conventions",
      "instructions",
    ]) {
      expect(b[key], `${key} missing from the bundle`).toBeDefined();
    }
    expect(b.meta.name).toBe("Camp One ➤ Broad (IG)");
    expect(b.instructions).toMatch(/INTERVIEW RULE/);
    expect(b.conventions).toMatch(/REACH AND FREQUENCY ARE NOT TRACKED/);
  });

  it("diagnose_campaign refuses an unknown campaign and names the way out", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
      tools.get("diagnose_campaign")!({ campaign: "Nope ➤ None (IG)" }, {}),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/list_campaigns/);
  });

  it("diagnose_campaign cannot reach a brand the caller isn't a member of", async () => {
    const tools = loadTools();
    const res = await runWithMcpActor({ user: restricted, tokenId: "t" }, () =>
      tools.get("diagnose_campaign")!(
        { brand: "Account B", campaign: "Camp B ➤ Broad (IG)" },
        {},
      ),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unknown brand|allowed brands/i);
  });

  it("allowedAccountsForUser mirrors the scoping (belt-and-braces)", async () => {
    const brands = await allowedAccountsForUser(restricted);
    expect(brands.map((b) => b.id)).toEqual([ACCOUNT_A]);
  });
});

describe("get_actual_cml — Pricing · Actual on the MCP (2026-11-27)", () => {
  const call = (user: SessionUser, args: Record<string, unknown>) =>
    runWithMcpActor({ user, tokenId: "t" }, () => loadTools().get("get_actual_cml")!(args, {}));
  const viewer: SessionUser = { ...restricted, permissions: ["price_structure.view"] };
  const noPricing: SessionUser = { ...restricted, permissions: [] };

  it("refuses a member without price_structure.view, and a brand with no version", async () => {
    const refused = await call(noPricing, {});
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("price_structure.view");
    const none = await call(viewer, {});
    expect(none.isError).toBe(true);
    expect(none.content[0]!.text).toContain("no Pricing version");
  });

  it("reads the page's own computation: CML withheld while incomplete, the version by name", async () => {
    const data = sampleVersionData();
    await insertVersion(db, ACCOUNT_A, RESTRICTED_ID, { name: "Base", notes: "", data });
    await insertVersion(db, ACCOUNT_A, RESTRICTED_ID, { name: "Second", notes: "", data });
    // An uploaded order with no products: the totals foot, CML is withheld.
    await db.insert(storeOrders).values({
      accountId: ACCOUNT_A,
      orderId: "MCP-ACT-1",
      orderDate: "2026-06-04",
      totalAmount: "230.00",
      attributes: {},
    });
    const out = parse(await call(viewer, { from: "2026-06-01", to: "2026-06-30", version: "base" }));
    expect(out.brand.id).toBe(ACCOUNT_A);
    expect(out.range).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(out.version.name).toBe("Base");
    expect(out.plan?.id).toBe(data.activePlanId);
    expect(out.complete).toBe(false);
    expect(out.cml).toBeNull();
    expect(out.waterfall.cml).toBeNull();
    expect(out.incomplete_because.orders_without_products).toBe(1);
    expect(out.waterfall.store_total_incl_vat).toBe(230);
    const w = out.waterfall;
    expect(w.store_total_incl_vat - w.vat - w.lost - w.open_expected_to_fail - w.uploaded_expected_to_fail).toBeCloseTo(
      out.net_revenue,
      1,
    );
    expect(out.orders.uploaded).toBe(1);
    expect(out.plan_bridge).toBeNull();

    const unknown = await call(viewer, { version: "nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toContain("Base");
  });
});
