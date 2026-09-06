import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creatives, creativeAngles, angles } from "@/db/schema";
import { getActiveAccountId } from "@/lib/tenant";

export interface AngleRow {
  id: string;
  name: string;
  createdAt: Date;
  /** How many creatives currently carry this angle. */
  usage: number;
}

/**
 * The managed angle vocabulary with per-angle usage counts (how many creatives
 * carry each angle). Usage is a correlated count against creative_angles by
 * name, since assignments are stored by string.
 */
export async function listAngles(): Promise<AngleRow[]> {
  const acct = await getActiveAccountId();
  const rows = await db
    .select({
      id: angles.id,
      name: angles.name,
      createdAt: angles.createdAt,
      // Usage is scoped to this account: an angle string can exist independently
      // in two brands, so we count only creative_angles whose creative belongs
      // to the active account.
      //
      // The subquery's tables are ALIASED and every column is qualified on
      // purpose. Drizzle renders `${table.column}` inside a raw sql template
      // unqualified, so an unadorned `${angles.name}` emits bare "name", which
      // Postgres binds to the INNERMOST scope that has it — `creatives.name` —
      // making this count "assignments whose angle equals the creative's name",
      // i.e. always 0. (That silent bug shipped with the original tags version;
      // it is fixed here, not introduced by the rename.) `angles.name` below is
      // written out so it unambiguously correlates to the OUTER row.
      usage: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${creativeAngles} ca
        JOIN ${creatives} cr ON cr.id = ca.creative_id
        WHERE ca.angle = angles.name
          AND cr.account_id = ${acct}
      )`,
    })
    .from(angles)
    .where(eq(angles.accountId, acct))
    .orderBy(asc(angles.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    usage: Number(r.usage ?? 0),
  }));
}

/** Single vocabulary angle by id — used by rename/delete actions. */
export async function getAngle(id: string) {
  const acct = await getActiveAccountId();
  const [row] = await db
    .select({ id: angles.id, name: angles.name })
    .from(angles)
    .where(and(eq(angles.accountId, acct), eq(angles.id, id)))
    .limit(1);
  return row ?? null;
}
