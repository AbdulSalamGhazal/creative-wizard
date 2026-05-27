import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { CreativeCreateForm } from "@/components/creative/creative-create-form";

export default async function NewCreativePage() {
  const [products, allTags] = await Promise.all([listProducts(), listAllTags()]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/creatives"
          className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to library
        </Link>
        <h1 className="font-display text-4xl tracking-tight mt-3">
          New creative
        </h1>
        <p className="text-ink-2 text-sm mt-1">
          Register the creative once, then CSV rows referencing this name will
          import cleanly. Names are case- and whitespace-sensitive (see{" "}
          <code className="font-mono text-brand-2">
            docs/validation-spec.md
          </code>{" "}
          §4).
        </p>
      </div>

      <CreativeCreateForm products={products} allTags={allTags} />
    </div>
  );
}
