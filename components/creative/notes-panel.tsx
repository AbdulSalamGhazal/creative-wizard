"use client";

import { useState, useTransition } from "react";
import { Check, Edit3, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateCreativeNotes } from "@/app/actions/creative";

const MAX = 5000;

export function NotesPanel({
  creativeId,
  initialNotes,
}: {
  creativeId: string;
  initialNotes: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(initialNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateCreativeNotes(creativeId, value);
      if (!res.ok) {
        setError(res.error ?? "Failed");
        toast.error(res.error ?? "Notes not saved");
        return;
      }
      setSaved(value);
      setEditing(false);
      toast.success("Notes saved");
    });
  };

  const cancel = () => {
    setValue(saved);
    setEditing(false);
    setError(null);
  };

  if (!editing) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Notes</h2>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setEditing(true)}
            className="text-ink-3 hover:text-ink"
          >
            <Edit3 className="w-3 h-3" />
            Edit
          </Button>
        </div>
        {saved ? (
          <p className="text-sm text-ink-2 whitespace-pre-wrap">{saved}</p>
        ) : (
          <p className="text-sm text-ink-3 italic">
            No notes yet — add hooks, variations, briefs, or links.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Edit notes</h2>
        <span
          className={
            value.length > MAX
              ? "text-[11px] text-neg num"
              : "text-[11px] text-ink-3 num"
          }
        >
          {value.length} / {MAX}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-[160px]"
        autoFocus
      />
      {error && <p className="text-[11px] text-neg">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" type="button" onClick={cancel} disabled={isPending}>
          <X className="w-3 h-3" />
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={isPending || value.length > MAX}
        >
          <Check className="w-3 h-3" />
          {isPending ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
