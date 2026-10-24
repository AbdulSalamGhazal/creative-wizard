"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ALL_PERMISSIONS,
  EDITOR_PRESET,
  PERMISSION_GROUPS,
  presetPermissions,
  type Permission,
} from "@/lib/permissions";
import { updateUserAccess } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useNavTransition } from "@/lib/nav-progress";
import { AdminSetPasswordButton } from "@/components/user/admin-set-password-button";
import { UserPhotoControl } from "@/components/user/user-photo-control";
import { UserAvatar } from "@/components/user/user-avatar";
import {
  holdsPermission,
  teamGuard,
  type ManagerScope,
  type MemberAccess,
} from "@/lib/team-guard";
import {
  UserBrandsSection,
  type BrandOption,
} from "@/components/user/user-brands-section";

type Preset = "admin" | "editor" | "viewer" | "custom";

const PRESET_LABEL: Record<Preset, string> = {
  admin: "Admin — full access",
  editor: "Editor — standard access",
  viewer: "Viewer — read only",
  custom: "Custom",
};

export interface AccessUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  /** null → derive from the role preset; array → an explicit custom grant. */
  permissions: string[] | null;
  /** Brand membership: true → every brand (incl. future); false → `accountIds`. */
  allAccounts: boolean;
  /** The user's explicit brand memberships (only meaningful when !allAccounts). */
  accountIds: string[];
  /** Pre-formatted join date shown in the header (optional). */
  joined?: string;
  /** Profile photo, or null → initials (2026-10-20). */
  avatarUrl: string | null;
}

function setEquals(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((x) => a.has(x));
}

/** Effective granted set for a user, mirroring the server's resolvePermissions. */
function effectiveSet(u: AccessUser): Set<string> {
  if (u.role === "admin") return new Set(ALL_PERMISSIONS);
  if (u.permissions === null) return new Set(presetPermissions(u.role));
  return new Set(
    u.permissions.filter((p) =>
      (ALL_PERMISSIONS as readonly string[]).includes(p),
    ),
  );
}

/** Which preset a checked set maps to (admin is only chosen via the selector). */
function classify(checked: Set<string>): Exclude<Preset, "admin"> {
  if (setEquals(checked, EDITOR_PRESET)) return "editor";
  if (checked.size === 0) return "viewer";
  return "custom";
}

