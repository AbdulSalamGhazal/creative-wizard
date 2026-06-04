"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/filters/date-range-picker";
import { previewCleanupAction, runCleanup } from "@/app/actions/cleanup";
import type { CleanupPreview } from "@/db/queries/cleanup";
import { usd, int } from "@/lib/format";
import { defaultDateRange } from "@/lib/date-presets";
import { cn } from "@/lib/utils";

type Platform = "instagram" | "facebook" | "tiktok" | "snapchat" | "google";

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "snapchat", label: "Snapchat" },
  { value: "google", label: "Google" },
];

interface Props {
  products: Array<{ id: string; name: string }>;
  creatives: Array<{ id: string; name: string; productName: string }>;
}

/**
 * Admin record-cleanup tool. Build a selection (platform / date range /
 * product / creative — combined with AND), preview the exact impact, then
 * permanently delete after a typed confirmation. Hard delete is a sanctioned,
 * audit-logged exit path for performance_records.
 */
export function CleanupTool({ products, creatives }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [platforms, setPlatforms] = useState<Platform[]>([]);
  // Seed the scope to the last 7 days (matches the picker default everywhere).
  // It's still preview-then-confirm, so a bounded default is safe.
  const [from, setFrom] = useState<string | null>(() => defaultDateRange().from);
  const [to, setTo] = useState<string | null>(() => defaultDateRange().to);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [creativeIds, setCreativeIds] = useState<string[]>([]);

  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const hasFilter =
    platforms.length > 0 ||
    (!!from && !!to) ||
    productIds.length > 0 ||
    creativeIds.length > 0;

  // Any filter change invalidates a stale preview.
  const resetPreview = () => {
    setPreview(null);
    setConfirmText("");
  };

  const filters = useMemo(
    () => ({
      platforms,
      from: from ?? undefined,
      to: to ?? undefined,
      productIds,
      creativeIds,
    }),
    [platforms, from, to, productIds, creativeIds],
  );

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    resetPreview();
  };

  const doPreview = () => {
    startTransition(async () => {
      const res = await previewCleanupAction(filters);
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
      const res = await runCleanup(filters);
      if (!res.ok) {
        toast.error(res.error ?? "Delete failed");
        return;
      }
      toast.success(`Deleted ${res.deleted ?? 0} records`);
      // Reset the whole form.
      setPlatforms([]);
      setFrom(null);
      setTo(null);
      setProductIds([]);
      setCreativeIds([]);
      setPreview(null);
      setConfirmText("");
      router.refresh();
    });
  };

  const productLabel =
    productIds.length === 0
      ? "Any"
      : productIds.length === 1
        ? (products.find((p) => p.id === productIds[0])?.name ?? "1")
        : `${productIds.length} selected`;
  const creativeLabel =
    creativeIds.length === 0
      ? "Any"
      : `${creativeIds.length} selected`;

  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <div className="rounded-lg border border-neg/30 bg-neg/[0.03] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-neg" />
        <h2 className="text-sm font-medium text-ink">Clean up records</h2>
        <span className="text-[11px] text-ink-3">
          Editors & admins · permanent · audit-logged
        </span>
      </div>
      <p className="text-[12px] text-ink-2">
        Permanently delete performance records matching a selection. Filters
        combine with AND. Preview the impact, then confirm — this cannot be
        undone (unlike a batch rollback).
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Platforms */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={pill(platforms.length > 0)}>
              <span className="text-ink-3">Platforms</span>
              <span className="text-ink">
                {platforms.length === 0 ? "Any" : `${platforms.length} selected`}
              </span>
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Platforms</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PLATFORMS.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.value}
                checked={platforms.includes(p.value)}
                onCheckedChange={() => toggle(platforms, p.value, setPlatforms)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Date range */}
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
            resetPreview();
          }}
        />

        {/* Products */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={pill(productIds.length > 0)}>
              <span className="text-ink-3">Products</span>
              <span className="text-ink">{productLabel}</span>
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Products</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {products.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={productIds.includes(p.id)}
                onCheckedChange={() => toggle(productIds, p.id, setProductIds)}
                onSelect={(e) => e.preventDefault()}
              >
                {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Creatives (searchable) */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={pill(creativeIds.length > 0)}>
              <span className="text-ink-3">Creatives</span>
              <span className="text-ink">{creativeLabel}</span>
              <ChevronDown className="w-3 h-3 text-ink-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="p-0 w-80">
            <Command
              filter={(value, search) =>
                value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
              }
            >
              <CommandInput placeholder="Search by name or product…" />
              <CommandList className="max-h-72">
                <CommandEmpty>No creatives found.</CommandEmpty>
                {creatives.map((c) => {
                  const checked = creativeIds.includes(c.id);
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.productName}`}
                      onSelect={() => toggle(creativeIds, c.id, setCreativeIds)}
                    >
                      <Check
                        className={cn(
                          "w-3.5 h-3.5 shrink-0 text-brand",
                          checked ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-[12px] truncate">
                        {c.name}
                      </span>
                      <span className="ml-auto text-[11px] text-ink-3 truncate">
                        {c.productName}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={doPreview}
          disabled={!hasFilter || isPending}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-line bg-surface text-xs text-ink hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending && !preview ? "Previewing…" : "Preview impact"}
        </button>
      </div>

      {!hasFilter && (
        <p className="text-[11px] text-ink-3">
          Select at least one filter to preview.
        </p>
      )}

      {/* Preview + confirm */}
      {preview && (
        <div className="rounded-md border border-line bg-surface p-3 space-y-3">
          {preview.rows === 0 ? (
            <p className="text-sm text-ink-2">
              Nothing matches that selection.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-ink">
                  <span className="num font-semibold">{int(preview.rows)}</span>{" "}
                  <span className="text-ink-3">rows</span>
                </span>
                <span className="text-ink">
                  <span className="num">{usd(preview.spend)}</span>{" "}
                  <span className="text-ink-3">spend</span>
                </span>
                <span className="text-ink">
                  <span className="num">{int(preview.creatives)}</span>{" "}
                  <span className="text-ink-3">creatives</span>
                </span>
                {preview.from && preview.to && (
                  <span className="text-ink-3 num text-[12px]">
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
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={!confirmed || isPending}
                  className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-neg/50 bg-neg/10 text-xs text-neg hover:bg-neg/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isPending ? "Deleting…" : `Delete ${int(preview.rows)} rows`}
                </button>
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
