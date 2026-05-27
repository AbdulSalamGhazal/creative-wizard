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
}

export function DownloadCsvButton({
  csvContent,
  filename,
  label = "Download CSV",
  disabled = false,
}: Props) {
  const onClick = () => downloadCsv(filename, csvContent);
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
