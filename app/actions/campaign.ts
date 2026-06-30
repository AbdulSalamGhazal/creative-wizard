"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import { campaigns } from "@/db/schema";
import { buildCampaignName } from "@/lib/campaign";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { getActiveAccountId } from "@/lib/tenant";
import { createCampaignSchema, updateCampaignSchema } from "@/validators/campaign";

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

/**
 * Edit a campaign's name (rebuilt from Campaign + Ad Set + Platform), platform,
 * and objective. The id is re-validated against the active account (never trust
 * the caller's id), and a rename must stay unique per account. Existing
 * performance_records follow automatically — they reference campaign_id, not the
 * name. Returns the new stored name so the caller can follow the URL on rename.
 */
export async function updateCampaign(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requireEditor();
    const parsed = updateCampaignSchema.safeParse(input);
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
    const { id, campaign, adset, platform, objective } = parsed.data;
    const name = buildCampaignName(campaign, adset, platform);
    if (!name) {
      return { ok: false, error: "Campaign name is empty.", fieldErrors: { campaign: "Required" } };
    }
    const acct = await getActiveAccountId();

    // The id must exist AND belong to the active account — don't trust the caller.
    const [current] = await db
      .select({ id: campaigns.id, name: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.accountId, acct)))
      .limit(1);
    if (!current) {
      return { ok: false, error: "Campaign not found." };
    }

    // On rename, enforce per-account uniqueness against OTHER campaigns.
    if (name !== current.name) {
      const [clash] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(eq(campaigns.accountId, acct), eq(campaigns.name, name), ne(campaigns.id, id)),
        )
        .limit(1);
      if (clash) {
        return {
          ok: false,
          error: `Campaign “${name}” already exists.`,
          fieldErrors: { campaign: "Already registered" },
        };
      }
    }

    await db
      .update(campaigns)
      .set({ name, platform, objective })
      .where(and(eq(campaigns.id, id), eq(campaigns.accountId, acct)));

    try {
      revalidatePath("/campaigns");
      revalidatePath(`/campaigns/${encodeURIComponent(name)}`);
      if (name !== current.name) {
        revalidatePath(`/campaigns/${encodeURIComponent(current.name)}`);
      }
    } catch (err) {
      console.warn("revalidatePath after campaign update failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CAMPAIGN_UPDATE,
      entityType: "campaign",
      entityId: id,
      entityLabel: name,
      actorUserId: user.id,
      meta: {
        platform,
        objective,
        renamedFrom: name !== current.name ? current.name : undefined,
      },
    });
    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
