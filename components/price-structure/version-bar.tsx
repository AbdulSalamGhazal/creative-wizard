"use client";

import { useState } from "react";
import { usePathname, useRouter } from "@/lib/brand-nav";
import { Check, Eye, Loader2, RefreshCw, Settings2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavTransition } from "@/lib/nav-progress";
import { cn } from "@/lib/utils";
import { SettingsSheet } from "./settings-sheet";
import { useVersion, type SaveState } from "./version-provider";

const MANAGE = "__manage";

/**
 * The module's header controls (brief §6.0): the version picker (last entry
 * "Manage versions…"), the Settings button, and the save status. Sits in
 * every page header's right slot.
 */
export function VersionBar() {
  const { access, versions, open, saveState, switchTo, flush, retry } = useVersion();
  const router = useRouter();
  const pathname = usePathname();
  const [, startNav] = useNavTransition();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pick = (value: string) => {
    if (value === MANAGE) {
      void (async () => {
        await flush();
        startNav(() => router.push(`/price-structure/versions${open ? `?v=${open.id}` : ""}`));
      })();
      return;
    }
    if (value !== open?.id) switchTo(value);
  };

  const onVersions = pathname.startsWith("/price-structure/versions");

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {access.edit || access.versions ? (
        <SaveStatus state={saveState} onRetry={retry} />
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-3" title="You can open every page; editing needs the Edit permission.">
          <Eye className="size-3" aria-hidden /> Read-only
        </span>
      )}
      <Select value={open?.id ?? ""} onValueChange={pick}>
        <SelectTrigger size="sm" className="h-8 max-w-[14rem] text-xs" aria-label="Version">
          <SelectValue placeholder="Version…" />
        </SelectTrigger>
        <SelectContent align="end">
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              <span dir="auto">{v.name}</span>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={MANAGE} disabled={onVersions}>
            Manage versions…
          </SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSettingsOpen(true)} disabled={!open}>
        <Settings2 aria-hidden />
        Settings
      </Button>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

const STATUS: Record<SaveState, { text: string; icon: React.ReactNode; className: string }> = {
  saved: { text: "Saved", icon: <Check className="size-3" aria-hidden />, className: "text-ink-3" },
  dirty: { text: "Saving…", icon: <Loader2 className="size-3 animate-spin" aria-hidden />, className: "text-ink-3" },
  saving: { text: "Saving…", icon: <Loader2 className="size-3 animate-spin" aria-hidden />, className: "text-ink-3" },
  retrying: {
    text: "Couldn't save, retrying",
    icon: <RefreshCw className="size-3 animate-spin" aria-hidden />,
    className: "text-warn",
  },
  failed: { text: "Couldn't save", icon: <TriangleAlert className="size-3" aria-hidden />, className: "text-neg" },
};

function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const meta = STATUS[state];
  const content = (
    <>
      {meta.icon}
      {meta.text}
    </>
  );
  if (state === "failed") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn("inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline", meta.className)}
      >
        {content} · retry
      </button>
    );
  }
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1 text-[11px]", meta.className)}>
      {content}
    </span>
  );
}
