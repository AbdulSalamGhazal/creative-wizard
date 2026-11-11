import { Suspense } from "react";
import { headers } from "next/headers";
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
  EntityRail,
} from "@/components/comments/comment-panel";
import { NoBrandAccess } from "@/components/layout/no-brand-access";
import { BrandRefused } from "@/components/layout/brand-refused";
import { RememberBrand } from "@/components/layout/remember-brand";
import { ANY_BRAND, stripBrand, withBrand } from "@/lib/brand-path";
import { getToastScope, resolveTablePrefs } from "@/db/queries/user-prefs";
import { TABLE_KEY_LIST } from "@/lib/table-columns";
import { TablePrefsProvider } from "@/components/ui/table-prefs-context";
import type { Metadata } from "next";
import { getActiveAccount, getActiveAccountId, listAccounts } from "@/lib/tenant";
import { REQUEST_PATH_HEADER, signinHref } from "@/lib/signin-redirect";

/**
 * The brand leads every tab title (2026-11): "Mesbah · Library · Wizard", so a
 * row of tabs open on different brands reads at a glance even when narrow.
 * The template REPLACES the root's `%s · Wizard` for every page below, which
 * is why the suffix is repeated here. No brand (signed out, no access) → the
 * root's template stands.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const user = await auth();
    if (!user || (await listAccounts()).length === 0) return {};
    const brand = await getActiveAccount();
    return { title: { template: `${brand.name} · %s · Wizard`, default: brand.name } };
  } catch {
    return {};
  }
}

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brand: string }>;
}) {
  const user = await auth();
  if (!user) {
    // The middleware verified the cookie but its user is gone or its sessions
    // were ended: back through sign-in to THIS page, as the middleware does.
    redirect(signinHref((await headers()).get(REQUEST_PATH_HEADER)));
  }
  const granted = grantedPermissions(user);

  // Brand membership is enforced here: a user with zero allowed brands gets the
  // "No brand access" screen BEFORE any tenant-scoped query runs, so no
  // forbidden brand's data is ever fetched.
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    return <NoBrandAccess name={user.name} />;
  }

  // THE BRAND IS IN THE URL (2026-11, lib/brand-path.ts). `_` = "my last
  // brand" (an old link with no remembered brand): resolve it and send the
  // tab to the real address. A brand this person can't open is refused HERE,
  // before any tenant query — never quietly swapped for another brand.
  const { brand: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const requestPath = (await headers()).get(REQUEST_PATH_HEADER) ?? `/${rawSlug}`;
  const q = requestPath.indexOf("?");
  const appPath = stripBrand(q === -1 ? requestPath : requestPath.slice(0, q));
  const search = q === -1 ? "" : requestPath.slice(q);
  if (slug === ANY_BRAND) {
    redirect(withBrand((await getActiveAccount()).slug, `${appPath}${search}`));
  }
  if (!accounts.some((a) => a.slug === slug)) {
    return <BrandRefused slug={slug} appPath={appPath} search={search} brands={accounts} />;
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
            <RememberBrand slug={slug} />
            <NavProgressBar />
            <TopBar
              user={user}
              accounts={accounts.map((a) => ({
                id: a.id,
                slug: a.slug,
                name: a.name,
                color: a.color,
                logoUrl: a.logoUrl,
              }))}
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
                <main className="@container/main flex-1 px-[var(--gutter)] py-6">{children}</main>
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
              {/* The rail — Comments and Activity, on an entity's own page
                  only, at the far right so its buttons never move when the
                  panel opens beside it (2026-11-07). */}
              <EntityRail />
            </div>
          </div>
        </CommentPanelProvider>
      </CommentAnchorProvider>
      </TablePrefsProvider>
    </PermissionsProvider>
  );
}
