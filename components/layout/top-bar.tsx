import { Wand2 } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { UserMenu } from "@/components/auth/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { ThemeToggle } from "@/components/theme/theme-toggle";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface Props {
  user: SessionUser;
  creatives: Array<{ id: string; name: string; productName: string }>;
}

export function TopBar({ user, creatives }: Props) {
  return (
    <header className="border-b border-line sticky top-0 z-20 bg-background">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, var(--brand), var(--brand-2))",
              boxShadow: "0 0 20px var(--brand-glow)",
            }}
          >
            <Wand2 className="w-4 h-4 text-white" />
          </div>
          <div className="text-[17px] font-semibold tracking-tight leading-none text-ink">
            Creative Wizard
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CommandPalette creatives={creatives} />
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
