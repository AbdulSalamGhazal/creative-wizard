"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCreative } from "@/app/actions/creative";

interface Props {
  products: Array<{ id: string; name: string }>;
}

const TYPES = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "slides", label: "Slides" },
] as const;

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
] as const;

export function CreativeCreateForm({ products }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [productId, setProductId] = useState<string>(products[0]?.id ?? "");
  const [type, setType] = useState<"video" | "image" | "slides">("video");
  const [status, setStatus] = useState<
    "draft" | "active" | "paused" | "archived"
  >("draft");
  const [launchDate, setLaunchDate] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await createCreative({
        name: name.trim(),
        productId,
        type,
        status,
        launchDate: launchDate || undefined,
        notes: notes.trim() || undefined,
        tags,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed to create");
        setFieldErrors(res.fieldErrors ?? {});
        toast.error(res.error ?? "Could not create creative");
        return;
      }
      toast.success(`Created ${res.name}`);
      router.push(`/creatives/${encodeURIComponent(res.name!)}`);
      router.refresh();
    });
  };

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
        <p className="text-ink-2 text-sm">
          No products yet. Add a product first so the new creative can be
          attributed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="Name"
        hint="The canonical creative identifier matched against CSV rows. Case- and whitespace-sensitive."
        error={fieldErrors.name}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="URJ_VID_042"
          maxLength={255}
          required
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Product" error={fieldErrors.productId}>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Type" error={fieldErrors.type}>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Status" error={fieldErrors.status}>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Launch date" hint="Optional." error={fieldErrors.launchDate}>
          <Input
            type="date"
            value={launchDate}
            onChange={(e) => setLaunchDate(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Tags"
        hint="Comma-separated."
        error={fieldErrors.tags}
      >
        <Input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="launch, ugc, cold-traffic"
        />
      </Field>

      <Field label="Notes" hint="Optional." error={fieldErrors.notes}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Hooks, variations, briefs, links — anything the team should remember."
          className="min-h-[100px]"
        />
      </Field>

      {error && (
        <div className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          type="button"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || !name.trim() || !productId}>
          {isPending ? "Creating…" : "Create creative"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {(hint || error) && (
        <p className={error ? "text-[11px] text-neg" : "text-[11px] text-ink-3"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
