import { cn } from "@/lib/utils";

/**
 * Marks an APP-OWNED creative in the Library — today that's the "Google Ads"
 * row every google upload records against (google exports carry no creative
 * column). It's a normal, visible creative: only its NAME is protected, since
 * the upload pipeline matches it by name.
 *
 * Same chip shape as the other inline badges (h-5, border-line, text-eyebrow).
 */
export function SystemBadge({ className }: { className?: string }) {
  return (
    <span
      title="Created and maintained by the app — it can't be renamed or deleted."
      className={cn(
        "inline-flex items-center h-5 px-1.5 rounded border border-line bg-surface-2 text-eyebrow text-ink-3",
        className,
      )}
    >
      System
    </span>
  );
}
