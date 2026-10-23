import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  presetPermissions,
  resolvePermissions,
  type Permission,
  type RoleTier,
} from "@/lib/permissions";

/**
 * The ONE guard on managing people (D1, 2026-10-23). "Manage users & access"
 * (`users.manage`) used to be admin-equivalent: a holder could mint an admin,
 * promote anyone to admin, reset the admin's password and hand out
 * permissions and brands they never had. Below admin, a holder now manages
 * people only WITHIN their own access:
 *
 *  - never makes an admin, and never changes an admin's access, brands,
 *    password or photo;
 *  - switches on or off only permissions they hold themselves — anything
 *    else on the person stays as it was;
 *  - if they are restricted to some brands: grants or removes only those
 *    brands, never "every brand", and leaves an every-brand member alone;
 *  - sets a password only for someone whose access is within theirs (a
 *    password reset is a takeover — it hands the actor that person's access).
 *
 * Admins pass every check. The self-edit and last-admin rules stay in the
 * actions, where they always were.
 *
 * PURE and dependency-light on purpose: the server actions and the upload
 * route call it as the gate, and the Team page's client components call the
 * SAME function to decide what to hide or lock — so the UI can never offer
 * what the server will refuse. (UI gating is still UX only; the server is
 * the gate.)
 */

/** What the person doing the managing holds — resolved once per request. */
export interface ManagerScope {
  isAdmin: boolean;
  /** Effective permissions (role preset or explicit set, resolved). */
  permissions: readonly Permission[];
  /** Member of every brand, including brands created later. */
  allAccounts: boolean;
  /** Explicit brand memberships — meaningful only when `!allAccounts`. */
  accountIds: readonly string[];
}

/** A member's SAVED access — the "before" every change is judged against. */
export interface MemberAccess {
  role: RoleTier;
  /** null → the role preset; an array → an explicit grant. */
  permissions: readonly string[] | null;
  allAccounts: boolean;
  accountIds: readonly string[];
}

export type TeamChange =
  | {
      kind: "invite";
      role: RoleTier;
      allAccounts: boolean;
      accountIds: readonly string[];
    }
  | {
      kind: "access";
      target: MemberAccess;
      role: RoleTier;
      permissions: readonly string[] | null;
    }
  | {
      kind: "brands";
      target: MemberAccess;
      allAccounts: boolean;
      accountIds: readonly string[];
    }
  | { kind: "password"; target: MemberAccess }
  | { kind: "photo"; target: Pick<MemberAccess, "role"> };

/** Every refusal, in the house voice. Tests and the UI read these too. */
export const TEAM_REFUSAL = {
  makeAdmin: "Only an admin can make someone an admin.",
  adminAccess: "Only an admin can change an admin's access.",
  adminBrands: "Only an admin can change an admin's brands.",
  adminPassword: "Only an admin can set an admin's password.",
  adminPhoto: "Only an admin can change an admin's photo.",
  grantEveryBrand: "Only someone with every brand can grant every brand.",
  everyBrandMember: "Only someone with every brand can change this person's brands.",
  grantBrand: "You can only grant brands you belong to.",
  removeBrand: "You can only remove brands you belong to.",
  passwordBeyond: "You can't set the password of someone with access you don't have.",
} as const;

const PERMISSION_LABEL: ReadonlyMap<string, string> = new Map(
  PERMISSION_GROUPS.flatMap((g) => g.perms.map((p) => [p.key, p.label] as const)),
);

export function grantRefusal(perm: Permission): string {
  return `You can't grant «${PERMISSION_LABEL.get(perm) ?? perm}» — you don't have it yourself.`;
}

export function removeRefusal(perm: Permission): string {
  return `You can't remove «${PERMISSION_LABEL.get(perm) ?? perm}» — you don't have it yourself.`;
}

/** The scope of an admin — everything, everywhere. */
export const ADMIN_SCOPE: ManagerScope = {
  isAdmin: true,
  permissions: ALL_PERMISSIONS,
  allAccounts: true,
  accountIds: [],
};

/** Does the manager hold `perm` themselves? */
export function holdsPermission(scope: ManagerScope, perm: Permission): boolean {
  return scope.isAdmin || scope.permissions.includes(perm);
}

