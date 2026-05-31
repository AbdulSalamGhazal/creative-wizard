"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
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
import { updateCreative } from "@/app/actions/creative";
import { TagInput } from "@/components/creative/tag-input";
import { ThumbnailUpload } from "@/components/creative/thumbnail-upload";

interface Props {
  creative: {
    id: string;
    name: string;
    productId: string;
    type: "video" | "image" | "slides";
    status: "draft" | "active" | "paused" | "archived";
    launchDate: string | null;
    notes: string | null;
    thumbnailUrl: string | null;
    tags: string[];
  };
  products: Array<{ id: string; name: string }>;
  allTags: string[];
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

export function CreativeEditForm({ creative, products, allTags }: Props) {
  const router = useRouter();
  const [name, setName] = useState(creative.name);
  const [productId, setProductId] = useState(creative.productId);
  const [type, setType] = useState(creative.type);
  const [status, setStatus] = useState(creative.status);
  const [launchDate, setLaunchDate] = useState(creative.launchDate ?? "");
  const [tagsInput, setTagsInput] = useState(creative.tags.join(", "));
  const [notes, setNotes] = useState(creative.notes ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(
    creative.thumbnailUrl,
  );
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
      const res = await updateCreative({
        id: creative.id,
        name: name.trim(),
        productId,
        type,
        status,
        launchDate: launchDate || null,
        notes: notes.trim() || null,
        thumbnailUrl: thumbnailUrl || null,
        tags,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
        setFieldErrors(res.fieldErrors ?? {});
        toast.error(res.error ?? "Could not save");
        return;
      }
      toast.success("Creative updated");
      router.push(`/creatives/${encodeURIComponent(res.name!)}`);
      router.refresh();
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href={`/creatives/${encodeURIComponent(creative.name)}`}
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to creative
        </Link>
        <h1 className="font-display text-4xl tracking-tight mt-3">
          Edit creative
        </h1>
        <p className="text-ink-2 text-sm mt-1">
          Renaming a creative keeps all its existing performance records
          attached — future CSV uploads must use the new name.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <Field
          label="Name"
          hint="Case- and whitespace-sensitive — matches CSV rows exactly."
          error={fieldErrors.name}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            required
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Product" error={fieldErrors.productId}>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Launch date"
            hint="Optional. Leave blank to clear."
            error={fieldErrors.launchDate}
          >
            <Input
              type="date"
              value={launchDate}
              onChange={(e) => setLaunchDate(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Thumbnail"
          hint="Optional. Shown on the board and detail page — auto-resized & optimized."
          error={fieldErrors.thumbnailUrl}
        >
          <ThumbnailUpload
            value={thumbnailUrl}
            onChange={setThumbnailUrl}
            disabled={isPending}
          />
        </Field>

        <Field
          label="Tags"
          hint="Comma-separated. Click a suggestion to append."
          error={fieldErrors.tags}
        >
          <TagInput
            value={tagsInput}
            onChange={setTagsInput}
            allTags={allTags}
          />
        </Field>

        <Field label="Notes" hint="Up to 5000 characters." error={fieldErrors.notes}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[140px]"
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
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
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
