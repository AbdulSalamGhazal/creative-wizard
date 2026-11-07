import { cache } from "react";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditEvents, psUserState, psVersions } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";
import { versionDataSchema } from "@/price-structure/schema";
import type { VersionData } from "@/price-structure/engine/types";

/**
 * Price Structure versions — the query layer. Every read injects the active
 * brand's `account_id`; every write stamps it. The jsonb document is parsed
 * through the module's Zod schema on the way OUT as well as in: a row the
 * schema rejects is reported and skipped, never handed to the engine.
 */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface VersionSummary {
  id: string;
  name: string;
  notes: string;
  revision: number;
  createdAt: string;
  openedAt: string;
  updatedAt: string;
}

export interface VersionRow extends VersionSummary {
  data: VersionData;
}

type RawRow = typeof psVersions.$inferSelect;

const summaryOf = (r: Pick<RawRow, "id" | "name" | "notes" | "revision" | "createdAt" | "openedAt" | "updatedAt">): VersionSummary => ({
  id: r.id,
  name: r.name,
  notes: r.notes,
  revision: r.revision,
  createdAt: r.createdAt.toISOString(),
  openedAt: r.openedAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Parse a stored row; null (and a log line) when the document fails the schema. */
function rowOf(r: RawRow): VersionRow | null {
  const parsed = versionDataSchema.safeParse(r.data);
  if (!parsed.success) {
    console.error(`[price-structure] version ${r.id} has an invalid document:`, parsed.error.issues[0]);
    return null;
  }
  return { ...summaryOf(r), data: parsed.data };
}

const byOpened = [desc(psVersions.openedAt), desc(psVersions.createdAt)];

/** Every version of the active brand, most recently opened first, with its data. */
export async function listVersions(acct?: string, exec: Exec = db): Promise<VersionRow[]> {
  const account = acct ?? (await getActiveAccountId());
  const rows = await exec
    .select()
    .from(psVersions)
    .where(eq(psVersions.accountId, account))
    .orderBy(...byOpened);
  return rows.map(rowOf).filter((r): r is VersionRow => r !== null);
}

export async function getVersion(acct: string, id: string, exec: Exec = db): Promise<VersionRow | null> {
  const [row] = await exec
    .select()
    .from(psVersions)
    .where(and(eq(psVersions.accountId, acct), eq(psVersions.id, id)));
  return row ? rowOf(row) : null;
}

export async function countVersions(acct: string, exec: Exec = db): Promise<number> {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(psVersions)
    .where(eq(psVersions.accountId, acct));
  return row?.n ?? 0;
}

export async function insertVersion(
  exec: Exec,
  acct: string,
  userId: string,
  input: { name: string; notes: string; data: VersionData },
): Promise<VersionRow> {
  const [row] = await exec
    .insert(psVersions)
    .values({
      accountId: acct,
      name: input.name,
      notes: input.notes,
      data: input.data,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();
  const parsed = row ? rowOf(row) : null;
  if (!parsed) throw new Error("insertVersion returned no row");
  return parsed;
}

/**
 * The brand's first version, created ONCE even when two tabs ask at the same
 * moment: the transaction takes a brand-wide advisory lock before counting.
 * Returns the existing most-recent version when one already exists.
 */
export async function bootstrapVersion(
  acct: string,
  userId: string,
  make: () => { name: string; notes: string; data: VersionData },
): Promise<{ version: VersionRow; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${acct}))`);
    const existing = await listVersions(acct, tx);
    if (existing[0]) return { version: existing[0], created: false };
    return { version: await insertVersion(tx, acct, userId, make()), created: true };
  });
}

/**
 * Save a version IF the caller's revision is still the live one. Returns the
 * saved row, or null when someone else saved first (the action then fetches
 * the live row and hands it back as a conflict).
 */
export async function updateVersionIfRevision(
  acct: string,
  id: string,
  revision: number,
  patch: { name: string; notes: string; data: VersionData },
  userId: string,
): Promise<VersionRow | null> {
  const [row] = await db
    .update(psVersions)
    .set({
      name: patch.name,
      notes: patch.notes,
      data: patch.data,
      revision: sql`${psVersions.revision} + 1`,
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(psVersions.accountId, acct), eq(psVersions.id, id), eq(psVersions.revision, revision)))
    .returning();
  return row ? rowOf(row) : null;
}

export async function deleteVersion(acct: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(psVersions)
    .where(and(eq(psVersions.accountId, acct), eq(psVersions.id, id)))
    .returning({ id: psVersions.id });
  return rows.length > 0;
}

/** Stamp `opened_at` and remember the version as this user's last for the brand. */
export async function touchVersionOpened(acct: string, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(psVersions)
    .set({ openedAt: new Date() })
    .where(and(eq(psVersions.accountId, acct), eq(psVersions.id, id)))
    .returning({ id: psVersions.id });
  if (rows.length === 0) return false;
  await db
    .insert(psUserState)
    .values({ userId, accountId: acct, lastVersionId: id })
    .onConflictDoUpdate({
      target: [psUserState.userId, psUserState.accountId],
      set: { lastVersionId: sql`excluded.last_version_id`, updatedAt: new Date() },
    });
  return true;
}

/** The version this user opened last for the brand, if it still exists. */
export async function getLastVersionId(userId: string, acct: string): Promise<string | null> {
  const [row] = await db
    .select({ id: psUserState.lastVersionId })
    .from(psUserState)
    .where(and(eq(psUserState.userId, userId), eq(psUserState.accountId, acct)));
  return row?.id ?? null;
}

/**
 * What changed since the client last looked: every version's summary, the
 * full rows whose revision differs from (or is unknown to) the client, and
 * the ids the client knows that no longer exist.
 */
export async function pollVersions(
  acct: string,
  known: ReadonlyArray<{ id: string; revision: number }>,
): Promise<{ summaries: VersionSummary[]; changed: VersionRow[]; deleted: string[] }> {
  const rows = await db
    .select()
    .from(psVersions)
    .where(eq(psVersions.accountId, acct))
    .orderBy(...byOpened);
  const knownRev = new Map(known.map((k) => [k.id, k.revision]));
  const summaries: VersionSummary[] = [];
  const changed: VersionRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.id);
    summaries.push(summaryOf(r));
    if (knownRev.get(r.id) !== r.revision) {
      const parsed = rowOf(r);
      if (parsed) changed.push(parsed);
    }
  }
  return { summaries, changed, deleted: known.map((k) => k.id).filter((id) => !seen.has(id)) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A version's name for `generateMetadata`, `cache()`-deduped per request and
 * scoped to the active brand. A malformed or foreign id reads as null.
 */
export const versionNameFor = cache(async (id: string | undefined): Promise<string | null> => {
  if (!id || !UUID.test(id)) return null;
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ name: psVersions.name })
    .from(psVersions)
    .where(and(eq(psVersions.accountId, acct), eq(psVersions.id, id)));
  return row?.name ?? null;
});

/** Names of several versions at once (the Versions page's "This tab" check and the picker). */
export async function versionNames(acct: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: psVersions.id, name: psVersions.name })
    .from(psVersions)
    .where(and(eq(psVersions.accountId, acct), inArray(psVersions.id, [...ids])));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The sections one person's edit lines on one version already name since
 * `since` — their current SITTING (2026-11-07). A save that adds nothing new
 * writes no history line (`newEditSections`). Read through the audit's
 * `(entity_type, entity_id)` index; never inside a transaction.
 */
export async function sittingEditSections(
  acct: string,
  versionId: string,
  userId: string,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ meta: auditEvents.meta })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, "price_structure"),
        eq(auditEvents.entityId, versionId),
        eq(auditEvents.accountId, acct),
        eq(auditEvents.action, "price_structure.version_edit"),
        eq(auditEvents.actorUserId, userId),
        gte(auditEvents.at, since),
      ),
    );
  return rows.flatMap((r) => {
    const sections = (r.meta as { sections?: unknown } | null)?.sections;
    return Array.isArray(sections) ? sections.filter((x): x is string => typeof x === "string") : [];
  });
}
