"use server";

import { revalidatePath } from "next/cache";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireEditor } from "@/lib/auth";
import {
  creatives,
  creativeStatusEnum,
  creativeTags,
  creativeTypeEnum,
  products,
} from "@/db/schema";
import { parseFile } from "@/csv/parse";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";

/**
 * Bulk-create creatives from a CSV/XLSX upload.
 *
 * Shape per row: name (required), product (required — must match an existing
 * product by name), type, status, launch_date, tags, notes. Validation is
 * all-or-nothing: the file previews with per-row errors and nothing is written
 * unless every row is valid (mirrors the performance-CSV philosophy, though
 * this is a separate, simpler pipeline — creatives, not performance records).
 */

type CreativeType = (typeof creativeTypeEnum)[number];
type CreativeStatus = (typeof creativeStatusEnum)[number];

export interface BulkRowResult {
  rowNumber: number;
  name: string;
  productName: string;
  type: string;
  status: string;
  launchDate: string | null;
  tags: string[];
  ok: boolean;
  errors: string[];
}

export interface BulkPreview {
  ok: boolean;
  /** Fatal parse/structure error (no per-row data). */
  error?: string;
  rows: BulkRowResult[];
  total: number;
  validCount: number;
  errorCount: number;
  allValid: boolean;
}

export interface BulkCommitResult {
  ok: boolean;
  created?: number;
  error?: string;
}

// Header synonyms (lowercased) → internal field.
const HEADER_MAP: Record<string, string[]> = {
  name: ["name", "creative", "creative name"],
  product: ["product", "product name"],
  type: ["type", "creative type"],
  status: ["status"],
  launchDate: ["launch_date", "launch date", "launchdate", "launched"],
  tags: ["tags", "tag"],
  notes: ["notes", "note"],
};

function indexFor(header: string[], field: string): number {
  const synonyms = HEADER_MAP[field] ?? [];
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const syn of synonyms) {
    const i = lower.indexOf(syn);
    if (i !== -1) return i;
  }
  return -1;
}

