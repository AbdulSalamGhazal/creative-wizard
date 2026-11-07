"use client";

import { useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { ToneDialogTitle } from "@/components/ui/dialog-tone";
import { endUserSessions } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { TeamMember } from "@/lib/team-member";

/**
 * End every session a member has (D4) — the Team page's hand on D3's stamp.
 * Recoverable (they sign in again), but it interrupts someone mid-work, so
 * one plain confirm rather than a bare menu click.
 */
export function EndSessionsDialog({
  member,
  open,
  onOpenChange,
}: {
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!member) return;
    startTransition(async () => {
      const res = await safeAction(() => endUserSessions({ userId: member.id }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't end sessions");
        return;
      }
      toast.success(`Signed ${member.name} out everywhere`);
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <ToneDialogTitle tone="warn">Sign {member?.name} out everywhere?</ToneDialogTitle>
          <DialogDescription>
            Every device they are signed in on is signed out. Their password is unchanged —
            they simply sign in again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={confirm} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing out…
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5" />
                Sign out everywhere
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
