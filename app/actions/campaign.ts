"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, inArray, ne, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { campaigns, parentCampaigns, performanceRecords } from "@/db/schema";
import {
  AD_NETWORK_LABEL,
  adSetPath,
  buildCampaignName,
  campaignPath,
  CAMPAIGN_PLATFORM_LOCKED,
  networkPlatforms,
  parseCampaignName,
  type AdNetwork,
} from "@/lib/campaign";
import { PLATFORM_LABEL } from "@/lib/palette";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { TouchCollector, touchesFromRecords } from "@/lib/audit-touches";
import {
  deleteRulesTargeting,
  releaseStaleObjectiveStamps,
  resweepActiveRules,
} from "@/db/queries/exclusion-rules";
import { deleteParentCampaignRows } from "@/db/queries/parent-campaign";
import { getActiveAccountId } from "@/lib/tenant";
import {
  addAdSetsSchema,
  createParentCampaignSchema,
  updateCampaignSchema,
  updateParentCampaignSchema,
  type AdSetDraft,
} from "@/validators/campaign";
import { actionError } from "@/lib/action-error";
import { uuidSchema } from "@/validators/shared";

/**
 * TWO LEVELS (2026-11; lib/campaign.ts). A CAMPAIGN is a `parent_campaigns`
 * row; an AD SET is a `campaigns` row under it — the object these actions
 * have always called "campaign". Both are registered by hand: the campaign
 * with its first ad sets (`createParentCampaign`), later ad sets from its
 * page (`addAdSets`). An ad set's stored name is ALWAYS
 * `buildCampaignName(campaign, ad set, platform)`, so it matches an uploaded
 * row byte-for-byte.
 */

export interface CampaignMutationResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Errors on the ad-set rows of a create / add form, by row index. */
  adSetErrors?: Record<number, string>;
  /** The stored name (an ad set's built name, or a campaign's own). */
  name?: string;
  /** A campaign's network — with `name`, its page's address. */
  network?: AdNetwork;
}

/** db or a transaction handle. */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

interface AdSetRow {
  /** Index of the form row this came from. */
  index: number;
  name: string;
  adsetName: string;
  platform: AdSetDraft["platforms"][number];
  objective: AdSetDraft["objective"];
}

const platformLabel = (p: string): string => (PLATFORM_LABEL as Record<string, string>)[p] ?? p;

/**
 * Turn the form's ad-set rows into registry rows: one per (ad set, platform),
 * each named through `buildCampaignName`. Refuses a platform outside the
 * campaign's network and a name listed twice.
 */
function buildAdSetRows(
  parent: { name: string; network: AdNetwork },
  drafts: readonly AdSetDraft[],
): { rows: AdSetRow[] } | { adSetErrors: Record<number, string> } {
  const allowed = networkPlatforms(parent.network);
  const rows: AdSetRow[] = [];
  const adSetErrors: Record<number, string> = {};
  const seen = new Map<string, number>();
  drafts.forEach((d, index) => {
    for (const platform of new Set(d.platforms)) {
      if (!allowed.includes(platform)) {
        adSetErrors[index] =
          `${platformLabel(platform)} isn't part of a ${AD_NETWORK_LABEL[parent.network]} campaign.`;
        return;
      }
      const name = buildCampaignName(parent.name, d.name, platform);
      if (seen.has(name)) {
        adSetErrors[index] = "This ad set is listed twice.";
        return;
      }
      seen.set(name, index);
      rows.push({ index, name, adsetName: d.name, platform, objective: d.objective });
    }
  });
  return Object.keys(adSetErrors).length > 0 ? { adSetErrors } : { rows };
}

/**
 * Which of these built names are already registered — and where. A stored
 * name is unique per BRAND (it is the upload-matching key), so the same
 * `Campaign ➤ Ad set` can't exist under a TikTok campaign and a Snapchat one
 * of the same name: the message names the platform that already has it.
 * Reads through `exec` — inside a transaction that is the `tx`.
 */
