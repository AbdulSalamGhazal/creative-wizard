"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateUserRole } from "@/app/actions/user";

export function UserRoleSelect({
  userId,
  currentRole,
  isSelf,
}: {
  userId: string;
  currentRole: "admin" | "editor" | "viewer";
  isSelf: boolean;
}) {
  const [role, setRole] = useState(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Select
        value={role}
        disabled={isPending || isSelf}
        onValueChange={(v) => {
          const next = v as typeof role;
          const prev = role;
          setRole(next);
          startTransition(async () => {
            const res = await updateUserRole(userId, next);
            if (!res.ok) {
              setError(res.error ?? "Failed");
              toast.error(res.error ?? "Role unchanged");
              setRole(prev);
            } else {
              setError(null);
              toast.success(`Role updated to ${next}`);
            }
          });
        }}
      >
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
          <SelectItem value="viewer">Viewer</SelectItem>
        </SelectContent>
      </Select>
      {error && <span className="text-[11px] text-neg">{error}</span>}
      {isSelf && <span className="text-[11px] text-ink-3">(you)</span>}
    </div>
  );
}
