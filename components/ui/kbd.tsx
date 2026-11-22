import { cn } from "@/lib/utils";

/**
 * A keyboard key, printed — ONE look for every place a key is shown (the ⌘K
 * trigger, the shortcut hint strip, the "?" list). Pass the key's text:
 * `<Kbd>B</Kbd>`. Decorative to a screen reader only where the sentence
 * around it already says the key.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] leading-none text-ink",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
