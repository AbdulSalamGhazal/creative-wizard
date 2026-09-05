import {
  check,
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  date,
  boolean,
  integer,
  smallint,
  bigint,
  numeric,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CAMPAIGN_OBJECTIVES } from "@/lib/campaign";
import { ALL_PLATFORMS } from "@/lib/palette";

export const roleEnum = ["admin", "editor", "viewer"] as const;
// Derived from lib/palette's canonical list (DERIVE, don't re-list — same
// pattern as campaignObjectiveEnum below).
export const platformEnum = ALL_PLATFORMS;
export const creativeTypeEnum = ["video", "slides", "image"] as const;
export const creativeStatusEnum = ["draft", "active", "paused", "archived"] as const;
export const productStatusEnum = ["active", "archived"] as const;
// Single source of truth lives in lib/campaign (client-safe) so the create-form
// dropdown and this DB enum can never drift.
export const campaignObjectiveEnum = CAMPAIGN_OBJECTIVES;

/**
 * The fixed UUID of the original brand ("Urjwan"). It's the DEFAULT for every
 * tenant table's `account_id` column so (a) the additive migration backfills
 * existing rows to it and (b) any write that forgets to set an account still
 * lands on the primary brand rather than failing. New code always sets the
 * account explicitly; this is a transition/safety net.
 */
export const DEFAULT_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  /** bcrypt hash. Nullable so existing rows can be migrated lazily; sign-in
   *  rejects users with no hash and points them to ask an admin to set one. */
  passwordHash: text("password_hash"),
  /**
   * Coarse tier: `admin` bypasses every permission check; `editor` / `viewer`
   * are the fallback presets used when `permissions IS NULL`. See lib/permissions.ts.
   */
  role: varchar("role", { length: 16, enum: roleEnum }).notNull().default("editor"),
  /**
   * Explicit per-user permission set (a list of `lib/permissions.ts` keys).
   * NULL → derive from `role` (the preset), which keeps existing users behaving
   * identically after deploy; a non-null array → that exact "Custom" set.
   * Admins ignore this (they always have everything).
   */
  permissions: text("permissions").array(),
  /**
   * Brand membership scope. `true` (default/legacy) → member of EVERY brand,
   * including brands created later; `false` → only the brands listed in
   * `user_accounts`. Admins are ALWAYS effectively `true` (enforced in code,
   * like the permission bypass). Combined with permissions: permissions say
   * WHAT a user can do, membership says WHERE. See lib/tenant.ts.
   */
  allAccounts: boolean("all_accounts").notNull().default(true),
  /**
   * The user's remembered default date range, applied on any page that has no
   * explicit from/to in its URL. A preset key (e.g. "30", "lifetime" — kept
   * rolling) or `custom:FROM..TO`. Null until they pick a range. Per-user
   * (global, across brands).
   */
  preferredDateRange: text("preferred_date_range"),
  /**
   * The user's remembered Excluded-toggle state (`includeExcluded`), applied on
   * any page whose URL doesn't carry an explicit `includeExcluded` param.
   * NULL = never chose → hidden (the safe default). Mirrors
   * `preferredDateRange`; resolution: URL param → this → hidden.
   */
  includeExcluded: boolean("include_excluded"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Personal access tokens — a user links their OWN LLM to the read-only MCP
 * server (`/api/mcp`) with a bearer token that ACTS AS THEM (brand membership +
 * viewer-level read apply exactly as in the web app). Global table, like
 * `users` — no `account_id`. The raw secret is NEVER stored: only its SHA-256
 * (`token_hash`, unique) and a short display `prefix`. See lib/api-token.ts.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** User-given label so they can tell tokens apart ("Claude Desktop"). */
    name: varchar("name", { length: 64 }).notNull(),
    /** SHA-256 hex of the raw secret. Unique so lookup is a single indexed hit. */
    tokenHash: text("token_hash").notNull().unique(),
    /** Display-only: `cwz_` + first 8 chars of the secret. NOT sensitive. */
    prefix: varchar("prefix", { length: 12 }).notNull(),
    /** Stamped on use (throttled to ≤ once/min) so the list can show recency. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set on revoke; a non-null value rejects the token at verify time. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("api_tokens_user_idx").on(t.userId),
  }),
);

/**
 * Brands / tenants. Global (shared across the app); every tenant-scoped table
 * carries an `account_id` FK to this table. Users are global too — any user can
 * switch to any account via the brand switcher.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  /**
   * "Active" window for the dynamic creative status: a creative counts as Active
   * on a platform if it spent within this many hours of THAT platform's latest
   * data day. Data is daily-grain, so this rounds to whole days (24h = the
   * latest day only, 48h = last two days, …). Per-brand, default 24h.
   */
  statusWindowHours: integer("status_window_hours").notNull().default(24),
  /**
   * Which custom store field (`store_order_fields.key`) holds an order's traffic
   * SOURCE, for the Store → Reconciliation page. NULL = not configured (the
   * by-platform reconciliation can't attribute orders to platforms yet). The raw
   * values found in that field's `attributes` are mapped to ad platforms via
   * `store_source_mappings`.
   */
  storeSourceFieldKey: varchar("store_source_field_key", { length: 48 }),
  /**
   * USD→SAR conversion rate for the Budget module's display toggle and its
   * ROAS-through-rate math (revenue is SAR, spend is USD). Per-brand,
   * user-editable on /budget (budget.manage). Default 3.77 (the peg).
   */
  usdToSarRate: numeric("usd_to_sar_rate", { precision: 8, scale: 4 })
    .notNull()
    .default("3.77"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Brand membership — which brands a RESTRICTED user (`users.all_accounts =
 * false`) may see. Consulted ONLY when `all_accounts = false`; all-accounts
 * users and admins ignore it. Global (non-tenant) table, like `users` itself —
 * no `account_id` default trick. Both FKs cascade so deleting a user or a brand
 * cleans up its memberships.
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.accountId] }),
  }),
);

