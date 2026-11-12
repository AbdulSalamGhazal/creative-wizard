"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "@/components/nav/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { ToneDialogTitle } from "@/components/ui/dialog-tone";
import { int, isoDate } from "@/lib/format";
import { deleteLandingPage } from "@/app/actions/landing-page";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { LandingPageRow } from "@/db/queries/landing-pages";
import { EmptyState } from "@/components/ui/empty-state";
import {
  LandingPageDialog,
  type LandingPageEditing as Editing,
  type ProductOption,
} from "@/components/landing-page/landing-page-dialog";

const plural = (n: number, word: string) => `${int(n)} ${word}${n === 1 ? "" : "s"}`;

/** The link as a person reads it: no scheme, no trailing slash. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");


/**
 * The landing-page registry behind an ad name's ` @code` suffix (the Library's
 * Landing pages tab). Add or edit in one dialog; delete only while no record
 * uses the page — once one does, the code is locked too, because the ads on
 * the platforms carry it. Every page sells ONE product (2026-10-29): the
 * dialog requires one, uploads refuse another product's ad (E024), and a page
 * from before that rule shows "Needs a product" until someone picks one.
 *
 * `canManage` false is the READ-ONLY view uploaders get (E023 sends them
 * here): the same list, with no add / edit / delete and no lock marks — the
 * lock is about editing, which they can't do anyway.
 */
export function LandingPagesTable({
  rows,
  products,
  canManage,
}: {
  rows: LandingPageRow[];
  /** The brand's active products — the dialog's Product picker. */
  products: ProductOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<LandingPageRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const confirmDelete = () => {
    const row = deleting;
    if (!row) return;
    startDelete(async () => {
      const res = await safeAction(() => deleteLandingPage(row.id));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't delete the landing page");
        return;
      }
      // The action revalidated: the list arrived re-rendered in its response.
      toast.success(`Deleted “${row.name}”`);
      setDeleting(null);
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
        <EmptyState
          title="No landing pages yet."
          hint={
            canManage ? (
              <>
                Add one, then end an ad&apos;s name with its code —{" "}
                <span className="font-mono text-ink-2">Promo_01 @ramadan</span> —
                and uploads file that ad&apos;s results under it.
              </>
            ) : (
              "Ask someone with “Manage landing pages” access to add one."
            )
          }
          action={canManage ? addButton : undefined}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-3 tabular-nums">{plural(rows.length, "landing page")}</p>
            {canManage && addButton}
          </div>
          {/* `relative` makes this scroll box the containing block for the
              sr-only labels inside the table — without it they are positioned
              against the page and widen it at 375px. */}
          <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-label text-ink-2 border-b border-line bg-surface-2/40">
                  <th className="font-medium px-3 py-2.5">Landing page</th>
                  <th className="font-medium px-3 py-2.5">Product</th>
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
                        {/* Its own page: results by platform, campaign and creative. */}
                        <Link
                          href={`/landing-pages/${encodeURIComponent(r.code)}`}
                          className="block max-w-[10rem] truncate text-ink hover:underline underline-offset-2 sm:max-w-[16rem]"
                          title={r.name}
                        >
                          {r.name}
                        </Link>
                        {r.description && (
                          <div
                            className="max-w-[10rem] truncate text-xs text-ink-3 sm:max-w-[16rem]"
                            title={r.description}
                          >
                            {r.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.productName ? (
                          <span
                            className="block max-w-[9rem] truncate text-ink-2 sm:max-w-[14rem]"
                            title={r.productName}
                          >
                            {r.productName}
                          </span>
                        ) : (
                          // A page from before products joined the registry
                          // that the backfill couldn't settle — the next edit
                          // must pick one.
                          <span
                            className="whitespace-nowrap text-xs text-behind"
                            title="Registered before pages had a product and its records point to more than one, or none. Edit it and pick the product it sells."
                          >
                            Needs a product
                          </span>
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
          products={products}
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
            <ToneDialogTitle tone="destructive">Delete this landing page?</ToneDialogTitle>
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
