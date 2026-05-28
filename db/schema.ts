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
export const platformEnum = ["meta", "tiktok", "snapchat", "google"] as const;
export const creativeTypeEnum = ["video", "slides", "image"] as const;
export const creativeStatusEnum = ["draft", "active", "paused", "archived"] as const;
export const productStatusEnum = ["active", "archived"] as const;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  /** bcrypt hash. Nullable so existing rows can be migrated lazily; sign-in
   *  rejects users with no hash and points them to ask an admin to set one. */
  passwordHash: text("password_hash"),
  role: varchar("role", { length: 16, enum: roleEnum }).notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
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
  }),
);

export const creatives = pgTable(
  "creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull().unique(),
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
 * Tag vocabulary — the managed set of tags, like products. Creatives still
 * store their assignments in `creative_tags` (by string); this table is the
 * canonical list admins curate. Renaming a tag here cascades to
 * `creative_tags`; deleting removes the assignments too.
 */
export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const uploadBatches = pgTable("upload_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
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
    uniq: uniqueIndex("pfm_unique_idx").on(t.platform, t.internalField, t.headerName),
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
    page: varchar("page", { length: 32 }).notNull().default("summary"),
    name: varchar("name", { length: 120 }).notNull(),
    query: text("query").notNull(),
    /** At most one default per page (team-wide landing config). Enforced by
     *  the partial unique index below. */
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
      t.ownerUserId,
      t.page,
      t.name,
    ),
    // One default per page — partial unique index over rows where is_default.
    oneDefaultPerPage: uniqueIndex("summary_views_default_idx")
      .on(t.page)
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
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id),
    platform: varchar("platform", { length: 16, enum: platformEnum }).notNull(),
    date: date("date").notNull(),
    spend: numeric("spend", { precision: 14, scale: 4 }).notNull(),
    impressions: integer("impressions").notNull(),
    clicks: integer("clicks").notNull(),
    conversions: integer("conversions"),
    conversionValue: numeric("conversion_value", { precision: 14, scale: 4 }),
    videoViews3s: integer("video_views_3s"),
    videoViews15s: integer("video_views_15s"),
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
    uniq: uniqueIndex("perf_creative_platform_date_idx").on(t.creativeId, t.platform, t.date),
    dateIdx: index("perf_date_idx").on(t.date),
    platformDateIdx: index("perf_platform_date_idx").on(t.platform, t.date),
    batchIdx: index("perf_upload_batch_idx").on(t.uploadBatchId),
    excludedIdx: index("perf_excluded_idx").on(t.excludedFromAggregates),
  }),
);
