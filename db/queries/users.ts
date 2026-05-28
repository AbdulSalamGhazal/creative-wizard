import { asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, users } from "@/db/schema";

/**
 * Users who've authored at least one creative — the candidate set for the
 * Summary view's "Creator" filter. We don't show the full team here because
 * filtering by a teammate who's never created a creative would always
 * return an empty result.
 */
export async function listCreators(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(creatives, sql`${creatives.createdByUserId} = ${users.id}`)
    .orderBy(asc(users.name));
  return rows;
}
