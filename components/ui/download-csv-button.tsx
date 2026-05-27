"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";

interface Props<T> {
  filenamePrefix: string;
  rows: T[];
  columns: CsvColumn<T>[];
  label?: string;
}

export function DownloadCsvButton<T>({
  filenamePrefix,
  rows,
  columns,
  label = "Download CSV",
}: Props<T>) {
  const onClick = () => {
    const content = rowsToCsv(rows, columns);
    downloadCsv(`${filenamePrefix}-${todayStamp()}.csv`, content);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      disabled={rows.length === 0}
      className="text-ink-3 hover:text-ink"
    >
      <Download className="w-3 h-3" />
      {label}
    </Button>
  );
}
