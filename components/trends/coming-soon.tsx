import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Placeholder for Trends sub-pages whose implementation is queued. Keeps the
 * IA navigable end-to-end while we build them out.
 */
export function ComingSoon({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/trends"
          className="inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink transition-colors mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Trends
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-4xl tracking-tight">{title}</h1>
          <span className="inline-flex items-center h-5 px-1.5 rounded text-[10px] border border-line text-ink-3 bg-surface-2">
            Coming soon
          </span>
        </div>
        <p className="text-ink-2 text-sm mt-2">{description}</p>
      </div>

      <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-8">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-3 mb-3">
          What it will answer
        </div>
        <ul className="space-y-2 text-sm text-ink-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-ink-3 mt-0.5">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
