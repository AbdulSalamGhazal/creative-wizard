/**
 * One-off data migration: shorten the Instagram/Facebook campaign-name tags.
 *
 *   " (Instagram)" → " (IG)"      " (Facebook)" → " (FB)"
 *
 * The platform tag is part of the STORED `campaign_name` (see
 * lib/campaign.buildCampaignName) and of the `campaigns` registry that uploads
 * match against. When the tag format changed, every existing stored name has to
 * move with it or uploads stop matching (E061). This rewrites BOTH tables.
 *
 * Safe to re-run: it only touches rows that still end with the long tag, and it
 * strips exactly the trailing suffix (never a mid-name occurrence). No collision
 * risk — the short form does not exist yet.
 *
 * Local:  tsx --env-file=.env.local db/scripts/shorten-platform-tags.ts
 * Prod:   DATABASE_URL='<direct-neon-url>' tsx db/scripts/shorten-platform-tags.ts
 */
import { sql, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { performanceRecords, campaigns } from "@/db/schema";

const SWAPS = [
  { long: " (Instagram)", short: " (IG)" },
  { long: " (Facebook)", short: " (FB)" },
] as const;

async function main() {
  console.log("Shortening IG/FB campaign-name tags…");
  let perfTotal = 0;
  let campTotal = 0;

  await db.transaction(async (tx) => {
    for (const { long, short } of SWAPS) {
      const n = long.length;
      // Strip the trailing `long` suffix and append `short`. The LIKE is
      // end-anchored (no trailing %), so only names that END with the tag match.
      const perf = await tx
        .update(performanceRecords)
        .set({
          campaignName: sql`left(${performanceRecords.campaignName}, length(${performanceRecords.campaignName}) - ${n}) || ${short}`,
        })
        .where(like(performanceRecords.campaignName, `%${long}`));
      const camp = await tx
        .update(campaigns)
        .set({
          name: sql`left(${campaigns.name}, length(${campaigns.name}) - ${n}) || ${short}`,
        })
        .where(like(campaigns.name, `%${long}`));

      const pc = (perf as { count?: number }).count ?? 0;
      const cc = (camp as { count?: number }).count ?? 0;
      perfTotal += pc;
      campTotal += cc;
      console.log(`  ${long.trim()} → ${short.trim()}: performance_records=${pc}, campaigns=${cc}`);
    }
  });

  console.log(
    `Done. performance_records updated=${perfTotal}, campaigns updated=${campTotal}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
