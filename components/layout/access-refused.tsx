import Link from "@/components/nav/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/layout/page-shell";
import { PERMISSION_GROUPS, type Permission } from "@/lib/permissions";

/** A permission's catalog label — the words the Team page shows for it. */
export function permissionLabel(perm: Permission): string {
  for (const g of PERMISSION_GROUPS) {
    for (const p of g.perms) if (p.key === perm) return p.label;
  }
  return perm;
}

/**
 * THE page-level refusal (R-011, 2026-11-07): a member without the grant who
 * reaches a gated page by bookmark, shared link or a demotion mid-session sees
 * what happened and whom to ask — INSIDE the app shell — instead of the error
 * boundary's "Something went wrong" and a Try again that can only fail again,
 * or a 404 that says the page doesn't exist. Pages render it; server ACTIONS
 * keep throwing (the action-failure toast is their channel).
 *
 * `perm` names the one grant to ask for; a page any of several grants opens
 * (Configuration) passes none and the hint stays general.
 */
export function AccessRefused({ page, perm }: { page: string; perm?: Permission }) {
  return (
    <PageShell>
      <EmptyState
        size="lg"
        icon={<Lock className="h-5 w-5" />}
        title={<>You don&rsquo;t have access to «{page}»</>}
        hint={
          perm
            ? `Ask an admin for the «${permissionLabel(perm)}» permission.`
            : "Ask an admin for access."
        }
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/">Go to Dashboard</Link>
          </Button>
        }
      />
    </PageShell>
  );
}
