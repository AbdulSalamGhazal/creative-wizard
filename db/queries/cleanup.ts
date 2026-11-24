import { and, asc, between, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  creatives,
  parentCampaigns,
  performanceRecords,
  platformEnum,
} from "@/db/schema";
import type { AdNetwork } from "@/lib/campaign";
import { getActiveAccountId } from "@/lib/tenant";
import { CleanupScopeChangedError } from "@/lib/cleanup-guard";
import { touchesFromRecords, type AuditTouches } from "@/lib/audit-touches";

type Platform = (typeof platformEnum)[number];

export interface CleanupMatch {
  platforms?: Platform[];
  from?: string;
  to?: string;
  productIds?: string[];
  creativeIds?: string[];
  /** AD SETS, by stored name (the key predates the two levels). */
  campaigns?: string[];
  /** Whole CAMPAIGNS, by id (2026-11): every ad set under each. */
  parentCampaignIds?: string[];
}

export interface CleanupPreview {
  rows: number;
  spend: number;
  creatives: number;
  from: string | null;
  to: string | null;
}

/**
 * Build the WHERE conditions shared by the preview and the delete so they
 * match exactly the same rows. Returns an empty array when no filter is set
 * — callers MUST treat empty as "match nothing" and refuse to delete.
 */
async function buildConditions(
  f: CleanupMatch,
  acct: string,
): Promise<SQL[]> {
  const conds: SQL[] = [eq(performanceRecords.accountId, acct)];
  if (f.platforms && f.platforms.length > 0) {
    conds.push(inArray(performanceRecords.platform, f.platforms));
  }
  if (f.from && f.to) {
    conds.push(between(performanceRecords.date, f.from, f.to));
  }
  if (f.creativeIds && f.creativeIds.length > 0) {
    conds.push(inArray(performanceRecords.creativeId, f.creativeIds));
  }
  if (f.campaigns && f.campaigns.length > 0) {
    // The picker supplies campaign NAMES (the combined "Campaign ➤ Adset" value
    // with the platform suffix for IG/FB). Resolve them to campaign ids scoped
    // to the active account, then match by campaign_id so we delete precisely
    // the rows the user picked.
    const campIds = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, acct),
          inArray(campaigns.name, f.campaigns),
        ),
      );
    conds.push(
      inArray(
        performanceRecords.campaignId,
        campIds.map((c) => c.id),
      ),
    );
  }
  if (f.parentCampaignIds && f.parentCampaignIds.length > 0) {
    // A whole campaign = the records of every ad set under it. Resolved to
    // ad-set ids scoped to the active account (never trust a caller's id),
    // then matched by campaign_id like the ad-set picker above — so picking
    // a campaign AND one of its ad sets narrows to that ad set (AND).
    const adSetIds = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.accountId, acct),
          inArray(campaigns.parentId, f.parentCampaignIds),
        ),
      );
    conds.push(
      inArray(
        performanceRecords.campaignId,
        adSetIds.map((c) => c.id),
      ),
    );
  }
  if (f.productIds && f.productIds.length > 0) {
    // performance_records has no product_id; match creatives under the selected
    // products via a subquery. Scope the subquery to the active account too —
    // it feeds a destructive hard-delete, so it must never resolve another
    // brand's product ids.
    conds.push(
      inArray(
        performanceRecords.creativeId,
        db
          .select({ id: creatives.id })
          .from(creatives)
          .where(
            and(
              eq(creatives.accountId, acct),
              inArray(creatives.productId, f.productIds),
            ),
          ),
      ),
    );
  }
  return conds;
}

/**
 * Did the user supply at least one real filter? The account scope is always
 * present in the SQL conditions, so we can't infer "no filter" from the
 * conditions array — we check the user-facing fields directly. Callers MUST
 * treat false as "match nothing" and refuse to delete.
 */
function hasAnyFilter(f: CleanupMatch): boolean {
  return Boolean(
    (f.platforms && f.platforms.length > 0) ||
      (f.from && f.to) ||
      (f.creativeIds && f.creativeIds.length > 0) ||
      (f.productIds && f.productIds.length > 0) ||
      (f.campaigns && f.campaigns.length > 0) ||
      (f.parentCampaignIds && f.parentCampaignIds.length > 0),
  );
}

