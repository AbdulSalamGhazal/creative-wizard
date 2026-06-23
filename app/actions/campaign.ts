"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import { campaigns } from "@/db/schema";
import { buildCampaignName } from "@/lib/campaign";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { createCampaignSchema } from "@/validators/campaign";

export interface CampaignMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** The built stored name, echoed back so the UI can confirm what was created. */
  name?: string;
}

/**
 * Register a campaign. The buyer gives Campaign + Ad Set + Platform; we build
 * the SAME stored name the upload pipeline would (buildCampaignName) so the
 * registry matches uploaded rows exactly. Unique per account.
 */
export async function createCampaign(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requireEditor();
    const parsed = createCampaignSchema.safeParse(input);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return {
        ok: false,
        error: "Invalid input",
        fieldErrors: {
          campaign: f.campaign?.[0] ?? "",
          adset: f.adset?.[0] ?? "",
          platform: f.platform?.[0] ?? "",
        },
      };
    }
    const { campaign, adset, platform, objective } = parsed.data;
    const name = buildCampaignName(campaign, adset, platform);
    if (!name) {
      return {
        ok: false,
        error: "Campaign name is empty.",
        fieldErrors: { campaign: "Required" },
      };
    }
    const acct = await getActiveAccountId();

    const [exists] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.name, name)))
      .limit(1);
    if (exists) {
      return {
        ok: false,
        error: `Campaign “${name}” already exists.`,
        fieldErrors: { campaign: "Already registered" },
      };
    }

    const [inserted] = await db
      .insert(campaigns)
      .values({ accountId: acct, name, platform, objective, createdByUserId: user.id })
      .returning({ id: campaigns.id });

    try {
      revalidatePath("/campaigns");
    } catch (err) {
      console.warn("revalidatePath after campaign create failed:", err);
    }
    if (inserted) {
      await logAudit({
        action: AUDIT_ACTIONS.CAMPAIGN_CREATE,
        entityType: "campaign",
        entityId: inserted.id,
        entityLabel: name,
        actorUserId: user.id,
        meta: { platform, objective },
      });
    }
    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
