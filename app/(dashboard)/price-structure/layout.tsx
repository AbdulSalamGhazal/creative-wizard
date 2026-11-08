import { Suspense } from "react";
import { getActiveAccountId } from "@/lib/tenant";
import {
  requirePriceStructureAccess,
  VIEW_PERM,
  type PriceStructureAccess,
} from "@/lib/price-structure-access";
import { refusable } from "@/lib/auth";
import { AccessRefused } from "@/components/layout/access-refused";
import { getLastVersionId, listVersions } from "@/db/queries/price-structure";
import { VersionProvider } from "@/components/price-structure/version-provider";
import { HeaderSkeleton, KpiRowSkeleton } from "@/components/layout/page-skeletons";

export const dynamic = "force-dynamic";

/**
 * The Price Structure module's shell — the ONE nested layout in the app
 * (2026-11). It holds the client `VersionProvider`, so the open version, the
 * edits not yet saved and the autosave timer survive a switch between the
 * module's pages (sibling navigations never re-render a layout). The brand's
 * versions are read once here — a few KB each — because the picker needs them
 * all and the Versions page summarises every one from its data.
 *
 * Any of the module's three grants opens it (view · edit · versions); each
 * page re-checks, so the sidebar's derived gate and the pages agree
 * (nav-gates.test.ts). What the member may CHANGE travels to the provider as
 * `access`, which hides or disables the controls — the actions are the gate.
 */
export default async function PriceStructureLayout({ children }: { children: React.ReactNode }) {
  // A member without any of the three grants is told so, in the app shell
  // (R-011) — not thrown into the error boundary.
  const allowed = await refusable(() => requirePriceStructureAccess());
  if (!allowed) return <AccessRefused page="Pricing" perm={VIEW_PERM} />;
  const { user: me, access } = allowed;
  return (
    // The provider reads `?v=` with useSearchParams. The versions read happens
    // INSIDE this boundary (R-076): when the layout awaited it, the nearest
    // boundary was the DASHBOARD's loading.tsx, so entering the module flashed
    // a filter strip and KPI tiles it doesn't have. Now the layout returns at
    // once and the module's own shape (the Overview, its landing page) shows.
    <Suspense
      fallback={
        <div className="space-y-6">
          <HeaderSkeleton eyebrow right />
          <KpiRowSkeleton count={6} cols="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
        </div>
      }
    >
      <VersionsLoaded userId={me.id} access={access}>
        {children}
      </VersionsLoaded>
    </Suspense>
  );
}

/** The brand's versions + the user's last-opened one, then the provider. */
async function VersionsLoaded({
  userId,
  access,
  children,
}: {
  userId: string;
  access: PriceStructureAccess;
  children: React.ReactNode;
}) {
  const acct = await getActiveAccountId();
  const [rows, lastOpenedId] = await Promise.all([listVersions(acct), getLastVersionId(userId, acct)]);
  return (
    <VersionProvider initialRows={rows} lastOpenedId={lastOpenedId} access={access}>
      {children}
    </VersionProvider>
  );
}
