"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, EVENT_TYPES, type EventType } from "@/lib/notifications";
import { saveNotificationRoutes } from "@/app/actions/notification-routes";
import type { BrandMember } from "@/db/queries/notifications";

/**
 * Who receives which event, in THIS brand. One row per catalog entry — the
 * rows derive from `EVENT_TYPES`, so a phase-3 alert appears here the moment
 * its catalog entry exists.
 *
 * Each row saves on its own: the recipient set for one event is the unit of
 * decision, and a page-wide Save would make a typo in one row block the rest.
 */
export function NotificationRoutesAdmin({
  members,
  recipients,
}: {
  members: BrandMember[];
  /** eventType → user ids, as stored. */
  recipients: Record<string, string[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(EVENT_TYPES.map((e) => [e.key, recipients[e.key] ?? []])),
  );

  const stored = (key: EventType) => recipients[key] ?? [];
  const dirty = (key: EventType) => {
    const a = [...(draft[key] ?? [])].sort().join(",");
    const b = [...stored(key)].sort().join(",");
    return a !== b;
  };

  const toggle = (key: EventType, userId: string) =>
    setDraft((d) => {
      const current = d[key] ?? [];
      return {
        ...d,
        [key]: current.includes(userId)
          ? current.filter((id) => id !== userId)
          : [...current, userId],
      };
    });

  const save = (key: EventType) =>
    startTransition(async () => {
      const res = await saveNotificationRoutes({ eventType: key, userIds: draft[key] ?? [] });
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't save that routing.");
        return;
      }
      toast.success("Routing saved.");
      router.refresh();
    });

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "Unknown";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-ink">Notification routing</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-3">
          Pick who hears about each event in this brand. Routing is per brand, and
          the person who caused an event is never notified about it.{" "}
          <span className="text-ink-2">Events with no recipients notify nobody.</span>
        </p>
      </div>

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {EVENT_TYPES.map((event) => {
          const chosen = draft[event.key] ?? [];
          return (
            <li
              key={event.key}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{event.label}</span>
                  <span className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
                    {CATEGORY_LABEL[event.category]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-3">{event.description}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      {chosen.length === 0
                        ? "Nobody"
                        : chosen.length === 1
                          ? nameOf(chosen[0]!)
                          : `${chosen.length} people`}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Recipients</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {members.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-ink-3">
                        Nobody has access to this brand yet.
                      </p>
                    ) : (
                      members.map((m) => (
                        <DropdownMenuCheckboxItem
                          key={m.id}
                          checked={chosen.includes(m.id)}
                          onCheckedChange={() => toggle(event.key, m.id)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {m.name}
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty(event.key) || isPending}
                  onClick={() => save(event.key)}
                  className={cn(!dirty(event.key) && "opacity-50")}
                >
                  <Check className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