/** Permissive launch-date parse → ISO YYYY-MM-DD. DD/MM/YYYY assumed (matches the upload pipeline). */
function parseLaunch(raw: string): { ok: boolean; value: string | null } {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? { ok: false, value: null } : { ok: true, value: s };
  }
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yy = Number(dmy[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const v = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      const d = new Date(`${v}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return { ok: true, value: v };
    }
  }
  return { ok: false, value: null };
}

interface NormalizedRow {
  rowNumber: number;
  name: string;
  productId: string;
  type: CreativeType;
  status: CreativeStatus;
  launchDate: string | null;
  tags: string[];
  notes: string | null;
}

interface BuildResult {
  preview: BulkPreview;
  normalized: NormalizedRow[]; // only valid rows, ready to insert
}

/**
 * Parse + validate the uploaded file against the DB. Shared by preview and
 * commit so the rules are defined once.
 */
async function build(formData: FormData): Promise<BuildResult> {
  const empty: BuildResult = {
    preview: { ok: false, rows: [], total: 0, validCount: 0, errorCount: 0, allValid: false },
    normalized: [],
  };

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ...empty, preview: { ...empty.preview, error: "No file provided." } };
  }

  const buf = await file.arrayBuffer();
  const parsed = parseFile({ content: buf, fileName: file.name, byteLength: buf.byteLength });
  if (!parsed.ok) {
    return { ...empty, preview: { ...empty.preview, error: parsed.error.message } };
  }

  const idx = {
    name: indexFor(parsed.header, "name"),
    product: indexFor(parsed.header, "product"),
    type: indexFor(parsed.header, "type"),
    status: indexFor(parsed.header, "status"),
    launchDate: indexFor(parsed.header, "launchDate"),
    tags: indexFor(parsed.header, "tags"),
    notes: indexFor(parsed.header, "notes"),
  };
  if (idx.name === -1 || idx.product === -1) {
    return {
      ...empty,
      preview: {
        ...empty.preview,
        error:
          'The file must have a "name" column and a "product" column (header row required).',
      },
    };
  }

  // Reference data: product name (lowercased) → id; existing creative names.
  const productRows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .orderBy(asc(products.name));
  const productByName = new Map<string, string>();
  for (const p of productRows) productByName.set(p.name.trim().toLowerCase(), p.id);

  const existingNames = new Set(
    (await db.select({ name: creatives.name }).from(creatives)).map((r) => r.name),
  );

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

  const rows: BulkRowResult[] = [];
  const normalized: NormalizedRow[] = [];
  const seenInFile = new Set<string>();

  parsed.rows.forEach((row, i) => {
    const rowNumber = parsed.rowNumbers[i] ?? i + 2;
    const errors: string[] = [];

    const name = cell(row, idx.name);
    const productName = cell(row, idx.product);
    const typeRaw = cell(row, idx.type).toLowerCase();
    const statusRaw = cell(row, idx.status).toLowerCase();
    const launchRaw = cell(row, idx.launchDate);
    const tagsRaw = cell(row, idx.tags);

    // name
    if (!name) errors.push("Name is required.");
    else if (name.length > 255) errors.push("Name exceeds 255 characters.");
    else if (existingNames.has(name)) errors.push("A creative with this name already exists.");
    else if (seenInFile.has(name)) errors.push("Duplicate name within this file.");

    // product
    let productId: string | undefined;
    if (!productName) {
      errors.push("Product is required.");
    } else {
      productId = productByName.get(productName.toLowerCase());
      if (!productId) errors.push(`Unknown product "${productName}".`);
    }

    // type (default video)
    const type = (typeRaw || "video") as CreativeType;
    if (!(creativeTypeEnum as readonly string[]).includes(type)) {
      errors.push(`Invalid type "${typeRaw}". Use video, image, or slides.`);
    }

    // status (default draft)
    const status = (statusRaw || "draft") as CreativeStatus;
    if (!(creativeStatusEnum as readonly string[]).includes(status)) {
      errors.push(`Invalid status "${statusRaw}". Use draft, active, paused, or archived.`);
    }

    // launch date
    const launch = parseLaunch(launchRaw);
    if (!launch.ok) errors.push(`Invalid launch date "${launchRaw}".`);

    // tags
    const tags = Array.from(
      new Set(
        tagsRaw
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    );
    if (tags.some((t) => t.length > 64)) errors.push("A tag exceeds 64 characters.");

    const ok = errors.length === 0;
    if (ok && name) seenInFile.add(name);

    rows.push({
      rowNumber,
      name,
      productName,
      type,
      status,
      launchDate: launch.value,
      tags,
      ok,
      errors,
    });

    if (ok && productId) {
      normalized.push({
        rowNumber,
        name,
        productId,
        type,
        status,
        launchDate: launch.value,
        tags,
        notes: idx.notes >= 0 ? cell(row, idx.notes) || null : null,
      });
    }
  });

  const errorCount = rows.filter((r) => !r.ok).length;
  const preview: BulkPreview = {
    ok: true,
    rows,
    total: rows.length,
    validCount: rows.length - errorCount,
    errorCount,
    allValid: rows.length > 0 && errorCount === 0,
  };

  return { preview, normalized };
}

/** Validate a bulk file and return a per-row preview. Read-only. */
export async function previewBulkCreatives(formData: FormData): Promise<BulkPreview> {
  try {
    await requireEditor();
    const { preview } = await build(formData);
    return preview;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
      rows: [],
      total: 0,
      validCount: 0,
      errorCount: 0,
      allValid: false,
    };
  }
}

/**
 * Commit a bulk file. Re-validates server-side (never trusts the client) and
 * inserts every creative + its tags in a single transaction. All-or-nothing:
 * any invalid row, or a name collision that snuck in since preview, aborts the
 * whole batch.
 */
export async function commitBulkCreatives(
  formData: FormData,
): Promise<BulkCommitResult> {
  try {
    const user = await requireEditor();
    const { preview, normalized } = await build(formData);

    if (!preview.ok) return { ok: false, error: preview.error ?? "Could not parse the file." };
    if (!preview.allValid) {
      return { ok: false, error: `${preview.errorCount} row(s) are invalid — fix them and retry.` };
    }
    if (normalized.length === 0) return { ok: false, error: "Nothing to create." };

    await db.transaction(async (tx) => {
      for (const r of normalized) {
        const [inserted] = await tx
          .insert(creatives)
          .values({
            name: r.name,
            productId: r.productId,
            type: r.type,
            status: r.status,
            launchDate: r.launchDate,
            notes: r.notes,
            createdByUserId: user.id,
          })
          .returning({ id: creatives.id });
        if (!inserted) throw new Error(`Failed to insert "${r.name}".`);
        if (r.tags.length > 0) {
          await tx
            .insert(creativeTags)
            .values(r.tags.map((tag) => ({ creativeId: inserted.id, tag })))
            .onConflictDoNothing();
        }
      }
    });

    try {
      revalidatePath("/creatives");
    } catch (err) {
      console.warn("revalidatePath after bulk create failed:", err);
    }

    await logAudit({
      action: AUDIT_ACTIONS.CREATIVE_BULK_CREATE,
      entityType: "creative",
      entityId: null,
      entityLabel: `${normalized.length} creative${normalized.length === 1 ? "" : "s"} created`,
      actorUserId: user.id,
      meta: { count: normalized.length, names: normalized.map((r) => r.name).slice(0, 50) },
    });

    return { ok: true, created: normalized.length };
  } catch (err) {
    // A unique-violation race (name taken between preview + commit) lands here.
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      ok: false,
      error: /unique|duplicate/i.test(msg)
        ? "A creative name in the batch was just taken by someone else. Re-validate and retry."
        : msg,
    };
  }
}
