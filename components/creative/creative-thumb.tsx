import Image from "next/image";

/**
 * A creative's thumbnail at TABLE-CELL size — the same `next/image` the
 * Library grid's card renders, shrunk to a 32 px square so it fits a row
 * without changing its height much. No thumbnail is a dash, like every other
 * empty cell. Decorative next to the name, so the alt is the name and the
 * cell's CSV value is the URL (each consumer says so).
 */
export function CreativeThumb({ url, name }: { url: string | null; name: string }) {
  if (!url) return <span className="text-ink-3">—</span>;
  return (
    <Image
      src={url}
      alt={name}
      width={32}
      height={32}
      sizes="32px"
      className="h-8 w-8 rounded-sm border border-line bg-surface-2 object-cover"
    />
  );
}
