import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { summaryViews, users } from "@/db/schema";

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
 * All saved views for a page, team-visible. Owner name joined for the
 * "saved by" hint. Ordered by name for a stable list.
 */
export async function listSummaryViews(
  page = "summary",
): Promise<SummaryViewRow[]> {
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
    .where(eq(summaryViews.page, page))
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

/** The team default view for a page, if one is set and non-empty. */
export async function getDefaultSummaryView(
  page = "summary",
): Promise<{ id: string; query: string } | null> {
  const [row] = await db
    .select({ id: summaryViews.id, query: summaryViews.query })
    .from(summaryViews)
    .where(and(eq(summaryViews.page, page), eq(summaryViews.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/** Single view by id — used by the delete/default actions to authorize + label. */
export async function getSummaryView(id: string) {
  const [row] = await db
    .select({
      id: summaryViews.id,
      name: summaryViews.name,
      ownerUserId: summaryViews.ownerUserId,
      page: summaryViews.page,
      isDefault: summaryViews.isDefault,
    })
    .from(summaryViews)
    .where(and(eq(summaryViews.id, id)))
    .limit(1);
  return row ?? null;
}
