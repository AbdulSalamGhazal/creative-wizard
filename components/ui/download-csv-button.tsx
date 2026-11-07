"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv-export";

interface Props {
  /** Pre-built CSV string (compute server-side and pass as a plain prop). */
  csvContent: string;
  filename: string;
  label?: string;
  disabled?: boolean;
  /**
   * The table-corner form (R-084): a 28px icon button beside the Columns
   * control, its label kept as `aria-label` and `title`.
   */
  iconOnly?: boolean;
}

export function DownloadCsvButton({
  csvContent,
  filename,
  label = "Download CSV",
  disabled = false,
  iconOnly = false,
}: Props) {
  const onClick = () => downloadCsv(filename, csvContent);
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || !csvContent}
        title={label}
        aria-label={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      disabled={disabled || !csvContent}
      className="text-ink-3 hover:text-ink"
    >
      <Download className="w-3 h-3" />
      {label}
    </Button>
  );
}
