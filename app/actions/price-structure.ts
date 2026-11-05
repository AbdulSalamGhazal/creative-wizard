"use server";

import { requirePermission } from "@/lib/auth";
import { getActiveAccountId } from "@/lib/tenant";
import { AUDIT_ACTIONS, logAudit } from "@/lib/audit";
import { actionError } from "@/lib/action-error";
import { PRICE_STRUCTURE_GATE } from "@/lib/page-gates";
import {
  bootstrapVersion as bootstrapVersionRow,
  deleteVersion as deleteVersionRow,
  getVersion,
  insertVersion,
  pollVersions as pollVersionRows,
  touchVersionOpened,
  updateVersionIfRevision,
  type VersionRow,
  type VersionSummary,
} from "@/db/queries/price-structure";
import { db } from "@/lib/db";
import {
  createVersionSchema,
  pollVersionsSchema,
  saveVersionSchema,
  versionIdSchema,
  VERSION_NAME_MAX,
} from "@/validators/price-structure";
import { versionDataSchema } from "@/price-structure/schema";
import { IMPORT_ERROR, importDocument } from "@/price-structure/engine/export-import";
import { blankVersionData, sampleVersionData } from "@/price-structure/engine/sample";
import type { VersionData } from "@/price-structure/engine/types";
import { SAVE_CONFLICT_MESSAGE, VERSION_GONE_MESSAGE } from "@/price-structure/messages";

/**
 * Price Structure versions — the server actions (brief §7). Every one needs
 * the module's single permission and works inside the active brand. NONE
 * revalidates a path: the client holds the open version and applies the
 * result itself (the autosave would otherwise re-render the page every
 * 500 ms), and create / delete update the provider's list in place.
 */
export type SaveVersionResult =
  | { ok: true; revision: number; updatedAt: string }
  /** Someone else saved first: here is the live row to merge against. */
  | { ok: false; error: string; conflict: VersionRow }
  /** The version no longer exists. */
  | { ok: false; error: string; gone: true }
  | { ok: false; error: string; conflict?: undefined; gone?: undefined };

export async function saveVersion(input: unknown): Promise<SaveVersionResult> {
  try {
    const me = await requirePermission(PRICE_STRUCTURE_GATE);
    const parsed = saveVersionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { id, revision, name, notes, data } = parsed.data;
    const saved = await updateVersionIfRevision(acct, id, revision, { name, notes, data }, me.id);
    if (saved) return { ok: true, revision: saved.revision, updatedAt: saved.updatedAt };
    const live = await getVersion(acct, id);
    if (!live) return { ok: false, error: VERSION_GONE_MESSAGE, gone: true };
    return { ok: false, error: SAVE_CONFLICT_MESSAGE, conflict: live };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps.saveVersion") };
  }
}

export type CreateVersionResult =
  | { ok: true; version: VersionRow; warnings: string[] }
  | { ok: false; error: string };

