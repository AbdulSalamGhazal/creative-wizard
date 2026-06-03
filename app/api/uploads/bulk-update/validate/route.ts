import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  performanceRecords,
  platformEnum,
  uploadValidationSessions,
} from "@/db/schema";
import { MAX_FILE_BYTES } from "@/csv/parse";
import { runUpdatePipeline } from "@/csv/update-pipeline";
import type { InternalField } from "@/csv/platforms/types";
import type { ValidationError } from "@/csv/errors";
import { resolveAdapter } from "@/db/queries/platforms";

const VALIDATION_TTL_MS = 10 * 60 * 1000;
const platformSchema = z.enum(platformEnum);
const SEP = "\u0001";

const toNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Pull an internal field's current value off a performance_records row. */
function currentValue(
  r: Record<string, unknown>,
  f: InternalField,
): number | null {
  switch (f) {
    case "spend": return toNum(r.spend);
    case "impressions": return toNum(r.impressions);
    case "clicks": return toNum(r.clicks);
    case "conversions": return toNum(r.conversions);
    case "conversion_value": return toNum(r.conversionValue);
    case "landing_page_views": return toNum(r.landingPageViews);
    case "video_views_2s": return toNum(r.videoViews2s);
    case "video_views_25": return toNum(r.videoViews25);
    case "video_views_50": return toNum(r.videoViews50);
    case "video_views_75": return toNum(r.videoViews75);
    case "video_views_100": return toNum(r.videoViews100);
    default: return null;
  }
}

export interface UpdatePlanRow {
  recordId: number;
  creativeName: string;
  creativeType: "video" | "image" | "slides";
  campaignName: string;
  date: string;
  updates: Partial<Record<InternalField, number>>;
  old: Partial<Record<InternalField, number | null>>;
}

export interface UpdateStoredPayload {
  kind: "update";
  updateFields: InternalField[];
  plan: UpdatePlanRow[];
  summary: {
    rows: number;
    creatives: number;
    dateRange: { from: string; to: string } | null;
    updateColumns: InternalField[];
    cellsChanged: number;
  };
}

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
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const platformResult = platformSchema.safeParse(form.get("platform"));
  if (!platformResult.success) {
    return NextResponse.json(
      { error: "Pick a platform before validating (instagram / facebook / tiktok / snapchat / google)." },
      { status: 400 },
    );
  }
  const platform = platformResult.data;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a `file` field with a CSV or XLSX upload." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB upload limit.", code: "E001" }, { status: 413 });
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const allNames = await db.select({ name: creatives.name }).from(creatives);
    const registeredNames = new Set(allNames.map((r) => r.name));
    const adapter = await resolveAdapter(platform);

    const result = runUpdatePipeline({
      content: buffer,
      byteLength: file.size,
      adapter,
      registeredNames,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, platform, errors: result.errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    const { candidates, updateFields } = result;
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          platform,
          errors: [{ code: "E061", severity: "FATAL", message: "No data rows to update." } satisfies ValidationError],
          warnings: result.warnings,
        },
        { status: 422 },
      );
    }

    // Resolve creative names → id + type.
    const names = [...new Set(candidates.map((c) => c.creativeName))];
    const creativeRows = await db
      .select({ id: creatives.id, name: creatives.name, type: creatives.type })
      .from(creatives)
      .where(inArray(creatives.name, names));
    const idByName = new Map(creativeRows.map((c) => [c.name, c.id]));
    const typeByName = new Map(creativeRows.map((c) => [c.name, c.type]));

    // Batch-load every candidate record (over-fetch by id×date×campaign, then
    // match exactly on the composite key).
    const creativeIds = [...new Set([...idByName.values()])];
    const dates = [...new Set(candidates.map((c) => c.date))];
    const campaignNames = [...new Set(candidates.map((c) => c.campaignName))];

    const existing =
      creativeIds.length > 0
        ? await db
            .select()
            .from(performanceRecords)
            .where(
              and(
                eq(performanceRecords.platform, platform),
                inArray(performanceRecords.creativeId, creativeIds),
                inArray(performanceRecords.date, dates),
                inArray(performanceRecords.campaignName, campaignNames),
              ),
            )
        : [];

    const recByKey = new Map<string, Record<string, unknown>>();
    for (const r of existing) {
      recByKey.set([r.creativeId, r.campaignName, r.date].join(SEP), r as unknown as Record<string, unknown>);
    }

    // Build the plan + collect unmatched rows (E060). All-or-nothing.
    const plan: UpdatePlanRow[] = [];
    const errors: ValidationError[] = [];
    let cellsChanged = 0;
    for (const c of candidates) {
      const cid = idByName.get(c.creativeName);
      const rec = cid ? recByKey.get([cid, c.campaignName, c.date].join(SEP)) : undefined;
      if (!cid || !rec) {
        errors.push({
          code: "E060",
          severity: "ERROR",
          message: `Row ${c.rowNumber}: no existing record for creative \`'${c.creativeName}'\` / campaign \`'${c.campaignName}'\` on \`${platform}\` for \`${c.date}\`. Bulk update can only change records that already exist.`,
          row: c.rowNumber,
          value: c.creativeName,
        });
        continue;
      }
      const old: Partial<Record<InternalField, number | null>> = {};
      for (const f of updateFields) {
        const ov = currentValue(rec, f);
        old[f] = ov;
        if ((c.updates[f] ?? null) !== ov) cellsChanged++;
      }
      plan.push({
        recordId: Number(rec.id),
        creativeName: c.creativeName,
        creativeType: (typeByName.get(c.creativeName) ?? "image") as UpdatePlanRow["creativeType"],
        campaignName: c.campaignName,
        date: c.date,
        updates: c.updates,
        old,
      });
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { ok: false, platform, errors, warnings: result.warnings },
        { status: 422 },
      );
    }

    const sortedDates = plan.map((p) => p.date).sort();
    const summary = {
      rows: plan.length,
      creatives: new Set(plan.map((p) => p.creativeName)).size,
      dateRange:
        sortedDates.length > 0
          ? { from: sortedDates[0]!, to: sortedDates[sortedDates.length - 1]! }
          : null,
      updateColumns: updateFields,
      cellsChanged,
    };

    const payload: UpdateStoredPayload = { kind: "update", updateFields, plan, summary };

    const [inserted] = await db
      .insert(uploadValidationSessions)
      .values({
        platform,
        fileName: file.name || "bulk-update.csv",
        uploadedByUserId: user.id,
        payload,
        expiresAt: new Date(Date.now() + VALIDATION_TTL_MS),
      })
      .returning({ token: uploadValidationSessions.token });

    if (!inserted) {
      return NextResponse.json({ error: "Failed to record validation session." }, { status: 500 });
    }

    // Preview: first 60 rows with the cells that actually change.
    const preview = plan.slice(0, 60).map((p) => ({
      creativeName: p.creativeName,
      campaignName: p.campaignName,
      date: p.date,
      changes: updateFields
        .filter((f) => (p.updates[f] ?? null) !== (p.old[f] ?? null))
        .map((f) => ({ field: f, old: p.old[f] ?? null, next: p.updates[f] ?? null })),
    }));

    return NextResponse.json({
      ok: true,
      token: inserted.token,
      platform,
      summary,
      preview,
      warnings: result.warnings,
    });
  } catch (err) {
    console.error("bulk-update validate failed:", err);
    return NextResponse.json(
      { error: "Something went wrong while validating the file. Please try again." },
      { status: 500 },
    );
  }
}
