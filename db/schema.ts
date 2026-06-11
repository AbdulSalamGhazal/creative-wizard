import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  date,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = ["admin", "editor", "viewer"] as const;
export const platformEnum = ["instagram", "facebook", "tiktok", "snapchat"] as const;
export const creativeTypeEnum = ["video", "slides", "image"] as const;
export const creativeStatusEnum = ["draft", "active", "paused", "archived"] as const;
export const productStatusEnum = ["active", "archived"] as const;

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
  role: varchar("role", { length: 16, enum: roleEnum }).notNull().default("editor"),
  /**
   * The user's remembered default date range, applied on any page that has no
   * explicit from/to in its URL. A preset key (e.g. "30", "lifetime" — kept
   * rolling) or `custom:FROM..TO`. Null until they pick a range. Per-user
   * (global, across brands).
   */
  preferredDateRange: text("preferred_date_range"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const uploadBatches = pgTable("upload_batches", {
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
});

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
     * Combined "Campaign Name ➤ Adset Name" sourced from the upload's two
     * columns. The UI only ever labels and shows this as "Campaign Name".
     * Part of the dedup key.
     */
    campaignName: text("campaign_name").notNull(),
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
  },
  (t) => ({
    // Unique on the FULL dedup key. The same creative can run on the same
    // platform/date across different campaigns (allowed), but not the same
    // campaign twice — campaign_name disambiguates.
    creativePlatformCampaignDateIdx: uniqueIndex(
      "perf_creative_platform_campaign_date_idx",
    ).on(t.creativeId, t.platform, t.campaignName, t.date),
    accountDateIdx: index("perf_account_date_idx").on(t.accountId, t.date),
    // Speeds the campaign-diagnosis queries, which filter by
    // (account_id, campaign_name, date). Additive — no data/column change.
    accountCampaignDateIdx: index("perf_account_campaign_date_idx").on(
      t.accountId,
      t.campaignName,
      t.date,
    ),
    dateIdx: index("perf_date_idx").on(t.date),
    platformDateIdx: index("perf_platform_date_idx").on(t.platform, t.date),
    batchIdx: index("perf_upload_batch_idx").on(t.uploadBatchId),
    excludedIdx: index("perf_excluded_idx").on(t.excludedFromAggregates),
  }),
);
