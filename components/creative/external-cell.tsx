"use client";

/**
 * A URL cell: a short link out, never the raw URL stretching the column.
 * Shared by every table that offers a creative's source link or thumbnail URL
 * (the Library, the campaign / landing page creatives table), so the field
 * looks the same wherever it appears. The click never reaches the row.
 */
export function ExternalCell({ url }: { url: string | null }) {
  if (!url) return <span className="text-ink-3">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      onClick={(e) => e.stopPropagation()}
      className="text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
    >
      Open
    </a>
  );
}
