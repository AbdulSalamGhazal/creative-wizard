"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/upload/dropzone";
import {
  previewBulkCreatives,
  commitBulkCreatives,
  type BulkPreview,
} from "@/app/actions/creative-bulk";

interface Props {
  /** Existing product names — shown as a hint and used in the CSV template. */
  products: string[];
}

export function BulkCreativeImport({ products }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  const onFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
  };

  const validate = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await previewBulkCreatives(fd);
      setPreview(res);
      if (!res.ok) toast.error(res.error ?? "Could not read the file");
    });
  };

  const create = () => {
    if (!file || !preview?.allValid) return;
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await commitBulkCreatives(fd);
      if (!res.ok) {
        toast.error(res.error ?? "Bulk create failed");
        // A race may have invalidated a name — re-validate to show fresh errors.
        const fresh = await previewBulkCreatives(fd);
        setPreview(fresh);
        return;
      }
      toast.success(`Created ${res.created ?? 0} creatives`);
      router.push("/creatives");
      router.refresh();
    });
  };

  const downloadTemplate = () => {
    const sampleProduct = products[0] ?? "Your Product";
    const lines = [
      "name,product,type,launch_date,tags",
      `URJ_VID_100,${sampleProduct},video,2026-05-01,launch;ugc`,
      `URJ_IMG_101,${sampleProduct},image,,evergreen`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "creatives-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Format guidance */}
      <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-ink">
            <Sparkles className="w-4 h-4 text-brand" />
            Expected columns
          </div>
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="w-3.5 h-3.5" />
            Download template
          </Button>
        </div>
        <ul className="text-[12px] text-ink-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <li><span className="font-mono text-ink">name</span> — required, unique</li>
          <li><span className="font-mono text-ink">product</span> — required, must match a product</li>
          <li><span className="font-mono text-ink">type</span> — video / image / slides (default video)</li>
          <li><span className="font-mono text-ink">launch_date</span> — optional (YYYY-MM-DD or DD/MM/YYYY)</li>
          <li><span className="font-mono text-ink">tags</span> — optional, <code>;</code> or <code>,</code> separated</li>
        </ul>
        {products.length > 0 && (
          <p className="text-[11px] text-ink-3">
            Valid products:{" "}
            <span className="text-ink-2">{products.join(" · ")}</span>
          </p>
        )}
      </div>

      <Dropzone file={file} onFile={onFile} disabled={isPending} />

      <div className="flex items-center gap-3">
        <Button type="button" onClick={validate} disabled={!file || isPending}>
          {isPending && !preview ? "Validating…" : "Validate file"}
        </Button>
        {preview?.ok && (
          <span className="text-xs text-ink-2 num">
            {preview.total} row{preview.total === 1 ? "" : "s"} ·{" "}
            <span className="text-pos">{preview.validCount} valid</span>
            {preview.errorCount > 0 && (
              <>
                {" · "}
                <span className="text-neg">{preview.errorCount} with errors</span>
              </>
            )}
          </span>
        )}
      </div>

      {/* Preview */}
      {preview?.ok && preview.rows.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-[12px] num">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
                  <th className="font-medium px-3 py-2 w-10">Row</th>
                  <th className="font-medium px-3 py-2 w-8"></th>
                  <th className="font-medium px-3 py-2">Name</th>
                  <th className="font-medium px-3 py-2">Product</th>
                  <th className="font-medium px-3 py-2">Type</th>
                  <th className="font-medium px-3 py-2">Tags / issue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className={r.ok ? "" : "bg-neg/[0.04]"}>
                    <td className="px-3 py-2 text-ink-3">{r.rowNumber}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-pos" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-neg" />
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink whitespace-nowrap">
                      {r.name || <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-2 whitespace-nowrap">
                      {r.productName || <span className="text-ink-3">—</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-2 capitalize">{r.type}</td>
                    <td className="px-3 py-2">
                      {r.ok ? (
                        <span className="text-ink-3">{r.tags.join(", ") || "—"}</span>
                      ) : (
                        <span className="text-neg">{r.errors.join(" ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.allValid ? (
            <Button type="button" onClick={create} disabled={isPending}>
              {isPending ? "Creating…" : `Create ${preview.validCount} creatives`}
            </Button>
          ) : (
            <p className="text-[12px] text-neg">
              Fix the {preview.errorCount} flagged row{preview.errorCount === 1 ? "" : "s"}{" "}
              and re-validate — it&apos;s all-or-nothing, nothing is created while any row has an error.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