/** Does the manager belong to brand `accountId`? */
export function holdsBrand(scope: ManagerScope, accountId: string): boolean {
  return scope.isAdmin || scope.allAccounts || scope.accountIds.includes(accountId);
}

/** Can the manager hand out "every brand"? */
export function holdsEveryBrand(scope: ManagerScope): boolean {
  return scope.isAdmin || scope.allAccounts;
}

/** First permission (catalog order) in `perms` the manager lacks, or null. */
function firstUnheld(scope: ManagerScope, perms: ReadonlySet<Permission>): Permission | null {
  for (const p of ALL_PERMISSIONS) {
    if (perms.has(p) && !holdsPermission(scope, p)) return p;
  }
  return null;
}

function difference<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): Set<T> {
  return new Set([...a].filter((x) => !b.has(x)));
}

/** Granting brands: "every brand", or each listed brand, must be the manager's. */
function brandGrantRefusal(
  scope: ManagerScope,
  allAccounts: boolean,
  accountIds: readonly string[],
): string | null {
  if (holdsEveryBrand(scope)) return null;
  if (allAccounts) return TEAM_REFUSAL.grantEveryBrand;
  if (accountIds.some((id) => !holdsBrand(scope, id))) return TEAM_REFUSAL.grantBrand;
  return null;
}

/** Is `target`'s whole access within the manager's — permissions AND brands? */
function withinScope(scope: ManagerScope, target: MemberAccess): boolean {
  if (scope.isAdmin) return true;
  if (target.role === "admin") return false;
  if (firstUnheld(scope, resolvePermissions(target.role, target.permissions)) !== null) {
    return false;
  }
  if (holdsEveryBrand(scope)) return true;
  if (target.allAccounts) return false;
  return target.accountIds.every((id) => holdsBrand(scope, id));
}

/**
 * Judge one Team change. Returns null when the manager may make it, or the
 * sentence that says why not.
 */
export function teamGuard(scope: ManagerScope, change: TeamChange): string | null {
  if (scope.isAdmin) return null;

  switch (change.kind) {
    case "invite": {
      if (change.role === "admin") return TEAM_REFUSAL.makeAdmin;
      const unheld = firstUnheld(scope, new Set(presetPermissions(change.role)));
      if (unheld) return grantRefusal(unheld);
      return brandGrantRefusal(scope, change.allAccounts, change.accountIds);
    }

    case "access": {
      if (change.target.role === "admin") return TEAM_REFUSAL.adminAccess;
      if (change.role === "admin") return TEAM_REFUSAL.makeAdmin;
      // Judge the EFFECTIVE sets, so a preset ("Editor") is judged by what it
      // grants, and a cosmetic tier change grants nothing.
      const before = resolvePermissions(change.target.role, change.target.permissions);
      const after = resolvePermissions(change.role, change.permissions);
      const added = firstUnheld(scope, difference(after, before));
      if (added) return grantRefusal(added);
      const removed = firstUnheld(scope, difference(before, after));
      if (removed) return removeRefusal(removed);
      return null;
    }

    case "brands": {
      const { target } = change;
      if (target.role === "admin") return TEAM_REFUSAL.adminBrands;
      if (holdsEveryBrand(scope)) return null;
      if (target.allAccounts) {
        return change.allAccounts ? null : TEAM_REFUSAL.everyBrandMember;
      }
      if (change.allAccounts) return TEAM_REFUSAL.grantEveryBrand;
      const before = new Set(target.accountIds);
      const after = new Set(change.accountIds);
      if ([...difference(after, before)].some((id) => !holdsBrand(scope, id))) {
        return TEAM_REFUSAL.grantBrand;
      }
      if ([...difference(before, after)].some((id) => !holdsBrand(scope, id))) {
        return TEAM_REFUSAL.removeBrand;
      }
      return null;
    }

    case "password": {
      if (change.target.role === "admin") return TEAM_REFUSAL.adminPassword;
      return withinScope(scope, change.target) ? null : TEAM_REFUSAL.passwordBeyond;
    }

    case "photo":
      return change.target.role === "admin" ? TEAM_REFUSAL.adminPhoto : null;
  }
}
