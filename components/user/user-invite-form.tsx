"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
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
import { inviteUser } from "@/app/actions/user";

export function UserInviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await inviteUser({ name: name.trim(), email: email.trim(), role });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        return;
      }
      setName("");
      setEmail("");
      setRole("editor");
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_auto] gap-2 items-end">
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Salam"
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
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="editor">Editor</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={isPending || !name.trim() || !email.trim()}>
          <UserPlus className="w-4 h-4" />
          {isPending ? "Adding…" : "Invite"}
        </Button>
      </div>
      {error && <p className="text-[11px] text-neg">{error}</p>}
      <p className="text-[11px] text-ink-3">
        Stub invite — creates the user row in the database. Once Auth.js v5
        is wired, the user will sign in via Google with the same email.
      </p>
    </form>
  );
}
