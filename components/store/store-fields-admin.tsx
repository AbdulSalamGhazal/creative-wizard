"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Trash2, X } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useNavTransition } from "@/lib/nav-progress";
import {
  createStoreField,
  updateStoreField,
  deleteStoreField,
} from "@/app/actions/store-field";
import type { StoreField, StoreFieldType } from "@/store/fields";

/**
 * Admin config for the Store module's order fields. The three CORE fields are
 * locked (System field) — only their label + accepted headers are editable.
 * Custom fields are fully editable and deletable (deleting keeps existing data).
 */
export function StoreFieldsAdmin({ fields }: { fields: StoreField[] }) {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <NewFieldForm />
      </div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {fields.map((f) => (
          <FieldRow key={f.id} field={f} />
        ))}
      </div>
      <p className="text-xs text-ink-3">
        Headers are matched case-insensitively (after trimming). Mapping is
        explicit — a required field with no matching header fails the upload.
        Every field is available in the Orders table&rsquo;s Columns menu, where
        each viewer chooses what to show.
      </p>
    </div>
  );
}

function HeadersEditor({
  headers,
  onChange,
  disabled,
}: {
  headers: string[];
  onChange: (h: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!headers.some((h) => h.toLowerCase() === v.toLowerCase())) {
      onChange([...headers, v]);
    }
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {headers.map((h) => (
        <span
          key={h}
          className="inline-flex h-6 items-center gap-1 rounded border border-line bg-surface-2 pl-2 pr-1 text-[11px]"
        >
          <span className="font-mono text-ink">{h}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(headers.filter((x) => x !== h))}
              className="text-ink-3 hover:text-neg"
              aria-label={`Remove header ${h}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add header…"
          className="h-6 w-28 rounded border border-line bg-transparent px-2 text-[11px] focus:border-brand focus:outline-none"
        />
      )}
    </div>
  );
}

function FieldRow({ field }: { field: StoreField }) {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();
  const [label, setLabel] = useState(field.label);
  const [required, setRequired] = useState(field.required);
  const [headers, setHeaders] = useState<string[]>(field.headers);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    label !== field.label ||
    required !== field.required ||
    JSON.stringify(headers) !== JSON.stringify(field.headers);

  function save() {
    startTransition(async () => {
      const res = await updateStoreField({
        id: field.id,
        label: label.trim(),
        required,
        headers,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save");
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteStoreField(field.id);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't delete");
        return;
      }
      toast.success(`Deleted "${field.label}"`);
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={isPending}
          className="h-7 min-w-0 flex-1 rounded border-b border-transparent bg-transparent text-sm font-medium text-ink hover:border-line focus:border-brand focus:outline-none"
        />
        <span className="font-mono text-[11px] text-ink-3">{field.key}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
          {field.type}
        </span>
        {field.core ? (
          <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
            <Lock className="h-3 w-3" /> System field
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={isPending}
            className="text-ink-3 hover:text-neg"
            aria-label={`Delete ${field.label}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-[11px] text-ink-3">Headers:</span>
        <HeadersEditor headers={headers} onChange={setHeaders} disabled={isPending} />
      </div>

      {!field.core && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <Toggle label="Required" on={required} onToggle={() => setRequired((v) => !v)} disabled={isPending} />
        </div>
      )}
      {field.core && (
        <p className="text-[11px] text-ink-3">
          Always required. Only the label + headers are editable.
        </p>
      )}

      {dirty && (
        <div className="flex items-center gap-2">
          <Button type="button" size="xs" onClick={save} disabled={isPending}>
            Save
          </Button>
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !isPending && setConfirmDelete(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete field</DialogTitle>
            <DialogDescription>
              &ldquo;{field.label}&rdquo; will stop validating and displaying. Values
              already stored on existing orders are KEPT (just no longer shown). You
              can re-add a field with the same name later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={isPending}>
              Delete field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Toggle({
  label,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center gap-1.5 hover:text-ink disabled:opacity-60"
    >
      <span
        className={cn(
          "h-3.5 w-3.5 rounded border",
          on ? "border-transparent bg-[var(--brand)]" : "border-line",
        )}
      />
      {label}
    </button>
  );
}

function NewFieldForm() {
  const router = useRouter();
  const [isPending, startTransition] = useNavTransition();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<StoreFieldType>("text");
  const [required, setRequired] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createStoreField({ label: label.trim(), type, required, headers });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't create field");
        return;
      }
      toast.success(`Added "${label.trim()}"`);
      setLabel("");
      setType("text");
      setRequired(false);
      setHeaders([]);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-sm font-medium text-ink">Add a custom field</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1.5">
          <Label htmlFor="new-field-label">Label</Label>
          <Input
            id="new-field-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Status"
            maxLength={64}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as StoreFieldType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="date">Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Accepted file headers</Label>
        <HeadersEditor headers={headers} onChange={setHeaders} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
        <Toggle label="Required" on={required} onToggle={() => setRequired((v) => !v)} />
      </div>
      <Button type="submit" size="sm" disabled={isPending || !label.trim()}>
        <Plus className="h-3.5 w-3.5" />
        Add field
      </Button>
    </form>
  );
}
