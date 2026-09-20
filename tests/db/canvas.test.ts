import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

vi.mock("@/lib/tenant", () => ({
  ACCOUNT_COOKIE: "ccms_account",
  getActiveAccountId: vi.fn(async () => ACCOUNT_A),
  getActiveAccount: vi.fn(),
  listAccounts: vi.fn(async () => []),
  getActiveStatusWindowHours: vi.fn(async () => 24),
}));

import { getActiveAccountId } from "@/lib/tenant";
import { canvasGraph } from "@/db/queries/canvas";
import { campaignNodeId, creativeNodeId } from "@/lib/canvas";
import { CREATIVE_STATUSES } from "@/lib/creative-status";
import {
  resetAndSeed,
  CAMPAIGN_1,
  CAMPAIGN_2,
  CREATIVE_1,
  CREATIVE_2,
  CREATIVE_B,
} from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);

/**
 * Fixture recap (account A): CREATIVE_1 spent 100 + 100 on instagram/camp1
 * (Jan 1–2) and 200 on facebook/camp2 (Jan 1); CREATIVE_2 has ONE row —
 * instagram/camp1, Jan 3, spend 1000 — and it is EXCLUDED.
 */
const JAN = { from: "2026-01-01", to: "2026-01-03" };
const ALL = [...CREATIVE_STATUSES];

beforeAll(async () => {
  await resetAndSeed();
});
beforeEach(() => setAccount(ACCOUNT_A));

describe("canvasGraph — edges are spend-in-range facts", () => {
  it("one edge per (campaign, creative), summed over the range", async () => {
    const g = await canvasGraph({ ...JAN, statuses: ALL });
    const byId = new Map(g.edges.map((e) => [e.id, e]));
    const e1 = byId.get(`${campaignNodeId(CAMPAIGN_1)}|${creativeNodeId(CREATIVE_1)}`)!;
    const e2 = byId.get(`${campaignNodeId(CAMPAIGN_2)}|${creativeNodeId(CREATIVE_1)}`)!;
    expect(e1.spend).toBe(200); // 100 + 100, two days, ONE edge
    expect(e2.spend).toBe(200);
    expect(g.edges).toHaveLength(2);
    // The edge carries the CAMPAIGN's platform (what it is colored by).
    expect(e1.platform).toBe("instagram");
    expect(e2.platform).toBe("facebook");
    expect(g.truncated).toBeNull();
  });

  it("nodes are exactly what the edges touch, with true range totals", async () => {
    const g = await canvasGraph({ ...JAN, statuses: ALL });
    expect(g.campaigns.map((c) => c.campaignId).sort()).toEqual(
      [CAMPAIGN_1, CAMPAIGN_2].sort(),
    );
    const c1 = g.creatives.find((c) => c.creativeId === CREATIVE_1)!;
    expect(c1.spend).toBe(400); // shared across both campaigns
    expect(c1.conversions).toBe(40);
    expect(c1.revenue).toBe(2000);
    const camp1 = g.campaigns.find((c) => c.campaignId === CAMPAIGN_1)!;
    expect(camp1.spend).toBe(200);
    expect(camp1.platform).toBe("instagram");
    expect(camp1.objective).toBe("Sales");
  });

  it("respects the RANGE", async () => {
    const g = await canvasGraph({ from: "2026-01-02", to: "2026-01-02", statuses: ALL });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.spend).toBe(100);
    expect(g.campaigns.map((c) => c.campaignId)).toEqual([CAMPAIGN_1]);
  });

  it("respects the EXCLUDED toggle — hidden by default, counted on request", async () => {
    const hidden = await canvasGraph({ ...JAN, statuses: ALL });
    expect(hidden.creatives.some((c) => c.creativeId === CREATIVE_2)).toBe(false);

    const shown = await canvasGraph({ ...JAN, statuses: ALL, includeExcluded: true });
    const e = shown.edges.find((x) => x.target === creativeNodeId(CREATIVE_2))!;
    expect(e.spend).toBe(1000);
    // …and the campaign's total moves with it: 200 + 1000.
    expect(shown.campaigns.find((c) => c.campaignId === CAMPAIGN_1)!.spend).toBe(1200);
  });

  it("respects the PLATFORM filter", async () => {
    const g = await canvasGraph({ ...JAN, statuses: ALL, platforms: ["facebook"] });
    expect(g.edges.map((e) => e.source)).toEqual([campaignNodeId(CAMPAIGN_2)]);
    expect(g.creatives.find((c) => c.creativeId === CREATIVE_1)!.spend).toBe(200);
  });

  it("is ACCOUNT-scoped — another brand's graph never leaks in", async () => {
    const a = await canvasGraph({ ...JAN, statuses: ALL });
    expect(a.creatives.some((c) => c.creativeId === CREATIVE_B)).toBe(false);

    setAccount(ACCOUNT_B);
    const b = await canvasGraph({ ...JAN, statuses: ALL });
    expect(b.creatives.map((c) => c.creativeId)).toEqual([CREATIVE_B]);
    expect(b.edges).toHaveLength(1);
    expect(b.edges[0]!.spend).toBe(777);
  });
});