/** Shared `account_id` column definition for tenant-scoped tables. */
const accountId = () =>
  uuid("account_id")
    .notNull()
    .references(() => accounts.id)
    .default(DEFAULT_ACCOUNT_ID);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    status: varchar("status", { length: 16, enum: productStatusEnum })
      .notNull()
      .default("active"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("products_status_idx").on(t.status),
    accountNameIdx: uniqueIndex("products_account_name_idx").on(t.accountId, t.name),
    accountSlugIdx: uniqueIndex("products_account_slug_idx").on(t.accountId, t.slug),
  }),
);

export const creatives = pgTable(
  "creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    name: varchar("name", { length: 255 }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: varchar("type", { length: 16, enum: creativeTypeEnum }).notNull(),
    thumbnailUrl: text("thumbnail_url"),
    status: varchar("status", { length: 16, enum: creativeStatusEnum })
      .notNull()
      .default("draft"),
    launchDate: date("launch_date"),
    /**
     * Manual PRIORITY — the team's own judgment of importance, independent of
     * performance. 1..3 (3 = highest), shown as a 1..3 icon control on the
     * detail page. NULL = unrated (the default; never a numeric 0, never
     * auto-set). Distinct from the computed performance "Rate" concept
     * (rating_rules / lib/rating.ts) — never conflate the two. Detail-page only
     * for now (not filtered/sorted → no index).
     */
    priority: smallint("priority"),
    notes: text("notes"),
    // The creative's source link (e.g. the live post/ad or asset URL).
    // Display-only metadata; not used in aggregation.
    sourceLink: text("source_link"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("creatives_product_idx").on(t.productId),
    statusIdx: index("creatives_status_idx").on(t.status),
    typeIdx: index("creatives_type_idx").on(t.type),
    accountNameIdx: uniqueIndex("creatives_account_name_idx").on(t.accountId, t.name),
  }),
);

