"use client";

import { useEffect, useState } from "react";
import { isRedactedServerError, looksLikeDbError } from "@/lib/error-copy";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It
 * replaces the entire document, so it can't rely on the app's CSS — styles
 * are inlined.
 *
 * It is also where a failure in the DASHBOARD layout lands (no boundary sits
 * above that layout but this one) — and that layout reads the database on
 * every page, so a connection blip shows THIS screen. "Try again" therefore
 * RELOADS: `reset()` re-renders the same failed payload and never recovers
 * (seen 2026-10-31 on a local CONNECT_TIMEOUT: the database was back, the
 * button stayed dead), and the document this replaced has nothing to keep.
 *
 * R-039 (2026-11-07): the calm "couldn't reach the data" copy the dashboard
 * boundary has was unreachable for the commonest outage, which fails HERE —
 * so this uses the same heuristic, and takes a redacted production server
 * error as a data blip too. And it follows the theme: light for Frost and
 * Paper (the theme class on the page it replaces), else the system's scheme — not a
 * near-black page with Midnight's pink button for everyone.
 */
const LIGHT_THEMES = new Set(["frost", "paper"]);

/** Midnight / Paper values from app/globals.css, inlined (no CSS here). */
const STYLE = `
.ge { --bg:#0a0812; --ink:#f2ebe5; --ink2:#a8a2b5; --line:#2a2638; }
@media (prefers-color-scheme: light) {
  .ge:not([data-theme]) { --bg:#f7f3ea; --ink:#2b2620; --ink2:#595246; --line:#d2c9b3; }
}
.ge[data-theme="light"] { --bg:#f7f3ea; --ink:#2b2620; --ink2:#595246; --line:#d2c9b3; }
.ge[data-theme="dark"] { --bg:#0a0812; --ink:#f2ebe5; --ink2:#a8a2b5; --line:#2a2638; }
`;

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The theme class next-themes put on <html>, read DURING render — before
  // this boundary's own <html> replaces it. Rendered on the server (a first
  // load that failed) there is no document: the system scheme stands.
  const [scheme] = useState<"light" | "dark" | undefined>(() => {
    if (typeof document === "undefined") return undefined;
    const cls = document.documentElement.classList;
    if ([...LIGHT_THEMES].some((t) => cls.contains(t))) return "light";
    if (cls.contains("midnight") || cls.contains("contrast")) return "dark";
    return undefined;
  });
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  const calm = looksLikeDbError(error?.message) || isRedactedServerError(error ?? {});

  return (
    <html lang="en">
      <body
        className="ge"
        data-theme={scheme}
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--ink)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>
            {calm ? "We couldn’t reach the data" : "Something went wrong"}
          </h1>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>
            {calm
              ? "The database didn’t respond just now — this is usually a brief blip. Give it a moment, then try again."
              : "The app hit an unexpected error. Please try again."}
          </p>
          {error?.digest && (
            <p style={{ color: "var(--ink2)", fontSize: 11, marginTop: 8, fontFamily: "monospace" }}>
              ref: {error.digest}
            </p>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              padding: "8px 16px",
              borderRadius: 8,
              // Neutral on every theme — the brand pink belonged to Midnight.
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