/** A file's name without its extension, trimmed to the column. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").trim().slice(0, VERSION_NAME_MAX);
}

export async function createVersion(input: unknown): Promise<CreateVersionResult> {
  try {
    const me = await requirePermission(PRICE_STRUCTURE_GATE);
    const parsed = createVersionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const acct = await getActiveAccountId();
    const { from, notes } = parsed.data;
    let name = parsed.data.name;
    let data: VersionData;
    const warnings: string[] = [];
    let action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] = AUDIT_ACTIONS.PS_VERSION_CREATE;

    switch (from.kind) {
      case "blank":
        data = blankVersionData();
        name ||= "Blank";
        break;
      case "sample":
        data = sampleVersionData();
        name ||= "Sample data";
        break;
      case "copy": {
        // Re-validated against the active brand before it is read (tenancy rule 4).
        const source = await getVersion(acct, from.id);
        if (!source) return { ok: false, error: VERSION_GONE_MESSAGE };
        data = structuredClone(source.data);
        name ||= `${source.name} (copy)`;
        break;
      }
      case "import": {
        const imported = importDocument(from.payload);
        if (!imported.ok) return { ok: false, error: imported.error };
        const doc = versionDataSchema.safeParse(imported.candidate);
        if (!doc.success) {
          console.warn("[ps.import] rejected:", doc.error.issues[0]);
          return { ok: false, error: IMPORT_ERROR };
        }
        data = doc.data;
        warnings.push(...imported.warnings);
        name ||= nameFromFile(from.fileName) || imported.name || "Imported version";
        action = AUDIT_ACTIONS.PS_VERSION_IMPORT;
        break;
      }
    }

    const version = await insertVersion(db, acct, me.id, { name, notes, data });
    await logAudit({
      action,
      entityType: "price_structure",
      entityId: version.id,
      entityLabel: version.name,
      actorUserId: me.id,
      meta: { from: from.kind, products: data.products.length, warnings: warnings.length },
    });
    return { ok: true, version, warnings };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps.createVersion") };
  }
}

export type BootstrapResult = { ok: true; version: VersionRow; created: boolean } | { ok: false; error: string };

/**
 * A brand's first version: "Main", Blank (user decision 2026-11-05, in place
 * of the brief's sample data). Idempotent — a brand that already has versions
 * gets its most recently opened one back.
 */
export async function bootstrapVersion(): Promise<BootstrapResult> {
  try {
    const me = await requirePermission(PRICE_STRUCTURE_GATE);
    const acct = await getActiveAccountId();
    const { version, created } = await bootstrapVersionRow(acct, me.id, () => ({
      name: "Main",
      notes: "",
      data: blankVersionData(),
    }));
    if (created) {
      await logAudit({
        action: AUDIT_ACTIONS.PS_VERSION_CREATE,
        entityType: "price_structure",
        entityId: version.id,
        entityLabel: version.name,
        actorUserId: me.id,
        meta: { from: "bootstrap" },
      });
    }
    return { ok: true, version, created };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps.bootstrapVersion") };
  }
}

export async function deleteVersion(input: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await requirePermission(PRICE_STRUCTURE_GATE);
    const parsed = versionIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input" };
    const acct = await getActiveAccountId();
    const existing = await getVersion(acct, parsed.data.id);
    if (!existing) return { ok: false, error: VERSION_GONE_MESSAGE };
    await deleteVersionRow(acct, parsed.data.id);
    await logAudit({
      action: AUDIT_ACTIONS.PS_VERSION_DELETE,
      entityType: "price_structure",
      entityId: existing.id,
      entityLabel: existing.name,
      actorUserId: me.id,
      meta: { products: existing.data.products.length, revision: existing.revision },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps.deleteVersion") };
  }
}

/**
 * "Opened": stamps the version's `opened_at` and remembers it as this user's
 * last for the brand. Best-effort, like a preference write — a failure must
 * not break opening the page.
 */
export async function openVersion(input: unknown): Promise<{ ok: boolean }> {
  try {
    const me = await requirePermission(PRICE_STRUCTURE_GATE);
    const parsed = versionIdSchema.safeParse(input);
    if (!parsed.success) return { ok: false };
    const acct = await getActiveAccountId();
    return { ok: await touchVersionOpened(acct, me.id, parsed.data.id) };
  } catch {
    return { ok: false };
  }
}

export type PollVersionsResult =
  | { ok: true; summaries: VersionSummary[]; changed: VersionRow[]; deleted: string[] }
  | { ok: false; error: string };

/** What changed since the client last looked (every ~10 s while visible, and on focus). */
export async function pollVersions(input: unknown): Promise<PollVersionsResult> {
  try {
    await requirePermission(PRICE_STRUCTURE_GATE);
    const parsed = pollVersionsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input" };
    const acct = await getActiveAccountId();
    const out = await pollVersionRows(acct, parsed.data.known);
    return { ok: true, ...out };
  } catch (err) {
    return { ok: false, error: actionError(err, "ps.pollVersions") };
  }
}