/**
 * Registered campaigns. Like creatives, a campaign must exist here before any
 * upload can reference it — otherwise renaming a campaign at the source would
 * silently spawn a new one. `name` is the FULL stored campaign_name produced by
 * lib/campaign.buildCampaignName ("Campaign ➤ Ad Set" + " (IG)"/" (FB)" for
 * Instagram/Facebook), so upload validation matches it byte-for-byte. Unique
 * per account; one name lives on exactly one platform (see the E060 guard).
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    name: text("name").notNull(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    objective: varchar("objective", { length: 16, enum: campaignObjectiveEnum })
      .notNull()
      .default("Sales"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountNameIdx: uniqueIndex("campaigns_account_name_idx").on(t.accountId, t.name),
    accountPlatformIdx: index("campaigns_account_platform_idx").on(
      t.accountId,
      t.platform,
    ),
  }),
);

export const creativeTags = pgTable(
  "creative_tags",
  {
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
    tag: varchar("tag", { length: 64 }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.creativeId, t.tag] }),
    tagIdx: index("creative_tags_tag_idx").on(t.tag),
  }),
);

/**
 * Manual per-(creative, platform) TERMINATION — the only manual lever in the
 * dynamic creative-status model. A row means "this creative is Terminated on
 * this platform": sticky, and it overrides the spend-derived Active/Pause logic
 * until removed. No row = automatic status. Reactivating deletes the row.
 * account_id is carried (and scoped) even though creative_id already implies
 * the account, so termination reads/writes stay first-class account-scoped.
 */
export const creativePlatformOverrides = pgTable(
  "creative_platform_overrides",
  {
    accountId: accountId(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    terminatedByUserId: uuid("terminated_by_user_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.creativeId, t.platform] }),
    accountIdx: index("cpo_account_idx").on(t.accountId),
  }),
);

/**
 * Tag vocabulary — the managed set of tags, like products. Creatives still
 * store their assignments in `creative_tags` (by string); this table is the
 * canonical list admins curate. Renaming a tag here cascades to
 * `creative_tags`; deleting removes the assignments too.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    name: varchar("name", { length: 64 }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    accountNameIdx: uniqueIndex("tags_account_name_idx").on(t.accountId, t.name),
  }),
);

/**
 * Singleton config for the creative rating shown on /summary. One global row
 * (id = 1). A creative's rating is derived live from its ROAS, gated by a
 * minimum spend:
 *   spend < minSpend            → N/A   (not enough spend to judge)
 *   ROAS >= goodRoas            → Good
 *   ROAS >= decentRoas          → Decent
 *   otherwise (has spend)       → Bad
 * Applied identically to each platform's own values and the blended total.
 * Edited from /admin/catalog?tab=rating (admin only).
 */
export const ratingRules = pgTable(
  "rating_rules",
  {
    // One default-rating row per brand (was a global id=1 singleton).
    accountId: accountId(),
    minSpend: numeric("min_spend", { precision: 14, scale: 2 }).notNull().default("500"),
    goodRoas: numeric("good_roas", { precision: 10, scale: 2 }).notNull().default("4"),
    decentRoas: numeric("decent_roas", { precision: 10, scale: 2 }).notNull().default("2"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId] }),
  }),
);

/**
 * Per-platform overrides for the rating cutoffs. The `rating_rules` row above
 * is the DEFAULT (used for the blended total and any platform without a row
 * here); a row in this table customizes one platform's thresholds. One row per
 * (brand, platform).
 */
export const platformRatingRules = pgTable(
  "platform_rating_rules",
  {
    accountId: accountId(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    minSpend: numeric("min_spend", { precision: 14, scale: 2 }).notNull().default("500"),
    goodRoas: numeric("good_roas", { precision: 10, scale: 2 }).notNull().default("4"),
    decentRoas: numeric("decent_roas", { precision: 10, scale: 2 }).notNull().default("2"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.platform] }),
  }),
);

export const uploadBatches = pgTable(
  "upload_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    rowsImported: integer("rows_imported").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackByUserId: uuid("rolled_back_by_user_id").references(() => users.id),
  },
  (t) => ({
    // The uploads page filters by account and sorts newest-first on every visit.
    accountUploadedIdx: index("upload_batches_account_uploaded_idx").on(
      t.accountId,
      t.uploadedAt.desc(),
    ),
  }),
);

/**
 * Per-platform CSV header → internal-field mappings. Admin-editable from
 * /admin/platforms so the team can tune the mapping when a real export
 * shows up without touching the codebase.
 *
 * Each row is one candidate header string for one (platform, internal_field).
 * The validation pipeline iterates the rows in priority order and picks the
 * first that case-insensitively matches a header in the uploaded CSV.
 */
