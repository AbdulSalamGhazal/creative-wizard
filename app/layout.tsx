import type { Metadata } from "next";
import {
  Instrument_Serif,
  Plus_Jakarta_Sans,
  IBM_Plex_Mono,
  Inter,
  Space_Grotesk,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import "./globals.css";

// The eight selectable tones (Sand/Frost/Rose are light, the rest dark).
// Midnight is the default and matches :root.
const THEMES = [
  "midnight",
  "slate",
  "carbon",
  "contrast",
  "ocean",
  "sand",
  "frost",
  "rose",
];

// ── UI font choices ──────────────────────────────────────────────
// Each exposes its own CSS var; the active one is selected by the
// `--font-ui` var in globals.css (driven by `data-font` on <html>). Jakarta
// is the default and is preloaded; the alternates load on first use.
const jakarta = Plus_Jakarta_Sans({
  variable: "--ff-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--ff-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const grotesk = Space_Grotesk({
  variable: "--ff-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

const instrument = Instrument_Serif({
  variable: "--ff-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Applies the saved UI font before first paint (no flash). next-themes injects
// its own equivalent for the theme class.
const fontScript = `(function(){try{var f=localStorage.getItem('cw-font');if(f){document.documentElement.setAttribute('data-font',f);}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "WIZARD",
  description: "WIZARD — creative performance management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font CSS-var classes go on <html> (not <body>) so that `--ff-*`
    // resolve in the same scope where `data-font` selects `--font-ui`. Custom
    // properties don't inherit upward, so defining them on <body> would leave
    // them invalid for the html-level `[data-font]` rules.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jakarta.variable} ${inter.variable} ${grotesk.variable} ${instrument.variable} ${plexMono.variable}`}
    >
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: fontScript }} />
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
