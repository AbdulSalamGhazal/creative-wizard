import type { Metadata } from "next";
import { Instrument_Serif, Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import "./globals.css";

// The three selectable tones. Midnight is the default (matches :root).
const THEMES = ["midnight", "slate", "carbon"];

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const instrument = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Creative Wizard",
  description: "Creative Wizard — creative performance management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${instrument.variable} ${plexMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="midnight"
          themes={THEMES}
          enableSystem={false}
          storageKey="cw-theme"
          disableTransitionOnChange
        >
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
