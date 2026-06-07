"use client";

import { useState, useTransition } from "react";
import { Check, Edit3, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCreativeSourceLink } from "@/app/actions/creative";

/** Inline editor for a creative's single source link — mirrors the NotesPanel
 *  pattern (view ↔ edit, dedicated action, no auto-save). */
export function SourceLinkPanel({
  creativeId,
  initialLink,
}: {
  creativeId: string;
  initialLink: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialLink ?? "");
  const [saved, setSaved] = useState(initialLink ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateCreativeSourceLink(creativeId, value);
      if (!res.ok) {
        setError(res.error ?? "Failed");
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
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Source link</h2>
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
          <a
            href={saved}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-ink hover:underline inline-flex items-center gap-1.5 min-w-0 max-w-full"
          >
            <span className="truncate">{saved}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 text-ink-3" />
          </a>
        ) : (
          <p className="text-sm text-ink-3 italic">
            No source link yet — add the live post, ad, or asset URL.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-medium text-ink">Edit source link</h2>
      <Input
        type="url"
        inputMode="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://…"
        maxLength={2048}
        autoFocus
        disabled={isPending}
      />
      {error && <p className="text-[11px] text-neg">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" type="button" onClick={cancel} disabled={isPending}>
          <X className="w-3 h-3" />
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={isPending}>
          <Check className="w-3 h-3" />
          {isPending ? "Saving…" : "Save link"}
        </Button>
      </div>
    </div>
  );
}
