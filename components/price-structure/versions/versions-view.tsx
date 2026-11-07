"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CopyPlus, Download, ExternalLink, FolderOpen, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TypeToConfirm, confirmMatches } from "@/components/ui/type-to-confirm";
import { useTableColumns } from "@/components/ui/use-table-columns";
import { TABLE_KEYS } from "@/lib/table-columns";
import type { VersionRow } from "@/db/queries/price-structure";
import type { CreateVersionInput } from "@/validators/price-structure";
import { VERSION_NAME_MAX, VERSION_NOTES_MAX } from "@/validators/price-structure";
import { evaluateAll } from "@/price-structure/engine/all-offers";
import { blend, planLines, roasFor } from "@/price-structure/engine/blend";
import { exportFileName, IMPORT_ERROR, toExport } from "@/price-structure/engine/export-import";
import { isRoasTargetMetric } from "@/price-structure/engine/targets";
import { pct2, roas2 } from "@/price-structure/format";
import { Field, TextField } from "../fields";
import { PsPageHeader } from "../ps-page-header";
import { SectionCard } from "../section-card";
import { useVersion } from "../version-provider";

type StartFrom = "copy" | "sample" | "blank";

const INTRO = (
  <>
    <p>
      A version is a complete, separate copy of everything: products, offers, settings, targets, plans and actual periods. Changes save automatically to the version that&rsquo;s open. Switch to another one any time, and come back later to find it as you left it.
    </p>
    <p className="mt-2">
      Each browser tab has its own version open, so you can work on two side by side. Switching version in one tab doesn&rsquo;t change the others. Open the same version in two tabs and they stay in step.
    </p>
  </>
);

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const DAY = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const STAMP = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Summary numbers of one version, for the All versions table. */
function summarise(row: VersionRow) {
  const data = row.data;
  const { rows, roasTarget } = evaluateAll(data);
  const offers = rows.length;
  const avgMargin = offers ? rows.reduce((s, r) => s + (Number.isFinite(r.r.margin) ? r.r.margin : 0), 0) / offers : NaN;
  const plan = data.plans.find((p) => p.id === data.activePlanId) ?? data.plans[0];
  const b = plan ? blend(planLines(plan, data.products, data.settings), data.settings) : null;
  const baked = b && b.orders > 0 ? b.platformRoas : NaN;
  const target = roasTarget && isRoasTargetMetric(roasTarget.metric) ? roasTarget : null;
  const roasA = b && b.orders > 0 && target ? roasFor(b, target.metric as "margin" | "profit" | "profitPerUnit", target.a) : NaN;
  const roasB = b && b.orders > 0 && target ? roasFor(b, target.metric as "margin" | "profit" | "profitPerUnit", target.b) : NaN;
  return { products: data.products.length, offers, avgMargin, baked, roasA, roasB, periods: data.actuals.length };
}

