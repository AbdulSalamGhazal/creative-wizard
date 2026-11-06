"use client";

import { useState } from "react";
import { Check, Copy, Dices } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateStarterPassword } from "@/lib/starter-password";

/**
 * A starter-password field with Generate and Copy (D4, 2026-11-06) — shared by
 * the Invite dialog and the Set-password dialog so the two can't drift. Shown
 * in clear on purpose: the inviter must READ it to pass it on, and nobody
 * else is looking at the Team page. The copy feedback follows the API-token
 * dialog's (icon swap + toast).
 */
export function PasswordField({
  id,
  value,
  onChange,
  disabled,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  minLength: number;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Password copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`At least ${minLength} characters`}
        autoComplete="new-password"
        spellCheck={false}
        minLength={minLength}
        required
        disabled={disabled}
        className="font-mono"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(generateStarterPassword())}
        disabled={disabled}
        aria-label="Generate a password"
        title="Generate a password"
      >
        <Dices className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        disabled={disabled || !value}
        aria-label="Copy password"
        title="Copy password"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
