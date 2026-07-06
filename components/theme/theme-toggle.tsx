"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Palette } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Theme picker in the top bar — four tones on one axis, persisted by
 * next-themes. Swatches preview [background · ink · accent] and MUST mirror the
 * `.<theme>` values in app/globals.css (keep in sync). Brand + chart colors
 * stay shared; only the chrome re-tones.
 */
const DARK_THEMES = [
  { value: "midnight", label: "Midnight", swatches: ["#0a0812", "#f2ebe5", "#d4145a"] },
  { value: "contrast", label: "Contrast", swatches: ["#000000", "#ffffff", "#f59e0b"] },
] as const;

const LIGHT_THEMES = [
  { value: "frost", label: "Frost", swatches: ["#f3f6fb", "#16202e", "#2563eb"] },
  { value: "paper", label: "Paper", swatches: ["#f7f3ea", "#2b2620", "#b45309"] },
] as const;

function Swatches({ colors }: { colors: readonly string[] }) {
  return (
    <span className="flex items-center -space-x-1">
      {colors.map((c, i) => (
        <span
          key={i}
          className="h-3.5 w-3.5 rounded-full ring-1 ring-black/30"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Leave the radio group uncontrolled until mounted to avoid a hydration
  // mismatch (the stored theme is only known on the client).
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Theme"
          aria-label="Change theme"
          className="text-ink-2 hover:text-ink p-1.5 rounded-md hover:bg-surface-2 transition"
        >
          <Palette className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 max-h-[75vh] overflow-y-auto">
        <DropdownMenuLabel>Theme · Dark</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? "midnight") : undefined}
          onValueChange={setTheme}
        >
          {DARK_THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value} className="gap-2">
              <Swatches colors={t.swatches} />
              {t.label}
            </DropdownMenuRadioItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Light</DropdownMenuLabel>
          {LIGHT_THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value} className="gap-2">
              <Swatches colors={t.swatches} />
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
