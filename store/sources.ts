/**
 * Store SOURCE vocabulary — the first mapping axis (utm_source → ad platform);
 * the second is `store/channels.ts` (channel → Website | Application).
 *
 * The sentinel lives HERE, beside the channel one, rather than in the
 * reconciliation query module: both the Reconciliation queries and the Store
 * Insights page (client and server) bucket by it, and a client component must
 * never reach into `db/queries/*` for a string. `db/queries/reconciliation.ts`
 * re-exports it, so its existing importers are unchanged.
 */

/** Sentinel bucket: no mapping for this order's source (or the cell is blank). */
export const UNATTRIBUTED = "__unattr__";
