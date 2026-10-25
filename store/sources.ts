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

/**
 * The UTMs page splits Reconciliation's Unattributed bucket THREE ways, because
 * "we don't know" has three different causes and three different fixes:
 *  · NO_SOURCE       — the order carries no `utm_source` at all (a blank cell
 *                      or an absent column): a tagging gap on the links.
 *  · UNMAPPED_SOURCE — a value nobody has mapped yet: a config gap, fixed in
 *                      Order fields (or inline on /store/utms).
 *  · OTHER_SOURCE    — a value explicitly mapped to "not an ad platform"
 *                      (direct, WhatsApp, a newsletter): not a gap at all.
 * INVARIANT (test-pinned): NO_SOURCE + UNMAPPED_SOURCE + OTHER_SOURCE ==
 * UNATTRIBUTED for any day and range, and the platform buckets are identical
 * — the UTMs page and Reconciliation never tell different stories.
 */
export const NO_SOURCE = "__nosrc__";
export const UNMAPPED_SOURCE = "__unmappedsrc__";
export const OTHER_SOURCE = "__othersrc__";
