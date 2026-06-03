import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import { performanceRecords, uploadValidationSessions } from "@/db/schema";
import type { InternalField } from "@/csv/platforms/types";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import type { UpdateStoredPayload, UpdatePlanRow } from "../validate/route";

const bodySchema = z.object({ token: z.string().uuid() });

/**
 * Build a typed UPDATE `set` from a plan row's updates. Video-funnel columns
 * are only written for video creatives (they stay NULL for image/slides, as
 * the import pipeline guarantees).
 */
function buildSet(
  row: UpdatePlanRow,
): Partial<typeof performanceRecords.$inferInsert> {
  const isVideo = row.creativeType === "video";
  const set: Partial<typeof performanceRecords.$inferInsert> = {};
  for (const [field, value] of Object.entries(row.updates) as Array<
    [InternalField, number | undefined]
  >) {
    if (value === undefined) continue;
    switch (field) {
      case "spend": set.spend = String(value); break;
      case "impressions": set.impressions = value; break;
      case "clicks": set.clicks = value; break;
      case "conversions": set.conversions = value; break;
      case "conversion_value": set.conversionValue = String(value); break;
      case "landing_page_views": set.landingPageViews = value; break;
      case "video_views_2s": if (isVideo) set.videoViews2s = value; break;
      case "video_views_25": if (isVideo) set.videoViews25 = value; break;
      case "video_views_50": if (isVideo) set.videoViews50 = value; break;
      case "video_views_75": if (isVideo) set.videoViews75 = value; break;
      case "video_views_100": if (isVideo) set.videoViews100 = value; break;
      default: break;
    }
  }
  return set;
}

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
    return NextResponse.json({ error: "Body must be { token: <uuid> }" }, { status: 400 });
  }
  const { token } = parsed.data;

  try {
    await db
      .delete(uploadValidationSessions)
      .where(lt(uploadValidationSessions.expiresAt, new Date()));

    const [session] = await db
      .select({
        platform: uploadValidationSessions.platform,
        fileName: uploadValidationSessions.fileName,
        payload: uploadValidationSessions.payload,
        expiresAt: uploadValidationSessions.expiresAt,
      })
      .from(uploadValidationSessions)
      .where(eq(uploadValidationSessions.token, token))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Token not found or expired", code: "410" }, { status: 410 });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await db.delete(uploadValidationSessions).where(eq(uploadValidationSessions.token, token));
      return NextResponse.json({ error: "Token expired", code: "410" }, { status: 410 });
    }

    const payload = session.payload as UpdateStoredPayload;
    if (payload?.kind !== "update" || !payload.plan || payload.plan.length === 0) {
      return NextResponse.json({ error: "This token is not a bulk-update plan." }, { status: 422 });
    }

    const rowsUpdated = await db.transaction(async (tx) => {
      let n = 0;
      for (const row of payload.plan) {
        const set = buildSet(row);
        if (Object.keys(set).length === 0) continue;
        await tx
          .update(performanceRecords)
          .set(set)
          .where(eq(performanceRecords.id, row.recordId));
        n++;
      }
      await tx
        .delete(uploadValidationSessions)
        .where(eq(uploadValidationSessions.token, token));
      return n;
    });

    try {
      revalidatePath("/");
      revalidatePath("/creatives");
      revalidatePath("/uploads");
      revalidatePath("/funnel");
      revalidatePath("/campaigns");
    } catch (err) {
      console.warn("revalidatePath after bulk-update failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.RECORDS_BULK_UPDATE,
      entityType: "upload",
      entityId: null,
      entityLabel: session.fileName,
      actorUserId: user.id,
      meta: {
        platform: session.platform,
        rowsUpdated,
        cellsChanged: payload.summary?.cellsChanged ?? null,
        columns: payload.summary?.updateColumns ?? null,
        dateRange: payload.summary?.dateRange ?? null,
      },
    });

    return NextResponse.json({
      rowsUpdated,
      cellsChanged: payload.summary?.cellsChanged ?? 0,
    });
  } catch (err) {
    console.error("bulk-update commit failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while applying updates. No data was changed." },
      { status: 500 },
    );
  }
}
