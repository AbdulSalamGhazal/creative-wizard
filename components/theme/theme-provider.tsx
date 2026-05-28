"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Thin wrapper over next-themes so the rest of the app imports a local module.
 * Mounted once in the root layout. Uses the `class` strategy (toggles
 * `class="light|dark"` on <html>), which our CSS variables key off.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