async function adSetCollisions(
  exec: Exec,
  acct: string,
  parentId: string | null,
  rows: readonly AdSetRow[],
  ignoreIds: readonly string[] = [],
): Promise<Record<number, string>> {
  if (rows.length === 0) return {};
  const existing = await exec
    .select({
      name: campaigns.name,
      platform: campaigns.platform,
      parentId: campaigns.parentId,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.accountId, acct),
        inArray(
          campaigns.name,
          rows.map((r) => r.name),
        ),
        ignoreIds.length > 0 ? notInArray(campaigns.id, [...ignoreIds]) : undefined,
      ),
    );
  const byName = new Map(existing.map((e) => [e.name, e]));
  const errors: Record<number, string> = {};
  for (const r of rows) {
    const hit = byName.get(r.name);
    if (!hit) continue;
    errors[r.index] =
      parentId !== null && hit.parentId === parentId
        ? `“${r.adsetName}” is already registered on ${platformLabel(hit.platform)} in this campaign.`
        : `“${r.name}” already exists on ${platformLabel(hit.platform)}. An ad set name can't repeat across platforms — rename this one (for example, add the platform).`;
  }
  return errors;
}

/** One `campaign.create` audit line per ad set, linked to its campaign too. */
async function auditAdSetsCreated(
  userId: string,
  parentId: string,
  created: ReadonlyArray<{ id: string; name: string; platform: string; objective: string }>,
): Promise<void> {
  for (const c of created) {
    await logAudit({
      action: AUDIT_ACTIONS.CAMPAIGN_CREATE,
      entityType: "campaign",
      entityId: c.id,
      entityLabel: c.name,
      actorUserId: userId,
      meta: { platform: c.platform, objective: c.objective },
      // The ad set links itself; this puts the line in its CAMPAIGN's Activity.
      touches: { parent_campaign: [parentId] },
    });
  }
}

/**
 * Register a CAMPAIGN together with its first ad sets ("New campaign"). The
 * campaign is unique per (brand, network, name); every ad set's stored name
 * is unique per brand. All-or-nothing, in one transaction.
 */
export async function createParentCampaign(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requirePermission("campaign.create");
    const parsed = createParentCampaignSchema.safeParse(input);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return {
        ok: false,
        error: f.adSets?.[0] ?? "Check the highlighted fields.",
        fieldErrors: { name: f.name?.[0] ?? "", network: f.network?.[0] ?? "" },
        adSetErrors: adSetIssueMap(parsed.error.issues),
      };
    }
    const { name, network, adSets } = parsed.data;
    const acct = await getActiveAccountId();

    const built = buildAdSetRows({ name, network }, adSets);
    if ("adSetErrors" in built) {
      return { ok: false, error: "Check the ad sets.", adSetErrors: built.adSetErrors };
    }

    const result = await db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: parentCampaigns.id })
        .from(parentCampaigns)
        .where(
          and(
            eq(parentCampaigns.accountId, acct),
            eq(parentCampaigns.network, network),
            eq(parentCampaigns.name, name),
          ),
        )
        .limit(1);
      if (clash) return { kind: "parent-exists" as const };
      const collisions = await adSetCollisions(tx, acct, null, built.rows);
      if (Object.keys(collisions).length > 0) return { kind: "collisions" as const, collisions };

      const [parent] = await tx
        .insert(parentCampaigns)
        .values({ accountId: acct, name, network, createdByUserId: user.id })
        .returning({ id: parentCampaigns.id });
      const created = await tx
        .insert(campaigns)
        .values(
          built.rows.map((r) => ({
            accountId: acct,
            parentId: parent!.id,
            adsetName: r.adsetName,
            name: r.name,
            platform: r.platform,
            objective: r.objective,
            createdByUserId: user.id,
          })),
        )
        .returning({
          id: campaigns.id,
          name: campaigns.name,
          platform: campaigns.platform,
          objective: campaigns.objective,
        });
      return { kind: "ok" as const, parentId: parent!.id, created };
    });

    if (result.kind === "parent-exists") {
      return {
        ok: false,
        error: `Campaign “${name}” already exists on ${AD_NETWORK_LABEL[network]}.`,
        fieldErrors: { name: "Already registered" },
      };
    }
    if (result.kind === "collisions") {
      return { ok: false, error: "Check the ad sets.", adSetErrors: result.collisions };
    }

    // NO revalidatePath (W2-1): the caller navigates to the new campaign's
    // page, and that navigation is the one render.
    await logAudit({
      action: AUDIT_ACTIONS.PARENT_CAMPAIGN_CREATE,
      entityType: "parent_campaign",
      entityId: result.parentId,
      entityLabel: name,
      actorUserId: user.id,
      meta: { network, adSets: result.created.length },
    });
    await auditAdSetsCreated(user.id, result.parentId, result.created);
    return { ok: true, name, network };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}