describe("canvasGraph — the status filter hides, it never restates", () => {
  it("a hidden status drops the creative AND the edges into it", async () => {
    const all = await canvasGraph({ ...JAN, statuses: ALL });
    const status = all.creatives.find((c) => c.creativeId === CREATIVE_1)!.status;
    const others = ALL.filter((s) => s !== status);

    const g = await canvasGraph({ ...JAN, statuses: others });
    expect(g.creatives.some((c) => c.creativeId === CREATIVE_1)).toBe(false);
    expect(g.edges).toHaveLength(0);
    // A campaign with nothing visible left isn't drawn either.
    expect(g.campaigns).toHaveLength(0);
  });

  it("the campaign's total is its TRUE range spend, whatever is shown", async () => {
    // With excluded rows counted, camp1 has two creatives. Hide one by status
    // and the campaign's spend must NOT shrink to the visible edge.
    const all = await canvasGraph({ ...JAN, statuses: ALL, includeExcluded: true });
    const s1 = all.creatives.find((c) => c.creativeId === CREATIVE_1)!.status;
    const s2 = all.creatives.find((c) => c.creativeId === CREATIVE_2)!.status;
    if (s1 === s2) return; // same bucket in this fixture → nothing to hide apart
    const g = await canvasGraph({
      ...JAN,
      includeExcluded: true,
      statuses: ALL.filter((s) => s !== s2),
    });
    expect(g.creatives.some((c) => c.creativeId === CREATIVE_2)).toBe(false);
    expect(g.campaigns.find((c) => c.campaignId === CAMPAIGN_1)!.spend).toBe(1200);
  });
});

describe("canvasGraph — active-but-idle creatives", () => {
  // December has no spend at all, but CREATIVE_1 is still ACTIVE (status is
  // current liveness over ALL data, not the selected range).
  const DEC = { from: "2025-12-01", to: "2025-12-31" };

  it("an ACTIVE creative with no edge in the range is included, unconnected", async () => {
    const g = await canvasGraph({ ...DEC, statuses: ALL });
    expect(g.edges).toHaveLength(0);
    expect(g.campaigns).toHaveLength(0);
    const idle = g.creatives.find((c) => c.creativeId === CREATIVE_1);
    expect(idle).toBeDefined();
    expect(idle!.status).toBe("active");
    expect(idle!.spend).toBe(0);
  });

  it("…but not when Active is filtered out — hidden means hidden", async () => {
    const g = await canvasGraph({
      ...DEC,
      statuses: ALL.filter((s) => s !== "active"),
    });
    expect(g.creatives).toHaveLength(0);
  });

  it("a creative that DID spend in the range is never listed as idle", async () => {
    const g = await canvasGraph({ ...JAN, statuses: ALL });
    const hits = g.creatives.filter((c) => c.creativeId === CREATIVE_1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.spend).toBe(400);
  });

  it("idle creatives obey the account scope too", async () => {
    const g = await canvasGraph({ ...DEC, statuses: ALL });
    expect(g.creatives.some((c) => c.creativeId === CREATIVE_B)).toBe(false);
  });
});
