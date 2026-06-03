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
 * Theme picker in the top bar. One axis, eight tones (seven dark + one light).
 * Each option previews its background / surface / ink so the choice is
 * obvious. Brand + chart colors are shared, so only the chrome re-tones.
 */
const DARK_THEMES = [
  { value: "midnight", label: "Midnight", swatches: ["#0a0812", "#1b1828", "#f2ebe5"] },
  { value: "slate", label: "Slate", swatches: ["#0b0e16", "#1c2433", "#eef2f8"] },
  { value: "carbon", label: "Carbon", swatches: ["#0a0a0b", "#1c1c1f", "#f4f4f5"] },
  { value: "contrast", label: "Contrast", swatches: ["#000000", "#151515", "#ffffff"] },
  { value: "forest", label: "Forest", swatches: ["#0a130d", "#18261d", "#e9f2ec"] },
  { value: "sepia", label: "Sepia", swatches: ["#130d0a", "#271d18", "#f3eae1"] },
  { value: "ocean", label: "Ocean", swatches: ["#08141b", "#152935", "#e6f2f5"] },
] as const;

const LIGHT_THEMES = [
  { value: "sand", label: "Sand", swatches: ["#f5f1e8", "#efe9dc", "#2a2420"] },
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
      <DropdownMenuContent align="end" className="w-48 max-h-[70vh] overflow-y-auto">
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