/** Zod issues on `adSets[i].*` → one message per row index. */
function adSetIssueMap(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const issue of issues) {
    const [root, index] = issue.path;
    if (root === "adSets" && typeof index === "number" && out[index] === undefined) {
      out[index] = issue.message;
    }
  }
  return out;
}

/**
 * Register more ad sets under an existing campaign ("Add ad set" on its
 * page). The campaign id is re-validated against the active brand.
 */
export async function addAdSets(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requirePermission("campaign.create");
    const parsed = addAdSetsSchema.safeParse(input);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return {
        ok: false,
        error: f.adSets?.[0] ?? "Check the ad sets.",
        adSetErrors: adSetIssueMap(parsed.error.issues),
      };
    }
    const { parentId, adSets } = parsed.data;
    const acct = await getActiveAccountId();

    const [parent] = await db
      .select({
        id: parentCampaigns.id,
        name: parentCampaigns.name,
        network: parentCampaigns.network,
      })
      .from(parentCampaigns)
      .where(and(eq(parentCampaigns.id, parentId), eq(parentCampaigns.accountId, acct)))
      .limit(1);
    if (!parent) return { ok: false, error: "Campaign not found." };

    const built = buildAdSetRows(parent, adSets);
    if ("adSetErrors" in built) {
      return { ok: false, error: "Check the ad sets.", adSetErrors: built.adSetErrors };
    }

    const result = await db.transaction(async (tx) => {
      const collisions = await adSetCollisions(tx, acct, parent.id, built.rows);
      if (Object.keys(collisions).length > 0) return { collisions };
      const created = await tx
        .insert(campaigns)
        .values(
          built.rows.map((r) => ({
            accountId: acct,
            parentId: parent.id,
            adsetName: r.adsetName,
            name: r.name,
            platform: r.platform,
            objective: r.objective,
            createdByUserId: user.id,
          })),
        )
        .returning({
          id: campaigns.id,
          name: campaigns.name,
          platform: campaigns.platform,
          objective: campaigns.objective,
        });
      return { created };
    });
    if ("collisions" in result) {
      return { ok: false, error: "Check the ad sets.", adSetErrors: result.collisions };
    }

    // ONE render (W2-1): the caller stays on the campaign's page, and this
    // revalidation is its re-render — the new ad sets appear in the table.
    try {
      revalidatePath(campaignPath(parent.network, parent.name));
    } catch (err) {
      console.warn("revalidatePath after adding ad sets failed:", err);
    }
    await auditAdSetsCreated(user.id, parent.id, result.created);
    return { ok: true, name: parent.name, network: parent.network };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}

/**
 * Rename a CAMPAIGN. Every ad set's stored name carries the campaign's, so
 * they are rebuilt in the SAME transaction — one edit instead of one per ad
 * set. Refused when the new name is taken on this network, or when a rebuilt
 * ad-set name would collide with another brand-wide. Records follow by id.
 */
