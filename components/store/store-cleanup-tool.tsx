"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import {
  previewStoreCleanupAction,
  runStoreCleanup,
} from "@/app/actions/store-cleanup";
import type { StoreCleanupPreview } from "@/db/queries/store";
import { sar, int, isoDate } from "@/lib/format";
import { defaultDateRange } from "@/lib/date-presets";
import { cn } from "@/lib/utils";

export interface CleanupBatch {
  id: string;
  fileName: string;
  uploadedAt: string;
}

/**
 * Order-cleanup tool — the Store twin of the ads `CleanupTool`. Build a
 * selection (order-date range / upload batch / order ids — combined with AND),
 * preview the exact impact (count + SAR total + date span), then permanently
 * delete after a typed confirmation. Hard delete is a sanctioned, audit-logged
 * exit path for `store_orders` (alongside batch rollback).
 */
export function StoreCleanupTool({ batches }: { batches: CleanupBatch[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Seed the scope to the last 7 days (matches the ads tool). Still
  // preview-then-confirm, so a bounded default is safe.
  const [from, setFrom] = useState<string | null>(() => defaultDateRange().from);
  const [to, setTo] = useState<string | null>(() => defaultDateRange().to);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [orderIdText, setOrderIdText] = useState("");

  const [preview, setPreview] = useState<StoreCleanupPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");

  // Split the search box into an exact id or a comma-separated list.
  const orderIds = useMemo(
    () =>
      orderIdText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [orderIdText],
  );

  const hasFilter = (!!from && !!to) || !!batchId || orderIds.length > 0;

  const resetPreview = () => {
    setPreview(null);
    setConfirmText("");
  };

  const filters = useMemo(
    () => ({
      from: from ?? undefined,
      to: to ?? undefined,
      batchId: batchId ?? undefined,
      orderIds,
    }),
    [from, to, batchId, orderIds],
  );

  const doPreview = () => {
    startTransition(async () => {
      const res = await previewStoreCleanupAction(filters);
      if (!res.ok || !res.preview) {
        toast.error(res.error ?? "Could not preview");
        return;
      }
      setPreview(res.preview);
      setConfirmText("");
    });
  };

  const doDelete = () => {
    startTransition(async () => {
      const res = await runStoreCleanup(filters);
      if (!res.ok) {
        toast.error(res.error ?? "Delete failed");
        return;
      }
      toast.success(`Deleted ${res.deleted ?? 0} order${res.deleted === 1 ? "" : "s"}`);
      setFrom(null);
      setTo(null);
      setBatchId(null);
      setOrderIdText("");
      setPreview(null);
      setConfirmText("");
      router.refresh();
    });
  };

  const batchLabel =
    batchId === null
      ? "Any"
      : (batches.find((b) => b.id === batchId)?.fileName ?? "1 selected");

  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <div className="rounded-lg border border-neg/30 bg-neg/[0.03] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-neg" />
        <h2 className="text-sm font-medium text-ink">Clean up orders</h2>
        <span className="text-[11px] text-ink-3">
          Permanent · audit-logged
        </span>
      </div>
      <p className="text-xs text-ink-2">
        Permanently delete store orders matching a selection. Filters combine
        with AND. Preview the impact, then confirm — this cannot be undone
        (unlike a batch rollback). Amounts are in SAR.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Order-date range */}
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
            resetPreview();
          }}
        />

        {/* Upload batch (single select) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={pill(batchId !== null)}>
              <span className="text-ink-3">Batch</span>
              <span className="text-ink max-w-[180px] truncate">{batchLabel}</span>
              <ChevronDown className="w-3 h-3 text-ink-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Upload batch</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setBatchId(null);
                resetPreview();
              }}
            >
              Any batch
            </DropdownMenuItem>
            {batches.map((b) => (
              <DropdownMenuItem
                key={b.id}
                onSelect={() => {
                  setBatchId(b.id);
                  resetPreview();
                }}
                className="flex items-center gap-2"
              >
                <span className="font-mono text-xs truncate">{b.fileName}</span>
                <span className="ml-auto text-[11px] text-ink-3 num shrink-0">
                  {isoDate(b.uploadedAt)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Order-id search (exact or comma-separated list) */}
        <Input
          value={orderIdText}
          onChange={(e) => {
            setOrderIdText(e.target.value);
            resetPreview();
          }}
          placeholder="Order ID(s), comma-separated"
          className="h-8 w-64 max-w-full"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={doPreview}
          disabled={!hasFilter || isPending}
        >
          {isPending && !preview ? "Previewing…" : "Preview impact"}
        </Button>
      </div>

      {!hasFilter && (
        <p className="text-[11px] text-ink-3">
          Select at least one filter to preview.
        </p>
      )}

      {/* Preview + confirm */}
      {preview && (
        <div className="rounded-md border border-line bg-surface p-3 space-y-3">
          {preview.orders === 0 ? (
            <p className="text-sm text-ink-2">Nothing matches that selection.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-ink">
                  <span className="num font-semibold">{int(preview.orders)}</span>{" "}
                  <span className="text-ink-3">
                    order{preview.orders === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-ink">
                  <span className="num tabular-nums">{sar(preview.sumTotal)}</span>{" "}
                  <span className="text-ink-3">total</span>
                </span>
                {preview.from && preview.to && (
                  <span className="text-ink-3 num text-xs">
                    {preview.from} → {preview.to}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-line">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[11px] text-ink-3">
                    Type <span className="font-mono text-neg">DELETE</span> to
                    confirm
                  </label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="h-8 mt-1 max-w-[220px]"
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={doDelete}
                  disabled={!confirmed || isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isPending ? "Deleting…" : `Delete ${int(preview.orders)} orders`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function pill(active: boolean): string {
  return cn(
    "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
    active
      ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
      : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
  );
}
