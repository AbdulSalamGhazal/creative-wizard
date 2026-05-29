"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/app/actions/session";

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
      const res = await signIn(form);
      if (!res.ok) {
        setError(res.error ?? "Sign-in failed.");
        return;
      }
      router.replace(nextPath);
      router.refresh();
    });
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="text-center space-y-2">
        <div
          className="w-12 h-12 rounded-md mx-auto flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, var(--brand), var(--brand-2))",
            boxShadow: "0 0 20px var(--brand-glow)",
          }}
        >
          <Wand2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="font-display text-3xl tracking-tight">Creative Wizard</h1>
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink-3 mt-1">
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
        {error && <p className="text-[12px] text-neg">{error}</p>}
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
