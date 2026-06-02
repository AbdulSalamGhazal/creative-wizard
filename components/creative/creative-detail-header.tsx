"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ThumbnailUpload } from "@/components/creative/thumbnail-upload";
import { TagMultiSelect } from "@/components/creative/tag-multi-select";
import { patchCreative } from "@/app/actions/creative";
import { creativeStatusEnum, creativeTypeEnum } from "@/db/schema";
import { isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreativeDetail } from "@/db/queries/creatives";

type Status = CreativeDetail["status"];
type Type = CreativeDetail["type"];

const TYPE_LABEL: Record<Type, string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const TYPE_ICON: Record<Type, React.ComponentType<{ className?: string }>> = {
  video: Film,
  image: ImageIcon,
  slides: Layers,
};

const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
  archived: "Archived",
};

const STATUS_DOT: Record<Status, string> = {
  active: "var(--pos)",
  paused: "var(--warn)",
  draft: "var(--ink-3)",
  archived: "var(--ink-3)",
};

// Local-date <-> ISO helpers (avoid UTC off-by-one on the calendar).
function parseISO(s: string | null): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}
function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function CreativeDetailHeader({
  creative,
  allTags,
  products,
}: {
  creative: CreativeDetail;
  allTags: string[];
  products: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dateOpen, setDateOpen] = useState(false);

  // Saved baseline (updated on successful save) + live drafts.
  const [saved, setSaved] = useState({
    name: creative.name,
    productId: creative.productId,
    type: creative.type,
    status: creative.status,
    thumbnailUrl: creative.thumbnailUrl,
    launchDate: creative.launchDate,
    tags: creative.tags,
  });

  const [name, setName] = useState(creative.name);
  const [productId, setProductId] = useState(creative.productId);
  const [type, setType] = useState<Type>(creative.type);
  const [status, setStatus] = useState<Status>(creative.status);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(
    creative.thumbnailUrl,
  );
  const [launchDate, setLaunchDate] = useState<string | null>(
    creative.launchDate,
  );
  const [tags, setTags] = useState<string[]>(creative.tags);

  const nameTrimmed = name.trim();
  const dirty =
    nameTrimmed !== saved.name ||
    productId !== saved.productId ||
    type !== saved.type ||
    status !== saved.status ||
    thumbnailUrl !== saved.thumbnailUrl ||
    launchDate !== saved.launchDate ||
    !sameSet(tags, saved.tags);

  const canSave = dirty && nameTrimmed !== "" && !isPending;

  const discard = () => {
    setName(saved.name);
    setProductId(saved.productId);
    setType(saved.type);
    setStatus(saved.status);
    setThumbnailUrl(saved.thumbnailUrl);
    setLaunchDate(saved.launchDate);
    setTags(saved.tags);
  };

  const onSave = () => {
    if (!canSave) return;
    const patch: Record<string, unknown> = { id: creative.id };
    if (nameTrimmed !== saved.name) patch.name = nameTrimmed;
    if (productId !== saved.productId) patch.productId = productId;
    if (type !== saved.type) patch.type = type;
    if (status !== saved.status) patch.status = status;
    if (thumbnailUrl !== saved.thumbnailUrl) patch.thumbnailUrl = thumbnailUrl;
    if (launchDate !== saved.launchDate) patch.launchDate = launchDate;
    if (!sameSet(tags, saved.tags)) patch.tags = tags;

    startTransition(async () => {
      const res = await patchCreative(patch);
      if (!res.ok) {
        toast.error(res.fieldErrors?.name ?? res.error ?? "Couldn't save changes");
        return;
      }
      const newName = res.name ?? nameTrimmed;
      toast.success("Changes saved");
      if (newName !== saved.name) {
        // The detail URL is keyed on the name — follow the rename.
        router.replace(`/creatives/${encodeURIComponent(newName)}`);
        router.refresh();
      } else {
        setSaved({
          name: nameTrimmed,
          productId,
          type,
          status,
          thumbnailUrl,
          launchDate,
          tags,
        });
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Save bar */}
      <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-warn">
              <span className="w-1.5 h-1.5 rounded-full bg-warn" />
              Unsaved changes
            </span>
          ) : (
            <span className="text-[11px] text-ink-3">All changes saved</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={discard}
            disabled={!dirty || isPending}
            className="text-ink-3 hover:text-ink"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Discard
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={!canSave}>
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save changes
          </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* Thumbnail */}
        <div className="space-y-1.5">
          <ThumbnailUpload
            value={thumbnailUrl}
            onChange={setThumbnailUrl}
            disabled={isPending}
          />
          <p className="text-[10px] text-ink-3 px-0.5">
            Click or drag to {thumbnailUrl ? "replace" : "add"} a thumbnail.
          </p>
        </div>

        {/* Editable meta */}
        <div className="space-y-4 min-w-0">
          {/* Product */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
              Product
            </label>
            <Select
              value={productId}
              onValueChange={setProductId}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 text-xs w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
              Creative name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
              placeholder="Creative name"
              className={cn(
                "w-full bg-transparent font-display text-3xl tracking-tight text-ink",
                "border-b border-line focus:border-brand focus:outline-none pb-1 transition-colors",
                "disabled:opacity-60",
              )}
            />
            {nameTrimmed === "" && (
              <p className="text-[11px] text-neg">Name can&apos;t be empty.</p>
            )}
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Type
              </label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as Type)}
                disabled={isPending}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {creativeTypeEnum.map((t) => {
                    const Icon = TYPE_ICON[t];
                    return (
                      <SelectItem key={t} value={t} className="text-xs">
                        <span className="inline-flex items-center gap-2">
                          <Icon className="w-3 h-3" />
                          {TYPE_LABEL[t]}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Status
              </label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as Status)}
                disabled={isPending}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {creativeStatusEnum.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: STATUS_DOT[s] }}
                        />
                        {STATUS_LABEL[s]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Publish date */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Publish date
            </label>
            <div className="flex items-center gap-1.5">
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={isPending}
                    className={cn(
                      "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors disabled:opacity-60",
                      launchDate
                        ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
                        : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    <span className="num">
                      {launchDate ? isoDate(launchDate) : "Set a date"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={parseISO(launchDate)}
                    defaultMonth={parseISO(launchDate) ?? new Date()}
                    onSelect={(d) => {
                      setLaunchDate(d ? fmtISO(d) : null);
                      setDateOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              {launchDate && (
                <button
                  type="button"
                  onClick={() => setLaunchDate(null)}
                  disabled={isPending}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-line text-ink-3 hover:text-neg transition-colors disabled:opacity-60"
                  aria-label="Clear publish date"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Tags
            </label>
            <TagMultiSelect
              value={tags}
              onChange={setTags}
              allTags={allTags}
              disabled={isPending}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
