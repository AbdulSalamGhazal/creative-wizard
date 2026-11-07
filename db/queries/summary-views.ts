import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { summaryViews, users } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

export interface SummaryViewRow {
  id: string;
  name: string;
  query: string;
  isDefault: boolean;
  ownerUserId: string;
  ownerName: string | null;
  createdAt: Date;
}

/**
 * A user's own saved views for a page (private — views are per-user, never
 * shared across teammates). Scoped to the active account AND the owner. Owner
 * name is still joined for the label, though it's always the caller now.
 * Ordered by name for a stable list.
 */
export async function listSummaryViews(
  ownerUserId: string,
  page = "summary",
): Promise<SummaryViewRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: summaryViews.id,
      name: summaryViews.name,
      query: summaryViews.query,
      isDefault: summaryViews.isDefault,
      ownerUserId: summaryViews.ownerUserId,
      ownerName: users.name,
      createdAt: summaryViews.createdAt,
    })
    .from(summaryViews)
    .leftJoin(users, eq(users.id, summaryViews.ownerUserId))
    .where(
      and(
        eq(summaryViews.accountId, acct),
        eq(summaryViews.page, page),
        eq(summaryViews.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(asc(summaryViews.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    query: r.query,
    isDefault: r.isDefault,
    ownerUserId: r.ownerUserId,
    ownerName: r.ownerName ?? null,
    createdAt: r.createdAt,
  }));
}

/** The caller's own default view for a page, if one is set and non-empty. */
export async function getDefaultSummaryView(
  ownerUserId: string,
  page = "summary",
): Promise<{ id: string; query: string } | null> {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ id: summaryViews.id, query: summaryViews.query })
    .from(summaryViews)
    .where(
      and(
        eq(summaryViews.accountId, acct),
        eq(summaryViews.page, page),
        eq(summaryViews.ownerUserId, ownerUserId),
        eq(summaryViews.isDefault, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Single view by id — used by the delete/default actions to authorize + label. */
export async function getSummaryView(id: string) {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({
      id: summaryViews.id,
      name: summaryViews.name,
      ownerUserId: summaryViews.ownerUserId,
      page: summaryViews.page,
      isDefault: summaryViews.isDefault,
    })
    .from(summaryViews)
    .where(and(eq(summaryViews.accountId, acct), eq(summaryViews.id, id)))
    .limit(1);
  return row ?? null;
}

/** One saved view as the ⌘K palette lists it (R-027). */
export interface SavedViewOption {
  id: string;
  name: string;
  /** The page key the view belongs to ("summary" · "creatives" · "campaigns"). */
  page: string;
  query: string;
}

/**
 * Every saved view the caller owns in the active brand, across pages — the
 * palette's "Saved views" group (R-027). Views are private, so this is the
 * owner's own list, like `listSummaryViews` but for every page at once.
 */
export async function listSavedViewOptions(ownerUserId: string): Promise<SavedViewOption[]> {
  const acct = await getActiveAccountId();
  return db
    .select({
      id: summaryViews.id,
      name: summaryViews.name,
      page: summaryViews.page,
      query: summaryViews.query,
    })
    .from(summaryViews)
    .where(and(eq(summaryViews.accountId, acct), eq(summaryViews.ownerUserId, ownerUserId)))
    .orderBy(asc(summaryViews.name));
}
