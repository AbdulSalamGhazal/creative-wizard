"use client";

import Link from "next/link";
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
import { safeAction } from "@/lib/action-failure";
import { actionSettled } from "@/lib/router-queue";
import { toastActionFailure } from "@/lib/action-toast";
import { AngleInput } from "@/components/creative/angle-input";
import { ThumbnailUpload } from "@/components/creative/thumbnail-upload";
import { StagePicker } from "@/components/creative/stage-picker";
import { TYPE_OPTIONS } from "@/lib/palette";
import { useNavTransition } from "@/lib/nav-progress";
import { EmptyState } from "@/components/ui/empty-state";
import { useCan } from "@/components/auth/permissions-context";

interface Props {
  products: Array<{ id: string; name: string }>;
  allAngles: string[];
}

const TYPES = TYPE_OPTIONS;

export function CreativeCreateForm({ products, allAngles }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  // No defaults — force a deliberate pick so a left-on-default value can't slip through.
  const [productId, setProductId] = useState<string>("");
  const [type, setType] = useState<"" | "video" | "image" | "slides">("");
  const [launchDate, setLaunchDate] = useState("");
  const [anglesInput, setAnglesInput] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Navigations show the progress bar (W3-6).
  const [, startNav] = useNavTransition();
  const canAddProducts = useCan("catalog.products");

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Guard (also narrows `type` off the "" placeholder); the button is disabled
    // until these are set, so this only ever no-ops a stray submit.
    if (!name.trim() || !productId || !type) return;

    const angles = anglesInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      const res = await safeAction(() =>
        createCreative({
          name: name.trim(),
          productId,
          type,
          launchDate: launchDate || undefined,
          notes: notes.trim() || undefined,
          thumbnailUrl: thumbnailUrl || undefined,
          sourceLink: sourceLink.trim() || undefined,
          angles,
          stages,
        }),
      );
      if (!res.ok) {
        // Every field keeps what was typed (and the uploaded thumbnail).
        toastActionFailure(res, "Couldn't create the creative", { inline: setError });
        setFieldErrors(("fieldErrors" in res && res.fieldErrors) || {});
        return;
      }
      toast.success(`Created “${res.name}”`);
      // ONE render: the action doesn't revalidate; this navigation renders the
      // new creative's page fresh (W2-1) — once the router is done with the
      // action (lib/router-queue.ts).
      await actionSettled();
      const href = `/library/${encodeURIComponent(res.name!)}`;
      startNav(() => router.push(href));
    });
  };

  if (products.length === 0) {
    return (
      // No dead end (D24): the empty state links to where products are added.
      <EmptyState
        title="No products yet."
        hint="Add a product first so the new creative can be attributed."
        action={
          canAddProducts ? (
            <Button asChild size="sm">
              <Link href="/library?tab=products">Add a product</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="Name"
        hint="Case- and whitespace-sensitive — must match your CSV rows exactly."
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
            <SelectTrigger><SelectValue placeholder="Select a product…" /></SelectTrigger>
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
            <SelectTrigger><SelectValue placeholder="Select a type…" /></SelectTrigger>
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

      <Field label="Launch date" hint="Optional." error={fieldErrors.launchDate}>
        <Input
          type="date"
          value={launchDate}
          onChange={(e) => setLaunchDate(e.target.value)}
        />
      </Field>

      <Field
        label="Thumbnail"
        hint="Optional."
        error={fieldErrors.thumbnailUrl}
      >
        <ThumbnailUpload
          value={thumbnailUrl}
          onChange={setThumbnailUrl}
          disabled={isPending}
        />
      </Field>

      {/* Stage — the team's manual call on where this sits in the funnel.
          Optional: unassigned is a real state. */}
      <Field
        label="Stage"
        hint="Optional — where this sits in the funnel."
        error={fieldErrors.stages}
      >
        <StagePicker value={stages} onChange={setStages} disabled={isPending} />
      </Field>

      <Field
        label="Angles"
        hint="Comma-separated."
        error={fieldErrors.angles}
      >
        <AngleInput
          value={anglesInput}
          onChange={setAnglesInput}
          allAngles={allAngles}
        />
      </Field>

      <Field
        label="Source link"
        hint="Optional."
        error={fieldErrors.sourceLink}
      >
        <Input
          type="url"
          inputMode="url"
          value={sourceLink}
          onChange={(e) => setSourceLink(e.target.value)}
          placeholder="https://…"
          maxLength={2048}
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
        <Button
          type="submit"
          disabled={isPending || !name.trim() || !productId || !type}
        >
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
