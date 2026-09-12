import { Suspense } from "react";
import { Menu } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { UserMenu } from "@/components/auth/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { NotificationBell } from "@/components/layout/notification-bell";
import { CommentDrawer } from "@/components/comments/comment-drawer";
import { AccountSwitcher } from "@/components/layout/account-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { LogoMark } from "@/components/layout/logo-mark";
import { BrandWordmark } from "@/components/layout/brand-wordmark";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface Props {
  user: SessionUser;
  creatives: Array<{ id: string; name: string; productName: string }>;
  accounts: Array<{ id: string; name: string }>;
  activeAccountId: string;
  /** The user's effective permission keys — drives which nav items appear. */
  granted: string[];
  /** Admins may delete anyone's comment; everyone may delete their own. */
  canModerateComments: boolean;
}

export function TopBar({
  user,
  creatives,
  accounts,
  activeAccountId,
  granted,
  canModerateComments,
}: Props) {
  return (
    <header className="border-b border-line sticky top-0 z-20 bg-background">
      <div className="flex items-center justify-between px-6 h-14">
        {/* `min-w-0`: this group yields first when the bar is tight, so the
            brand name truncates rather than the row overflowing (at 375px the
            fixed elements leave ~52px for the name). */}
        <div className="flex min-w-0 items-center gap-2.5">
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
          <LogoMark className="h-10 w-auto shrink-0" />
          {/* Below sm the logo mark carries the brand on its own — the
              wordmark is the first thing to go when the bar gets tight. */}
          <BrandWordmark className="hidden sm:inline-block text-2xl leading-none" />
          <AccountSwitcher accounts={accounts} activeId={activeAccountId} />
        </div>
        {/* Search · comments · notifications · account. The screenshot and
            theme controls moved INTO the account menu, which is what makes
            this row fit a phone. */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <CommandPalette creatives={creatives} granted={granted} />
          {/* One comment surface for the whole app: it follows the page. */}
          <CommentDrawer
            currentUserId={user.id}
            canModerate={canModerateComments}
          />
          {/* The bell is the ONLY entry to notifications — there is no sidebar
              item for them, on purpose. */}
          <NotificationBell />
          <UserMenu
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              initials: initials(user.name),
            }}
          />
        </div>
      </div>
    </header>
  );
}
