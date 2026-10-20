"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { int, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LANDING_CODE_MAX, LANDING_CODE_MARKER } from "@/lib/landing-code";
import {
  createLandingPage,
  deleteLandingPage,
  updateLandingPage,
} from "@/app/actions/landing-page";
import type { LandingPageRow } from "@/db/queries/landing-pages";

const plural = (n: number, word: string) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;

/** The link as a person reads it: no scheme, no trailing slash. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

type Editing = { mode: "create" } | { mode: "edit"; row: LandingPageRow };

/**
 * The landing-page registry behind an ad name's ` @code` suffix (the Library's
 * Landing pages tab). Add or edit in one dialog; delete only while no record
 * uses the page — once one does, the code is locked too, because the ads on
 * the platforms carry it.
 *
 * `canManage` false is the READ-ONLY view uploaders get (E023 sends them
 * here): the same list, with no add / edit / delete and no lock marks — the
 * lock is about editing, which they can't do anyway.
 */
export function LandingPagesTable({
  rows,
  canManage,
}: {
  rows: LandingPageRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<LandingPageRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const confirmDelete = () => {
    const row = deleting;
    if (!row) return;
    startDelete(async () => {
      const res = await deleteLandingPage(row.id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete the landing page.");
        return;
      }
      toast.success(`Deleted “${row.name}”`);
      setDeleting(null);
      router.refresh();
    });
  };

  const addButton = (
    <Button onClick={() => setEditing({ mode: "create" })}>
      <Plus className="w-4 h-4" />
      Add landing page
    </Button>
  );

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="text-sm text-ink">No landing pages yet.</p>
          {canManage ? (
            <>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                Add one, then end an ad&apos;s name with its code —{" "}
                <span className="font-mono text-ink-2">Promo_01 @ramadan</span> —
                and uploads file that ad&apos;s results under it.
              </p>
              <div className="mt-4 flex justify-center">{addButton}</div>
            </>
          ) : (
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
              Ask someone with “Manage landing pages” access to add one.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-3 num">{plural(rows.length, "landing page")}</p>
            {canManage && addButton}
          </div>
          {/* `relative` makes this scroll box the containing block for the
              sr-only labels inside the table — without it they are positioned
              against the page and widen it at 375px. */}
          <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm num">
              <thead>
                <tr className="text-left text-label text-ink-3 border-b border-line">
                  <th className="font-medium px-3 py-2.5">Landing page</th>
                  <th className="font-medium px-3 py-2.5">Code</th>
                  <th className="font-medium px-3 py-2.5">Link</th>
                  <th className="font-medium px-3 py-2.5 text-right">Creatives</th>
                  <th className="font-medium px-3 py-2.5">Added</th>
                  {canManage && (
                    <th className="font-medium px-3 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const locked = canManage && r.records > 0;
                  return (
                    <tr key={r.id} className="hover:bg-surface-2/60 transition-colors">
                      <td className="px-3 py-2">
                        <div
                          className="max-w-[10rem] truncate text-ink sm:max-w-[16rem]"
                          title={r.name}
                        >
                          {r.name}
                        </div>
                        {r.description && (
                          <div
                            className="max-w-[10rem] truncate text-xs text-ink-3 sm:max-w-[16rem]"
                            title={r.description}
                          >
                            {r.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-2">
                          @{r.code}
                          {locked && (
                            <span title={`Locked — used by ${plural(r.records, "record")}`}>
                              <Lock className="h-3 w-3 text-ink-3" aria-hidden />
                              <span className="sr-only">
                                {`Locked — used by ${plural(r.records, "record")}`}
                              </span>
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-[12rem] items-center gap-1 text-ink-2 hover:text-ink sm:max-w-[18rem]"
                          title={r.url}
                        >
                          <span className="truncate">{shortUrl(r.url)}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 text-ink-3" aria-hidden />
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2">{int(r.creatives)}</td>
                      <td className="px-3 py-2 text-ink-3 whitespace-nowrap">
                        {isoDate(r.createdAt)}
                      </td>
                      {canManage && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditing({ mode: "edit", row: r })}
                              className="text-ink-3 hover:text-ink"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </Button>
                            {/* Disabled while in use, and the title says why — the
                                records point here and the FK has no cascade. */}
                            <span
                              title={
                                locked
                                  ? `Used by ${plural(r.records, "record")}, so it can't be deleted`
                                  : undefined
                              }
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                aria-label={
                                  locked
                                    ? `Can't delete ${r.name}: used by ${plural(r.records, "record")}`
                                    : `Delete landing page ${r.name}`
                                }
                                onClick={() => setDeleting(r)}
                                disabled={locked || isDeleting}
                                className="text-ink-3 hover:text-neg"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </span>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <LandingPageDialog
          key={editing.mode === "edit" ? editing.row.id : "create"}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (isDeleting) return; // don't close mid-delete
          if (!o) setDeleting(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this landing page?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-ink">{deleting?.name}</span>{" "}
              <span className="font-mono">@{deleting?.code}</span> will be removed.
              Uploads will reject ads that still carry its code.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm" disabled={isDeleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting…" : "Delete landing page"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Add or edit one landing page. A failed save keeps every typed value. */
function LandingPageDialog({
  editing,
  onClose,
}: {
  editing: Editing;
  onClose: () => void;
}) {
  const router = useRouter();
  const initial = editing.mode === "edit" ? editing.row : null;
  const locked = (initial?.records ?? 0) > 0;
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const typedCode = code.trim().replace(/^@/, "");
  const ready = Boolean(name.trim() && typedCode && url.trim());
  const dirty =
    !initial ||
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
      const values = { name, code, url, description };
      const res = initial
        ? await updateLandingPage({ id: initial.id, ...values })
        : await createLandingPage(values);
      if (!res.ok) {
        setError(res.error ?? "Could not save the landing page.");
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      toast.success(initial ? "Landing page updated" : `Added @${typedCode}`);
      onClose();
      router.refresh();
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
          <Field label="Name" htmlFor="lp-name">
            <Input
              id="lp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramadan offer"
              maxLength={255}
              aria-invalid={Boolean(fieldErrors.name)}
              autoFocus
            />
          </Field>

          <Field
            label="Code"
            htmlFor="lp-code"
            tip={
              locked
                ? `Used by ${plural(initial?.records ?? 0, "record")}, so the code is locked — the ads on the platforms carry it.`
                : undefined
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
            <div className="text-[10px] uppercase tracking-wide text-ink-3 mb-0.5">
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

function Field({
  label,
  htmlFor,
  tip,
  children,
}: {
  label: string;
  htmlFor: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {tip && <InfoTip label={`About the ${label.toLowerCase()}`}>{tip}</InfoTip>}
      </div>
      {children}
    </div>
  );
}
