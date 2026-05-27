"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
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
import { inviteUser } from "@/app/actions/user";

export function UserInviteForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await inviteUser({
        name: name.trim(),
        email: email.trim(),
        role,
        password,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        toast.error(res.error ?? "Invite failed");
        return;
      }
      toast.success(`Invited ${name.trim()}`);
      setName("");
      setEmail("");
      setRole("editor");
      setPassword("");
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
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
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
          {isPending ? "Adding…" : "Invite"}
        </Button>
      </div>
      {error && <p className="text-[11px] text-neg">{error}</p>}
      <p className="text-[11px] text-ink-3">
        Share the starter password with your teammate over a trusted channel.
        They can change it from the user menu after they sign in.
      </p>
    </form>
  );
}
