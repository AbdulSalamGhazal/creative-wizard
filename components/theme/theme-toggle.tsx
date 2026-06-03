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
 * Appearance picker in the top bar. Two independent axes, one window:
 *  - Theme (8 tones: 5 dark + 3 light), persisted by next-themes.
 *  - UI font (3 families), persisted under `cw-font` → `data-font` on <html>.
 * Theme swatches preview [background · ink · accent]; font options render their
 * own name in their own typeface. Brand + chart colors stay shared.
 */
const DARK_THEMES = [
  { value: "midnight", label: "Midnight", swatches: ["#0a0812", "#f2ebe5", "#d4145a"] },
  { value: "slate", label: "Slate", swatches: ["#0a1322", "#e8f0fc", "#2f7bf6"] },
  { value: "carbon", label: "Carbon", swatches: ["#0a0a0b", "#f4f4f5", "#06b6d4"] },
  { value: "contrast", label: "Contrast", swatches: ["#000000", "#ffffff", "#f59e0b"] },
  { value: "ocean", label: "Ocean", swatches: ["#06141a", "#e3f4f6", "#14b8a6"] },
] as const;

const LIGHT_THEMES = [
  { value: "sand", label: "Sand", swatches: ["#f5f1e8", "#2a2420", "#c2410c"] },
  { value: "frost", label: "Frost", swatches: ["#f3f6fb", "#16202e", "#2563eb"] },
  { value: "rose", label: "Rose", swatches: ["#fbf3f4", "#2a1c22", "#e11d48"] },
] as const;

const FONTS = [
  { value: "jakarta", label: "Jakarta", varName: "--ff-jakarta" },
  { value: "inter", label: "Inter", varName: "--ff-inter" },
  { value: "grotesk", label: "Space Grotesk", varName: "--ff-grotesk" },
] as const;

const FONT_STORAGE_KEY = "cw-font";
const DEFAULT_FONT = "jakarta";

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
  const [font, setFontState] = useState<string>(DEFAULT_FONT);

  // Client-only state; leave the radio groups uncontrolled until mounted to
  // avoid a hydration mismatch.
  useEffect(() => {
    setMounted(true);
    try {
      setFontState(localStorage.getItem(FONT_STORAGE_KEY) || DEFAULT_FONT);
    } catch {
      /* ignore */
    }
  }, []);

  const setFont = (next: string) => {
    setFontState(next);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-font", next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Appearance"
          aria-label="Change theme & font"
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

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Font</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? font : undefined}
          onValueChange={setFont}
        >
          {FONTS.map((f) => (
            <DropdownMenuRadioItem key={f.value} value={f.value}>
              <span style={{ fontFamily: `var(${f.varName})` }}>{f.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