export const platformFieldMappings = pgTable(
  "platform_field_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    internalField: varchar("internal_field", { length: 32 }).notNull(),
    headerName: varchar("header_name", { length: 255 }).notNull(),
    priority: integer("priority").notNull().default(0),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("pfm_unique_idx").on(
      t.accountId,
      t.platform,
      t.internalField,
      t.headerName,
    ),
    platformIdx: index("pfm_platform_idx").on(t.platform),
  }),
);

/**
 * Holds the validated rows between the validate→commit two-step. TTL is
 * enforced lazily at lookup time; expired rows linger until a sweep runs.
 *
 * In production this can move to Vercel KV. The schema column shape stays.
 */
export const uploadValidationSessions = pgTable(
  "upload_validation_sessions",
  {
    token: uuid("token").primaryKey().defaultRandom(),
    accountId: accountId(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresIdx: index("uvs_expires_idx").on(t.expiresAt),
  }),
);

/**
 * Saved "Views" — named snapshots of a page's full filter/column/sort
 * configuration, stored as the raw URL query string. Team-visible (this is
 * an internal tool, so a teammate's "High-ROAS" view is useful to everyone);
 * deletable by the owner or an admin.
 *
 * `page` lets the table be reused beyond Summary later (Trends, Library…).
 * `query` is the searchParams string sans leading "?", e.g.
 * "platforms=meta,tiktok&metricFilters=total:roas:gte:2".
 */
export const summaryViews = pgTable(
  "summary_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    page: varchar("page", { length: 32 }).notNull().default("summary"),
    name: varchar("name", { length: 120 }).notNull(),
    query: text("query").notNull(),
    /** At most one default per (user, page) — each user has their own default
     *  landing config. Enforced by the partial unique index below. */
    isDefault: boolean("is_default").notNull().default(false),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pageIdx: index("summary_views_page_idx").on(t.page),
    ownerIdx: index("summary_views_owner_idx").on(t.ownerUserId),
    uniqOwnerName: uniqueIndex("summary_views_owner_name_idx").on(
      t.accountId,
      t.ownerUserId,
      t.page,
      t.name,
    ),
    // One default per (account, user, page) — partial unique index over
    // is_default. Per-user so each teammate keeps their own default view.
    oneDefaultPerUserPage: uniqueIndex("summary_views_default_idx")
      .on(t.accountId, t.ownerUserId, t.page)
      .where(sql`${t.isDefault}`),
  }),
);

