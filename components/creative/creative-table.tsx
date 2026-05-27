"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DownloadCsvButton } from "@/components/ui/download-csv-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkUpdateStatus } from "@/app/actions/creative";
import type { CreativeListRow } from "@/db/queries/creatives";
import { rowsToCsv, todayStamp, type CsvColumn } from "@/lib/csv-export";
import { isoDate, usd } from "@/lib/format";

const CSV_COLUMNS: CsvColumn<CreativeListRow>[] = [
  { key: "name", label: "Creative", value: (r) => r.name },
  { key: "product", label: "Product", value: (r) => r.productName },
  { key: "type", label: "Type", value: (r) => r.type },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "launchDate", label: "Launch date", value: (r) => r.launchDate ?? "" },
  { key: "spend30d", label: "30d spend (USD)", value: (r) => r.spend30d },
  { key: "tags", label: "Tags", value: (r) => r.tags.join("; ") },
];

const TYPE_LABEL: Record<CreativeListRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const statusClass: Record<CreativeListRow["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

const BULK_STATUSES: Array<{ value: CreativeListRow["status"]; label: string }> = [
  { value: "active", label: "Activate" },
  { value: "paused", label: "Pause" },
  { value: "draft", label: "Mark as draft" },
  { value: "archived", label: "Archive" },
];

export function CreativeTable({ rows }: { rows: CreativeListRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CreativeListRow["status"] | "">("");
  const [isPending, startTransition] = useTransition();

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(allIds) : new Set());
  };
  const clearSelection = () => setSelected(new Set());

  const applyBulkStatus = () => {
    if (!bulkStatus || selected.size === 0) return;
    const ids = Array.from(selected);
    const targetStatus = bulkStatus;
    startTransition(async () => {
      const res = await bulkUpdateStatus({ ids, status: targetStatus });
      if (!res.ok) {
        toast.error(res.error ?? "Bulk update failed");
        return;
      }
      toast.success(
        `${res.updated ?? ids.length} creatives → ${targetStatus}`,
      );
      setSelected(new Set());
      setBulkStatus("");
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-ink-2 text-sm">No creatives match these filters.</p>
      </div>
    );
  }

  const csvContent = rowsToCsv(rows, CSV_COLUMNS);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <DownloadCsvButton
          csvContent={csvContent}
          filename={`creatives-${todayStamp()}.csv`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm num">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-ink-3 border-b border-line">
              <th className="font-medium pl-3 pr-2 py-2.5 w-8">
                <Checkbox
                  checked={
                    allSelected ? true : someSelected ? "indeterminate" : false
                  }
                  onCheckedChange={(v) => toggleAll(v === true)}
                  aria-label="Select all"
                />
              </th>
              <th className="font-medium px-3 py-2.5">Creative</th>
              <th className="font-medium px-3 py-2.5">Product</th>
              <th className="font-medium px-3 py-2.5">Type</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="font-medium px-3 py-2.5">Launch date</th>
              <th className="font-medium px-3 py-2.5 text-right">30d spend</th>
              <th className="font-medium px-3 py-2.5">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={
                  selected.has(r.id)
                    ? "bg-[var(--brand-soft)]/60 hover:bg-[var(--brand-soft)] transition-colors"
                    : "hover:bg-surface-2/60 transition-colors"
                }
              >
                <td className="pl-3 pr-2 py-2.5">
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) => toggleOne(r.id, v === true)}
                    aria-label={`Select ${r.name}`}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <Link
                    href={`/creatives/${encodeURIComponent(r.name)}`}
                    className="font-mono text-ink text-[13px] hover:text-brand transition-colors"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-ink-2">{r.productName}</td>
                <td className="px-3 py-2.5 text-ink-2">{TYPE_LABEL[r.type]}</td>
                <td className="px-3 py-2.5">
                  <Badge variant="outline" className={statusClass[r.status]}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-ink-2">
                  {r.launchDate ? isoDate(r.launchDate) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right text-ink">
                  {r.spend30d > 0 ? usd(r.spend30d) : "—"}
                </td>
                <td className="px-3 py-2.5 text-ink-2">
                  {r.tags.length === 0 ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <div className="flex items-center gap-1 flex-wrap">
                      {r.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center h-5 px-1.5 rounded text-[10px] bg-surface-2 border border-line text-ink-2"
                        >
                          {t}
                        </span>
                      ))}
                      {r.tags.length > 3 && (
                        <span className="text-[10px] text-ink-3">
                          +{r.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk-action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 flex items-center gap-3 px-4 py-3 rounded-lg border border-brand/40 bg-surface shadow-lg shadow-black/30">
          <span className="text-sm text-ink num">
            <span className="text-ink font-semibold">{selected.size}</span> selected
          </span>
          <Select
            value={bulkStatus}
            onValueChange={(v) => setBulkStatus(v as CreativeListRow["status"])}
          >
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Change status…" />
            </SelectTrigger>
            <SelectContent>
              {BULK_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            onClick={applyBulkStatus}
            disabled={isPending || !bulkStatus}
          >
            {isPending ? "Applying…" : "Apply"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearSelection}
            disabled={isPending}
            className="ml-auto"
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}
