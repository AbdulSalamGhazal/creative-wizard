import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
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

  const platformResult = platformSchema.safeParse(rawPlatform);
  if (!platformResult.success) {
    return NextResponse.json(
      {
        error:
          "Pick a platform before validating (meta / tiktok / snapchat / google).",
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
    findExistingBatch: async (name, plat, date) => {
      const [row] = await db
        .select({ batchId: performanceRecords.uploadBatchId })
        .from(performanceRecords)
        .innerJoin(creatives, eq(creatives.id, performanceRecords.creativeId))
        .innerJoin(
          uploadBatches,
          eq(uploadBatches.id, performanceRecords.uploadBatchId),
        )
        .where(
          and(
            eq(creatives.name, name),
            eq(performanceRecords.platform, plat),
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
  };

  const expiresAt = new Date(Date.now() + VALIDATION_TTL_MS);
  const payload = {
    summary,
    rows: result.rows,
    warnings: result.warnings,
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
}

export interface ValidationPayload {
  summary: {
    rows: number;
    creatives: number;
    dateRange: { from: string; to: string } | null;
  };
  rows: ParsedRow[];
  warnings: unknown[];
}
