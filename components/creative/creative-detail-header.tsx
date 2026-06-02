"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThumbnailUpload } from "@/components/creative/thumbnail-upload";
import { TagInput } from "@/components/creative/tag-input";
import { DeleteCreativeDialog } from "@/components/creative/delete-creative-dialog";
import { patchCreative } from "@/app/actions/creative";
import { creativeStatusEnum } from "@/db/schema";
import { isoDate } from "@/lib/format";
import type {
  CreativeDetail,
  CreativeDeletionSummary,
} from "@/db/queries/creatives";

type Status = CreativeDetail["status"];

const TYPE_LABEL: Record<CreativeDetail["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const TYPE_ICON: Record<
  CreativeDetail["type"],
  React.ComponentType<{ className?: string }>
> = {
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

function parseTags(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(",")) {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function CreativeDetailHeader({
  creative,
  allTags,
  deletionSummary,
}: {
  creative: CreativeDetail;
  allTags: string[];
  deletionSummary: CreativeDeletionSummary;
}) {
  const router = useRouter();
  const TypeIcon = TYPE_ICON[creative.type];

  const [status, setStatus] = useState<Status>(creative.status);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(
    creative.thumbnailUrl,
  );
  const [launchDate, setLaunchDate] = useState<string | null>(
    creative.launchDate,
  );
  const [tags, setTags] = useState<string[]>(creative.tags);

  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState(creative.tags.join(", "));

  const [isPending, startTransition] = useTransition();

  // ── Auto-saving field handlers (optimistic, revert on failure) ──
  const onStatus = (next: string) => {
    const value = next as Status;
    const prev = status;
    if (value === prev) return;
    setStatus(value);
    startTransition(async () => {
      const res = await patchCreative({ id: creative.id, status: value });
      if (!res.ok) {
        setStatus(prev);
        toast.error(res.error ?? "Couldn't update status");
        return;
      }
      toast.success(`Status → ${STATUS_LABEL[value]}`);
      router.refresh();
    });
  };

  const onThumbnail = (url: string | null) => {
    const prev = thumbnailUrl;
    setThumbnailUrl(url);
    startTransition(async () => {
      const res = await patchCreative({ id: creative.id, thumbnailUrl: url });
      if (!res.ok) {
        setThumbnailUrl(prev);
        toast.error(res.error ?? "Couldn't save thumbnail");
        return;
      }
      toast.success(url ? "Thumbnail updated" : "Thumbnail removed");
      router.refresh();
    });
  };

  const onLaunchDate = (next: string | null) => {
    const prev = launchDate;
    if (next === prev) return;
    setLaunchDate(next);
    startTransition(async () => {
      const res = await patchCreative({ id: creative.id, launchDate: next });
      if (!res.ok) {
        setLaunchDate(prev);
        toast.error(res.error ?? "Couldn't save launch date");
        return;
      }
      toast.success(next ? `Launch date set to ${next}` : "Launch date cleared");
      router.refresh();
    });
  };

  const saveTags = () => {
    const next = parseTags(tagDraft);
    const prev = tags;
    setTags(next);
    setEditingTags(false);
    startTransition(async () => {
      const res = await patchCreative({ id: creative.id, tags: next });
      if (!res.ok) {
        setTags(prev);
        toast.error(res.error ?? "Couldn't save tags");
        return;
      }
      toast.success("Tags updated");
      router.refresh();
    });
  };

  const cancelTags = () => {
    setTagDraft(tags.join(", "));
    setEditingTags(false);
  };

  return (
    <div className="space-y-4">
      {/* Top action row */}
      <div className="flex items-center justify-between">
        <Link
          href="/creatives"
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to library
        </Link>
        <div className="flex items-center gap-1">
          {isPending && (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-3 mr-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </span>
          )}
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-ink-3 hover:text-ink"
          >
            <Link href={`/creatives/${encodeURIComponent(creative.name)}/edit`}>
              <Pencil className="w-3.5 h-3.5" />
              Name &amp; type
            </Link>
          </Button>
          <DeleteCreativeDialog
            creativeId={creative.id}
            creativeName={creative.name}
            summary={deletionSummary}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* Thumbnail — inline upload / replace / remove */}
        <div className="space-y-1.5">
          <ThumbnailUpload value={thumbnailUrl} onChange={onThumbnail} />
          <p className="text-[10px] text-ink-3 px-0.5">
            Click or drag to {thumbnailUrl ? "replace" : "add"} a thumbnail.
          </p>
        </div>

        {/* Meta + inline editors */}
        <div className="space-y-4 min-w-0">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
              {creative.productName}
            </div>
            <h1 className="font-display text-4xl tracking-tight break-words">
              {creative.name}
            </h1>
            <div className="mt-2">
              <Badge variant="outline" className="text-ink-2">
                <TypeIcon className="w-3 h-3 mr-1" />
                {TYPE_LABEL[creative.type]}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Status
              </label>
              <Select value={status} onValueChange={onStatus} disabled={isPending}>
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

            {/* Launch / publish date */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Publish date
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={launchDate ?? ""}
                  disabled={isPending}
                  onChange={(e) => onLaunchDate(e.target.value || null)}
                  className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-ink num [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60"
                />
                {launchDate && (
                  <button
                    type="button"
                    onClick={() => onLaunchDate(null)}
                    disabled={isPending}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-line text-ink-3 hover:text-neg transition-colors disabled:opacity-60"
                    aria-label="Clear launch date"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-ink-3">
                {launchDate ? `Launched ${isoDate(launchDate)}` : "Not launched"}
              </p>
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5 max-w-xl">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-[0.14em] text-ink-3">
                Tags
              </label>
              {!editingTags && (
                <button
                  type="button"
                  onClick={() => {
                    setTagDraft(tags.join(", "));
                    setEditingTags(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
              )}
            </div>

            {editingTags ? (
              <div className="space-y-2">
                <TagInput
                  value={tagDraft}
                  onChange={setTagDraft}
                  allTags={allTags}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    onClick={saveTags}
                    disabled={isPending}
                  >
                    <Check className="w-3 h-3" />
                    Save tags
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={cancelTags}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : tags.length > 0 ? (
              <div className="flex items-center gap-1 flex-wrap">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center h-6 px-2 rounded text-[11px] bg-surface-2 border border-line text-ink-2"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">No tags yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