export async function updateParentCampaign(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requirePermission("campaign.edit");
    const parsed = updateParentCampaignSchema.safeParse(input);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return { ok: false, error: "Invalid input", fieldErrors: { name: f.name?.[0] ?? "" } };
    }
    const { id, name } = parsed.data;
    const acct = await getActiveAccountId();

    const [current] = await db
      .select({
        id: parentCampaigns.id,
        name: parentCampaigns.name,
        network: parentCampaigns.network,
      })
      .from(parentCampaigns)
      .where(and(eq(parentCampaigns.id, id), eq(parentCampaigns.accountId, acct)))
      .limit(1);
    if (!current) return { ok: false, error: "Campaign not found." };
    if (name === current.name) return { ok: true, name, network: current.network };

    const result = await db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: parentCampaigns.id })
        .from(parentCampaigns)
        .where(
          and(
            eq(parentCampaigns.accountId, acct),
            eq(parentCampaigns.network, current.network),
            eq(parentCampaigns.name, name),
            ne(parentCampaigns.id, id),
          ),
        )
        .limit(1);
      if (clash) return { kind: "parent-exists" as const };

      const children = await tx
        .select({
          id: campaigns.id,
          name: campaigns.name,
          adsetName: campaigns.adsetName,
          platform: campaigns.platform,
          objective: campaigns.objective,
        })
        .from(campaigns)
        .where(and(eq(campaigns.accountId, acct), eq(campaigns.parentId, id)));
      const rebuilt: AdSetRow[] = children.map((c, index) => {
        // A row the reconcile hasn't reached reads its ad set off its name.
        const adsetName = c.adsetName ?? parseCampaignName(c.name, c.platform).adset;
        return {
          index,
          adsetName,
          name: buildCampaignName(name, adsetName, c.platform),
          platform: c.platform,
          objective: c.objective,
        };
      });
      const collisions = await adSetCollisions(
        tx,
        acct,
        null,
        rebuilt,
        children.map((c) => c.id),
      );
      const firstCollision = Object.values(collisions)[0];
      if (firstCollision) return { kind: "collision" as const, message: firstCollision };

      await tx
        .update(parentCampaigns)
        .set({ name })
        .where(and(eq(parentCampaigns.id, id), eq(parentCampaigns.accountId, acct)));
      for (const [i, c] of children.entries()) {
        const next = rebuilt[i]!;
        if (next.name === c.name && next.adsetName === c.adsetName) continue;
        await tx
          .update(campaigns)
          .set({ name: next.name, adsetName: next.adsetName })
          .where(and(eq(campaigns.id, c.id), eq(campaigns.accountId, acct)));
      }
      return { kind: "ok" as const, childIds: children.map((c) => c.id) };
    });

    if (result.kind === "parent-exists") {
      return {
        ok: false,
        error: `Campaign “${name}” already exists on ${AD_NETWORK_LABEL[current.network]}.`,
        fieldErrors: { name: "Already registered" },
      };
    }
    if (result.kind === "collision") {
      return { ok: false, error: result.message, fieldErrors: { name: "Ad set name clash" } };
    }

    // NO revalidatePath (W2-1): the address changed with the name, so the
    // caller follows the new URL — revalidating the old one would re-render a
    // page that now 404s.
    await logAudit({
      action: AUDIT_ACTIONS.PARENT_CAMPAIGN_UPDATE,
      entityType: "parent_campaign",
      entityId: id,
      entityLabel: name,
      actorUserId: user.id,
      meta: { renamedFrom: current.name, adSetsRenamed: result.childIds.length },
      // Its ad sets were renamed with it.
      touches: { campaign: result.childIds },
    });
    return { ok: true, name, network: current.network };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}

/**
 * Hard-delete a CAMPAIGN: every ad set under it, and every performance record
 * of those ad sets. The CREATIVES that ran in it are kept — only their
 * records here go. A sanctioned exit path for `performance_records`
 * (CLAUDE.md, Database rules #4), behind `campaign.delete` and the
 * confirm-with-summary + type-the-name dialog. Account-scoped; one transaction.
 */