/**
 * Append-only audit trail. Every mutation in the system writes one row.
 *
 * Design notes:
 * - `actor_user_id` is nullable: a few events (failed sign-ins, system tasks)
 *   have no authenticated actor. We capture the attempted email in `meta`.
 * - `entity_id` is nullable + untyped (text rather than uuid) because audit
 *   targets aren't always uuids — e.g. upload batches use uuid but a sign-in
 *   event references a user by email string before we know who they are.
 * - `entity_label` is denormalized at write time so the feed renders even
 *   after the entity is deleted (e.g. a rolled-back batch, a renamed creative).
 * - `meta` jsonb holds action-specific extras (from/to status, row counts,
 *   reasons, etc.). Shape is per-action — see lib/audit.ts AUDIT_ACTIONS.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    accountId: accountId(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: text("entity_id"),
    entityLabel: varchar("entity_label", { length: 255 }),
    meta: jsonb("meta"),
  },
  (t) => ({
    // The audit feed filters by account and pages by id DESC; the table is
    // append-only and grows forever, so the account-leading index matters.
    accountIdIdx: index("audit_account_id_idx").on(t.accountId, t.id.desc()),
    atIdx: index("audit_at_idx").on(t.at),
    actorIdx: index("audit_actor_idx").on(t.actorUserId),
    entityIdx: index("audit_entity_idx").on(t.entityType, t.entityId),
    actionIdx: index("audit_action_idx").on(t.action),
  }),
);

export const performanceRecords = pgTable(
  "performance_records",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    accountId: accountId(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    date: date("date").notNull(),
    /**
     * The campaign identity — FK to the registered campaigns row. Part of the
     * dedup key (creative, platform, campaign, date). The campaign's display
     * name comes from the joined campaigns.name (the old denormalized
     * campaign_name text column was dropped in migration 0024).
     */
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    spend: numeric("spend", { precision: 14, scale: 4 }).notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    conversions: integer("conversions"),
    conversionValue: numeric("conversion_value", { precision: 14, scale: 4 }),
    landingPageViews: integer("landing_page_views"),
    // Mid-funnel commerce events — populated where the platform reports them;
    // null otherwise. Plain event counts, aggregated via SUM like conversions.
    // Presentation in the UI is intentionally deferred — schema only for now.
    addToCart: integer("add_to_cart"),
    addPayment: integer("add_payment"),
    // Video view funnel — populated for video creatives only; null for
    // image/slides so they're excluded from video-rate math.
    videoViews2s: integer("video_views_2s"),
    videoViews25: integer("video_views_25"),
    videoViews50: integer("video_views_50"),
    videoViews75: integer("video_views_75"),
    videoViews100: integer("video_views_100"),
    rawPayload: jsonb("raw_payload").notNull(),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => uploadBatches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    excludedFromAggregates: boolean("excluded_from_aggregates").notNull().default(false),
    excludedReason: text("excluded_reason"),
    excludedByUserId: uuid("excluded_by_user_id").references(() => users.id),
    excludedAt: timestamp("excluded_at", { withTimezone: true }),
    /**
     * Exclusion provenance (2026-09). Who flipped `excluded_from_aggregates`:
     * 'manual' (the per-record action) or 'rule' (the exclusion-rules engine,
     * `excluded_rule_id` says which). NULL only when not excluded. The two
     * writers never overwrite each other: a rule skips already-excluded rows,
     * and manual un-exclude refuses rows with source='rule'. FK has NO cascade
     * on purpose — rule deactivation/deletion un-applies its rows in code first.
     */
    excludedSource: varchar("excluded_source", {
      length: 8,
      enum: ["manual", "rule"],
    }),
    excludedRuleId: uuid("excluded_rule_id").references(() => exclusionRules.id),
  },
  (t) => ({
    // Unique on the FULL dedup key. The same creative can run on the same
    // platform/date across different campaigns (allowed), but not the same
    // campaign twice — campaign_id disambiguates.
    creativePlatformCampaignIdDateIdx: uniqueIndex(
      "perf_creative_platform_campaign_id_date_idx",
    ).on(t.creativeId, t.platform, t.campaignId, t.date),
    accountDateIdx: index("perf_account_date_idx").on(t.accountId, t.date),
    // Speeds the per-campaign queries (campaign detail + the campaigns table),
    // which filter by (account_id, campaign_id, date).
    accountCampaignIdDateIdx: index("perf_account_campaign_id_date_idx").on(
      t.accountId,
      t.campaignId,
      t.date,
    ),
    dateIdx: index("perf_date_idx").on(t.date),
    platformDateIdx: index("perf_platform_date_idx").on(t.platform, t.date),
    batchIdx: index("perf_upload_batch_idx").on(t.uploadBatchId),
    excludedIdx: index("perf_excluded_idx").on(t.excludedFromAggregates),
    excludedRuleIdx: index("perf_excluded_rule_idx").on(t.excludedRuleId),
  }),
);

export const exclusionRuleKindEnum = [
  "campaign_objective",
  "campaign",
  "creative",
] as const;
export type ExclusionRuleKind = (typeof exclusionRuleKindEnum)[number];

/**
 * Rule-based exclusions (2026-09) — account-global config rows that flip
 * `performance_records.excluded_from_aggregates` for everything matching the
 * rule ("materialized with provenance": the engine in lib/exclusion-rules.ts
 * stamps `excluded_source='rule'` + `excluded_rule_id`; aggregate queries stay
 * untouched). Exactly ONE target column is set, matching `kind` (validated in
 * code; enforced-ish by the per-kind partial unique indexes). `active` is a
 * GLOBAL switch — deactivating un-applies the rule for every user. Newly
 * imported records are stamped against active rules inside the commit
 * transaction. Deleting a targeted campaign/creative deletes its rules.
 */
