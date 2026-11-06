"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { adminSetPassword } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { PasswordField } from "@/components/user/password-field";
import type { TeamMember } from "@/lib/team-member";

/**
 * Set a member's password from the Team page — a reset for a forgotten one,
 * or a first credential for a legacy account. CONTROLLED: the directory
 * renders it once and both a row's menu and the drawer open it (D4). Ends
 * every session the person has (D3), which the copy says.
 */
export function AdminSetPasswordDialog({
  member,
  open,
  onOpenChange,
}: {
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setPassword("");
    setError(null);
  }

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!member) return;
    setError(null);
    startTransition(async () => {
      const res = await safeAction(() => adminSetPassword({ userId: member.id, password }));
      if (!res.ok) {
        // A form shows its failure inline; the typed password stays.
        toastActionFailure(res, "Couldn't set password", { inline: setError });
        return;
      }
      toast.success(`Password set for ${member.name} — share it over a trusted channel`);
      onOpenChange(false);
      setTimeout(reset, 200);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return; // don't allow closing mid-save
        onOpenChange(o);
        if (!o) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            A new password for <span className="font-medium text-ink">{member?.name}</span>.
            Every device they are signed in on is signed out; share the new password with
            them over a trusted channel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-pwd">New password</Label>
            <PasswordField
              id="set-pwd"
              value={password}
              onChange={setPassword}
              disabled={isPending}
              minLength={PASSWORD_MIN_LENGTH}
            />
          </div>
          {error && (
            <div className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || password.length < PASSWORD_MIN_LENGTH}>
              {isPending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
