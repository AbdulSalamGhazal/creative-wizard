"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
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
import { adminSetPassword } from "@/app/actions/user";

interface Props {
  userId: string;
  userEmail: string;
}

export function AdminSetPasswordButton({ userId, userEmail }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await adminSetPassword({ userId, password });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        toast.error(res.error ?? "Could not set password");
        return;
      }
      setDone(true);
      setPassword("");
      toast.success(`Password set for ${userEmail}`);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPassword("");
          setError(null);
          setDone(false);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        className="text-ink-3 hover:text-ink"
      >
        <KeyRound className="w-3 h-3" />
        Set password
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            Set a new password for{" "}
            <code className="font-mono text-ink-2">{userEmail}</code>. Share it
            with them over a trusted channel; they should change it on next
            sign-in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="set-pwd">New password</Label>
            <Input
              id="set-pwd"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              required
              autoFocus
            />
          </div>
          {error && <p className="text-[11px] text-neg">{error}</p>}
          {done && (
            <p className="text-[11px] text-pos">
              Password set. Tell the user to use it on next sign-in.
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Close
            </Button>
            <Button type="submit" disabled={isPending || password.length < 8}>
              {isPending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
