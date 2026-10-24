import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { NavProgressBar } from "@/components/layout/nav-progress-bar";
import { auth, grantedPermissions } from "@/lib/auth";
import { canModerateComments } from "@/lib/comments";
import { PermissionsProvider } from "@/components/auth/permissions-context";
import { CommentAnchorProvider } from "@/components/comments/comment-anchor-context";
import {
  CommentDock,
  CommentPanelProvider,
} from "@/components/comments/comment-panel";
import { NoBrandAccess } from "@/components/layout/no-brand-access";
import { getToastScope, resolveTablePrefs } from "@/db/queries/user-prefs";
import { TABLE_KEY_LIST } from "@/lib/table-columns";
import { TablePrefsProvider } from "@/components/ui/table-prefs-context";
import { getActiveAccountId, listAccounts } from "@/lib/tenant";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await auth();
  if (!user) {
    redirect("/signin");
  }
  const granted = grantedPermissions(user);

  // Brand membership is enforced here: a user with zero allowed brands gets the
  // "No brand access" screen BEFORE any tenant-scoped query runs, so no
  // forbidden brand's data is ever fetched.
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return <NoBrandAccess name={user.name} />;
  }

  // The ⌘K creative list is NOT read here any more (D13, 2026-10): the
  // palette fetches it from /api/palette when first opened (or on idle), so
  // it stops riding along with every full render of every page.
  const acct = await getActiveAccountId();

  // Which arrivals may toast for this user (migration 0050). Read once here
  // and handed down: the bell obeys it, the account menu shows it.
  const toastScope = await getToastScope();

  // Every table's remembered columns, in ONE cache()-deduped read, handed to
  // the client once. A table anywhere under this layout reads its own entry by
  // key — no page has to thread a prop, and a NEW table needs no page edit.
  const tablePrefs = await resolveTablePrefs(TABLE_KEY_LIST);

  return (
    <PermissionsProvider granted={granted}>
      <TablePrefsProvider prefs={tablePrefs}>
      {/* Which thing the comment drawer points at — an entity page registers
          itself, everything else derives from the pathname. */}
      <CommentAnchorProvider>
        <CommentPanelProvider>
          <div className="min-h-screen flex flex-col">
            <NavProgressBar />
            <TopBar
              user={user}
              accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
              activeAccountId={acct}
              granted={granted}
              toastScope={toastScope}
            />
            <div className="flex flex-1">
              {/* Suspense: Sidebar reads useSearchParams (Budget month links). */}
              <Suspense
                fallback={
                  <aside className="hidden lg:block w-56 shrink-0 border-r border-line" />
                }
              >
                <Sidebar granted={granted} />
              </Suspense>
              {/* `min-w-0` lets this column shrink to the available width instead
               *  of being forced to its content's intrinsic width — so wide
               *  children (e.g. the Summary table) scroll within their own
               *  overflow-x container rather than pushing the whole page to
               *  scroll horizontally. */}
              <div className="flex-1 min-w-0 flex flex-col">
                <main className="flex-1 px-6 py-6">{children}</main>
              </div>
              {/* The docked comment panel. A sibling of the page column, so
                opening it SQUEEZES the page (which is flex-1 min-w-0) instead
                of covering it; below lg it renders as an overlay instead. */}
              <Suspense fallback={null}>
                <CommentDock
                  currentUserId={user.id}
                  currentUserName={user.name}
                  currentUserAvatarUrl={user.avatarUrl}
                  canModerate={canModerateComments(user)}
                />
              </Suspense>
            </div>
          </div>
        </CommentPanelProvider>
      </CommentAnchorProvider>
      </TablePrefsProvider>
    </PermissionsProvider>
  );
}
