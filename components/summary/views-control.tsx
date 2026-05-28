"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Check, Plus, Trash2, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  createSummaryView,
  deleteSummaryView,
} from "@/app/actions/summary-view";
import type { SummaryViewRow } from "@/db/queries/summary-views";

interface Props {
  views: SummaryViewRow[];
  currentUserId: string;
  isAdmin: boolean;
}

/** Order-independent comparison of two query strings. */
function sameQuery(a: string, b: string): boolean {
  const norm = (s: string) => {
    const p = new URLSearchParams(s);
    const entries = [...p.entries()].sort(([ak, av], [bk, bv]) =>
      ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk),
    );
    return entries.map(([k, v]) => `${k}=${v}`).join("&");
  };
  return norm(a) === norm(b);
}

/**
 * Saved-views control for the Summary page. Lists team views (apply on
 * click), lets any signed-in user save the current configuration, and lets
 * the owner or an admin delete a view. Stored config is the raw query
 * string, so whatever filters/columns/sort exist now or later are captured
 * automatically.
 */
export function ViewsControl({ views, currentUserId, isAdmin }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  const currentQuery = searchParams.toString();
  const activeView = views.find((v) => sameQuery(v.query, currentQuery));

  const applyView = useCallback(
    (query: string) => {
      setOpen(false);
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createSummaryView({
        name: trimmed,
        query: currentQuery,
        page: "summary",
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save view");
        return;
      }
      toast.success(`Saved view “${trimmed}”`);
      setName("");
      router.refresh();
    });
  };

  const remove = (id: string, viewName: string) => {
    startTransition(async () => {
      const res = await deleteSummaryView(id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete view");
        return;
      }
      toast.success(`Deleted “${viewName}”`);
      router.refresh();
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs transition-colors",
            activeView
              ? "border-brand/50 text-ink bg-[var(--brand-soft)]"
              : "border-line text-ink-2 bg-surface hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Bookmark className="w-3.5 h-3.5" />
          <span className="text-ink-3">View</span>
          <span className="text-ink max-w-[140px] truncate">
            {activeView ? activeView.name : "Unsaved"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2 space-y-2">
        <div className="px-1 text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Saved views
        </div>

        {views.length === 0 ? (
          <p className="px-1 text-[11px] text-ink-3">
            No saved views yet. Configure filters and columns below, then save
            this setup.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {views.map((v) => {
              const isActive = activeView?.id === v.id;
              const canDelete = v.ownerUserId === currentUserId || isAdmin;
              return (
                <div
                  key={v.id}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                    isActive
                      ? "bg-[var(--brand-soft)] text-ink"
                      : "hover:bg-surface-2 text-ink-2",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => applyView(v.query)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {isActive ? (
                      <Check className="w-3.5 h-3.5 text-brand shrink-0" />
                    ) : (
                      <Bookmark className="w-3.5 h-3.5 text-ink-3 shrink-0" />
                    )}
                    <span className="flex flex-col min-w-0">
                      <span className="truncate text-ink">{v.name}</span>
                      {v.ownerName && (
                        <span className="truncate text-[10px] text-ink-3">
                          {v.ownerName}
                        </span>
                      )}
                    </span>
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => remove(v.id, v.name)}
                      disabled={isPending}
                      className="shrink-0 text-ink-3 hover:text-neg transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Delete ${v.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Save current configuration */}
        <div className="pt-2 border-t border-line space-y-1.5">
          <div className="px-1 text-[10px] text-ink-3">
            Save the current filters, columns, and sort as a new view.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="View name…"
              maxLength={120}
              className="h-8 flex-1 min-w-0 rounded-md border border-line bg-surface px-2.5 text-xs text-ink placeholder:text-ink-3 outline-none focus:border-line-2"
            />
            <button
              type="button"
              onClick={save}
              disabled={isPending || name.trim() === ""}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-brand/50 bg-[var(--brand-soft)] text-xs text-ink hover:bg-brand/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              Save
            </button>
          </div>
          {activeView && (
            <button
              type="button"
              onClick={() => applyView("")}
              className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors px-1"
            >
              <X className="w-3 h-3" />
              Clear view (reset to default)
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
