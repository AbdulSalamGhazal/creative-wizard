import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Film, Image as ImageIcon, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { gradientFor } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { isoDate } from "@/lib/format";
import type { CreativeDetail } from "@/db/queries/creatives";

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

const STATUS_LABEL: Record<CreativeDetail["status"], string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
  archived: "Archived",
};

const STATUS_DOT: Record<CreativeDetail["status"], string> = {
  active: "var(--pos)",
  paused: "var(--warn)",
  draft: "var(--ink-3)",
  archived: "var(--ink-3)",
};

const statusBadgeClass: Record<CreativeDetail["status"], string> = {
  active: "border-pos/40 text-pos bg-pos/10",
  draft: "border-line-2 text-ink-2 bg-surface-2",
  paused: "border-warn/40 text-warn bg-warn/10",
  archived: "border-line-2 text-ink-3 bg-surface-2",
};

export function CreativeDetailHeader({ creative }: { creative: CreativeDetail }) {
  const TypeIcon = TYPE_ICON[creative.type];
  const grad = gradientFor(creative.name);

  return (
    <div className="space-y-4">
      <Link
        href="/creatives"
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to library
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        {/* Thumbnail */}
        <div
          className={cn(
            "relative aspect-[4/3] rounded-lg overflow-hidden border border-line bg-surface",
            creative.status === "archived" && "opacity-65",
          )}
        >
          {creative.thumbnailUrl ? (
            <Image
              src={creative.thumbnailUrl}
              alt={creative.name}
              fill
              sizes="260px"
              className="object-cover"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
              }}
            >
              <div
                className="absolute inset-0 opacity-30"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)",
                  backgroundSize: "16px 16px",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <TypeIcon className="w-20 h-20 text-white/70" />
              </div>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="space-y-3 min-w-0">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-1">
              {creative.productName}
            </div>
            <h1 className="font-display text-4xl tracking-tight break-words">
              {creative.name}
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Badge variant="outline" className="text-ink-2">
              <TypeIcon className="w-3 h-3 mr-1" />
              {TYPE_LABEL[creative.type]}
            </Badge>
            <Badge variant="outline" className={statusBadgeClass[creative.status]}>
              <span
                className="w-1.5 h-1.5 rounded-full mr-1.5"
                style={{ background: STATUS_DOT[creative.status] }}
              />
              {STATUS_LABEL[creative.status]}
            </Badge>
            <Badge variant="outline" className="text-ink-3">
              {creative.launchDate
                ? `Launched ${isoDate(creative.launchDate)}`
                : "Not launched"}
            </Badge>
          </div>

          {creative.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {creative.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center h-6 px-2 rounded text-[11px] bg-surface-2 border border-line text-ink-2"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {creative.notes && (
            <p className="text-sm text-ink-2 max-w-2xl">{creative.notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}
