import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
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
  summary: { rows: number; creatives: number; dateRange: { from: string; to: string } | null };
  rows: ParsedRow[];
  warnings: unknown[];
}

const CHUNK_SIZE = 500;

/**
 * POST /api/uploads/commit
 *
 * Body: { token }. Looks up the validation session, opens a transaction,
 * inserts an upload_batches row + bulk inserts performance_records, deletes
 * the session, commits. Returns { batchId, rowsImported }.
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

  // Lazy cleanup of expired sessions (small sweep, cheap with the expires_at index).
  await db
    .delete(uploadValidationSessions)
    .where(lt(uploadValidationSessions.expiresAt, new Date()));

  const [session] = await db
    .select({
      token: uploadValidationSessions.token,
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

  // Re-resolve creative IDs by name in case the registry shifted between
  // validate and commit. Names that vanished → 422 with a clear pointer.
  const names = [...new Set(payload.rows.map((r) => r.creativeName))];
  const found = await db
    .select({ id: creatives.id, name: creatives.name })
    .from(creatives)
    .where(inArray(creatives.name, names));
  const idByName = new Map(found.map((c) => [c.name, c.id]));
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

  // Transactional commit.
  const platform = session.platform as "meta" | "tiktok" | "snapchat" | "google";

  const result = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(uploadBatches)
      .values({
        platform,
        fileName: session.fileName,
        uploadedByUserId: user.id,
        rowsImported: payload.rows.length,
      })
      .returning({ id: uploadBatches.id });

    if (!batch) throw new Error("Failed to create upload batch");

    const inserts = payload.rows.map((r) => ({
      creativeId: idByName.get(r.creativeName)!,
      platform,
      date: r.date,
      spend: r.spend.toString(),
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: r.conversions,
      conversionValue:
        r.conversionValue === null ? null : r.conversionValue.toString(),
      videoViews3s: r.videoViews3s,
      videoViews15s: r.videoViews15s,
      rawPayload: r.rawPayload,
      uploadBatchId: batch.id,
    }));

    let inserted = 0;
    for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
      const chunk = inserts.slice(i, i + CHUNK_SIZE);
      const ret = await tx
        .insert(performanceRecords)
        .values(chunk)
        .returning({ id: performanceRecords.id });
      inserted += ret.length;
    }

    await tx
      .delete(uploadValidationSessions)
      .where(eq(uploadValidationSessions.token, token));

    return { batchId: batch.id, rowsImported: inserted };
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
    meta: {
      platform,
      rowsImported: result.rowsImported,
      dateRange: payload.summary?.dateRange ?? null,
      creatives: payload.summary?.creatives ?? null,
    },
  });

  return NextResponse.json(result);
}
