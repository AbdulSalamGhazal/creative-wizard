import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  campaigns,
  creatives,
  performanceRecords,
  uploadBatches,
  uploadValidationSessions,
} from "@/db/schema";
import type { ParsedRow } from "@/csv/pipeline";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

const bodySchema = z.object({
  token: z.string().uuid(),
});

interface StoredPayload {
  summary: {
    rows: number;
    creatives: number;
    dateRange: { from: string; to: string } | null;
    upsert?: true;
    newRows?: number;
    updatedRows?: number;
  };
  rows: ParsedRow[];
  warnings: unknown[];
  /**
   * Upsert only: aligned 1:1 with `rows`. Each entry is the existing
   * performance_records id to UPDATE in place, or null when the row is new
   * (insert). Absent for a plain strict-insert import.
   */
  existingIds?: (number | null)[];
}

const CHUNK_SIZE = 500;

/**
 * POST /api/uploads/commit
 *
 * Body: { token }. Looks up the validation session, opens a transaction,
 * inserts an upload_batches row + bulk inserts performance_records, deletes
 * the session, commits. Returns { batchId, rowsImported, rowsUpdated, upsert }.
 *
 * In upsert mode (the session carries `existingIds`) rows that already exist
 * are UPDATEd in place and only the new rows are inserted under a fresh batch
 * — a pure-update upsert creates no batch (batchId null).
 *
 * Status codes:
 *   200 — committed
 *   400 — bad input
 *   401 — not signed in
 *   410 — token absent or expired
 *   422 — payload references creatives that no longer exist (post-validate edit)
 *   500 — unexpected
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireEditor();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body must be { token: <uuid> }" },
      { status: 400 },
    );
  }
  const { token } = parsed.data;

  try {
  // Lazy cleanup of expired sessions (small sweep, cheap with the expires_at index).
  await db
    .delete(uploadValidationSessions)
    .where(lt(uploadValidationSessions.expiresAt, new Date()));

  const [session] = await db
    .select({
      token: uploadValidationSessions.token,
      accountId: uploadValidationSessions.accountId,
      platform: uploadValidationSessions.platform,
      fileName: uploadValidationSessions.fileName,
      payload: uploadValidationSessions.payload,
      expiresAt: uploadValidationSessions.expiresAt,
    })
    .from(uploadValidationSessions)
    .where(eq(uploadValidationSessions.token, token))
    .limit(1);

  if (!session) {
    return NextResponse.json(
      { error: "Token not found or expired", code: "410" },
      { status: 410 },
    );
  }
  if (session.expiresAt.getTime() < Date.now()) {
    await db
      .delete(uploadValidationSessions)
      .where(eq(uploadValidationSessions.token, token));
    return NextResponse.json(
      { error: "Token expired", code: "410" },
      { status: 410 },
    );
  }

  const payload = session.payload as StoredPayload;
  if (!payload?.rows || payload.rows.length === 0) {
    return NextResponse.json(
      { error: "Payload has no rows to commit." },
      { status: 422 },
    );
  }

  // Scope every write to the account the session was validated under — NOT the
  // current cookie — so a brand switch between validate and commit can't write
  // this file's rows into a different brand.
  const acct = session.accountId;

  // Re-resolve creative IDs by name in case the registry shifted between
  // validate and commit. Names that vanished → 422 with a clear pointer.
  const names = [...new Set(payload.rows.map((r) => r.creativeName))];
  const found = await db
    .select({ id: creatives.id, name: creatives.name, type: creatives.type })
    .from(creatives)
    .where(and(eq(creatives.accountId, acct), inArray(creatives.name, names)));
  const idByName = new Map(found.map((c) => [c.name, c.id]));
  const typeByName = new Map(found.map((c) => [c.name, c.type]));
  const missing = names.filter((n) => !idByName.has(n));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "Some creatives were removed since validation.",
        missing,
      },
      { status: 422 },
    );
  }

  // Resolve campaign_id from the registry (account-scoped). The names were
  // validated as registered at validate-time (E061); re-resolve here in case the
  // registry shifted. A vanished campaign → 422, like the creative case.
  const campaignNames = [...new Set(payload.rows.map((r) => r.campaignName))];
  const campRows = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(
      and(eq(campaigns.accountId, acct), inArray(campaigns.name, campaignNames)),
    );
  const campaignIdByName = new Map(campRows.map((c) => [c.name, c.id]));
  const missingCampaigns = campaignNames.filter(
    (n) => !campaignIdByName.has(n),
  );
  if (missingCampaigns.length > 0) {
    return NextResponse.json(
      {
        error: "Some campaigns were removed since validation.",
        missing: missingCampaigns,
      },
      { status: 422 },
    );
  }

  // Transactional commit.
  const platform = session.platform as
    | "instagram"
    | "facebook"
    | "tiktok"
    | "snapchat";

  // Column values for one performance_records row. Identity columns
  // (creative/platform/campaign/date) are added separately for inserts;
  // updates only overwrite these metric columns. Video-funnel metrics apply
  // to video creatives only — NULL for image/slides so they're excluded from
  // hook/hold/complete rates (the metrics filter on `video_views_2s IS NOT NULL`).
  const metricValues = (r: ParsedRow) => {
    const isVideo = typeByName.get(r.creativeName) === "video";
    return {
      spend: r.spend.toString(),
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      conversionValue:
        r.conversionValue === null ? null : r.conversionValue.toString(),
      landingPageViews: r.landingPageViews,
      addToCart: r.addToCart,
      addPayment: r.addPayment,
      videoViews2s: isVideo ? r.videoViews2s : null,
      videoViews25: isVideo ? r.videoViews25 : null,
      videoViews50: isVideo ? r.videoViews50 : null,
      videoViews75: isVideo ? r.videoViews75 : null,
      videoViews100: isVideo ? r.videoViews100 : null,
      rawPayload: r.rawPayload,
    };
  };

  // Partition rows into inserts (new) and updates (overwrite existing by id).
  // For a plain import `existingIds` is absent → every row is an insert.
  const existingIds = payload.existingIds;
  const upsert = Array.isArray(existingIds);
  const insertRows: ParsedRow[] = [];
  const updateRows: { id: number; row: ParsedRow }[] = [];
  if (upsert) {
    payload.rows.forEach((r, i) => {
      const recordId = existingIds![i] ?? null;
      if (recordId === null) insertRows.push(r);
      else updateRows.push({ id: recordId, row: r });
    });
  } else {
    insertRows.push(...payload.rows);
  }

  const result = await db.transaction(async (tx) => {
    // Only open a batch when there are new rows to insert. A pure-update
    // upsert (every row already exists) creates no batch.
    let batchId: string | null = null;
    let inserted = 0;

    if (insertRows.length > 0) {
      const [batch] = await tx
        .insert(uploadBatches)
        .values({
          accountId: acct,
          platform,
          fileName: session.fileName,
          uploadedByUserId: user.id,
          rowsImported: insertRows.length,
        })
        .returning({ id: uploadBatches.id });

      if (!batch) throw new Error("Failed to create upload batch");
      batchId = batch.id;

      const inserts = insertRows.map((r) => ({
        accountId: acct,
        creativeId: idByName.get(r.creativeName)!,
        platform,
        // Dual-write during the expand phase: campaign_id is the new identity,
        // campaign_name stays populated until the contract migration drops it.
        campaignName: r.campaignName,
        campaignId: campaignIdByName.get(r.campaignName)!,
        date: r.date,
        ...metricValues(r),
        uploadBatchId: batch.id,
      }));

      for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
        const chunk = inserts.slice(i, i + CHUNK_SIZE);
        const ret = await tx
          .insert(performanceRecords)
          .values(chunk)
          .returning({ id: performanceRecords.id });
        inserted += ret.length;
      }
    }

    // Per-row in-place update of existing records (full last-value-wins
    // overwrite of the metric columns). Identity, batch ownership and
    // exclusion flags are left untouched.
    let updated = 0;
    for (const { id, row } of updateRows) {
      const ret = await tx
        .update(performanceRecords)
        .set(metricValues(row))
        .where(
          and(
            eq(performanceRecords.accountId, acct),
            eq(performanceRecords.id, id),
          ),
        )
        .returning({ id: performanceRecords.id });
      updated += ret.length;
    }

    await tx
      .delete(uploadValidationSessions)
      .where(eq(uploadValidationSessions.token, token));

    return { batchId, rowsImported: inserted, rowsUpdated: updated, upsert };
  });

  // Refresh dashboard caches. Wrapped in try/catch so a revalidate failure
  // doesn't mask the successful commit.
  try {
    revalidatePath("/");
    revalidatePath("/creatives");
    revalidatePath("/uploads");
  } catch (err) {
    console.warn("revalidatePath after commit failed:", err);
  }

  await logAudit({
    action: AUDIT_ACTIONS.UPLOAD_COMMIT,
    entityType: "upload",
    entityId: result.batchId,
    entityLabel: session.fileName,
    actorUserId: user.id,
    accountId: acct,
    meta: {
      platform,
      rowsImported: result.rowsImported,
      rowsUpdated: result.rowsUpdated,
      upsert: result.upsert,
      dateRange: payload.summary?.dateRange ?? null,
      creatives: payload.summary?.creatives ?? null,
    },
  });

  return NextResponse.json(result);
  } catch (err) {
    console.error("upload commit failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while importing. No data was committed." },
      { status: 500 },
    );
  }
}
