"use client";

import { useState } from "react";
import { Download, FilePlus2, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dropzone } from "@/components/upload/dropzone";
import { readSheetRows } from "@/app/actions/sheet";
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import { downloadCsv } from "@/lib/csv-export";
import { actualsTemplate, blankPeriod, parseActualRows, splitCsv, templateFileName } from "@/price-structure/engine/actuals-csv";
import type { ActualPeriod, Plan, Product } from "@/price-structure/engine/types";
import { ConfirmDialog } from "../confirm-dialog";
import { SectionCard } from "../section-card";

export interface LoadNote {
  kind: "ok" | "error";
  text: string;
  warnings: string[];
}

/**
 * "Actual periods" (brief §6.4): download the template, upload a filled
 * file (CSV split here; a workbook goes through the house reader), or
 * enter by hand; then pick the period and the plan to compare with.
 */
export function ActualPeriodsCard({
  products,
  plans,
  periods,
  selectedId,
  compareId,
  onSelect,
  onCompare,
  onAdd,
  onDelete,
  readOnly = false,
}: {
  products: readonly Product[];
  plans: readonly Plan[];
  periods: readonly ActualPeriod[];
  selectedId: string | null;
  compareId: string | null;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onAdd: (period: ActualPeriod) => void;
  onDelete: (id: string) => void;
  /** A viewer: the template downloads and the selects work; nothing is added or deleted. */
  readOnly?: boolean;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<LoadNote | null>(null);
  const [confirm, setConfirm] = useState(false);
  const selected = periods.find((p) => p.id === selectedId) ?? null;

  const download = () => {
    const today = new Date();
    downloadCsv(templateFileName(today), actualsTemplate(products, today));
  };

  const load = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let rows: string[][];
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        rows = splitCsv(await file.text());
      } else {
        const form = new FormData();
        form.set("file", file);
        const res = await safeAction(() => readSheetRows(form));
        if (!res.ok || !res.rows) {
          toastActionFailure(res, "Couldn't read the file");
          return;
        }
        rows = res.rows;
      }
      const parsed = parseActualRows(rows, products);
      if (!parsed.ok) {
        setNote({ kind: "error", text: parsed.error, warnings: [] });
        return;
      }
      onAdd(parsed.period);
      setNote({ kind: "ok", text: `Loaded "${parsed.period.name}": ${parsed.matched} offer${parsed.matched === 1 ? "" : "s"} with orders.`, warnings: parsed.warnings });
      setUploadOpen(false);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Actual periods"
      info="Download the template, fill in orders per offer and the period's ad spend, then upload it. You can also enter numbers by hand."
      actions={
        <>
          <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={download} disabled={products.length === 0}>
            <Download aria-hidden /> Download template
          </Button>
          {!readOnly && (
            <>
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setUploadOpen(true)} disabled={products.length === 0}>
                <Upload aria-hidden /> Upload file
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => onAdd(blankPeriod(new Date()))}>
                <FilePlus2 aria-hidden /> Enter by hand
              </Button>
            </>
          )}
        </>
      }
      contentClassName="space-y-3"
    >
      {note && (
        <div className={note.kind === "ok" ? "rounded-md border border-pos/40 bg-pos/10 px-2 py-1.5 text-xs text-ink-2" : "rounded-md border border-neg/30 bg-neg/5 px-2 py-1.5 text-xs text-ink-2"} role="status">
          {note.text}
          {note.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-ink-3">
              {note.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {periods.length === 0 && readOnly ? (
        <p className="text-xs text-ink-3">No actual periods yet. Someone with the Edit permission uploads or enters one.</p>
      ) : periods.length === 0 ? (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-3">
          <li>Download the template.</li>
          <li>Fill in last month&rsquo;s orders per offer and ad spend.</li>
          <li>Upload it here.</li>
        </ol>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-ink-2">
            Period
            <Select value={selected?.id ?? ""} onValueChange={onSelect}>
              <SelectTrigger size="sm" className="h-8 min-w-44 text-xs" aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1 text-xs text-ink-2">
            Compare with plan
            <Select value={compareId ?? ""} onValueChange={onCompare}>
              <SelectTrigger size="sm" className="h-8 min-w-40 text-xs" aria-label="Compare with plan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span dir="auto">{p.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {selected && !readOnly && (
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs text-neg hover:text-neg" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden /> Delete period
            </Button>
          )}
        </div>
      )}
      <Dialog open={uploadOpen} onOpenChange={(o) => !busy && setUploadOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload a filled template</DialogTitle>
            <DialogDescription>A CSV or Excel file with the template&rsquo;s Product, Offer and Orders columns. Orders are placed orders.</DialogDescription>
          </DialogHeader>
          <Dropzone file={file} onFile={setFile} disabled={busy} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void load()} disabled={!file || busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              Load period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {selected && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Delete "${selected.name}"?`}
          description="Its orders and ad spend go. Plans are not affected."
          confirmLabel="Delete period"
          onConfirm={() => onDelete(selected.id)}
        />
      )}
    </SectionCard>
  );
}
