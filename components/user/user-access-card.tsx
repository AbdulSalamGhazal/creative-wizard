"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { useNavTransition } from "@/lib/nav-progress";
import { AdminSetPasswordButton } from "@/components/user/admin-set-password-button";

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
  /** Pre-formatted join date shown in the header (optional). */
  joined?: string;
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
}: {
  user: AccessUser;
  isSelf: boolean;
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

  const router = useRouter();
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [checked, setChecked] = useState<Set<string>>(initialChecked);
  const [isPending, startTransition] = useNavTransition();

  const isAdmin = preset === "admin";

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
    if (isAdmin || isSelf) return;
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
      const res = await updateUserAccess({ userId: user.id, ...payload });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save access");
        return;
      }
      toast.success(`Updated ${user.name}'s access`);
      // Re-fetch so the `user` prop (and thus the dirty baseline) reflects the
      // saved state — the unsaved-changes bar collapses.
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
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
        <div className="flex items-center gap-2">
          <AdminSetPasswordButton userId={user.id} userEmail={user.email} />
          <div className="w-[220px] max-w-full">
            <Select
              value={preset}
              onValueChange={(v) => selectPreset(v as Preset)}
              disabled={isSelf}
            >
              <SelectTrigger aria-label="Access preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
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
                const locked = isAdmin || isSelf;
                return (
                  <button
                    key={perm.key}
                    type="button"
                    onClick={() => toggle(perm.key)}
                    disabled={locked}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                      locked
                        ? "cursor-default"
                        : "hover:bg-surface-2",
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
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {isSelf ? (
        <div className="border-t border-line px-4 py-2 text-xs text-ink-3">
          You can&apos;t change your own access.
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
