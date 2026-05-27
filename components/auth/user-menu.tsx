"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/actions/session";

interface Props {
  user: {
    name: string;
    email: string;
    role: "admin" | "editor" | "viewer";
    initials: string;
  };
}

export function UserMenu({ user }: Props) {
  const [isPending, startTransition] = useTransition();

  const handleSignOut = () => {
    startTransition(async () => {
      await signOut();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-7 h-7 rounded-full bg-surface-2 border border-line flex items-center justify-center text-[11px] font-semibold text-ink hover:bg-surface-3 transition-colors"
          aria-label="Account menu"
        >
          {user.initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <span className="text-ink truncate">{user.name}</span>
            <span className="text-ink-3 text-[11px] font-mono truncate">
              {user.email}
            </span>
            <span className="text-ink-3 text-[10px] uppercase tracking-[0.14em] mt-0.5">
              {user.role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut} disabled={isPending}>
          <LogOut className="w-3.5 h-3.5" />
          {isPending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
