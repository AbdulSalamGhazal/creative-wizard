"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Camera, KeyRound, LogOut, Palette, Plug } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/actions/session";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { captureScreenshot } from "@/lib/screenshot";

interface Props {
  user: {
    name: string;
    email: string;
    role: "admin" | "editor" | "viewer";
    initials: string;
  };
}

/**
 * Theme swatches preview [background · ink · accent] and MUST mirror the
 * `.<theme>` values in app/globals.css (keep in sync). Four tones on one axis,
 * persisted by next-themes; brand + chart colors stay shared.
 */
const DARK_THEMES = [
  { value: "midnight", label: "Midnight", swatches: ["#0a0812", "#f2ebe5", "#d4145a"] },
  { value: "contrast", label: "Contrast", swatches: ["#000000", "#ffffff", "#f59e0b"] },
] as const;

const LIGHT_THEMES = [
  { value: "frost", label: "Frost", swatches: ["#f3f6fb", "#16202e", "#2563eb"] },
  { value: "paper", label: "Paper", swatches: ["#f7f3ea", "#2b2620", "#b45309"] },
] as const;

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="flex items-center -space-x-1">
      {colors.map((c, i) => (
        <span
          key={i}
          className="h-3.5 w-3.5 rounded-full ring-1 ring-black/30"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

/**
 * The account menu — now also the home of the two chrome controls that used to
 * sit loose in the top bar: "Copy screenshot" and the theme picker. The bar
 * keeps only what's used constantly (search, comments, notifications); the
 * things used occasionally moved one click away.
 *
 * Theme is a hover SUBMENU (shadcn's DropdownMenuSub) rather than an
 * always-expanded section: the menu stays short, and the four swatches appear
 * only when asked for.
 */
export function UserMenu({ user }: Props) {
  const [isPending, startTransition] = useTransition();
  const [changeOpen, setChangeOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Leave the radio group uncontrolled until mounted to avoid a hydration
  // mismatch (the stored theme is only known on the client).
  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = mounted
    ? ([...DARK_THEMES, ...LIGHT_THEMES].find((t) => t.value === theme)?.label ?? "")
    : "";

  const handleSignOut = () => {
    startTransition(async () => {
      await signOut();
    });
  };

  return (
    <>
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
        {/* Excluded from screenshots: the menu is open while the capture runs. */}
        <DropdownMenuContent
          align="end"
          className="w-56 max-h-[80vh] overflow-y-auto"
          data-screenshot-exclude
        >
          <DropdownMenuLabel>
            <div className="flex flex-col gap-0.5">
              <span className="text-ink truncate">{user.name}</span>
              <span className="text-ink-3 text-[11px] font-mono truncate">
                {user.email}
              </span>
              <span className="text-ink-3 text-eyebrow mt-0.5">{user.role}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account/api">
              <Plug className="w-3.5 h-3.5" />
              API access
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setChangeOpen(true);
            }}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              // Let the menu close first so it isn't in the frame — the
              // exclude attribute covers it, but a closed menu is cleaner.
              window.setTimeout(() => void captureScreenshot(), 0);
            }}
          >
            <Camera className="w-3.5 h-3.5" />
            Copy screenshot
          </DropdownMenuItem>

          {/* Theme is a SUBMENU: one row that opens the four swatches on
              hover, focus, → or Enter (Radix handles all four). The menu stays
              short, and the current theme carries the radio indicator. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette className="w-3.5 h-3.5" />
              Theme
              <span className="ml-auto text-[11px] text-ink-3">{currentTheme}</span>
            </DropdownMenuSubTrigger>
            {/* SubContent is portaled separately — exclude it from captures. */}
            <DropdownMenuSubContent className="w-48" data-screenshot-exclude>
              <DropdownMenuRadioGroup
                value={mounted ? (theme ?? "midnight") : undefined}
                onValueChange={setTheme}
              >
                <DropdownMenuLabel className="text-ink-3 text-eyebrow font-normal">
                  Dark
                </DropdownMenuLabel>
                {DARK_THEMES.map((t) => (
                  <DropdownMenuRadioItem key={t.value} value={t.value} className="gap-2">
                    <Swatches colors={t.swatches} />
                    {t.label}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-ink-3 text-eyebrow font-normal">
                  Light
                </DropdownMenuLabel>
                {LIGHT_THEMES.map((t) => (
                  <DropdownMenuRadioItem key={t.value} value={t.value} className="gap-2">
                    <Swatches colors={t.swatches} />
                    {t.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOut} disabled={isPending}>
            <LogOut className="w-3.5 h-3.5" />
            {isPending ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />
    </>
  );
}
