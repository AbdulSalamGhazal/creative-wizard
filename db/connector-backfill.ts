/**
 * One-off first load of the Salla connector feed: every order the connector
 * still holds (its window is 30 days), for every linked store, through the
 * same ingest as the webhook. Idempotent — safe to run again. The nightly
 * pull (`/api/cron/store-sync`) only handles the small daily delta; this
 * script has no time limit.
 *
 * Usage (prod, after the migration and with CONNECTOR_MODE as you want it):
 *   DATABASE_URL='<pooled-url>' CONNECTOR_API_KEY='…' CONNECTOR_MODE=live \
 *     npx tsx db/connector-backfill.ts [YYYY-MM-DD]
 * The optional date is `created_from`; default is 30 days ago.
 */
import { syncAllStores } from "@/lib/connector/sync";
import { connectorMode } from "@/lib/connector/ingest";

async function main() {
  const arg = process.argv[2];
  if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    console.error("The date must be YYYY-MM-DD.");
    process.exit(1);
  }
  const from = arg ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  console.log(`Backfilling from ${from} in ${connectorMode()} mode…`);
  const results = await syncAllStores({ backfillFrom: from });
  for (const r of results) {
    console.log(
      `${r.store}: ${r.ok ? "ok" : `FAILED (${r.error})`} · ${r.orders} orders read · ${r.applied} applied`,
    );
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
