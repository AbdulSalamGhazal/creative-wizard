import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creativeTags, tags } from "@/db/schema";

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
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      createdAt: tags.createdAt,
      usage: sql<number>`(
        SELECT COUNT(*)::int FROM ${creativeTags}
        WHERE ${creativeTags.tag} = ${tags.name}
      )`,
    })
    .from(tags)
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
  const [row] = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.id, id))
    .limit(1);
  return row ?? null;
}
