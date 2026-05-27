import { Moon } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { UserMenu } from "@/components/auth/user-menu";
import { CommandPalette } from "@/components/layout/command-palette";

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
    <header className="border-b border-line relative z-10 bg-bg">
      <div className="flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, var(--brand), var(--brand-2))",
                boxShadow: "0 0 20px rgba(212, 20, 90, 0.3)",
              }}
            >
              <span className="font-display text-white text-base leading-none">
                U
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold tracking-tight">
                Urjwan
              </div>
              <div className="text-[9.5px] uppercase tracking-[0.18em] text-ink-3 mt-0.5">
                Creative System
              </div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-ink-3">
            <span>Workspace</span>
            <span aria-hidden>›</span>
            <span className="text-ink-2">Production</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CommandPalette creatives={creatives} />
          <button
            className="text-ink-2 hover:text-ink p-1.5 rounded-md hover:bg-surface-2 transition"
            title="Theme"
            type="button"
          >
            <Moon className="w-4 h-4" />
          </button>
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