export async function deleteParentCampaign(
  parentId: string,
): Promise<{ ok: boolean; error?: string; recordsDeleted?: number; adSetsDeleted?: number }> {
  try {
    const user = await requirePermission("campaign.delete");
    if (!uuidSchema.safeParse(parentId).success) {
      return { ok: false, error: "Invalid campaign id." };
    }
    const acct = await getActiveAccountId();

    // The id must exist AND belong to the active account — never trust the caller.
    const [target] = await db
      .select({ id: parentCampaigns.id, name: parentCampaigns.name })
      .from(parentCampaigns)
      .where(and(eq(parentCampaigns.accountId, acct), eq(parentCampaigns.id, parentId)))
      .limit(1);
    if (!target) return { ok: false, error: "Campaign not found." };

    const removed = await db.transaction((tx) => deleteParentCampaignRows(tx, acct, parentId));

    // NO revalidatePath (W2-1): the caller navigates to /campaigns, and that
    // navigation is the one render — the page being left no longer exists.
    await logAudit({
      action: AUDIT_ACTIONS.PARENT_CAMPAIGN_DELETE,
      entityType: "parent_campaign",
      entityId: target.id,
      entityLabel: target.name,
      actorUserId: user.id,
      meta: { adSetsDeleted: removed.adSetIds.length, recordsDeleted: removed.records },
      // Every ad set is named explicitly — one with no records would be
      // missed by a touch list built from the records alone.
      touches: {
        creative: removed.creativeIds,
        campaign: removed.adSetIds,
        budget_month: removed.months,
      },
    });
    return {
      ok: true,
      recordsDeleted: removed.records,
      adSetsDeleted: removed.adSetIds.length,
    };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}

/**
 * Edit an AD SET: its own name, platform and objective. The campaign part of
 * its stored name comes from its CAMPAIGN (rename that on the campaign's
 * page). The id is re-validated against the active account, and the rebuilt
 * name must stay unique per account. Existing performance_records follow
 * automatically — they reference campaign_id, not the name. Returns the new
 * stored name so the caller can follow the URL on rename.
 *
 * The PLATFORM is locked once the ad set has records (D9, 2026-10-23): the
 * records carry their own platform, so re-tagging it made the two disagree,
 * and the old name's next upload then hit E061. It can also only ever move
 * inside its campaign's network (Instagram ↔ Facebook).
 */
export async function updateCampaign(input: unknown): Promise<CampaignMutationResult> {
  try {
    const user = await requirePermission("campaign.edit");
    const parsed = updateCampaignSchema.safeParse(input);
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      return {
        ok: false,
        error: "Invalid input",
        fieldErrors: {
          adset: f.adset?.[0] ?? "",
          platform: f.platform?.[0] ?? "",
        },
      };
    }
    const { id, adset, platform, objective } = parsed.data;
    const acct = await getActiveAccountId();

    // The id must exist AND belong to the active account — don't trust the caller.
    const [current] = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        objective: campaigns.objective,
        platform: campaigns.platform,
        parentName: parentCampaigns.name,
        parentNetwork: parentCampaigns.network,
      })
      .from(campaigns)
      // Every ad set has its campaign (`parent_id` is NOT NULL).
      .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
      .where(and(eq(campaigns.id, id), eq(campaigns.accountId, acct)))
      .limit(1);
    if (!current) {
      return { ok: false, error: "Ad set not found." };
    }
    // The campaign part is its campaign's name — never the caller's.
    const name = buildCampaignName(current.parentName, adset, platform);
    if (!name) {
      return { ok: false, error: "Ad set name is empty.", fieldErrors: { adset: "Required" } };
    }
    const platformChanged = platform !== current.platform;
    if (platformChanged && !networkPlatforms(current.parentNetwork).includes(platform)) {
      return {
        ok: false,
        error: `${platformLabel(platform)} isn't part of a ${AD_NETWORK_LABEL[current.parentNetwork]} campaign.`,
        fieldErrors: { platform: "Not this campaign's platform" },
      };
    }

    // On rename, enforce per-account uniqueness against OTHER ad sets.
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
          error: `Ad set “${name}” already exists.`,
          fieldErrors: { adset: "Already registered" },
        };
      }
    }

    // An objective edit changes which `campaign_objective` rules cover this
    // ad set's records, so the materialized flags must be re-derived in the
    // SAME transaction as the write — otherwise the rules page and every
    // aggregate disagree with the rules until someone toggles a rule by hand.
    // Release its stamps from objective rules that no longer match, then
    // re-sweep so the new objective (or any other active rule) re-stamps.
    const objectiveChanged = objective !== current.objective;
    let exclusionsReleased = 0;
    let exclusionsRestamped = 0;
    // The records the re-sweep moved — their creatives are touched too.
    const touched = new TouchCollector();

    const locked = await db.transaction(async (tx) => {
      // Checked inside the transaction, against the same snapshot as the write.
      if (platformChanged) {
        const [hasRecord] = await tx
          .select({ id: performanceRecords.id })
          .from(performanceRecords)
          .where(
            and(eq(performanceRecords.accountId, acct), eq(performanceRecords.campaignId, id)),
          )
          .limit(1);
        if (hasRecord) return true;
      }
      await tx
        .update(campaigns)
        .set({ name, adsetName: adset, platform, objective })
        .where(and(eq(campaigns.id, id), eq(campaigns.accountId, acct)));

      if (objectiveChanged) {
        exclusionsReleased = await releaseStaleObjectiveStamps(tx, acct, id, objective, touched);
        exclusionsRestamped = await resweepActiveRules(tx, acct, touched);
      }
      return false;
    });
    if (locked) {
      return {
        ok: false,
        error: CAMPAIGN_PLATFORM_LOCKED,
        fieldErrors: { platform: "Locked" },
      };
    }

    // ONE render (W2-1), as patchCreative: unrenamed, this revalidation is
    // the staying caller's re-render; renamed, the caller follows the new URL
    // and a revalidation would re-render the old one, which now 404s.
    const renamed = name !== current.name;
    if (!renamed) {
      try {
        revalidatePath(adSetPath(name));
      } catch (err) {
        console.warn("revalidatePath after ad set update failed:", err);
      }
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
        objectiveChangedFrom: objectiveChanged ? current.objective : undefined,
        platformChangedFrom: platformChanged ? current.platform : undefined,
        // Exclusion rows re-derived by this edit (omitted when nothing moved).
        exclusionsReleased: exclusionsReleased || undefined,
        exclusionsRestamped: exclusionsRestamped || undefined,
      },
      // The ad set links itself; a re-sweep can also move OTHER ad sets'
      // rows (any active rule re-stamps), so only its creatives are passed.
      touches: { creative: touched.touches().creative },
    });
    return { ok: true, name };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}

