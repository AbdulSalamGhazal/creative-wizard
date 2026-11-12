"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { int } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LANDING_CODE_MAX, LANDING_CODE_MARKER } from "@/lib/landing-code";
import { createLandingPage, updateLandingPage } from "@/app/actions/landing-page";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { LandingPageRow } from "@/db/queries/landing-pages";

const plural = (n: number, word: string) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;

export type LandingPageEditing = { mode: "create" } | { mode: "edit"; row: LandingPageRow };
export type ProductOption = { id: string; name: string };

/**
 * The landing-page add / edit dialog — ONE form, shared by the Library's
 * Landing pages tab and a landing page's own detail page (2026-11-12).
 */
/** Add or edit one landing page. A failed save keeps every typed value. */
export function LandingPageDialog({
  editing,
  products,
  onClose,
  onSaved,
}: {
  editing: LandingPageEditing;
  products: ProductOption[];
  onClose: () => void;
  /** After a successful save, with the code as saved (without the `@`) —
   *  the detail page follows a changed code to its new address. */
  onSaved?: (code: string) => void;
}) {
  const initial = editing.mode === "edit" ? editing.row : null;
  const locked = (initial?.records ?? 0) > 0;
  // The product locks with the code once records use the page — unless the
  // page has none yet (the post-backfill "Needs a product" path), when the
  // whole point of the edit is to give it one.
  const productLocked = locked && initial?.productId !== null;
  const [productId, setProductId] = useState(initial?.productId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const typedCode = code.trim().replace(/^@/, "");
  const ready = Boolean(productId && name.trim() && typedCode && url.trim());
  const dirty =
    !initial ||
    productId !== (initial.productId ?? "") ||
    name !== initial.name ||
    code !== initial.code ||
    url !== initial.url ||
    description !== (initial.description ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !dirty) return;
    setError(null);
    setFieldErrors({});
    start(async () => {
      const values = { productId, name, code, url, description };
      const id = initial?.id;
      const res = id
        ? await safeAction(() => updateLandingPage({ id, ...values }))
        : await safeAction(() => createLandingPage(values));
      if (!res.ok) {
        // The dialog stays open with every typed field.
        toastActionFailure(res, "Couldn't save the landing page", { inline: setError });
        setFieldErrors(("fieldErrors" in res && res.fieldErrors) || {});
        return;
      }
      toast.success(initial ? "Landing page updated" : `Added @${typedCode}`);
      onClose();
      onSaved?.(typedCode);
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (pending) return; // don't close mid-save
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit landing page" : "Add landing page"}</DialogTitle>
          <DialogDescription className="sr-only">
            A landing page&apos;s code is what an ad name ends with to send its
            results here.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Product"
            htmlFor="lp-product"
            tip={
              <InfoTip label="About the product">
                {productLocked
                  ? `Used by ${plural(initial?.records ?? 0, "record")}, so the product is locked — those records were accepted as this product's.`
                  : "Uploads refuse an ad whose creative belongs to another product, so this page compares with its own product's page on Trends → LPs."}
              </InfoTip>
            }
          >
            <Select
              value={productId}
              onValueChange={setProductId}
              disabled={productLocked || products.length === 0}
            >
              <SelectTrigger
                id="lp-product"
                aria-invalid={Boolean(fieldErrors.productId)}
                className="w-full"
              >
                <SelectValue
                  placeholder={products.length === 0 ? "No active products" : "Pick a product"}
                />
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

          <Field label="Name" htmlFor="lp-name">
            <Input
              id="lp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramadan offer"
              maxLength={255}
              aria-invalid={Boolean(fieldErrors.name)}
              autoFocus={Boolean(productId)}
            />
          </Field>

          <Field
            label="Code"
            htmlFor="lp-code"
            tip={
              locked ? (
                <InfoTip label="About the code">
                  {`Used by ${plural(initial?.records ?? 0, "record")}, so the code is locked — the ads on the platforms carry it.`}
                </InfoTip>
              ) : undefined
            }
          >
            <div className="relative">
              <span
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-ink-3"
                aria-hidden
              >
                @
              </span>
              <Input
                id="lp-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ramadan"
                maxLength={LANDING_CODE_MAX + 1}
                disabled={locked}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(fieldErrors.code)}
                // The text starts right where the `@` ends (one mono glyph
                // past left-3), so the field reads `@ramadan`, never
                // `@ ramadan` — the very spacing uploads refuse (E022).
                className="pl-[20px] font-mono"
              />
            </div>
          </Field>

          <Field label="Link" htmlFor="lp-url">
            <Input
              id="lp-url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              aria-invalid={Boolean(fieldErrors.url)}
            />
          </Field>

          <Field label="Description" htmlFor="lp-description">
            <Textarea
              id="lp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              maxLength={200}
              rows={2}
              aria-invalid={Boolean(fieldErrors.description)}
            />
          </Field>

          <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
            <div className="text-label text-ink-3 mb-0.5">
              Ad name
            </div>
            <div className="font-mono text-sm text-ink break-all">
              <span className="text-ink-3">Creative name</span>
              {LANDING_CODE_MARKER}
              <span className={cn(!typedCode && "text-ink-3")}>{typedCode || "code"}</span>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-neg/30 bg-neg/5 px-3 py-2 text-xs text-ink"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ready || !dirty}>
              {pending ? "Saving…" : initial ? "Save changes" : "Add landing page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
