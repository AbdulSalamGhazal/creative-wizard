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
  // The level ABOVE an ad set (2026-11): `list_campaigns` rolls up by it and
  // `get_campaign` reads ONE in depth (both `level: "campaign"`);
  // `get_timeseries` breaks down by it (`dimension: "parent_campaign"`) and
  // `get_canvas_patterns` folds to it (`level: "campaign"`).
  "parent-campaign": { mcp: "tools", tools: ["list_campaigns", "get_campaign"] },
  "campaign-status": { mcp: "tools", tools: ["get_campaign"] },
  summary: { mcp: "tools", tools: ["get_summary"] },
  rating: { mcp: "tools", tools: ["get_summary"] },
  funnel: { mcp: "tools", tools: ["get_funnel"] },
  "series-bounds": { mcp: "tools", tools: ["get_data_freshness", "get_budget", "get_store"] },
  diagnosis: { mcp: "tools", tools: ["diagnose_campaign"] },
  products: { mcp: "tools", tools: ["list_products"] },
  budget: { mcp: "tools", tools: ["get_budget", "get_budget_review"] },
  "store-insights": { mcp: "tools", tools: ["get_store"] },
  reconciliation: { mcp: "tools", tools: ["get_store"] },
  // The Salla feed: get_store carries its freshness (`salla_feed`). The raw
  // event log stays off the MCP until there is an analysis to serve from it.
  "store-connector": { mcp: "tools", tools: ["get_store"] },
  // Product costs: get_store.top_products carries COGS and gross profit.
  "store-costs": { mcp: "tools", tools: ["get_store"] },
  "landing-page-performance": { mcp: "tools", tools: ["get_landing_pages"] },
  trends: { mcp: "tools", tools: ["get_trends"] },
  // Pricing · Actual (user decision 2026-11-27, reopening 2026-11-11): the real
  // CML, against the version's active plan. get_actual_cml reads a version's
  // document only to run the page's computation; the versions themselves
  // (products, offers, targets, plans) are not a tool.
  "price-structure-actual": { mcp: "tools", tools: ["get_actual_cml"] },
  "price-structure": { mcp: "tools", tools: ["get_actual_cml"] },

  // ── Deliberately not on the MCP ───────────────────────────────────────────
  "store-utms": {
    mcp: "no",
    why: "UTM hygiene is a cleanup surface; get_store already carries the platform split the UTMs map to.",
  },
  store: {
    mcp: "no",
    why: "Order rows, field config, batches and the cleanup writers — row-level PII and upload plumbing; get_store reads the aggregates.",
  },
  // One page in depth (2026-11-12, its detail page): get_landing_pages `code`.
  "landing-pages": { mcp: "tools", tools: ["get_landing_pages"] },
  angles: {
    mcp: "no",
    why: "The angle vocabulary and its writer; get_trends and list_creatives return the angles in use.",
  },
  // The Canvas's PATTERNS (2026-11-20): the insight strip as data. The node
  // graph itself stays a picture; the patterns are what a user asks about.
  canvas: { mcp: "tools", tools: ["get_canvas_patterns"] },
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
