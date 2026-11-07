"use client";

import { useEffect, useMemo, useState } from "react";
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
  type Permission,
} from "@/lib/permissions";
import {
  classifyChecked,
  effectivePermissions,
  presetOf,
  PRESET_DESCRIPTION,
  PRESET_LABEL,
  type AccessPreset,
} from "@/lib/team-presets";
import { updateUserAccess } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { useNavTransition } from "@/lib/nav-progress";
import {
  holdsPermission,
  teamGuard,
  type ManagerScope,
  type MemberAccess,
} from "@/lib/team-guard";
import type { TeamMember } from "@/lib/team-member";

/**
 * WHAT a member may do — the preset selector and the permission grid, with a
 * dirty Save/Discard bar (2026-07; the drawer's first section since D4). It
 * was the body of the old per-member card; the identity header, the password
 * button and the brands moved to the drawer around it.
 *
 * Below admin, a manager works within their own access (`teamGuard`, D1): the
 * same guard the action enforces decides what is hidden or greyed out here.
 */
export function MemberAccessEditor({
  user,
  isSelf,
  scope,
  onDirtyChange,
}: {
  user: TeamMember;
  isSelf: boolean;
  /** What the signed-in manager may hand out — `teamGuard` decides with it. */
  scope: ManagerScope;
  /** The drawer refuses to close over unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const initialPreset = presetOf(user.role, user.permissions);
  const initialChecked = useMemo(
    () => effectivePermissions(user.role, user.permissions),
    [user.role, user.permissions],
  );
  // A custom grant keeps the user's non-admin tier; a demoted admin becomes editor.
  const customTier = user.role === "admin" ? "editor" : user.role;

  const [preset, setPreset] = useState<AccessPreset>(initialPreset);
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
  // Below admin, an admin's access is read-only.
  const adminOffLimits = !scope.isAdmin && user.role === "admin";
  const readOnly = isSelf || adminOffLimits;
  /** A preset is offered when choosing it is allowed — or it is the saved one. */
  const presetOffered = (p: AccessPreset) =>
    p === initialPreset ||
    p === "custom" ||
    teamGuard(scope, { kind: "access", target: saved, role: p, permissions: null }) === null;
  /** A permission the manager doesn't hold stays exactly as it is. */
  const outOfReach = (perm: Permission) => !holdsPermission(scope, perm);

  const payload = useMemo(() => {
    if (preset === "admin") return { role: "admin" as const, permissions: null };
    if (preset === "editor") return { role: "editor" as const, permissions: null };
    if (preset === "viewer") return { role: "viewer" as const, permissions: null };
    return { role: customTier, permissions: [...checked].sort() };
  }, [preset, checked, customTier]);

  const initialPayload = useMemo(
    () => ({
      role: user.role,
      permissions: user.permissions === null ? null : [...user.permissions].sort(),
    }),
    [user.role, user.permissions],
  );

  const dirty = !readOnly && JSON.stringify(payload) !== JSON.stringify(initialPayload);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  function selectPreset(p: AccessPreset) {
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
      setPreset(classifyChecked(next));
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
    <section aria-labelledby="member-access-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="member-access-heading" className="text-label text-ink-3">
          Access
        </h3>
        <div className="w-[200px] min-w-0 max-w-full shrink">
          <Select
            value={preset}
            onValueChange={(v) => selectPreset(v as AccessPreset)}
            disabled={readOnly}
          >
            <SelectTrigger
              aria-label="Access preset"
              className="h-8 w-full min-w-0 text-xs [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:truncate"
            >
              {/* The trigger shows the name alone; the description is the list's. */}
              <SelectValue>{PRESET_LABEL[preset]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PRESET_LABEL) as AccessPreset[])
                .filter(presetOffered)
                .map((p) => (
                  <SelectItem key={p} value={p} className="text-xs">
                    <span className="flex flex-col">
                      <span>{PRESET_LABEL[p]}</span>
                      <span className="text-[10px] text-ink-2">{PRESET_DESCRIPTION[p]}</span>
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {readOnly && (
        <p className="text-xs text-ink-3">
          {isSelf
            ? "You can't change your own access."
            : "Only an admin can change an admin's access."}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <div className="text-[11px] font-medium text-ink-2">{group.label}</div>
            <div className="space-y-0.5">
              {group.perms.map((perm) => {
                const on = checked.has(perm.key);
                // Out of reach = the manager doesn't hold it; it stays as is.
                const unheld = !isAdmin && !readOnly && outOfReach(perm.key);
                const locked = isAdmin || readOnly || unheld;
                // Named EXPLICITLY by its visible label (+ the out-of-reach
                // note): left to name-from-content, the label in its own span
                // read as an unnamed checkbox in the accessibility tree.
                const name = unheld
                  ? `${perm.label} (you don't have this permission yourself)`
                  : perm.label;
                return (
                  <button
                    key={perm.key}
                    type="button"
                    // The visual is a custom checkbox (the inner span is
                    // aria-hidden), so the semantics have to be stated here or
                    // a screen reader just hears "button".
                    role="checkbox"
                    aria-checked={on}
                    aria-label={name}
                    onClick={() => toggle(perm.key)}
                    disabled={locked}
                    title={unheld ? "You don't have this permission yourself." : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                      locked ? "cursor-default" : "hover:bg-surface-2",
                      // Greyed out: shown as it is, not yours to change.
                      unheld && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        on
                          ? "border-transparent bg-brand text-primary-foreground"
                          : "border-line",
                        locked && "opacity-70",
                      )}
                      aria-hidden
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className={cn("text-ink-2", on && "text-ink")}>{perm.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {dirty && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2/50 px-3 py-2">
          <span className="text-xs text-ink-2">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={discard} disabled={isPending}>
              Discard
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
