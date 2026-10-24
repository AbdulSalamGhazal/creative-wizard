"use client";

import { useMemo, useRef, useState, useTransition } from "react";
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
import { safeAction } from "@/lib/action-failure";
import { toastActionFailure } from "@/lib/action-toast";
import type { StoreCleanupPreview } from "@/db/queries/store";
import { sar, int, isoDate, plural } from "@/lib/format";
import { defaultDateRange } from "@/lib/date-presets";
import { pillClass } from "@/components/filters/filter-pill";
import { TypeToConfirm, confirmMatches } from "@/components/ui/type-to-confirm";

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
  const [isPending, startTransition] = useTransition();

  // Seed the scope to the last 7 days (matches the ads tool). Still
  // preview-then-confirm, so a bounded default is safe.
  const [from, setFrom] = useState<string | null>(() => defaultDateRange().from);
  const [to, setTo] = useState<string | null>(() => defaultDateRange().to);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [orderIdText, setOrderIdText] = useState("");

  /**
   * The preview AND the exact filters it counted (W1-7): the delete sends
   * those with the count shown, never the live ones.
   */
  const [preview, setPreview] = useState<
    (StoreCleanupPreview & { filters: typeof filters }) | null
  >(null);
  const [confirmText, setConfirmText] = useState("");
  /** Bumped by every filter change: a preview answering an older one is dropped. */
  const requestId = useRef(0);

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
    requestId.current += 1;
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
    const id = (requestId.current += 1);
    const counted = filters;
    startTransition(async () => {
      const res = await safeAction(() => previewStoreCleanupAction(counted));
      if (id !== requestId.current) return; // the filters moved on
      if (!res.ok || !("preview" in res) || !res.preview) {
        toastActionFailure(res, "Couldn't preview");
        return;
      }
      setPreview({ ...res.preview, filters: counted });
      setConfirmText("");
    });
  };

  const doDelete = () => {
    if (!preview) return;
    const { filters: counted, orders } = preview;
    startTransition(async () => {
      const res = await safeAction(() => runStoreCleanup({ ...counted, expectedRows: orders }));
      if (!res.ok) {
        toastActionFailure(res, "Couldn't delete those orders");
        return;
      }
      toast.success(`Deleted ${plural(res.deleted ?? 0, "order")}`);
      // Back to the default range the picker shows — never null, which the
      // pill reads as "Last 7 days" and the server as "all time".
      const range = defaultDateRange();
      requestId.current += 1;
      setFrom(range.from);
      setTo(range.to);
      setBatchId(null);
      setOrderIdText("");
      setPreview(null);
      setConfirmText("");
      // runStoreCleanup revalidated: this page arrived re-rendered in its
      // response (W2-1).
    });
  };

  const batchLabel =
    batchId === null
      ? "Any"
      : (batches.find((b) => b.id === batchId)?.fileName ?? "1 selected");

  const confirmed = confirmMatches(confirmText, "DELETE", true);

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
            <button type="button" className={pillClass(batchId !== null)}>
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
                <TypeToConfirm
                  className="flex-1 min-w-[200px]"
                  phrase="DELETE"
                  value={confirmText}
                  onChange={setConfirmText}
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={doDelete}
                  disabled={!confirmed || isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isPending ? "Deleting…" : `Delete ${plural(preview.orders, "order")}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


