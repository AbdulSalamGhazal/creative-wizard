import { listProducts } from "@/db/queries/products";
import { listAllTags } from "@/db/queries/creatives";
import { CreativeCreateForm } from "@/components/creative/creative-create-form";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/layout/page-header";

export default async function NewCreativePage() {
  const [products, allTags] = await Promise.all([listProducts(), listAllTags()]);

  return (
    <PageShell width="form">
      <PageHeader
        backLink={{ href: "/creatives", label: "Back to library" }}
        title="New creative"
        subtitle="Names are case- and whitespace-sensitive — match your ad platform exactly so performance rows import cleanly."
      />

      <CreativeCreateForm products={products} allTags={allTags} />
    </PageShell>
  );
}