/** Versions (brief §6.5): manage the brand's complete copies. */
export function VersionsView() {
  const { access, versions, open, updateMeta, switchTo, openInNewTab, create, remove, flush } = useVersion();
  const manage = access.versions;
  const ids = { name: useId(), notes: useId(), newName: useId(), from: useId() };
  const [newName, setNewName] = useState("");
  const [from, setFrom] = useState<StartFrom>("copy");
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<VersionRow | null>(null);
  const [typed, setTyped] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const createAndOpen = (input: CreateVersionInput) =>
    run("create", async () => {
      await flush();
      const res = await create(input);
      if (!res) return;
      if (res.warnings.length) for (const w of res.warnings) toast.warning(w);
      switchTo(res.version.id);
    });

  const saveCopy = () =>
    open &&
    run("copy", async () => {
      await flush();
      const name = `${open.name} · ${STAMP.format(new Date())}`;
      const res = await create({ name, notes: open.notes, from: { kind: "copy", id: open.id } });
      if (res) toast.success(`Saved “${name}”. Open it from the list below whenever you want to go back to this point.`);
    });

  const duplicate = (row: VersionRow) =>
    run(`dup-${row.id}`, async () => {
      await flush();
      const res = await create({ name: `${row.name} (copy)`, notes: row.notes, from: { kind: "copy", id: row.id } });
      if (res) toast.success(`Created “${res.version.name}”`);
    });

  const exportRow = (row: VersionRow) => {
    const now = new Date();
    downloadJson(exportFileName(row.name, now), toExport(row.name, row.data, now));
  };

  const importFile = async (file: File) => {
    let payload: unknown;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      toast.error(IMPORT_ERROR);
      return;
    }
    await createAndOpen({ name: "", notes: "", from: { kind: "import", payload, fileName: file.name } });
  };

  const confirmDelete = () =>
    toDelete &&
    run(`del-${toDelete.id}`, async () => {
      const ok = await remove(toDelete.id);
      if (ok) toast.success(`Deleted “${toDelete.name}”`);
      setToDelete(null);
      setTyped("");
    });

  const columns = useMemo<DataColumn<VersionRow>[]>(
    () => [
      {
        key: "version",
        label: "Version",
        pinned: true,
        render: (r) => {
          const current = r.id === open?.id;
          return (
            <span className="block min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-ink" dir="auto">{r.name}</span>
                {current && <span className="shrink-0 rounded border border-brand/50 px-1 text-[10px] text-brand">This tab</span>}
              </span>
              <span className="block truncate text-[10px] text-ink-3" dir="auto">{r.notes || `Created ${DAY.format(new Date(r.createdAt))}`}</span>
            </span>
          );
        },
      },
      { key: "products", label: "Products", align: "right", render: (r) => <span className="tabular-nums">{summarise(r).products}</span> },
      { key: "offers", label: "Offers", align: "right", render: (r) => <span className="tabular-nums">{summarise(r).offers}</span> },
      { key: "avg", label: "Avg CML %", align: "right", render: (r) => <span className="tabular-nums">{pct2(summarise(r).avgMargin)}</span> },
      { key: "baked", label: "Baked-in ROAS", align: "right", render: (r) => <span className="tabular-nums">{roas2(summarise(r).baked)}</span> },
      {
        key: "roasAB",
        label: "ROAS for A / B",
        align: "right",
        render: (r) => {
          const s = summarise(r);
          return <span className="tabular-nums">{roas2(s.roasA)} / {roas2(s.roasB)}</span>;
        },
      },
      { key: "periods", label: "Actual periods", align: "right", render: (r) => <span className="tabular-nums">{summarise(r).periods}</span> },
      { key: "opened", label: "Last opened", align: "right", render: (r) => <span className="tabular-nums text-ink-2">{WHEN.format(new Date(r.openedAt))}</span> },
      {
        key: "actions",
        label: "Actions",
        align: "right",
        lockedVisible: true,
        render: (r) => {
          const current = r.id === open?.id;
          return (
            <span className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              {!current && (
                <Button type="button" size="xs" variant="ghost" onClick={() => switchTo(r.id)} title="Open in this tab">
                  <FolderOpen aria-hidden /> Open here
                </Button>
              )}
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Open in a new tab" title="New tab" onClick={() => openInNewTab(r.id)}>
                <ExternalLink aria-hidden />
              </Button>
              {manage && (
                <Button type="button" size="icon-xs" variant="ghost" aria-label="Duplicate" title="Duplicate" disabled={busy !== null} onClick={() => void duplicate(r)}>
                  {busy === `dup-${r.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <CopyPlus aria-hidden />}
                </Button>
              )}
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Export to JSON" title="Export" onClick={() => exportRow(r)}>
                <Download aria-hidden />
              </Button>
              {manage && (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Delete version"
                  title={current ? "Open in this tab. Switch this tab to another version first." : "Delete"}
                  disabled={current || busy !== null}
                  className="text-neg hover:text-neg"
                  onClick={() => setToDelete(r)}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open?.id, busy, manage],
  );
  const hideable = columns.filter((c) => !c.pinned && !c.lockedVisible).map((c) => c.key);
  const cols = useTableColumns({ tableKey: TABLE_KEYS.PS_VERSIONS, hideable, defaults: columns.filter((c) => !c.pinned).map((c) => c.key) });

  if (!open) return <PsPageHeader title="Versions" info={INTRO} />;

  return (
    <>
      <PsPageHeader title="Versions" info={INTRO} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Open in this tab" subtitle={`Opened ${WHEN.format(new Date(open.openedAt))}${manage ? " · saving automatically" : ""}`} contentClassName="space-y-3">
          <fieldset disabled={!manage} className="min-w-0 space-y-3">
            <Field label="Name" htmlFor={ids.name}>
              <TextField id={ids.name} value={open.name} onChange={(v) => updateMeta({ name: v.slice(0, VERSION_NAME_MAX) })} />
            </Field>
            <Field label="Notes" htmlFor={ids.notes}>
              <Textarea id={ids.notes} dir="auto" rows={2} value={open.notes} maxLength={VERSION_NOTES_MAX} placeholder="What is this version for?" onChange={(e) => updateMeta({ notes: e.target.value })} className="text-sm" />
            </Field>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            {manage && (
              <Button type="button" size="sm" className="h-8 text-xs" disabled={busy !== null} onClick={() => void saveCopy()}>
                {busy === "copy" ? <Loader2 className="animate-spin" aria-hidden /> : <CopyPlus aria-hidden />}
                Save a copy
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => exportRow(open)}>
              <Download aria-hidden /> Export to JSON
            </Button>
          </div>
          {manage ? (
            <p className="text-[11px] text-ink-3">&ldquo;Save a copy&rdquo; keeps a snapshot of how things are now. You stay in this version.</p>
          ) : (
            <p className="text-[11px] text-ink-3">Renaming, copying and creating versions needs the Manage versions permission.</p>
          )}
        </SectionCard>
        {manage && (
        <SectionCard title="Start a new version" subtitle="Creates the version and opens it in this tab. Everything you've done so far stays saved in the current one." contentClassName="space-y-3">
          <Field label="Name" htmlFor={ids.newName}>
            <TextField id={ids.newName} value={newName} onChange={setNewName} placeholder="e.g. Ramadan pricing" />
          </Field>
          <Field label="Start from" htmlFor={ids.from}>
            <Select value={from} onValueChange={(v) => setFrom(v as StartFrom)}>
              <SelectTrigger id={ids.from} size="sm" className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">
                  Copy of &ldquo;<span dir="auto">{open.name}</span>&rdquo;
                </SelectItem>
                <SelectItem value="sample">Sample data</SelectItem>
                <SelectItem value="blank">Blank</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={busy !== null}
              onClick={() =>
                void createAndOpen({
                  name: newName.trim(),
                  notes: "",
                  from: from === "copy" ? { kind: "copy", id: open.id } : { kind: from },
                })
              }
            >
              {busy === "create" ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              Create and open
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden /> Import JSON as a new version…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import JSON as a new version"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </div>
        </SectionCard>
        )}
      </div>
      <SectionCard title="All versions" subtitle="Each version is summarised with its own settings and active plan." contentClassName="px-0">
        <DataTable<VersionRow> columns={columns} rows={versions} rowKey={(r) => r.id} minWidthClass="min-w-[1000px]" {...cols.tableProps} />
      </SectionCard>
      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && busy === null && (setToDelete(null), setTyped(""))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete version &ldquo;<span dir="auto">{toDelete?.name}</span>&rdquo;?
            </DialogTitle>
            <DialogDescription>This can&rsquo;t be undone. Export it first if you may want it back.</DialogDescription>
          </DialogHeader>
          {toDelete && <TypeToConfirm phrase={toDelete.name} value={typed} onChange={setTyped} disabled={busy !== null} />}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => (setToDelete(null), setTyped(""))} disabled={busy !== null}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!toDelete || !confirmMatches(typed, toDelete.name) || busy !== null} onClick={() => void confirmDelete()}>
              {busy?.startsWith("del-") ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
