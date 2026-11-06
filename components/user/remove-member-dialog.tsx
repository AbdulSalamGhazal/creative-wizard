"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { memberRemovalPreview, removeUser } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { int, plural } from "@/lib/format";
import { TypeToConfirm, confirmMatches } from "@/components/ui/type-to-confirm";
import type { MemberFootprint, TeamMember } from "@/lib/team-member";

/**
 * Remove a member from the team (D4, 2026-11-06) — the house UNRECOVERABLE
 * delete: preview what it touches → acknowledge → type the name (D23, one
 * `TypeToConfirm`). The preview is what they leave BEHIND, because removal
 * keeps all of it attributed to them; the reassurance is that nothing of the
 * team's history goes with the person.
 */
export function RemoveMemberDialog({
  member,
  open,
  onOpenChange,
  onRemoved,
}: {
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drawer for this person must close too. */
  onRemoved?: (id: string) => void;
}) {
  const [kept, setKept] = useState<MemberFootprint | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState("");
  const [isPending, startTransition] = useTransition();

  const memberId = member?.id ?? null;
  useEffect(() => {
    if (!open || !memberId) return;
    setKept(null);
    let cancelled = false;
    void (async () => {
      const res = await safeAction(() => memberRemovalPreview({ userId: memberId }));
      if (cancelled) return;
      // A failed preview still lets the removal proceed; the counts are a courtesy.
      setKept(res.ok && "kept" in res ? res.kept : { creatives: 0, uploads: 0, comments: 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  function reset() {
    setAcknowledged(false);
    setTyped("");
  }

  const confirmed = !!member && acknowledged && confirmMatches(typed, member.name);

  const confirm = () => {
    if (!member) return;
    startTransition(async () => {
      const res = await safeAction(() => removeUser({ userId: member.id }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't remove");
        return;
      }
      toast.success(`Removed ${member.name} from the team`);
      onOpenChange(false);
      onRemoved?.(member.id);
      setTimeout(reset, 200);
    });
  };

  const total = kept ? kept.creatives + kept.uploads + kept.comments : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return; // don't allow closing mid-remove
        onOpenChange(o);
        if (!o) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-neg/10 text-neg">
              <AlertTriangle className="h-4 w-4" />
            </span>
            Remove {member?.name} from the team?
          </DialogTitle>
          <DialogDescription>
            Their sign-in is deleted, every session ends, and their brand access, API tokens
            and connected apps are revoked. <span className="font-medium text-ink">{member?.email}</span>{" "}
            becomes free to invite again. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* What stays — attributed to them, untouched. */}
          <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-2">Work that stays, in their name</span>
              {kept ? (
                <span className="num font-display text-2xl leading-none text-ink">{int(total)}</span>
              ) : (
                <Skeleton className="h-6 w-10" />
              )}
            </div>
            {kept && total > 0 && (
              <>
                <div className="h-px bg-line" />
                <div className="space-y-1 text-[11px]">
                  {(
                    [
                      ["Creatives created", kept.creatives],
                      ["Uploads", kept.uploads],
                      ["Comments", kept.comments],
                    ] as const
                  )
                    .filter(([, n]) => n > 0)
                    .map(([label, n]) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-ink-3">{label}</span>
                        <span className="num text-ink-2">{int(n)}</span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>

          <p className="text-xs leading-relaxed text-ink-2">
            {kept && total > 0 ? (
              <>
                These {plural(total, "item")} are <span className="font-medium text-ink">kept</span>{" "}
                and stay attributed to {member?.name} in every table, thread and the audit log.
                Only the person&apos;s access goes.
              </>
            ) : (
              <>
                Nothing of the team&apos;s history goes with them — only the person&apos;s
                access.
              </>
            )}
          </p>

          <label className="flex cursor-pointer select-none items-start gap-2 rounded-md border border-line bg-surface px-3 py-2.5">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
              disabled={isPending}
              className="mt-0.5"
            />
            <span className="text-xs text-ink-2">
              I understand this permanently removes{" "}
              <span className="text-ink">{member?.name}</span> from the team.
            </span>
          </label>

          {member && (
            <TypeToConfirm
              phrase={member.name}
              value={typed}
              onChange={setTyped}
              disabled={isPending}
              inputClassName="mt-1 h-8 w-full"
            />
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={!confirmed || isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Removing…
              </>
            ) : (
              <>
                <UserMinus className="h-3.5 w-3.5" />
                Remove from team
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
