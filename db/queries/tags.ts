import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, creativeTags, tags } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

export interface TagRow {
  id: string;
  name: string;
  createdAt: Date;
  /** How many creatives currently carry this tag. */
  usage: number;
}

/**
 * The managed tag vocabulary with per-tag usage counts (how many creatives
 * carry each tag). Usage is a correlated count against creative_tags by
 * name, since assignments are stored by string.
 */
export async function listTags(): Promise<TagRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      createdAt: tags.createdAt,
      // Usage is scoped to this account: a tag string can exist independently
      // in two brands, so we count only creative_tags whose creative belongs
      // to the active account.
      usage: sql<number>`(
        SELECT COUNT(*)::int FROM ${creativeTags}
        JOIN ${creatives} ON ${creatives.id} = ${creativeTags.creativeId}
        WHERE ${creativeTags.tag} = ${tags.name}
          AND ${creatives.accountId} = ${acct}
      )`,
    })
    .from(tags)
    .where(eq(tags.accountId, acct))
    .orderBy(asc(tags.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    usage: Number(r.usage ?? 0),
  }));
}

/** Single vocabulary tag by id — used by rename/delete actions. */
export async function getTag(id: string) {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.accountId, acct), eq(tags.id, id)))
    .limit(1);
  return row ?? null;
}