export const exclusionRules = pgTable(
  "exclusion_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    kind: varchar("kind", { length: 24, enum: exclusionRuleKindEnum }).notNull(),
    /** kind='campaign_objective' → which objective. */
    objective: varchar("objective", { length: 16, enum: campaignObjectiveEnum }),
    /** kind='campaign' → which campaign. */
    campaignId: uuid("campaign_id").references(() => campaigns.id),
    /** kind='creative' → which creative. */
    creativeId: uuid("creative_id").references(() => creatives.id),
    active: boolean("active").notNull().default(true),
    note: varchar("note", { length: 200 }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Exactly the kind-matching target column is set (also validated in code
    // by validateRuleTarget — this is the DB backstop).
    oneTargetCheck: check(
      "exclusion_rules_one_target_check",
      sql`(
        (${t.kind} = 'campaign_objective' AND ${t.objective} IS NOT NULL AND ${t.campaignId} IS NULL AND ${t.creativeId} IS NULL) OR
        (${t.kind} = 'campaign' AND ${t.campaignId} IS NOT NULL AND ${t.objective} IS NULL AND ${t.creativeId} IS NULL) OR
        (${t.kind} = 'creative' AND ${t.creativeId} IS NOT NULL AND ${t.objective} IS NULL AND ${t.campaignId} IS NULL)
      )`,
    ),
    // One rule per target per account (partial per kind, since the target
    // column differs by kind).
    accountObjectiveUnique: uniqueIndex("exclusion_rules_account_objective_idx")
      .on(t.accountId, t.objective)
      .where(sql`${t.kind} = 'campaign_objective'`),
    accountCampaignUnique: uniqueIndex("exclusion_rules_account_campaign_idx")
      .on(t.accountId, t.campaignId)
      .where(sql`${t.kind} = 'campaign'`),
    accountCreativeUnique: uniqueIndex("exclusion_rules_account_creative_idx")
      .on(t.accountId, t.creativeId)
      .where(sql`${t.kind} = 'creative'`),
  }),
);

/**
 * Budget module (2026-09) — monthly spend plan per platform → objective, in
 * USD. `month` is always the FIRST of the month. Actuals come straight from
 * `performance_records` for the month WITHOUT any exclusion filtering (raw
 * totals — a standing product decision; see tech-spec §Budget). Tenant table
 * (§4.1 invariants).
 */
export const budgetAllocations = pgTable(
  "budget_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    /** First day of the planned month (e.g. 2026-09-01). */
    month: date("month").notNull(),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    objective: varchar("objective", { length: 16, enum: campaignObjectiveEnum }).notNull(),
    /** Planned spend for the month, USD. */
    plannedSpend: numeric("planned_spend", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountMonthComboUnique: uniqueIndex("budget_allocations_account_month_combo_idx").on(
      t.accountId,
      t.month,
      t.platform,
      t.objective,
    ),
  }),
);

/**
 * Month-level budget targets — today just the planned revenue (SAR, matching
 * the store's currency; never converted). A separate month-grain table so
 * future month-level targets (e.g. planned orders) slot in without remodeling.
 */
export const budgetTargets = pgTable(
  "budget_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    /** First day of the target month. */
    month: date("month").notNull(),
    plannedRevenueSar: numeric("planned_revenue_sar", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountMonthUnique: uniqueIndex("budget_targets_account_month_idx").on(
      t.accountId,
      t.month,
    ),
  }),
);

// =====================================================================
// Store module — manual Salla order uploads (NEW; parallel to the ads
// pipeline above, which it must NOT touch). Grain = one row per order.
// Currency is SAR throughout; never converted to USD in this module.
// =====================================================================

export const storeFieldTypeEnum = ["text", "number", "date"] as const;

/**
 * Config for store-order fields — the THREE core fields (seeded per account,
 * keys locked by `CORE_KEYS` in store/fields.ts: order_id/order_date/
 * total_amount) plus admin-defined custom fields. `headers` are the accepted
 * file headers for EXPLICIT mapping (matched case-insensitively after trim — no
 * auto-detection). A custom field can be `required`; core fields are always
 * required. `type` and `key` of core rows are immutable (only label + headers
 * are editable). Upload validation derives its rules entirely from these rows.
 */
