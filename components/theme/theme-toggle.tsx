"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccent } from "@/components/theme/accent-provider";
import { ACCENTS } from "@/components/theme/accents";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Appearance control in the top bar. Two axes:
 *  - Mode (Light / Dark / System), persisted by next-themes.
 *  - Accent (brand hue), persisted by the AccentProvider.
 * The trigger icon reflects the resolved mode.
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { accent, setAccent, mounted: accentMounted } = useAccent();
  const [mounted, setMounted] = useState(false);

  // Theme is only known on the client; render a stable placeholder on the
  // server pass to avoid a hydration mismatch.
  useEffect(() => setMounted(true), []);

  const TriggerIcon = resolvedTheme === "light" ? Sun : Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Appearance"
          aria-label="Change appearance"
          className="text-ink-2 hover:text-ink p-1.5 rounded-md hover:bg-surface-2 transition"
        >
          {mounted ? (
            <TriggerIcon className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? "system") : undefined}
          onValueChange={setTheme}
        >
          {MODES.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="text-ink-2" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Accent</DropdownMenuLabel>
        <div
          className="flex items-center gap-1.5 px-2 py-1.5"
          role="radiogroup"
          aria-label="Accent color"
        >
          {ACCENTS.map((a) => {
            const active = accentMounted && accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={active}
                title={a.label}
                aria-label={a.label}
                onClick={() => setAccent(a.id)}
                className={cn(
                  "relative h-6 w-6 rounded-full transition-transform hover:scale-110",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                  active && "ring-2 ring-offset-2 ring-offset-popover ring-ink",
                )}
                style={{ backgroundColor: a.swatch }}
              >
                {active && (
                  <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white" />
                )}
              </button>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
