import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  performanceRecords,
  platformEnum,
  uploadBatches,
  uploadValidationSessions,
} from "@/db/schema";
import { MAX_FILE_BYTES } from "@/csv/parse";
import { runPipeline, type ParsedRow } from "@/csv/pipeline";
import { resolveAdapter } from "@/db/queries/platforms";

const VALIDATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

const platformSchema = z.enum(platformEnum);

/**
 * POST /api/uploads/validate
 *
 * Accepts: multipart/form-data with `file` (CSV or XLSX) and `platform`.
 * Platform is **required** — the team picks it explicitly to prevent a
 * "wrong-platform" mistake. Runs the 5-stage validation pipeline.
 *
 * Status codes:
 *   200 — valid; token returned
 *   400 — bad form input (missing file / missing or invalid platform)
 *   401 — not signed in
 *   413 — file > 10 MB
 *   422 — validation errors
 *   500 — unexpected
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireEditor();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const rawPlatform = form.get("platform");
  const file = form.get("file");
  // Upsert mode: rows already in the DB are UPDATED in place instead of
  // rejected (E051), and rows that don't exist are inserted. Default off —
  // a plain import stays strict-insert. Built for attribution backfill
  // (e.g. TikTok re-reporting sales for the past week).
  const upsert =
    form.get("upsert") === "true" || form.get("upsert") === "1";

  const platformResult = platformSchema.safeParse(rawPlatform);
  if (!platformResult.success) {
    return NextResponse.json(
      {
        error:
          "Pick a platform before validating (instagram / facebook / tiktok / snapchat / google).",
      },
      { status: 400 },
    );
  }
  const platform = platformResult.data;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected a `file` field with a CSV or XLSX upload." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: "File exceeds the 10 MB upload limit.",
        code: "E001",
      },
      { status: 413 },
    );
  }

  try {
  const buffer = new Uint8Array(await file.arrayBuffer());

  // Snapshot of registered creative names (strict byte-equal matching).
  const allNames = await db.select({ name: creatives.name }).from(creatives);
  const registeredNames = new Set(allNames.map((r) => r.name));

  const adapter = await resolveAdapter(platform);

  const result = await runPipeline({
    content: buffer,
    byteLength: file.size,
    adapter,
    registeredNames,
    // In upsert mode we DON'T reject existing rows (no E051) — the pipeline
    // skips Stage 5 entirely when findExistingBatch is omitted, and we
    // partition new-vs-existing below instead.
    findExistingBatch: upsert
      ? undefined
      : async (name, plat, campaignName, date) => {
          const [row] = await db
            .select({ batchId: performanceRecords.uploadBatchId })
            .from(performanceRecords)
            .innerJoin(
              creatives,
              eq(creatives.id, performanceRecords.creativeId),
            )
            .innerJoin(
              uploadBatches,
              eq(uploadBatches.id, performanceRecords.uploadBatchId),
            )
            .where(
              and(
                eq(creatives.name, name),
                eq(performanceRecords.platform, plat),
                eq(performanceRecords.campaignName, campaignName),
                eq(performanceRecords.date, date),
                eq(uploadBatches.status, "active"),
              ),
            )
            .limit(1);
          return row?.batchId ?? null;
        },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        platform,
        errors: result.errors,
        warnings: result.warnings,
      },
      { status: 422 },
    );
  }

  // Upsert partition: for each validated row decide insert (new) vs update
  // (an existing active record). `existingIds[i]` is the performance_records
  // id to overwrite, or null when the row is new. Computed only in upsert
  // mode; a plain import leaves it undefined and inserts everything.
  let existingIds: (number | null)[] | undefined;
  let updatedRows = 0;
  let newRows = result.rows.length;

  if (upsert) {
    const wantedNames = [...new Set(result.rows.map((r) => r.creativeName))];
    const nameRows = wantedNames.length
      ? await db
          .select({ id: creatives.id, name: creatives.name })
          .from(creatives)
          .where(inArray(creatives.name, wantedNames))
      : [];
    const idByName = new Map(nameRows.map((c) => [c.name, c.id]));
    const creativeIds = [...idByName.values()];
    const campaignNames = [
      ...new Set(result.rows.map((r) => r.campaignName)),
    ];
    const recordDates = [...new Set(result.rows.map((r) => r.date))];

    // Existing active records that could collide. We over-fetch on the IN
    // sets and key precisely in JS to keep the SQL simple.
    const existing =
      creativeIds.length && campaignNames.length && recordDates.length
        ? await db
            .select({
              id: performanceRecords.id,
              creativeId: performanceRecords.creativeId,
              campaignName: performanceRecords.campaignName,
              date: performanceRecords.date,
            })
            .from(performanceRecords)
            .innerJoin(
              uploadBatches,
              eq(uploadBatches.id, performanceRecords.uploadBatchId),
            )
            .where(
              and(
                eq(performanceRecords.platform, platform),
                eq(uploadBatches.status, "active"),
                inArray(performanceRecords.creativeId, creativeIds),
                inArray(performanceRecords.campaignName, campaignNames),
                inArray(performanceRecords.date, recordDates),
              ),
            )
        : [];

    const SEP = "\u0001";
    const idByIdentity = new Map<string, number>();
    for (const e of existing) {
      idByIdentity.set(
        `${e.creativeId}${SEP}${e.campaignName}${SEP}${e.date}`,
        e.id,
      );
    }

    existingIds = result.rows.map((r) => {
      const cid = idByName.get(r.creativeName);
      if (cid === undefined) return null;
      const hit = idByIdentity.get(
        `${cid}${SEP}${r.campaignName}${SEP}${r.date}`,
      );
      return hit ?? null;
    });
    updatedRows = existingIds.filter((x) => x !== null).length;
    newRows = existingIds.length - updatedRows;
  }

  // Build summary
  const dates = result.rows.map((r) => r.date).sort();
  const creativesCount = new Set(result.rows.map((r) => r.creativeName)).size;
  const summary = {
    rows: result.rows.length,
    creatives: creativesCount,
    dateRange:
      dates.length > 0
        ? { from: dates[0]!, to: dates[dates.length - 1]! }
        : null,
    ...(upsert ? { upsert: true as const, newRows, updatedRows } : {}),
  };

  const expiresAt = new Date(Date.now() + VALIDATION_TTL_MS);
  const payload = {
    summary,
    rows: result.rows,
    warnings: result.warnings,
    ...(existingIds ? { existingIds } : {}),
  };

  const [inserted] = await db
    .insert(uploadValidationSessions)
    .values({
      platform,
      fileName: file.name || "upload.csv",
      uploadedByUserId: user.id,
      payload,
      expiresAt,
    })
    .returning({ token: uploadValidationSessions.token });

  if (!inserted) {
    return NextResponse.json(
      { error: "Failed to record validation session." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    token: inserted.token,
    platform,
    summary,
    warnings: result.warnings,
  });
  } catch (err) {
    console.error("upload validate failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while validating the file. Please try again." },
      { status: 500 },
    );
  }
}

export interface ValidationPayload {
  summary: {
    rows: number;
    creatives: number;
    dateRange: { from: string; to: string } | null;
    /** Present only for upsert validations. */
    upsert?: true;
    newRows?: number;
    updatedRows?: number;
  };
  rows: ParsedRow[];
  warnings: unknown[];
  /**
   * Upsert only: aligned 1:1 with `rows`. Each entry is the existing
   * performance_records id to UPDATE, or null when the row is new (insert).
   * Absent for a plain strict-insert import.
   */
  existingIds?: (number | null)[];
}
