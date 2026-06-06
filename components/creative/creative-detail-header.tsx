"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThumbnailUpload } from "@/components/creative/thumbnail-upload";
import { TagMultiSelect } from "@/components/creative/tag-multi-select";
import { StatusBadge } from "@/components/creative/status-badge";
import {
  patchCreative,
  setCreativeTermination,
} from "@/app/actions/creative";
import { creativeTypeEnum } from "@/db/schema";
import { ALL_PLATFORMS, PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/palette";
import { isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CreativeDetail } from "@/db/queries/creatives";
import type {
  CreativeStatusResult,
  Platform,
  PlatformStatus,
} from "@/lib/creative-status";

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
  status,
  terminated,
  allTags,
  products,
}: {
  creative: CreativeDetail;
  /** Dynamic status (general + per-platform), computed by the page. */
  status: CreativeStatusResult;
  /** Platforms this creative is manually terminated on. */
  terminated: Platform[];
  allTags: string[];
  products: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dateOpen, setDateOpen] = useState(false);

  // Saved baseline (updated on successful save) + live drafts. Status is NOT
  // part of this editor — it's derived, with per-platform termination as the
  // only manual lever (handled separately below, not via patchCreative).
  const [saved, setSaved] = useState({
    name: creative.name,
    productId: creative.productId,
    type: creative.type,
    thumbnailUrl: creative.thumbnailUrl,
    launchDate: creative.launchDate,
    tags: creative.tags,
  });

  const [name, setName] = useState(creative.name);
  const [productId, setProductId] = useState(creative.productId);
  const [type, setType] = useState<Type>(creative.type);
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
    thumbnailUrl !== saved.thumbnailUrl ||
    launchDate !== saved.launchDate ||
    !sameSet(tags, saved.tags);

  const canSave = dirty && nameTrimmed !== "" && !isPending;

  const discard = () => {
    setName(saved.name);
    setProductId(saved.productId);
    setType(saved.type);
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

          {/* Name + read-only dynamic status */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[10px] uppercase tracking-[0.18em] text-ink-3">
                Creative name
              </label>
              <StatusBadge status={status.general} />
            </div>
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

          {/* Type */}
          <div className="max-w-xl">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Type
              </label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as Type)}
                disabled={isPending}
              >
                <SelectTrigger className="h-8 text-xs w-full sm:w-1/2">
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
          </div>

          {/* Per-platform status + termination lever */}
          <PlatformStatusSection
            creativeId={creative.id}
            perPlatform={status.perPlatform}
            terminated={terminated}
          />

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

/**
 * Per-platform status rows + the manual Terminate / Reactivate lever. Each
 * platform with presence (it ran or is terminated) shows its derived status
 * badge and a button to flip its termination. A creative with no presence at
 * all reads "New" and shows a short note instead of controls.
 */
function PlatformStatusSection({
  creativeId,
  perPlatform,
  terminated,
}: {
  creativeId: string;
  perPlatform: Partial<Record<Platform, PlatformStatus>>;
  terminated: Platform[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
        Platform status
      </label>
      {/* One row per platform. Left border accent uses the platform's own color. */}
      <div className="flex flex-col gap-2 max-w-sm">
        {ALL_PLATFORMS.map((p) => {
          const s = perPlatform[p];
          const color = PLATFORM_COLOR[p];
          return (
            <div
              key={p}
              className="flex items-center justify-between gap-4 rounded-md border border-line bg-surface pl-3 pr-4 py-2.5"
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            >
              <span
                className="text-sm font-medium"
                style={{ color }}
              >
                {PLATFORM_LABEL[p]}
              </span>
              <StatusBadge status={s ?? "new"} />
            </div>
          );
        })}
      </div>
      <div className="pt-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] text-ink-3 hover:text-neg transition-colors underline-offset-2 hover:underline"
        >
          Terminate / reactivate…
        </button>
      </div>
      <TerminationDialog
        creativeId={creativeId}
        terminated={terminated}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

/**
 * The deliberate, rare termination control. Lists every platform with a toggle
 * (checked = Terminated); the user picks which platforms to terminate or
 * reactivate, then applies. Termination is sticky and overrides the automatic
 * Active/Pause status until reactivated.
 */
function TerminationDialog({
  creativeId,
  terminated,
  open,
  onOpenChange,
}: {
  creativeId: string;
  terminated: Platform[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const original = useMemo(() => new Set(terminated), [terminated]);
  const [picked, setPicked] = useState<Set<Platform>>(() => new Set(terminated));

  // Re-sync when the dialog (re)opens or the server state changes.
  useEffect(() => {
    if (open) setPicked(new Set(terminated));
  }, [open, terminated]);

  const toggle = (p: Platform) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const changes = ALL_PLATFORMS.filter(
    (p) => original.has(p) !== picked.has(p),
  );

  const apply = () => {
    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      for (const p of changes) {
        const res = await setCreativeTermination({
          creativeId,
          platform: p,
          terminated: picked.has(p),
        });
        if (!res.ok) {
          toast.error(res.error ?? `Couldn't update ${PLATFORM_LABEL[p]}`);
          return;
        }
      }
      toast.success("Termination updated");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Terminate creative</DialogTitle>
          <DialogDescription>
            Pick the platforms to terminate. Terminated platforms stay
            Terminated (ignoring spend) until you reactivate them here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {ALL_PLATFORMS.map((p) => {
            const checked = picked.has(p);
            return (
              <label
                key={p}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surface-2 cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(p)}
                  disabled={pending}
                />
                <span className="text-sm text-ink">{PLATFORM_LABEL[p]}</span>
                {original.has(p) && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-neg">
                    Terminated
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={pending}>
            {pending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              `Apply${changes.length ? ` (${changes.length})` : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
