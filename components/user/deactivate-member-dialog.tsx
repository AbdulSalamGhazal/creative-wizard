"use client";

import { useTransition } from "react";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setUserStatus } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { TeamMember } from "@/lib/team-member";

/**
 * Deactivate a member (D4, 2026-11-06). REVERSIBLE — so the house destructive
 * dialog without the typing step (the Budget Plan precedent: it says so
 * instead of asking for a name). Reactivation is one click from the row, with
 * no dialog at all: putting access back is the recoverable direction.
 */
export function DeactivateMemberDialog({
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
      const res = await safeAction(() => setUserStatus({ userId: member.id, active: false }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't deactivate");
        return;
      }
      toast.success(`Deactivated ${member.name}`);
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
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-warn/15 text-warn">
              <UserX className="h-4 w-4" />
            </span>
            Deactivate {member?.name}?
          </DialogTitle>
          <DialogDescription>
            They are signed out everywhere and can&apos;t sign in until reactivated. Their
            access, brands and work stay exactly as they are.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
          Reversible — reactivate from their row at any time.
        </p>
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
                Deactivating…
              </>
            ) : (
              <>
                <UserX className="h-3.5 w-3.5" />
                Deactivate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
