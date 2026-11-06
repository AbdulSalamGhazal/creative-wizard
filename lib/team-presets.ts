import {
  ALL_PERMISSIONS,
  EDITOR_PRESET,
  isPermission,
  presetPermissions,
  type RoleTier,
} from "@/lib/permissions";

/**
 * How a member's SAVED access reads as a preset — PURE, shared by the Team
 * page's row badge and the access editor so the two can't disagree about who
 * is "Custom" (the editor had this logic to itself; the row now needs it too).
 *
 * `admin` is a tier, never inferred from a checked set; below admin a NULL
 * set IS the tier's preset, and an explicit set is classified by what it
 * holds: exactly the editor preset → Editor, nothing → Viewer, else Custom.
 */
export type AccessPreset = RoleTier | "custom";

export const PRESET_LABEL: Record<AccessPreset, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  custom: "Custom",
};

/** The access selector's longer wording — what each preset means. */
export const PRESET_DESCRIPTION: Record<AccessPreset, string> = {
  admin: "Full access — every permission, every brand",
  editor: "Standard access — creatives, campaigns, uploads",
  viewer: "Read only",
  custom: "A hand-picked set of permissions",
};

function setEquals(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((x) => a.has(x));
}

/** Which preset a CHECKED set is (never admin — that is chosen, not inferred). */
export function classifyChecked(checked: ReadonlySet<string>): Exclude<AccessPreset, "admin"> {
  if (setEquals(checked, EDITOR_PRESET)) return "editor";
  if (checked.size === 0) return "viewer";
  return "custom";
}

/** The preset a member's saved `role` + `permissions` read as. */
export function presetOf(role: RoleTier, permissions: readonly string[] | null): AccessPreset {
  if (role === "admin") return "admin";
  if (permissions === null) return role;
  return classifyChecked(new Set(permissions.filter(isPermission)));
}

/** The member's EFFECTIVE granted set — mirrors the server's `resolvePermissions`. */
export function effectivePermissions(
  role: RoleTier,
  permissions: readonly string[] | null,
): Set<string> {
  if (role === "admin") return new Set(ALL_PERMISSIONS);
  if (permissions === null) return new Set(presetPermissions(role));
  return new Set(permissions.filter(isPermission));
}
