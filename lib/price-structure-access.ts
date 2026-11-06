import { can, requireAuth, type SessionUser } from "@/lib/auth";
import { PRICE_STRUCTURE_PERMS } from "@/lib/page-gates";

/**
 * What a member may do in Price Structure (2026-11-06, user decision):
 *  · `price_structure.view`     — open every page, read-only; nothing saves.
 *  · `price_structure.edit`     — change the open version's document (products,
 *                                 offers, targets, plans, actual periods, settings).
 *  · `price_structure.versions` — create, copy, import, rename and delete versions.
 * Edit and Versions each imply View. Admins hold all three. The server is the
 * gate: the layout and every page need `view`, and each action checks the
 * capability it needs; the client only mirrors this to hide or disable controls.
 */
export interface PriceStructureAccess {
  edit: boolean;
  versions: boolean;
}

export const VIEW_PERM = PRICE_STRUCTURE_PERMS[0];
export const EDIT_PERM = PRICE_STRUCTURE_PERMS[1];
export const VERSIONS_PERM = PRICE_STRUCTURE_PERMS[2];

/** The member's capabilities, or null when they may not open the module at all. */
export function priceStructureAccess(user: Pick<SessionUser, "role" | "permissions">): PriceStructureAccess | null {
  const edit = can(user, EDIT_PERM);
  const versions = can(user, VERSIONS_PERM);
  if (!edit && !versions && !can(user, VIEW_PERM)) return null;
  return { edit, versions };
}

/** Signed in and allowed to open the module. Throws "Missing permission: …" otherwise. */
export async function requirePriceStructureAccess(): Promise<{ user: SessionUser; access: PriceStructureAccess }> {
  const user = await requireAuth();
  const access = priceStructureAccess(user);
  if (!access) throw new Error(`Missing permission: ${VIEW_PERM}`);
  return { user, access };
}

export const EDIT_REFUSED = `Missing permission: ${EDIT_PERM}`;
export const VERSIONS_REFUSED = `Missing permission: ${VERSIONS_PERM}`;