/**
 * Distinct campaign names for the active account, for the cleanup campaign
 * picker. Date-unbounded on purpose — cleanup operates on historical data, so
 * the picker must surface every campaign that has ever stored a record, not
 * just recent ones.
 */
export async function listAccountCampaigns(): Promise<string[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .selectDistinct({ name: campaigns.name })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .where(eq(performanceRecords.accountId, acct))
    .orderBy(asc(campaigns.name));
  return rows.map((r) => r.name);
}

/** One campaign as the cleanup picker lists it. */
export interface CleanupCampaignOption {
  id: string;
  name: string;
  network: AdNetwork;
}

/**
 * The active account's CAMPAIGNS that have ever stored a record, for the
 * cleanup tool's Campaigns picker — date-unbounded for the same reason as the
 * ad-set list above. Two campaigns may share a name across networks, so each
 * carries its network.
 */
export async function listAccountParentCampaigns(): Promise<CleanupCampaignOption[]> {
  const acct = await getActiveAccountId();
  return db
    .selectDistinct({
      id: parentCampaigns.id,
      name: parentCampaigns.name,
      network: parentCampaigns.network,
    })
    .from(performanceRecords)
    .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
    .innerJoin(parentCampaigns, eq(parentCampaigns.id, campaigns.parentId))
    .where(eq(performanceRecords.accountId, acct))
    .orderBy(asc(parentCampaigns.name), asc(parentCampaigns.network));
}

/** Count + summarize what a cleanup selection would affect. Read-only. */
export async function previewCleanup(f: CleanupMatch): Promise<CleanupPreview> {
  if (!hasAnyFilter(f)) {
    return { rows: 0, spend: 0, creatives: 0, from: null, to: null };
  }
  const conds = await buildConditions(f, await getActiveAccountId());
  const [row] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      spend: sql<number>`COALESCE(SUM(${performanceRecords.spend}), 0)::float8`,
      creatives: sql<number>`count(DISTINCT ${performanceRecords.creativeId})::int`,
      minDate: sql<string | null>`MIN(${performanceRecords.date})`,
      maxDate: sql<string | null>`MAX(${performanceRecords.date})`,
    })
    .from(performanceRecords)
    .where(and(...conds));

  return {
    rows: Number(row?.rows ?? 0),
    spend: Number(row?.spend ?? 0),
    creatives: Number(row?.creatives ?? 0),
    from: row?.minDate ?? null,
    to: row?.maxDate ?? null,
  };
}

/**
 * Hard-delete every performance_record matching the selection. Returns the
 * number of rows removed and what they belonged to (the audit's `touches`,
 * named by the DELETE itself — afterwards nothing is left to resolve it
 * from). Refuses to run with no filter (returns 0) as a last-resort guard
 * against deleting everything.
 *
 * NOTE: this is a sanctioned second exit path for performance_records
 * (admin-only, audited at the action layer) in addition to batch rollback.
 */
export async function deleteRecords(
  f: CleanupMatch,
  expectedRows?: number,
): Promise<{ deleted: number; touches: AuditTouches }> {
  if (!hasAnyFilter(f)) return { deleted: 0, touches: {} };
  // Resolved BEFORE the transaction: the conditions read the campaigns table
  // and the active brand, and the pool is one connection in production.
  const conds = await buildConditions(f, await getActiveAccountId());
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(performanceRecords)
      .where(and(...conds))
      .returning({
        id: performanceRecords.id,
        creativeId: performanceRecords.creativeId,
        campaignId: performanceRecords.campaignId,
        date: performanceRecords.date,
      });
    // Exactly what was previewed, or nothing (W1-7).
    if (expectedRows !== undefined && deleted.length !== expectedRows) {
      throw new CleanupScopeChangedError(deleted.length, expectedRows);
    }
    return {
      deleted: deleted.length,
      touches: touchesFromRecords(deleted, { months: true }),
    };
  });
}
