import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ACCOUNT_A, ACCOUNT_B } from "./config";

/**
 * The polish after the campaign / ad set sweep (2026-11-24) — the places that
 * named a campaign or an ad set but gave no way to its page:
 *
 *  - the audit log links an entry to the page as it is named TODAY (by id),
 *    not by the label stored when the entry was written;
 *  - Funnel's platform expansion carries a campaign's network — with its
 *    name, its address.
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
import { campaigns, parentCampaigns } from "@/db/schema";
import { AUDIT_ACTIONS, writeAudit, type AuditAction, type AuditEntityType } from "@/lib/audit";
import { listAuditEvents } from "@/db/queries/audit";
import { platformCampaignFunnel } from "@/db/queries/funnel";
import { adSetPath, campaignPath } from "@/lib/campaign";
import { CAMPAIGN_1, CAMPAIGN_B, PARENT_1, PARENT_B, USER, resetAndSeed } from "./fixtures";

const setAccount = (id: string) => vi.mocked(getActiveAccountId).mockResolvedValue(id);
const RANGE = { from: "2026-01-01", to: "2026-01-31" };

beforeEach(async () => {
  await resetAndSeed();
  setAccount(ACCOUNT_A);
});

const event = (
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | null,
  entityLabel: string,
  accountId = ACCOUNT_A,
) =>
  writeAudit(db, {
    accountId,
    action,
    entityType,
    entityId,
    entityLabel,
    actorUserId: USER,
    meta: {},
  });

describe("the audit log links a campaign / ad set entry to its page TODAY", () => {
  it("resolves both levels from the id", async () => {
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_CREATE, "parent_campaign", PARENT_1, "Camp One");
    await event(AUDIT_ACTIONS.CAMPAIGN_CREATE, "campaign", CAMPAIGN_1, "Camp One ➤ Broad (IG)");
    const rows = await listAuditEvents({});
    const byType = new Map(rows.map((r) => [r.entityType, r.livePath]));
    expect(byType.get("parent_campaign")).toBe(campaignPath("meta", "Camp One"));
    expect(byType.get("campaign")).toBe(adSetPath("Camp One ➤ Broad (IG)"));
  });

  it("follows a rename — the stored label is the OLD name, the link the new page", async () => {
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_CREATE, "parent_campaign", PARENT_1, "Camp One");
    await event(AUDIT_ACTIONS.CAMPAIGN_CREATE, "campaign", CAMPAIGN_1, "Camp One ➤ Broad (IG)");
    await db.update(parentCampaigns).set({ name: "Renamed" }).where(eq(parentCampaigns.id, PARENT_1));
    await db
      .update(campaigns)
      .set({ name: "Renamed ➤ Broad (IG)" })
      .where(eq(campaigns.id, CAMPAIGN_1));

    const rows = await listAuditEvents({});
    const parent = rows.find((r) => r.entityType === "parent_campaign");
    const adSet = rows.find((r) => r.entityType === "campaign");
    expect(parent?.entityLabel).toBe("Camp One");
    expect(parent?.livePath).toBe(campaignPath("meta", "Renamed"));
    expect(adSet?.livePath).toBe(adSetPath("Renamed ➤ Broad (IG)"));
  });

  it("has no link for a row that is gone, an id that is not one, or another kind of entry", async () => {
    const GONE = "66666666-6666-6666-6666-6666666660ff";
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_DELETE, "parent_campaign", GONE, "Deleted camp");
    await event(AUDIT_ACTIONS.CAMPAIGN_DELETE, "campaign", "not-a-uuid", "Odd");
    await event(AUDIT_ACTIONS.CAMPAIGN_DELETE, "campaign", null, "No id");
    await event(AUDIT_ACTIONS.CREATIVE_CREATE, "creative", CAMPAIGN_1, "A creative");
    const rows = await listAuditEvents({});
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.livePath === null)).toBe(true);
  });

  it("never resolves another brand's row", async () => {
    // An entry in brand A that names brand B's campaign and ad set by id.
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_UPDATE, "parent_campaign", PARENT_B, "Camp B");
    await event(AUDIT_ACTIONS.CAMPAIGN_UPDATE, "campaign", CAMPAIGN_B, "Camp B ➤ Broad (IG)");
    const rows = await listAuditEvents({});
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.livePath === null)).toBe(true);

    // In its own brand the same ids resolve.
    await event(AUDIT_ACTIONS.PARENT_CAMPAIGN_UPDATE, "parent_campaign", PARENT_B, "Camp B", ACCOUNT_B);
    setAccount(ACCOUNT_B);
    const own = await listAuditEvents({});
    expect(own.map((r) => r.livePath)).toEqual([campaignPath("meta", "Camp B")]);
  });
});

describe("Funnel's platform expansion can address what it lists", () => {
  it("a campaign row carries its network; an ad-set row is addressed by its stored name", async () => {
    const byCampaign = await platformCampaignFunnel(RANGE, "campaign");
    expect(byCampaign.length).toBeGreaterThan(0);
    for (const r of byCampaign) expect(r.network).toBe("meta");
    expect(new Set(byCampaign.map((r) => r.campaign))).toEqual(new Set(["Camp One", "Camp Two"]));

    const byAdSet = await platformCampaignFunnel(RANGE, "adset");
    expect(byAdSet.length).toBeGreaterThan(0);
    for (const r of byAdSet) expect(r.network).toBeUndefined();
    expect(byAdSet.map((r) => r.campaign)).toContain("Camp One ➤ Broad (IG)");
  });
});
