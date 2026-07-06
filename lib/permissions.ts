/**
 * The permission catalog — the SINGLE SOURCE OF TRUTH for every grantable
 * capability in the app. Every UI (the Access page checkbox grids, nav gating,
 * button gating) and every server check derives from this list; nothing
 * re-lists permission keys elsewhere (the project's "DERIVE, don't re-list"
 * rule). Read stays role-free: anyone signed in can VIEW dashboards, creatives,
 * campaigns, etc. — permissions gate WRITES.
 *
 * To add a capability: add a `{ key, label }` under the right group here, then
 * wire the matching `requirePermission("<key>")` on the server action / route
 * and (optionally) gate its UI affordance. Adjust granularity only by splitting
 * further — never merge.
 */
export const PERMISSION_GROUPS = [
  {
    key: "creatives",
    label: "Creatives",
    perms: [
      { key: "creative.create", label: "Create creatives (incl. bulk import)" },
      {
        key: "creative.edit",
        label:
          "Edit creatives (fields, tags, notes, thumbnail, terminate/reactivate)",
      },
      { key: "creative.delete", label: "Delete creatives (removes their records)" },
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    perms: [
      { key: "campaign.create", label: "Register campaigns" },
      { key: "campaign.edit", label: "Edit campaigns" },
      { key: "campaign.delete", label: "Delete campaigns (removes their records)" },
    ],
  },
  {
    key: "uploads",
    label: "Data & uploads",
    perms: [
      { key: "upload.import", label: "Upload & commit performance data" },
      { key: "upload.upsert", label: "Use upsert mode (overwrites existing rows)" },
      { key: "upload.rollback", label: "Roll back a batch (24h window)" },
      { key: "upload.cleanup", label: "Record cleanup (filtered hard-delete)" },
      { key: "record.exclude", label: "Exclude/include records from aggregates" },
    ],
  },
  {
    key: "catalog",
    label: "Catalog & config",
    perms: [
      { key: "catalog.products", label: "Manage products" },
      { key: "catalog.tags", label: "Manage tags" },
      { key: "config.rating", label: "Edit rating rules" },
      { key: "config.mappings", label: "Edit CSV mappings" },
      { key: "config.brands", label: "Manage brands & status window" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    perms: [
      { key: "users.manage", label: "Manage users & access" },
      { key: "audit.view", label: "View audit log" },
    ],
  },
] as const;

type Group = (typeof PERMISSION_GROUPS)[number];

/** Every permission key in the catalog, as a string-literal union. */
export type Permission = Group["perms"][number]["key"];

/** Flat list of every permission key (derived — order follows the catalog). */
export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap(
  (g) => g.perms.map((p) => p.key),
);

const ALL_PERMISSIONS_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Type guard: is `value` a permission key in the catalog? */
export function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS_SET.has(value);
}

/** The coarse role tier stored on `users.role`. */
export type RoleTier = "admin" | "editor" | "viewer";

/**
 * The `editor` preset mirrors today's `requireEditor` capabilities EXACTLY, so
 * existing editors are unaffected on deploy (they have NULL `permissions`, which
 * falls back to this set): all creative + campaign mutations, data import /
 * upsert / cleanup, and record exclusion. It deliberately does NOT include
 * rollback, catalog/config, user management, or audit — all admin-only today.
 */
export const EDITOR_PRESET: readonly Permission[] = [
  "creative.create",
  "creative.edit",
  "creative.delete",
  "campaign.create",
  "campaign.edit",
  "campaign.delete",
  "upload.import",
  "upload.upsert",
  "upload.cleanup",
  "record.exclude",
];

/** The `viewer` preset — read-only, no write capabilities. */
export const VIEWER_PRESET: readonly Permission[] = [];

/**
 * The permissions a role tier implies when a user has NO explicit set
 * (`users.permissions IS NULL`). Admins get everything (they also bypass checks
 * in `can()`); editors get the editor preset; viewers get nothing.
 */
export function presetPermissions(role: RoleTier): readonly Permission[] {
  if (role === "admin") return ALL_PERMISSIONS;
  if (role === "editor") return EDITOR_PRESET;
  return VIEWER_PRESET;
}

/**
 * Resolve a user's effective permission set from their stored tier + optional
 * explicit override. NULL/absent `permissions` → the role preset; a non-null
 * array → that exact explicit set. Admins are handled by the caller (`can()`
 * bypasses), but this returns ALL_PERMISSIONS for them too for UI display.
 */
export function resolvePermissions(
  role: RoleTier,
  permissions: readonly string[] | null | undefined,
): Set<Permission> {
  if (role === "admin") return new Set(ALL_PERMISSIONS);
  if (permissions == null) return new Set(presetPermissions(role));
  return new Set(permissions.filter(isPermission));
}
