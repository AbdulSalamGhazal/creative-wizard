import { Suspense } from "react";
import { Menu } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import type { ToastScope } from "@/lib/notifications";
import { UserMenu } from "@/components/auth/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { NotificationBell } from "@/components/layout/notification-bell";
import { PanelToggles } from "@/components/comments/comment-panel";
import { AccountSwitcher } from "@/components/layout/account-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { LogoMark } from "@/components/layout/logo-mark";
import { BrandWordmark } from "@/components/layout/brand-wordmark";
import { brandColor, type BrandStyle } from "@/lib/brand-style";

interface Props {
  user: SessionUser;
  accounts: BrandStyle[];
  activeAccountId: string;
  /** The user's effective permission keys — drives which nav items appear. */
  granted: string[];
  /** Which arrivals may toast (migration 0050) — the bell obeys it, the menu
   *  shows it. */
  toastScope: ToastScope;
}

export function TopBar({
  user,
  accounts,
  activeAccountId,
  granted,
  toastScope,
}: Props) {
  const active = accounts.find((a) => a.id === activeAccountId) ?? accounts[0];
  return (
    <header className="border-b border-line sticky top-0 z-20 bg-background">
      {/* The brand's accent (2026-11): a 2 px strip of its colour along the
          top edge, so which brand this tab is on reads before any word.
          OVERLAID (absolute — the sticky header is its containing block), so
          the bar stays exactly h-14: the sidebar, filter strips and comment
          dock all stick at top-14. */}
      {active && (
        <div
          aria-hidden
          data-brand-accent
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
          style={{ background: brandColor(active) }}
        />
      )}
      <div className="flex items-center justify-between px-[var(--gutter)] h-14">
        {/* `min-w-0`: this group yields first when the bar is tight, so the
            brand name truncates rather than the row overflowing (at 375px the
            fixed elements leave ~52px for the name). */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          {/* Suspense: MobileNav reads useSearchParams (Budget month links). */}
          <Suspense
            fallback={
              <button
                type="button"
                aria-label="Open navigation menu"
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-line text-ink-2"
              >
                <Menu className="w-4.5 h-4.5" />
              </button>
            }
          >
            <MobileNav granted={granted} />
          </Suspense>
          {/* h-9 on a phone: 7px of logo buys the brand name room (R-060). */}
          <LogoMark className="h-9 w-auto shrink-0 sm:h-10" />
          {/* Below sm the logo mark carries the brand on its own — the
              wordmark is the first thing to go when the bar gets tight. */}
          <BrandWordmark className="hidden sm:inline-block text-2xl leading-none" />
          <AccountSwitcher accounts={accounts} activeId={activeAccountId} />
        </div>
        {/* Search · comments · notifications · account. The screenshot and
            theme controls moved INTO the account menu, which is what makes
            this row fit a phone. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <CommandPalette accountId={activeAccountId} granted={granted} />
          {/* Comments + Activity on an entity's page — HERE only below lg; on
              a desktop they live in the rail at the page's right edge
              (2026-11-07). Elsewhere they don't render at all. */}
          <PanelToggles orientation="horizontal" className="lg:hidden" />
          {/* The bell is the ONLY entry to notifications — there is no sidebar
              item for them, on purpose. */}
          <NotificationBell
            userId={user.id}
            accountId={activeAccountId}
            toastScope={toastScope}
          />
          <UserMenu
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              avatarUrl: user.avatarUrl,
            }}
            toastScope={toastScope}
          />
        </div>
      </div>
    </header>
  );
}
