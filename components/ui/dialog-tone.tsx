import type { ComponentType, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * A confirm dialog's title with its TONE disc (R-107): every destructive
 * confirm (a delete, a rollback, a removal) opens with the same tinted disc,
 * so the cue for "this changes data" is reliable instead of present on four
 * dialogs and absent on the rest. `destructive` = neg (it removes data),
 * `warn` = warn (reversible, but it locks someone out).
 */
export function ToneDialogTitle({
  tone,
  icon: Icon = AlertTriangle,
  children,
}: {
  tone: "destructive" | "warn";
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <DialogTitle className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          tone === "destructive" ? "bg-neg/10 text-neg" : "bg-warn/15 text-warn",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">{children}</span>
    </DialogTitle>
  );
}
