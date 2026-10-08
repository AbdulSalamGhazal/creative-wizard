"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, Trash2 } from "lucide-react";
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
import { useNavTransition } from "@/lib/nav-progress";
import { revokeOauthGrantAction } from "@/app/actions/oauth";

export interface GrantRow {
  familyId: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Connections made by signing in from the client (Claude and anything else that
 * speaks OAuth), as opposed to the personal tokens above. ONE row per grant,
 * with Revoke — which kills the whole token family, so a refresh token the
 * client is holding stops working too.
 */
export function OauthGrants({ grants }: { grants: GrantRow[] }) {
  const [target, setTarget] = useState<GrantRow | null>(null);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Connected apps</h2>
        <p className="text-xs text-ink-3">
          Apps you connected by signing in — no token to paste or store. Each one
          acts as you and reads only what you can see.
        </p>
      </div>

      {grants.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Plug className="h-5 w-5 text-ink-3" />
          <p className="text-sm text-ink-2">Nothing connected yet.</p>
          <p className="text-xs text-ink-3">
            Add the MCP URL below in Claude and sign in when the window opens.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {grants.map((g) => (
            <li
              key={g.familyId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-ink">{g.clientName}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <span>connected {g.createdAt}</span>
                  <span>· {g.lastUsedAt ? `last used ${g.lastUsedAt}` : "not used yet"}</span>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-ink-3 hover:text-neg"
                onClick={() => setTarget(g)}
                aria-label={`Revoke ${g.clientName}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RevokeGrantDialog
        grant={target}
        onOpenChange={(open) => !open && setTarget(null)}
      />
    </div>
  );
}

function RevokeGrantDialog({
  grant,
  onOpenChange,
}: {
  grant: GrantRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();

  function confirm() {
    if (!grant) return;
    startTransition(async () => {
      const res = await revokeOauthGrantAction({ familyId: grant.familyId });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't revoke that connection");
        return;
      }
      toast.success(`${grant.clientName} disconnected`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={grant !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {grant?.clientName}?</DialogTitle>
          <DialogDescription>
            It loses access immediately, including its ability to refresh. To use
            it again you’ll sign in from that app once more.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={confirm}
            disabled={isPending}
          >
            {isPending ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
