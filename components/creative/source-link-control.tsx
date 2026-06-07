"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Link2, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { updateCreativeSourceLink } from "@/app/actions/creative";

/**
 * Compact source-link control for the detail header (below the thumbnail).
 * View = a small "Source" button that opens the link (+ an edit pencil), or an
 * "Add source link" affordance when empty. Editing reveals a small inline input
 * saved via the dedicated `updateCreativeSourceLink` action (independent of the
 * header's Save bar, like notes).
 */
export function SourceLinkControl({
  creativeId,
  initialLink,
}: {
  creativeId: string;
  initialLink: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialLink ?? "");
  const [saved, setSaved] = useState(initialLink ?? "");
  const [isPending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await updateCreativeSourceLink(creativeId, value);
      if (!res.ok) {
        toast.error(res.error ?? "Link not saved");
        return;
      }
      const cleaned = value.trim();
      setSaved(cleaned);
      setValue(cleaned);
      setEditing(false);
      toast.success("Source link saved");
    });
  };

  const cancel = () => {
    setValue(saved);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          placeholder="https://…"
          maxLength={2048}
          autoFocus
          disabled={isPending}
          className="h-8 text-xs"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          aria-label="Save source link"
          className="inline-flex items-center justify-center h-8 w-8 shrink-0 rounded-md border border-line text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          aria-label="Cancel"
          className="inline-flex items-center justify-center h-8 w-8 shrink-0 rounded-md border border-line text-ink-3 hover:text-neg transition-colors disabled:opacity-60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (!saved) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors"
      >
        <Link2 className="w-3.5 h-3.5" />
        Add source link
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <a
        href={saved}
        target="_blank"
        rel="noopener noreferrer"
        title={saved}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink hover:bg-surface-2 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-ink-3" />
        Source
      </a>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit source link"
        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