export function UserAccessCard({
  user,
  isSelf,
  brands,
  scope,
}: {
  user: AccessUser;
  isSelf: boolean;
  /** The full brand list, so the card shows the person's real brands. */
  brands: BrandOption[];
  /** What the signed-in manager may hand out — `teamGuard` decides with it. */
  scope: ManagerScope;
}) {
  const initialPreset: Preset =
    user.role === "admin"
      ? "admin"
      : user.permissions === null
        ? user.role // "editor" | "viewer"
        : classify(new Set(user.permissions));

  const initialChecked = useMemo(() => effectiveSet(user), [user]);
  // A custom grant keeps the user's non-admin tier; a demoted admin becomes editor.
  const customTier = user.role === "admin" ? "editor" : user.role;

  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [checked, setChecked] = useState<Set<string>>(initialChecked);
  const [isPending, startTransition] = useNavTransition();

  const isAdmin = preset === "admin";

  // The saved access every change is judged against — the SAME judgement the
  // server makes (lib/team-guard.ts), so nothing here offers what it refuses.
  const saved: MemberAccess = {
    role: user.role,
    permissions: user.permissions,
    allAccounts: user.allAccounts,
    accountIds: user.accountIds,
  };
  // Below admin, an admin's card is read-only.
  const adminOffLimits = !scope.isAdmin && user.role === "admin";
  const readOnly = isSelf || adminOffLimits;
  const canSetPassword = teamGuard(scope, { kind: "password", target: saved }) === null;
  const canChangePhoto = teamGuard(scope, { kind: "photo", target: saved }) === null;
  /** A preset is offered when choosing it is allowed — or it is the saved one. */
  const presetOffered = (p: Preset) =>
    p === initialPreset ||
    p === "custom" ||
    teamGuard(scope, { kind: "access", target: saved, role: p, permissions: null }) === null;
  /** A permission the manager doesn't hold stays exactly as it is. */
  const outOfReach = (perm: Permission) => !holdsPermission(scope, perm);

  const payload = useMemo(() => {
    if (preset === "admin") return { role: "admin" as const, permissions: null };
    if (preset === "editor") return { role: "editor" as const, permissions: null };
    if (preset === "viewer") return { role: "viewer" as const, permissions: null };
    return {
      role: customTier,
      permissions: [...checked].sort(),
    };
  }, [preset, checked, customTier]);

  const initialPayload = useMemo(
    () => ({
      role: user.role,
      permissions:
        user.permissions === null ? null : [...user.permissions].sort(),
    }),
    [user],
  );

  const dirty = JSON.stringify(payload) !== JSON.stringify(initialPayload);

  function selectPreset(p: Preset) {
    setPreset(p);
    if (p === "admin") setChecked(new Set(ALL_PERMISSIONS));
    else if (p === "editor") setChecked(new Set(EDITOR_PRESET));
    else if (p === "viewer") setChecked(new Set());
    // custom: keep the current checkboxes
  }

  function toggle(perm: Permission) {
    if (isAdmin || readOnly || outOfReach(perm)) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      setPreset(classify(next));
      return next;
    });
  }

  function discard() {
    setPreset(initialPreset);
    setChecked(new Set(initialChecked));
  }

  function save() {
    startTransition(async () => {
      const res = await safeAction(() => updateUserAccess({ userId: user.id, ...payload }));
      if (!res.ok) {
        // The unsaved changes stay, so a retry is one click.
        toastActionFailure(res, "Couldn't save access");
        return;
      }
      // The action revalidated, so the `user` prop (and thus the dirty
      // baseline) arrives with the saved state in its response — the
      // unsaved-changes bar collapses without a second render (W2-1).
      toast.success(`Updated ${user.name}'s access`);
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
        {/* The photo: set or remove it for anyone the guard allows (this
            page is `users.manage`; the server checks both again). */}
        {canChangePhoto ? (
          <UserPhotoControl userId={user.id} name={user.name} avatarUrl={user.avatarUrl} />
        ) : (
          <UserAvatar name={user.name} src={user.avatarUrl} size="lg" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {user.name}
            </span>
            {isSelf && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                You
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 truncate font-mono text-xs text-ink-3">
            <span className="truncate">{user.email}</span>
            {user.joined && (
              <span className="shrink-0 font-sans text-ink-3/80">
                · joined {user.joined}
              </span>
            )}
          </div>
        </div>
        </div>
        {/* min-w-0 + a shrinkable select: at 375 px the password button and
            a fixed 220 px select overran the card by a pixel or so. */}
        <div className="flex min-w-0 max-w-full items-center gap-2">
          {canSetPassword && (
            <AdminSetPasswordButton userId={user.id} userEmail={user.email} />
          )}
          <div className="w-[220px] min-w-0 max-w-full shrink">
            <Select
              value={preset}
              onValueChange={(v) => selectPreset(v as Preset)}
              disabled={readOnly}
            >
              <SelectTrigger
                aria-label="Access preset"
                className="w-full min-w-0 [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:truncate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESET_LABEL) as Preset[])
                  .filter(presetOffered)
                  .map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRESET_LABEL[p]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <div className="text-label text-ink-3">{group.label}</div>
            <div className="space-y-1">
              {group.perms.map((perm) => {
                const on = checked.has(perm.key);
                // Out of reach = the manager doesn't hold it; it stays as is.
                const unheld = !isAdmin && !readOnly && outOfReach(perm.key);
                const locked = isAdmin || readOnly || unheld;
                return (
                  <button
                    key={perm.key}
                    type="button"
                    // The visual is a custom checkbox (the inner span is
                    // aria-hidden), so the semantics have to be stated here or
                    // a screen reader just hears "button".
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(perm.key)}
                    disabled={locked}
                    title={unheld ? "You don't have this permission yourself." : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                      locked
                        ? "cursor-default"
                        : "hover:bg-surface-2",
                      // Greyed out: shown as it is, not yours to change.
                      unheld && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        on
                          ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                          : "border-line",
                        locked && "opacity-70",
                      )}
                      aria-hidden
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className={cn("text-ink-2", on && "text-ink")}>
                      {perm.label}
                    </span>
                    {unheld && (
                      <span className="sr-only">
                        {" "}(you don&apos;t have this permission yourself)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <UserBrandsSection
        userId={user.id}
        isSelf={isSelf}
        isAdmin={user.role === "admin"}
        brands={brands}
        scope={scope}
        initialAllAccounts={user.allAccounts}
        initialAccountIds={user.accountIds}
      />

      {readOnly ? (
        <div className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {isSelf
            ? "You can't change your own access."
            : "Only an admin can change an admin."}
        </div>
      ) : (
        dirty && (
          <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2/50 px-4 py-2.5">
            <span className="text-xs text-ink-2">Unsaved changes</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={discard}
                disabled={isPending}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={isPending}
              >
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
