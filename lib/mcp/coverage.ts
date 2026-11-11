/**
 * THE MCP COVERAGE REGISTER (2026-11-11, user rule): every query module in
 * `db/queries/` is DECIDED here — either a tool reads it, or the reason it
 * doesn't is written down.
 *
 * Why it exists: from 2026-10-03 to 2026-11-11 the app shipped Budget, the
 * Store module, landing pages, Trends and Pricing, and the MCP got NONE of
 * them — no step in a feature's path asked "should the user's own Claude be
 * able to read this?". Nobody decided against it; nobody decided at all.
 *
 * `lib/mcp/coverage.test.ts` fails the suite when a query module is missing
 * here, when an entry names a module that no longer exists, or when a "tools"
 * entry names a tool `lib/mcp/tools.ts` doesn't register. A new module therefore
 * can't land without its feature session making the call — and a "not
 * relevant" entry is a decision the user can read and overturn.
 *
 * Read-only stays absolute: a module that only WRITES is "no" by definition
 * (the MCP never mutates — docs/decisions/mcp-diagnosis.md).
 */
export type McpCoverage =
  /** One or more MCP tools read this module. */
  | { mcp: "tools"; tools: readonly string[] }
  /** Deliberately not on the MCP — the reason is the record. */
  | { mcp: "no"; why: string };

export const MCP_COVERAGE: Record<string, McpCoverage> = {
  // ── On the MCP ────────────────────────────────────────────────────────────
  performance: { mcp: "tools", tools: ["get_kpis", "get_timeseries"] },
  creatives: { mcp: "tools", tools: ["list_creatives", "get_creative"] },
  "creative-status": { mcp: "tools", tools: ["get_creative"] },
  portfolio: { mcp: "tools", tools: ["list_campaigns"] },
  campaign: { mcp: "tools", tools: ["get_campaign"] },
  "campaign-status": { mcp: "tools", tools: ["get_campaign"] },
  summary: { mcp: "tools", tools: ["get_summary"] },
  rating: { mcp: "tools", tools: ["get_summary"] },
  funnel: { mcp: "tools", tools: ["get_funnel"] },
  "series-bounds": { mcp: "tools", tools: ["get_data_freshness", "get_budget", "get_store"] },
  diagnosis: { mcp: "tools", tools: ["diagnose_campaign"] },
  products: { mcp: "tools", tools: ["list_products"] },
  budget: { mcp: "tools", tools: ["get_budget"] },
  "store-insights": { mcp: "tools", tools: ["get_store"] },
  reconciliation: { mcp: "tools", tools: ["get_store"] },
  "landing-page-performance": { mcp: "tools", tools: ["get_landing_pages"] },
  trends: { mcp: "tools", tools: ["get_trends"] },

  // ── Deliberately not on the MCP ───────────────────────────────────────────
  "price-structure": {
    mcp: "no",
    why: "User decision 2026-11-11: costs and margins are sensitive; the user's Claude does not read Pricing.",
  },
  audience: {
    mcp: "no",
    why: "Funnel-audience snapshots are hand-entered planning inputs, not performance; not requested for the MCP.",
  },
  "store-utms": {
    mcp: "no",
    why: "UTM hygiene is a cleanup surface; get_store already carries the platform split the UTMs map to.",
  },
  store: {
    mcp: "no",
    why: "Order rows, field config, batches and the cleanup writers — row-level PII and upload plumbing; get_store reads the aggregates.",
  },
  "landing-pages": {
    mcp: "no",
    why: "The registry list; get_landing_pages already returns each page's name, code and URL with its performance.",
  },
  angles: {
    mcp: "no",
    why: "The angle vocabulary and its writer; get_trends and list_creatives return the angles in use.",
  },
  canvas: {
    mcp: "no",
    why: "The Canvas's node graph is a visual layout of facts every other tool already returns.",
  },
  platforms: { mcp: "no", why: "Admin overview of record counts per platform; get_data_freshness answers the useful question." },
  "exclusion-rules": { mcp: "no", why: "Admin rule engine and its writers; every tool reports excluded records via include_excluded." },
  uploads: { mcp: "no", why: "Upload batches and the pipeline's writers — plumbing, not analytics." },
  cleanup: { mcp: "no", why: "The record-cleanup tool's preview and delete — a writer." },
  "summary-views": { mcp: "no", why: "A user's saved table views — UI state." },
  "user-prefs": { mcp: "no", why: "Per-user UI preferences." },
  comments: { mcp: "no", why: "Team conversation, not data; not requested for the MCP." },
  "comment-reads": { mcp: "no", why: "Read receipts for comments — UI state." },
  notifications: { mcp: "no", why: "The bell's inbox — UI state." },
  activity: { mcp: "no", why: "The brand's comment feed; see comments." },
  "entity-activity": { mcp: "no", why: "Per-entity edit history for the Activity tab; not requested for the MCP." },
  audit: { mcp: "no", why: "Admin audit log — access-controlled history, not analytics." },
  team: { mcp: "no", why: "Members and permissions — admin data." },
  auth: { mcp: "no", why: "Sign-in and session reads." },
  values: { mcp: "no", why: "Shared row-value coercion helpers, not a data source." },
};
