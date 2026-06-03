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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Theme picker in the top bar. One axis, three dark tones. Each option shows
 * a little preview of that theme's background / surface / ink so the choice is
 * obvious. Brand + chart colors are shared, so only the chrome re-tones.
 */
const THEMES = [
  { value: "midnight", label: "Midnight", swatches: ["#0a0812", "#1b1828", "#f2ebe5"] },
  { value: "slate", label: "Slate", swatches: ["#0b0e16", "#1c2433", "#eef2f8"] },
  { value: "carbon", label: "Carbon", swatches: ["#0a0a0b", "#1c1c1f", "#f4f4f5"] },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Theme is only known on the client; leave the radio group uncontrolled
  // until mounted to avoid a hydration mismatch.
  useEffect(() => setMounted(true), []);

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
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? "midnight") : undefined}
          onValueChange={setTheme}
        >
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.value} value={t.value} className="gap-2">
              <span className="flex items-center -space-x-1">
                {t.swatches.map((c, i) => (
                  <span
                    key={i}
                    className="h-3.5 w-3.5 rounded-full ring-1 ring-black/30"
                    style={{ background: c }}
                  />
                ))}
              </span>
              {t.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
