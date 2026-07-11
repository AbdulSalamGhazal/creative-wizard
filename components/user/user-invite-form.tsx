"use client";

import { useState, useTransition } from "react";
import { Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import type { BrandOption } from "@/components/user/user-brands-section";

export function UserInviteForm({ brands }: { brands: BrandOption[] }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [password, setPassword] = useState("");
  const [allAccounts, setAllAccounts] = useState(true);
  const [accountIds, setAccountIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Admins always see every brand — the picker is meaningless for them.
  const brandsLocked = role === "admin";
  const noneChosen = !brandsLocked && !allAccounts && accountIds.size === 0;

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
      const res = await inviteUser({
        name: name.trim(),
        email: email.trim(),
        role,
        password,
        allAccounts: brandsLocked ? true : allAccounts,
        accountIds: brandsLocked || allAccounts ? [] : [...accountIds],
      });
      if (!res.ok) {
        setError(res.error ?? "Invite failed");
        return;
      }
      toast.success(`Invited ${name.trim()}`);
      setName("");
      setEmail("");
      setRole("editor");
      setPassword("");
      setAllAccounts(true);
      setAccountIds(new Set());
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Teammate name"
            required
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
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-2 items-end">
        <div className="space-y-1.5">
          <Label>Starting access</Label>
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-password">Starter password</Label>
          <Input
            id="invite-password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={
            isPending || !name.trim() || !email.trim() || password.length < 8
          }
        >
          <UserPlus className="w-4 h-4" />
          {isPending ? "Inviting…" : "Invite"}
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label>Brands</Label>
        {brandsLocked ? (
          <p className="text-[11px] text-ink-3">
            Admins can always see every brand.
          </p>
        ) : (
          <>
            <button
              type="button"
              role="switch"
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
              All brands (including brands created later)
            </button>
            {!allAccounts && (
              <div className="grid gap-1 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                {brands.map((b) => {
                  const on = accountIds.has(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
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
      <p className="text-[11px] text-ink-3">
        Share the starter password with your teammate over a trusted channel.
        They can change it from the user menu after they sign in.
      </p>
    </form>
  );
}
