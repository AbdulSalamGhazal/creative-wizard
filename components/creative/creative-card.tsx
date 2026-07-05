import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Film, Image as ImageIcon, Layers } from "lucide-react";
import type { CreativeListRow } from "@/db/queries/creatives";
import { StatusBadge } from "@/components/creative/status-badge";
import { gradientFor } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { isoDate, usd } from "@/lib/format";

const TYPE_LABEL: Record<CreativeListRow["type"], string> = {
  video: "Video",
  image: "Image",
  slides: "Slides",
};

const TYPE_ICON: Record<
  CreativeListRow["type"],
  React.ComponentType<{ className?: string }>
> = {
  video: Film,
  image: ImageIcon,
  slides: Layers,
};

export function CreativeCard({
  row,
  listCtx,
}: {
  row: CreativeListRow;
  listCtx?: string;
}) {
  const TypeIcon = TYPE_ICON[row.type];
  const grad = gradientFor(row.name);
  // "new" (never spent) keeps the dashed placeholder border the old `draft`
  // had; "terminated" keeps the dimmed treatment the old `archived` had.
  const isNew = row.status === "new";
  const isTerminated = row.status === "terminated";
  const visibleTags = row.tags.slice(0, 2);
  const overflow = row.tags.length - visibleTags.length;

  return (
    <Link
      href={`/creatives/${encodeURIComponent(row.name)}${listCtx ? `?${listCtx}` : ""}`}
      className={cn(
        "group block rounded-lg border bg-surface text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-line-2",
        isNew
          ? "border-dashed border-line-2"
          : isTerminated
            ? "border-line opacity-65 hover:opacity-80"
            : "border-line",
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-lg">
        {row.thumbnailUrl ? (
          <Image
            src={row.thumbnailUrl}
            alt={row.name}
            fill
            sizes="(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="absolute inset-0 transition-transform duration-500 group-hover:scale-105"
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
              <TypeIcon className="w-14 h-14 text-white/70" />
            </div>
          </div>
        )}

        {/* Type badge */}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-background/80 backdrop-blur border border-line text-[10px] uppercase tracking-[0.14em] text-ink-2">
          <TypeIcon className="w-3 h-3" />
          {TYPE_LABEL[row.type]}
        </span>

        {/* Status badge */}
        <StatusBadge
          status={row.status}
          className="absolute top-2 right-2 h-6 px-2 rounded-md bg-background/80 backdrop-blur border border-line text-[10px]"
        />

        {/* Hover action chevron */}
        <span className="absolute bottom-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md bg-background/80 backdrop-blur border border-line text-ink-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowUpRight className="w-3.5 h-3.5" />
        </span>
      </div>

      {/* Body */}
      <div className="px-3 pt-3 pb-2">
        <div className="font-mono text-xs text-ink truncate" title={row.name}>
          {row.name}
        </div>
        <div className="mt-0.5 text-xs text-ink-3 truncate">{row.productName}</div>

        {/* Tags */}
        <div className="mt-2 flex items-center gap-1 flex-wrap min-h-[20px]">
          {visibleTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center h-5 px-1.5 rounded text-[10px] bg-surface-2 border border-line text-ink-2"
            >
              {t}
            </span>
          ))}
          {overflow > 0 && (
            <span className="text-[10px] text-ink-3">+{overflow} more</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-line flex items-center justify-between text-[11px] num">
        <span className="text-ink-3">
          {row.launchDate ? isoDate(row.launchDate) : "Not launched"}
        </span>
        <span className="text-ink-2">
          {row.spend30d > 0 ? `${usd(row.spend30d)} / 30d` : "—"}
        </span>
      </div>
    </Link>
  );
}
