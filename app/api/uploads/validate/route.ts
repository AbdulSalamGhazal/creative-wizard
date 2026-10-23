import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import {
  campaigns,
  creatives,
  landingPages,
  performanceRecords,
  platformEnum,
  uploadBatches,
  uploadValidationSessions,
} from "@/db/schema";
import { FILE_TOO_LARGE_MESSAGE, MAX_FILE_BYTES } from "@/csv/parse";
import { runPipeline, type ExistingRecord, type ParsedRow } from "@/csv/pipeline";
import { campaignPlatformCollisions } from "@/csv/cross-platform";
import { resolveAdapter } from "@/db/queries/platforms";
import { getActiveAccountId } from "@/lib/tenant";

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
 *   413 — file > MAX_FILE_BYTES (4 MB)
 *   422 — validation errors
 *   500 — unexpected
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requirePermission("upload.import");
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
  // Upsert overwrites existing rows — a stricter, separately-grantable capability.
  if (upsert && !can(user, "upload.upsert")) {
    return NextResponse.json(
      { error: "You don't have permission to use upsert mode." },
      { status: 403 },
    );
  }

  const platformResult = platformSchema.safeParse(rawPlatform);
  if (!platformResult.success) {
    return NextResponse.json(
      {
        // Derived from the canonical platform list — never re-list it here.
        error: `Pick a platform before validating (${platformEnum.join(" / ")}).`,
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
        error: FILE_TOO_LARGE_MESSAGE,
        code: "E001",
      },
      { status: 413 },
    );
  }

  try {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const acct = await getActiveAccountId();

  // Snapshot of registered creative names (strict byte-equal matching),
  // scoped to the active brand so names only match within this account.
  const allNames = await db
    .select({ name: creatives.name })
    .from(creatives)
    .where(eq(creatives.accountId, acct));
  const registeredNames = new Set(allNames.map((r) => r.name));

  // Registered campaigns (the built campaign_name), scoped to the active brand.
  // A row whose campaign isn't registered is rejected (E061) — see the pipeline.
  const allCampaigns = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.accountId, acct));
  const registeredCampaigns = new Set(allCampaigns.map((r) => r.name));

  // Registered landing-page codes (no `@`), scoped to the active brand. A
  // row's ` @code` must be one of them (E023) — see lib/landing-code.ts.
  const allLandingPages = await db
    .select({ code: landingPages.code })
    .from(landingPages)
    .where(eq(landingPages.accountId, acct));
  const registeredLandingCodes = new Set(allLandingPages.map((r) => r.code));

  const adapter = await resolveAdapter(platform);

  // Filled by the pipeline's single Stage 5 lookup (below); reused by the
  // upsert partition.
  let stored: Array<ExistingRecord & { id: number }> = [];

  const result = await runPipeline({
    content: buffer,
    byteLength: file.size,
    adapter,
    registeredNames,
    registeredCampaigns,
    registeredLandingCodes,
    // In upsert mode we DON'T reject existing rows (no E051) — we partition
    // new-vs-existing below instead. Stage 5 still runs in both modes: the
    // landing-page rename guard (E052) protects upserts too.
    allowExisting: upsert,
    // ONE query for the whole file: IN-lists per column, keyed precisely by
    // the pipeline. Kept in `stored` for the upsert partition below, which
    // needs exactly these rows — so an upsert pays for one lookup, not one
    // per (creative, campaign, day) plus a second pass.
    findExisting: async (days, plat) => {
      stored = await db
        .select({
          id: performanceRecords.id,
          creativeName: creatives.name,
          campaignName: campaigns.name,
          date: performanceRecords.date,
          landingCode: landingPages.code,
          batchId: performanceRecords.uploadBatchId,
        })
        .from(performanceRecords)
        .innerJoin(
          creatives,
          eq(creatives.id, performanceRecords.creativeId),
        )
        .innerJoin(
          uploadBatches,
          eq(uploadBatches.id, performanceRecords.uploadBatchId),
        )
        .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
        .leftJoin(
          landingPages,
          eq(landingPages.id, performanceRecords.landingPageId),
        )
        .where(
          and(
            eq(performanceRecords.accountId, acct),
            eq(performanceRecords.platform, plat),
            eq(uploadBatches.status, "active"),
            inArray(creatives.name, [...new Set(days.map((d) => d.creativeName))]),
            inArray(campaigns.name, [...new Set(days.map((d) => d.campaignName))]),
            inArray(performanceRecords.date, [...new Set(days.map((d) => d.date))]),
          ),
        );
      return stored;
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

  // Cross-platform campaign-name guard (E060): a campaign name must belong to a
  // single platform — the app keys a campaign by name alone, so the same name on
  // two platforms would silently merge into one campaign. Reject if any campaign
  // in this file already exists on a DIFFERENT platform (active batches only).
  const fileCampaigns = [...new Set(result.rows.map((r) => r.campaignName))];
  const onOtherPlatforms = fileCampaigns.length
    ? await db
        .selectDistinct({
          campaignName: campaigns.name,
          platform: performanceRecords.platform,
        })
        .from(performanceRecords)
        .innerJoin(
          uploadBatches,
          eq(uploadBatches.id, performanceRecords.uploadBatchId),
        )
        .innerJoin(campaigns, eq(campaigns.id, performanceRecords.campaignId))
        .where(
          and(
            eq(performanceRecords.accountId, acct),
            inArray(campaigns.name, fileCampaigns),
            ne(performanceRecords.platform, platform),
            eq(uploadBatches.status, "active"),
          ),
        )
    : [];
  const collisionErrors = campaignPlatformCollisions(
    platform,
    fileCampaigns,
    onOtherPlatforms,
  );
  if (collisionErrors.length > 0) {
    return NextResponse.json(
      { ok: false, platform, errors: collisionErrors, warnings: result.warnings },
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
    // The rows Stage 5 already fetched (`stored`), keyed at full identity —
    // creative NAME is unique per account, landing page included ("" = the
    // product's own page).
    const SEP = "\u0001";
    const idByIdentity = new Map<string, number>();
    for (const e of stored) {
      idByIdentity.set(
        `${e.creativeName}${SEP}${e.campaignName}${SEP}${e.date}${SEP}${e.landingCode ?? ""}`,
        e.id,
      );
    }

    existingIds = result.rows.map(
      (r) =>
        idByIdentity.get(
          `${r.creativeName}${SEP}${r.campaignName}${SEP}${r.date}${SEP}${r.landingCode ?? ""}`,
        ) ?? null,
    );
    updatedRows = existingIds.filter((x) => x !== null).length;
    newRows = existingIds.length - updatedRows;
  }

  // Build summary
  const dates = result.rows.map((r) => r.date).sort();
  const creativesCount = new Set(result.rows.map((r) => r.creativeName)).size;
  // Rows per landing page, so the summary shows the ` @code` split happened.
  // Rows without a code (the product's own page) aren't listed.
  const landingRowCounts = new Map<string, number>();
  for (const r of result.rows) {
    if (r.landingCode === null) continue;
    landingRowCounts.set(r.landingCode, (landingRowCounts.get(r.landingCode) ?? 0) + 1);
  }
  const summary = {
    rows: result.rows.length,
    creatives: creativesCount,
    landingPages: [...landingRowCounts]
      .map(([code, rows]) => ({ code, rows }))
      .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code)),
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
      accountId: acct,
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
    /** Rows per landing-page code (no `@`); empty when every row is main-page. */
    landingPages: { code: string; rows: number }[];
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
