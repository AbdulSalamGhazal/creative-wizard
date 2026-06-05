"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createAccount,
  renameAccount,
  setActiveAccount,
} from "@/app/actions/account";

interface AccountRow {
  id: string;
  name: string;
  slug: string;
}

/**
 * Brand (account) admin. Create a new brand — it starts completely empty (no
 * creatives / products / tags / performance) — or rename an existing one. The
 * active brand is badged; switching here writes the same `ccms_account` cookie
 * as the top-bar switcher. There is intentionally no delete: a brand owns data
 * and removing it is a destructive operation better done deliberately at the DB.
 */
export function AccountsAdmin({
  accounts,
  activeId,
}: {
  accounts: AccountRow[];
  activeId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createAccount({ name });
      if (!res.ok) {
        toast.error(res.error ?? "Could not create brand");
        return;
      }
      toast.success(`Created “${name}”`);
      setNewName("");
      router.refresh();
    });
  };

  const beginEdit = (row: AccountRow) => {
    setEditingId(row.id);
    setEditValue(row.name);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const saveEdit = (id: string) => {
    const next = editValue.trim();
    if (!next) return;
    startTransition(async () => {
      const res = await renameAccount({ id, name: next });
      if (!res.ok) {
        toast.error(res.error ?? "Could not rename brand");
        return;
      }
      toast.success(`Renamed to “${next}”`);
      cancelEdit();
      router.refresh();
    });
  };

  const switchTo = (row: AccountRow) => {
    startTransition(async () => {
      const res = await setActiveAccount({ accountId: row.id });
      if (!res.ok) {
        toast.error(res.error ?? "Could not switch brand");
        return;
      }
      toast.success(`Switched to ${row.name}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-start gap-2"
        >
          <div className="flex-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New brand name"
              maxLength={120}
            />
          </div>
          <Button type="submit" disabled={isPending || !newName.trim()}>
            <Plus className="w-4 h-4" />
            Create brand
          </Button>
        </form>
        <p className="text-ink-3 text-xs mt-2">
          A new brand starts empty — its own creatives, products, tags,
          performance data, CSV mappings, and rate config, fully isolated.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium px-3 py-2.5">Brand</th>
              <th className="font-medium px-3 py-2.5">Slug</th>
              <th className="font-medium px-3 py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {accounts.map((r) => {
              const editing = editingId === r.id;
              const isActive = r.id === activeId;
              return (
                <tr key={r.id} className="hover:bg-surface-2/60 transition-colors">
                  <td className="px-3 py-2">
                    {editing ? (
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEdit(r.id);
                          } else if (e.key === "Escape") {
                            cancelEdit();
                          }
                        }}
                        maxLength={120}
                        autoFocus
                        className="h-7 max-w-[240px]"
                      />
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-ink">{r.name}</span>
                        {isActive && (
                          <span className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 bg-brand/15 text-brand">
                            Current
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-3">{r.slug}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {editing ? (
                      <span className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => saveEdit(r.id)}
                          disabled={isPending || !editValue.trim()}
                          className="text-pos hover:text-pos"
                        >
                          <Check className="w-3 h-3" />
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={cancelEdit}
                          disabled={isPending}
                          className="text-ink-3 hover:text-ink"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {!isActive && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => switchTo(r)}
                            disabled={isPending}
                            className="text-ink-3 hover:text-ink"
                          >
                            Switch
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => beginEdit(r)}
                          disabled={isPending}
                          className="text-ink-3 hover:text-ink"
                        >
                          <Pencil className="w-3 h-3" />
                          Rename
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
