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

const VALIDATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

const platformSchema = z.enum(platformEnum);

/**
 * POST /api/uploads/validate
 *
 * Accepts: multipart/form-data with `file` (CSV) and `platform`.
 * Runs the 5-stage validation pipeline. On success returns a token whose
 * payload the commit endpoint will read. On failure returns the full error
 * + warning arrays with no token.
 *
 * Status codes:
 *   200 — valid; token returned
 *   400 — bad form input (missing file / bad platform)
 *   401 — not signed in
 *   413 — file > 10 MB
 *   422 — validation errors; body has `errors` and `warnings`
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
        error: "Invalid platform; expected one of: meta, tiktok, snapchat, google.",
      },
      { status: 400 },
    );
  }
  const platform = platformResult.data;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Expected a `file` field with a CSV upload." },
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

  // Snapshot of registered creative names (strict byte-equal matching per
  // validation-spec §4).
  const allNames = await db.select({ name: creatives.name }).from(creatives);
  const registeredNames = new Set(allNames.map((r) => r.name));

  const result = await runPipeline({
    content: buffer,
    byteLength: file.size,
    platform,
    registeredNames,
    findExistingBatch: async (name, plat, date) => {
      // Lookup performance_records by (creative.name, platform, date).
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

  // Stash payload for commit. TTL is enforced lazily at lookup.
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
    summary,
    warnings: result.warnings,
  });
}

// Reused type narrow for the payload shape we store in JSONB.
export interface ValidationPayload {
  summary: {
    rows: number;
    creatives: number;
    dateRange: { from: string; to: string } | null;
  };
  rows: ParsedRow[];
  warnings: unknown[];
}
