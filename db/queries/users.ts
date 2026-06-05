import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, users } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

/**
 * Users who've authored at least one creative — the candidate set for the
 * Summary view's "Creator" filter. We don't show the full team here because
 * filtering by a teammate who's never created a creative would always
 * return an empty result.
 */
export async function listCreators(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  const acct = await getActiveAccountId();
  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(
      creatives,
      and(
        eq(creatives.createdByUserId, users.id),
        eq(creatives.accountId, acct),
      ),
    )
    .orderBy(asc(users.name));
  return rows;
}
