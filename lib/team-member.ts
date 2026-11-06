import type { RoleTier } from "@/lib/enums";

/**
 * One member as the Team page hands them to the client (D4, 2026-11-06) — a
 * plain, serialisable shape: dates are ISO strings, nothing from the schema.
 * The server page builds it from `listTeamWithMemberships`; every client
 * component on the page (row, drawer, dialogs) reads this and nothing else.
 */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: RoleTier;
  /** null → derive from the role preset; array → an explicit custom grant. */
  permissions: string[] | null;
  /** Brand membership: true → every brand (incl. future); false → `accountIds`. */
  allAccounts: boolean;
  /** Explicit brand memberships (only meaningful when !allAccounts). */
  accountIds: string[];
  /** Profile photo, or null → initials. */
  avatarUrl: string | null;
  /** ISO timestamps. */
  createdAt: string;
  deactivatedAt: string | null;
  lastSignInAt: string | null;
}

/** The dialogs a row's menu or the drawer can ask the directory to open. */
export type MemberDialog = "password" | "deactivate" | "reactivate" | "remove" | "sessions";

/**
 * What a member leaves behind when removed — kept, in their name. Counted by
 * `memberFootprint` (db/queries/team.ts); shown by the Remove dialog.
 */
export interface MemberFootprint {
  creatives: number;
  uploads: number;
  comments: number;
}
