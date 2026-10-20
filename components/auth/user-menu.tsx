"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import {
  Bell,
  Camera,
  ImagePlus,
  KeyRound,
  Loader2,
  LogOut,
  Palette,
  Plug,
  Trash2,
} from "lucide-react";
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
import { setToastScope } from "@/app/actions/user-prefs";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import {
  TOAST_SCOPES,
  TOAST_SCOPE_HINT,
  TOAST_SCOPE_LABEL,
  type ToastScope,
} from "@/lib/notifications";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { UserAvatar } from "@/components/user/user-avatar";
import { usePhotoChange } from "@/components/user/user-photo-control";
import { captureScreenshot } from "@/lib/screenshot";

interface Props {
  user: {
    name: string;
    email: string;
    role: "admin" | "editor" | "viewer";
    /** Profile photo, or null → initials (`UserAvatar`). */
    avatarUrl: string | null;
  };
  /** Which arrivals may toast (migration 0050) — the current value, from the
   *  server; the submenu writes it and refreshes. */
  toastScope: ToastScope;
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
export function UserMenu({ user, toastScope }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [changeOpen, setChangeOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Optimistic: the check moves now, the server catches up on refresh.
  const [scope, setScope] = useState<ToastScope>(toastScope);
  // Your own photo: no id travels (the session user is the subject).
  const photo = usePhotoChange({ name: user.name });
  useEffect(() => setScope(toastScope), [toastScope]);

  const changeScope = (next: string) => {
    const value = next as ToastScope;
    const previous = scope;
    setScope(value);
    startTransition(async () => {
      const res = await safeAction(() => setToastScope(value));
      if (!res.ok) {
        // Put the check back where the server still has it.
        setScope(previous);
        toastActionFailure(res, "Couldn't save that setting.");
        return;
      }
      // The layout reads the setting server-side and hands it to the bell —
      // refresh so the bell obeys the new value without a reload.
      router.refresh();
    });
  };

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
      {photo.input}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label="Account menu"
          >
            <UserAvatar name={user.name} src={user.avatarUrl} size="md" />
            {photo.busy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-ink" />
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        {/* Excluded from screenshots: the menu is open while the capture runs. */}
        <DropdownMenuContent
          align="end"
          className="w-56 max-h-[80vh] overflow-y-auto"
          data-screenshot-exclude
        >
          <DropdownMenuLabel>
            <div className="flex items-center gap-2.5">
              <UserAvatar name={user.name} src={user.avatarUrl} size="lg" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ink truncate">{user.name}</span>
                <span className="text-ink-3 text-[11px] font-mono truncate">
                  {user.email}
                </span>
                <span className="text-ink-3 text-eyebrow mt-0.5">{user.role}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Your photo — every avatar of you, everywhere, falls back to your
              initials without one. */}
          <DropdownMenuItem onSelect={photo.pick} disabled={photo.busy}>
            <ImagePlus className="w-3.5 h-3.5" />
            {user.avatarUrl ? "Change photo" : "Upload photo"}
          </DropdownMenuItem>
          {user.avatarUrl && (
            <DropdownMenuItem onSelect={() => void photo.remove()} disabled={photo.busy}>
              <Trash2 className="w-3.5 h-3.5" />
              Remove photo
            </DropdownMenuItem>
          )}
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

          {/* Notifications: the same submenu shape as Theme. The setting is
              about INTERRUPTION only — the badge, the tab title and the bell
              keep working on "Off". */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Bell className="w-3.5 h-3.5" />
              Notifications
              <span className="ml-auto text-[11px] text-ink-3">
                {TOAST_SCOPE_LABEL[scope]}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60" data-screenshot-exclude>
              <DropdownMenuLabel className="text-ink-3 text-eyebrow font-normal">
                Toasts
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={scope} onValueChange={changeScope}>
                {TOAST_SCOPES.map((value) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    className="items-start gap-2"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>{TOAST_SCOPE_LABEL[value]}</span>
                      <span className="text-[11px] text-ink-3">
                        {TOAST_SCOPE_HINT[value]}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

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
