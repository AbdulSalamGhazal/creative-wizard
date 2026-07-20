import type { Metadata } from "next";
import {
  Instrument_Serif,
  Plus_Jakarta_Sans,
  IBM_Plex_Mono,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import "./globals.css";

// The four selectable tones: two dark (Midnight / Contrast), two light
// (Frost / Paper). Midnight is the default and matches :root.
const THEMES = ["midnight", "contrast", "frost", "paper"];

// The one UI font — Plus Jakarta Sans. Exposes `--ff-jakarta`, which
// `--font-ui` in globals.css points straight at.
const jakarta = Plus_Jakarta_Sans({
  variable: "--ff-jakarta",
  subsets: ["latin"],
  // 800 (extrabold) powers the thick WIZARD wordmark; 400–700 cover the UI.
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
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

// Pre-paint migration of stale stored values, BEFORE next-themes reads them.
//  - A theme that was removed (slate/carbon/ocean → midnight; sand/rose →
//    frost) or any unknown value → midnight. Left as-is, the class wouldn't
//    exist, silently rendering Midnight tokens while `dark:` no longer matched.
//  - The old `cw-font` key is dropped (the font switcher was removed).
// Runs before the ThemeProvider (and next-themes' own inline script) below, so
// next-themes reads the corrected `cw-theme` value.
const themeMigrationScript = `(function(){try{var k='cw-theme',v=localStorage.getItem(k),m={slate:'midnight',carbon:'midnight',ocean:'midnight',sand:'frost',rose:'frost'},ok={midnight:1,contrast:1,frost:1,paper:1};if(v){if(m[v]){localStorage.setItem(k,m[v]);}else if(!ok[v]){localStorage.setItem(k,'midnight');}}localStorage.removeItem('cw-font');}catch(e){}})();`;

/**
 * Browser-tab titles. Every page sets its own `metadata.title` (details use
 * `generateMetadata`), and this template appends the product suffix — so a tab
 * reads "Creatives · Wizard" or "Creative · URJ_VID_001 · Wizard". `default`
 * covers any route that sets none. NOTE: the tab ICON comes from the
 * `app/icon.png` file convention, not from `metadata.icons` — don't add an
 * `icons` key here or it will override that.
 */
export const metadata: Metadata = {
  title: { template: "%s · Wizard", default: "Wizard" },
  description: "WIZARD — creative performance management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font CSS-var classes go on <html> so `--ff-jakarta` / `--ff-serif` /
    // `--ff-mono` are defined where `--font-ui` (globals.css) references them.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jakarta.variable} ${instrument.variable} ${plexMono.variable}`}
    >
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeMigrationScript }} />
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
