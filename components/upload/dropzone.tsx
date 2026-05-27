"use client";

import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { FileSpreadsheet, Upload as UploadIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES } from "@/csv/parse";
import { cn } from "@/lib/utils";

interface Props {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function Dropzone({ file, onFile, disabled }: Props) {
  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        onFile(null);
        return;
      }
      const f = accepted[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      onDrop,
      multiple: false,
      maxSize: MAX_FILE_BYTES,
      accept: { "text/csv": [".csv"], "application/vnd.ms-excel": [".csv"] },
      disabled,
    });

  if (file) {
    return (
      <div className="rounded-lg border border-line bg-surface px-4 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-surface-2 flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-ink-2" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink truncate">{file.name}</div>
          <div className="text-xs text-ink-3 num">
            {prettyBytes(file.size)}
          </div>
        </div>
        {!disabled && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onFile(null)}
            className="text-ink-3 hover:text-ink"
          >
            <X className="w-3.5 h-3.5" />
            Remove
          </Button>
        )}
      </div>
    );
  }

  const sizeRejected = fileRejections.some((r) =>
    r.errors.some((e) => e.code === "file-too-large"),
  );
  const typeRejected = fileRejections.some((r) =>
    r.errors.some((e) => e.code === "file-invalid-type"),
  );

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "rounded-lg border-2 border-dashed transition-colors text-center px-6 py-12 cursor-pointer",
          isDragActive
            ? "border-brand/60 bg-[var(--brand-soft)]"
            : "border-line-2 bg-surface hover:border-line hover:bg-surface-2/60",
          disabled && "opacity-60 cursor-not-allowed",
        )}
      >
        <input {...getInputProps()} />
        <div className="mx-auto w-12 h-12 rounded-full bg-surface-2 border border-line flex items-center justify-center">
          <UploadIcon className="w-5 h-5 text-ink-2" />
        </div>
        <div className="mt-4 text-sm text-ink">
          {isDragActive ? "Drop the CSV here" : "Drag a CSV here, or click to browse"}
        </div>
        <div className="mt-1 text-xs text-ink-3">CSV files up to 10 MB</div>
      </div>
      {(sizeRejected || typeRejected) && (
        <div className="mt-2 text-xs text-neg">
          {sizeRejected
            ? "File exceeds the 10 MB limit."
            : "Only .csv files are accepted."}
        </div>
      )}
    </div>
  );
}
