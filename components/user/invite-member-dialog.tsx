"use client";

import { useState, useTransition } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { inviteUser } from "@/app/actions/user";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { generateStarterPassword } from "@/lib/starter-password";
import { PRESET_DESCRIPTION, PRESET_LABEL } from "@/lib/team-presets";
import type { BrandOption } from "@/components/user/user-brands-section";
import { PasswordField } from "@/components/user/password-field";
import { holdsEveryBrand, teamGuard, type ManagerScope } from "@/lib/team-guard";
import { roleEnum, type RoleTier } from "@/lib/enums";

/** Roles in the picker's order — least access first, DERIVED from the enum. */
const ROLE_ORDER: readonly RoleTier[] = [...roleEnum].reverse();

interface Handed {
  name: string;
  email: string;
  password: string;
  userId: string | undefined;
}

/**
 * Invite a member (D4, 2026-11-06) — the header's one button, opening the
 * house dialog in two steps. The form takes name, email, starting access and
 * brands; the starter password is GENERATED (the inviter can still type one).
 * On success the dialog turns into the hand-over: the credentials, shown once
 * with a Copy button, because the app has no mailer and the inviter passes
 * them on over a trusted channel (the API-token dialog's pattern). The old
 * always-open form made the inviter remember what they had typed.
 */
export function InviteMemberDialog({
  brands,
  scope,
  open,
  onOpenChange,
  onInvited,
}: {
  /** The brands this manager may grant (all of them, unless restricted). */
  brands: BrandOption[];
  /** What the signed-in manager may hand out — `teamGuard` decides with it. */
  scope: ManagerScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The directory opens the new member's row. */
  onInvited?: (userId: string | undefined) => void;
}) {
  // Below admin, offer only the starting access the guard would accept: never
  // Admin, and Editor only for someone who holds the whole preset (D1).
  const everyBrand = holdsEveryBrand(scope);
  const roles = ROLE_ORDER.filter(
    (r) =>
      teamGuard(scope, { kind: "invite", role: r, allAccounts: everyBrand, accountIds: [] }) ===
      null,
  );
  const defaultRole: RoleTier = roles.includes("editor") ? "editor" : "viewer";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleTier>(defaultRole);
  const [password, setPassword] = useState(() => generateStarterPassword());
  // A manager restricted to some brands can't grant "All brands".
  const [allAccounts, setAllAccounts] = useState(everyBrand);
  const [accountIds, setAccountIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [handed, setHanded] = useState<Handed | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Admins always see every brand — the picker is meaningless for them.
  const brandsLocked = role === "admin";
  const noneChosen = !brandsLocked && !allAccounts && accountIds.size === 0;

  function reset() {
    setName("");
    setEmail("");
    setRole(defaultRole);
    setPassword(generateStarterPassword());
    setAllAccounts(everyBrand);
    setAccountIds(new Set());
    setError(null);
    setHanded(null);
    setCopied(false);
  }

  function toggleBrand(id: string) {
    setAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (noneChosen) {
      setError("Select at least one brand.");
      return;
    }
    startTransition(async () => {
      const res = await safeAction(() =>
        inviteUser({
          name: name.trim(),
          email: email.trim(),
          role,
          password,
          allAccounts: brandsLocked ? true : allAccounts,
          accountIds: brandsLocked || allAccounts ? [] : [...accountIds],
        }),
      );
      if (!res.ok) {
        // Every field keeps what was typed.
        toastActionFailure(res, "Invite failed", { inline: setError });
        return;
      }
      toast.success(`Added ${name.trim()} to the team`);
      setHanded({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        userId: "userId" in res ? res.userId : undefined,
      });
    });
  };

  async function copyCredentials() {
    if (!handed) return;
    try {
      await navigator.clipboard.writeText(
        `Wizard sign-in\nEmail: ${handed.email}\nPassword: ${handed.password}`,
      );
      setCopied(true);
      toast.success("Sign-in details copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }

  function close() {
    const invited = handed?.userId;
    onOpenChange(false);
    // Defer reset so the dialog's close animation doesn't flash the form.
    setTimeout(reset, 200);
    if (handed) onInvited?.(invited);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isPending) return;
        if (!o) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {handed ? (
          <>
            <DialogHeader>
              <DialogTitle>Share {handed.name}&apos;s sign-in</DialogTitle>
              <DialogDescription>
                This is the only time the password is shown. Pass both lines on over a trusted
                channel; they can change the password from their account menu.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1 rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-sans text-ink-3">Email</span>
                <span className="min-w-0 flex-1 truncate text-ink">{handed.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-sans text-ink-3">Password</span>
                <span className="min-w-0 flex-1 truncate text-ink">{handed.password}</span>
              </div>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={copyCredentials}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy both"}
              </Button>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription>
                They sign in with the email and the starter password shown after this step.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Name</Label>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  autoComplete="off"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@urjwan.com"
                  autoComplete="off"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invite-access">Starting access</Label>
                <Select value={role} onValueChange={(v) => setRole(v as RoleTier)}>
                  <SelectTrigger id="invite-access" className="w-full">
                    {/* The trigger shows the name alone; the description is the list's. */}
                    <SelectValue>{PRESET_LABEL[role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex flex-col">
                          <span>{PRESET_LABEL[r]}</span>
                          <span className="text-[10px] text-ink-3">{PRESET_DESCRIPTION[r]}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-password">Starter password</Label>
                <PasswordField
                  id="invite-password"
                  value={password}
                  onChange={setPassword}
                  disabled={isPending}
                  minLength={PASSWORD_MIN_LENGTH}
                />
              </div>
            </div>

            {/* The brand toggles are several buttons — the label names them as a group. */}
            <div className="space-y-1.5" role="group" aria-labelledby="invite-brands">
              <Label id="invite-brands">Brands</Label>
              {brandsLocked ? (
                <p className="text-xs text-ink-3">Admins can always see every brand.</p>
              ) : (
                <>
                  {everyBrand && (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={allAccounts}
                      onClick={() => setAllAccounts((v) => !v)}
                      className="flex items-center gap-2 text-xs text-ink-2 hover:text-ink"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          allAccounts
                            ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                            : "border-line",
                        )}
                        aria-hidden
                      >
                        {allAccounts && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      All brands, including brands created later
                    </button>
                  )}
                  {!allAccounts && (
                    <div className="grid gap-1 pt-1 sm:grid-cols-2">
                      {brands.map((b) => {
                        const on = accountIds.has(b.id);
                        return (
                          <button
                            key={b.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            // Named explicitly — the brand name sits in its own span.
                            aria-label={b.name}
                            onClick={() => toggleBrand(b.id)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-surface-2"
                          >
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                on
                                  ? "border-transparent bg-[var(--brand)] text-[var(--primary-foreground)]"
                                  : "border-line",
                              )}
                              aria-hidden
                            >
                              {on && <Check className="h-3 w-3" strokeWidth={3} />}
                            </span>
                            <span className={cn("truncate text-ink-2", on && "text-ink")}>
                              {b.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isPending ||
                  !name.trim() ||
                  !email.trim() ||
                  password.length < PASSWORD_MIN_LENGTH ||
                  noneChosen
                }
              >
                <UserPlus className="h-4 w-4" />
                {isPending ? "Adding…" : "Add to team"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
