import { LockKeyhole } from "lucide-react";
import { signOut } from "@/app/actions/session";
import { Button } from "@/components/ui/button";

/**
 * Full-page state for a signed-in user who is a member of ZERO brands (an admin
 * revoked every membership). Rendered by the dashboard layout BEFORE any
 * tenant-scoped query runs, so no forbidden brand's data is ever fetched. The
 * only action is to sign out (or wait for an admin to grant a brand).
 */
export function NoBrandAccess({ name }: { name: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink-3">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-medium text-ink">No brand access</h1>
        <p className="mt-2 text-sm text-ink-2">
          Hi {name} — your account isn&apos;t a member of any brand yet. Ask an
          admin to grant you access to a brand, then reload.
        </p>
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
