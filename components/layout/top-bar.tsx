import type { SessionUser } from "@/lib/auth";
import { UserMenu } from "@/components/auth/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { ScreenshotButton } from "@/components/layout/screenshot-button";
import { AccountSwitcher } from "@/components/layout/account-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { LogoMark } from "@/components/layout/logo-mark";
import { BrandWordmark } from "@/components/layout/brand-wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";

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
}

export function TopBar({
  user,
  creatives,
  accounts,
  activeAccountId,
  granted,
}: Props) {
  return (
    <header className="border-b border-line sticky top-0 z-20 bg-background">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-2.5">
          <MobileNav granted={granted} />
          <LogoMark className="w-10 h-10 shrink-0" />
          <BrandWordmark className="text-2xl leading-none" />
          <AccountSwitcher accounts={accounts} activeId={activeAccountId} />
        </div>
        <div className="flex items-center gap-3">
          <CommandPalette creatives={creatives} />
          <ScreenshotButton />
          <ThemeToggle />
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