export const storeOrderFields = pgTable(
  "store_order_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    /** Stable slug — the key under which a value lands in `store_orders.attributes`. */
    key: varchar("key", { length: 48 }).notNull(),
    label: varchar("label", { length: 64 }).notNull(),
    type: varchar("type", { length: 8, enum: storeFieldTypeEnum }).notNull(),
    required: boolean("required").notNull().default(false),
    /**
     * RETIRED 2026-08 — no longer read anywhere. Every field is now offered in
     * the Orders table's Columns menu; visibility is each viewer's per-browser
     * choice. Kept as a dead column (additive-only rule; like `creatives.status`)
     * for a later cleanup migration. Do NOT reintroduce reads of it.
     */
    showInTable: boolean("show_in_table").notNull().default(true),
    /** Accepted file headers (case-insensitive, trimmed). Explicit mapping only. */
    headers: text("headers").array().notNull().default(sql`'{}'::text[]`),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountKeyUnique: uniqueIndex("store_order_fields_account_key_idx").on(
      t.accountId,
      t.key,
    ),
  }),
);

/**
 * One store-order upload. Separate from the ads `upload_batches` (different
 * domain — no platform). `rowsInserted` drives batch rollback (deletes only
 * this batch's INSERTED rows); `rowsUpdated` (upsert only) is NOT rollback-able,
 * same caveat as the ads upsert.
 */
export const storeUploadBatches = pgTable(
  "store_upload_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id),
    rowsInserted: integer("rows_inserted").notNull().default(0),
    rowsUpdated: integer("rows_updated").notNull().default(0),
    upsert: boolean("upsert").notNull().default(false),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackByUserId: uuid("rolled_back_by_user_id").references(() => users.id),
  },
  (t) => ({
    accountUploadedIdx: index("store_upload_batches_account_uploaded_idx").on(
      t.accountId,
      t.uploadedAt.desc(),
    ),
  }),
);

/**
 * A store order. Core = exactly three columns (order_id / order_date /
 * total_amount, SAR); every other attribute lives in `attributes` jsonb keyed
 * by the custom field's `key`. Unique per `(account_id, order_id)`.
 * `upload_batch_id` records the batch that INSERTED the row and is NOT changed
 * on an upsert-update (so a rollback can delete inserts without touching rows
 * that merely got updated).
 */
export const storeOrders = pgTable(
  "store_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    orderId: varchar("order_id", { length: 64 }).notNull(),
    orderDate: date("order_date").notNull(),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    attributes: jsonb("attributes").notNull().default(sql`'{}'::jsonb`),
    uploadBatchId: uuid("upload_batch_id")
      .notNull()
      .references(() => storeUploadBatches.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountOrderUnique: uniqueIndex("store_orders_account_order_idx").on(
      t.accountId,
      t.orderId,
    ),
    accountDateIdx: index("store_orders_account_date_idx").on(
      t.accountId,
      t.orderDate,
    ),
    batchIdx: index("store_orders_batch_idx").on(t.uploadBatchId),
  }),
);

/**
 * Maps a RAW source value (as found in an order's configured source field, see
 * `accounts.store_source_field_key`) to one of the four ad platforms, or to NULL
 * = "not an ad platform" (e.g. organic/direct). Drives the Store →
 * Reconciliation page's by-platform attribution. Mapping is EXPLICIT only — a
 * raw value with no row here is treated as Unattributed (never auto-matched).
 * Tenant-scoped (§4.1); unique per `(account_id, raw_value)`.
 */
export const storeSourceMappings = pgTable(
  "store_source_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: accountId(),
    /** The raw value as it appears in the order's source field (verbatim). */
    rawValue: varchar("raw_value", { length: 128 }).notNull(),
    /** One of the 4 ad platforms, or NULL = "not an ad platform". */
    platform: varchar("platform", { length: 16, enum: platformEnum }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountRawUnique: uniqueIndex("store_source_mappings_account_raw_idx").on(
      t.accountId,
      t.rawValue,
    ),
  }),
);