/**
 * Hard-delete an AD SET and all of its `performance_records`. Those rows are
 * FK'd to exactly one ad set with NO `ON DELETE CASCADE`, so they're removed
 * explicitly (inside the transaction) before the row is dropped. Its CAMPAIGN
 * stays (delete that on the campaign's page). The CREATIVES that ran in it
 * are NOT deleted — only the records tying them to this ad set — so a
 * creative with data elsewhere keeps it; one that ran only here simply
 * becomes record-less (reads as "New").
 *
 * This is a sanctioned hard-delete exit path for `performance_records`,
 * alongside batch-rollback, the cleanup tool, and deleteCreative. The audit row
 * survives (it stores a label, not an FK). Editor-or-admin only; account-scoped.
 */
export async function deleteCampaign(
  campaignId: string,
): Promise<{ ok: boolean; error?: string; recordsDeleted?: number }> {
  try {
    const user = await requirePermission("campaign.delete");
    if (!uuidSchema.safeParse(campaignId).success) {
      return { ok: false, error: "Invalid ad set id." };
    }
    const acct = await getActiveAccountId();

    // The id must exist AND belong to the active account — never trust the caller.
    const [target] = await db
      .select({ id: campaigns.id, name: campaigns.name, parentId: campaigns.parentId })
      .from(campaigns)
      .where(and(eq(campaigns.accountId, acct), eq(campaigns.id, campaignId)))
      .limit(1);
    if (!target) return { ok: false, error: "Ad set not found." };

    const recordsDeleted = await db.transaction(async (tx) => {
      const countRows = await tx
        .select({ value: count() })
        .from(performanceRecords)
        .where(eq(performanceRecords.campaignId, campaignId));
      const n = countRows[0]?.value ?? 0;
      // Records first (no cascade on performance_records.campaign_id), then the
      // ad set's row itself. Creatives/upload_batches are left untouched.
      // RETURNING names the creatives that lost records and the months whose
      // actuals moved — the audit's links, captured as the rows go.
      const removed = await tx
        .delete(performanceRecords)
        .where(eq(performanceRecords.campaignId, campaignId))
        .returning({
          creativeId: performanceRecords.creativeId,
          campaignId: performanceRecords.campaignId,
          date: performanceRecords.date,
        });
      // Exclusion rules targeting this ad set go with it (their flagged rows
      // were just deleted, so nothing references the rule anymore).
      await deleteRulesTargeting(tx, acct, { campaignId });
      await tx.delete(campaigns).where(eq(campaigns.id, campaignId));
      return { n, touches: touchesFromRecords(removed, { months: true }) };
    });

    // NO revalidatePath (W2-1): the caller navigates away, and that
    // navigation is the one render. A revalidation here would re-render the
    // page being left — an ad set that no longer exists — and ship it in this
    // response, for nothing.

    await logAudit({
      action: AUDIT_ACTIONS.CAMPAIGN_DELETE,
      entityType: "campaign",
      entityId: target.id,
      entityLabel: target.name,
      actorUserId: user.id,
      meta: { recordsDeleted: recordsDeleted.n },
      // …and in its CAMPAIGN's Activity ("Deleted ad set").
      touches: {
        ...recordsDeleted.touches,
        ...(target.parentId ? { parent_campaign: [target.parentId] } : {}),
      },
    });

    return { ok: true, recordsDeleted: recordsDeleted.n };
  } catch (err) {
    return { ok: false, error: actionError(err, "campaign") };
  }
}
