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
import { MAX_FILE_BYTES, parseFile } from "@/csv/parse";
import { runPipeline, type ParsedRow } from "@/csv/pipeline";
import { resolveAdapter } from "@/db/queries/platforms";
import { detectPlatform } from "@/csv/platforms/detect";
import type { PlatformAdapter } from "@/csv/platforms/types";

const VALIDATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

const platformSchema = z.enum(platformEnum);
type Platform = PlatformAdapter["platform"];

/**
 * POST /api/uploads/validate
 *
 * Accepts: multipart/form-data with `file` (CSV or XLSX) and an OPTIONAL
 * `platform`. When `platform` is omitted, the server auto-detects from the
 * file's header row.
 *
 * Status codes:
 *   200 — valid; token returned, plus the detected/selected platform
 *   400 — bad form input
 *   401 — not signed in
 *   413 — file > 10 MB
 *   422 — validation errors (or could-not-detect-platform)
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

  // Parse first so we can auto-detect the platform if one wasn't passed.
  const parsed = parseFile({
    content: buffer,
    byteLength: file.size,
    fileName: file.name,
  });
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, errors: [parsed.error], warnings: [] },
      { status: 422 },
    );
  }

  // Resolve the four adapters from the DB once — we use them for auto-detect
  // and again as the pipeline adapter.
  const [metaAdapter, tiktokAdapter, snapchatAdapter, googleAdapter] =
    await Promise.all([
      resolveAdapter("meta"),
      resolveAdapter("tiktok"),
      resolveAdapter("snapchat"),
      resolveAdapter("google"),
    ]);
  const adapters: Record<Platform, PlatformAdapter> = {
    meta: metaAdapter,
    tiktok: tiktokAdapter,
    snapchat: snapchatAdapter,
    google: googleAdapter,
  };

  let platform: Platform | null = null;
  let detectionAmbiguous = false;
  let detectionScores: Record<Platform, number> = {
    meta: 0,
    tiktok: 0,
    snapchat: 0,
    google: 0,
  };
  let detectionUsed: "explicit" | "auto" = "auto";

  if (rawPlatform) {
    const parsedPlatform = platformSchema.safeParse(rawPlatform);
    if (!parsedPlatform.success) {
      return NextResponse.json(
        {
          error:
            "Invalid platform; expected one of: meta, tiktok, snapchat, google.",
        },
        { status: 400 },
      );
    }
    platform = parsedPlatform.data;
    detectionUsed = "explicit";
  } else {
    const detect = detectPlatform(parsed.header, adapters);
    detectionAmbiguous = detect.ambiguous;
    detectionScores = detect.scores;
    if (!detect.platform) {
      return NextResponse.json(
        {
          ok: false,
          detection: {
            used: "auto",
            platform: null,
            ambiguous: false,
            scores: detect.scores,
          },
          errors: [
            {
              code: "E010",
              severity: "FATAL",
              message:
                "Could not auto-detect the platform from the file's headers. Pick a platform manually and try again, or update the mapping in /admin/platforms.",
            },
          ],
          warnings: [],
        },
        { status: 422 },
      );
    }
    platform = detect.platform;
  }

  // Snapshot of registered creative names (strict byte-equal matching).
  const allNames = await db.select({ name: creatives.name }).from(creatives);
  const registeredNames = new Set(allNames.map((r) => r.name));

  const adapter = adapters[platform];

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

  const detection = {
    used: detectionUsed,
    platform,
    ambiguous: detectionAmbiguous,
    scores: detectionScores,
  };

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        detection,
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

  // Stash payload for commit.
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
    detection,
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
