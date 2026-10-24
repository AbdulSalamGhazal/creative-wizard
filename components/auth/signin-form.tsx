"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogoMark } from "@/components/layout/logo-mark";
import { BrandWordmark } from "@/components/layout/brand-wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/app/actions/session";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { safeInternalPath } from "@/lib/url";

export function SignInForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.set("email", email.trim());
    form.set("password", password);
    startTransition(async () => {
      const res = await safeAction(() => signIn(form));
      if (!res.ok) {
        toastActionFailure(res, "Sign-in failed.", { inline: setError });
        return;
      }
      // Re-constrain even though the page already sanitized it — the client
      // must not trust a prop that ultimately came from the URL. ONE render:
      // the session cookie the action set already emptied the router cache,
      // so this navigation renders the target fresh (no refresh after it).
      router.replace(safeInternalPath(nextPath));
    });
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <LogoMark className="h-16 w-auto mx-auto" />
        <div>
          <BrandWordmark className="text-4xl" />
          <div className="text-label text-ink-3 mt-2">
            Sign in to continue
          </div>
        </div>
      </div>

      <form
        onSubmit={submit}
        className="space-y-3 rounded-lg border border-line bg-surface p-5"
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@urjwan.com"
            autoComplete="email"
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="text-xs text-neg">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={isPending || !email.trim() || !password}
        >
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-[11px] text-ink-3 text-center pt-1">
          Internal-team tool. Ask an admin to invite you if your email
          isn&apos;t on the team yet.
        </p>
      </form>
    </div>
  );
}
