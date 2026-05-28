"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isoDate } from "@/lib/format";
import { createTag, deleteTag, renameTag } from "@/app/actions/tag";
import type { TagRow } from "@/db/queries/tags";

/**
 * Tag vocabulary admin. Add a tag, rename it inline (cascades to every
 * tagged creative), or delete it (removes the assignment everywhere).
 */
export function TagsTable({ rows }: { rows: TagRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createTag({ name });
      if (!res.ok) {
        toast.error(res.error ?? "Could not add tag");
        return;
      }
      toast.success(`Added “${name}”`);
      setNewName("");
      router.refresh();
    });
  };

  const beginEdit = (row: TagRow) => {
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
      const res = await renameTag(id, next);
      if (!res.ok) {
        toast.error(res.error ?? "Could not rename tag");
        return;
      }
      toast.success(`Renamed to “${next}”`);
      cancelEdit();
      router.refresh();
    });
  };

  const remove = (row: TagRow) => {
    const msg =
      row.usage > 0
        ? `Delete “${row.name}”? It will be removed from ${row.usage} creative${row.usage === 1 ? "" : "s"}.`
        : `Delete “${row.name}”?`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteTag(row.id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete tag");
        return;
      }
      toast.success(`Deleted “${row.name}”`);
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
              placeholder="New tag name"
              maxLength={64}
            />
          </div>
          <Button type="submit" disabled={isPending || !newName.trim()}>
            <Plus className="w-4 h-4" />
            Add tag
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center text-ink-3 text-sm">
          No tags yet. Add one above, or tags get created when you tag a
          creative.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm num">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                <th className="font-medium px-3 py-2.5">Tag</th>
                <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
                <th className="font-medium px-3 py-2.5">Added</th>
                <th className="font-medium px-3 py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const editing = editingId === r.id;
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
                          maxLength={64}
                          autoFocus
                          className="h-7 max-w-[220px]"
                        />
                      ) : (
                        <span className="text-ink">{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-2">{r.usage}</td>
                    <td className="px-3 py-2 text-ink-3">{isoDate(r.createdAt)}</td>
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => remove(r)}
                            disabled={isPending}
                            className="text-ink-3 hover:text-neg"
                          >
                            <Trash2 className="w-3 h-3" />
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
      )}
    </div>
  );
}
