import type { Metadata } from "next";
import { Instrument_Serif, Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { AccentProvider } from "@/components/theme/accent-provider";
import { ThemedToaster } from "@/components/theme/themed-toaster";
import { ACCENT_STORAGE_KEY } from "@/components/theme/accents";
import "./globals.css";

// Runs before first paint to apply the saved accent (no flash). next-themes
// injects its own equivalent for the light/dark class.
const accentScript = `(function(){try{var a=localStorage.getItem(${JSON.stringify(
  ACCENT_STORAGE_KEY,
)});if(a){document.documentElement.setAttribute('data-accent',a);}}catch(e){}})();`;

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
  title: "Urjwan CCMS",
  description: "Urjwan Creative Management System",
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
        {/* Applies the saved accent before paint (no flash). Inline scripts
            render in place here and run during body parse, after the head
            stylesheet has loaded. */}
        <script dangerouslySetInnerHTML={{ __html: accentScript }} />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AccentProvider>
            {children}
            <ThemedToaster />
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
