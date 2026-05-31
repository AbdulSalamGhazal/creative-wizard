import { notFound } from "next/navigation";
import { getCreativeByName, listAllTags } from "@/db/queries/creatives";
import { listProducts } from "@/db/queries/products";
import { CreativeEditForm } from "@/components/creative/creative-edit-form";

export default async function EditCreativePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const [creative, products, allTags] = await Promise.all([
    getCreativeByName(decoded),
    listProducts(),
    listAllTags(),
  ]);
  if (!creative) notFound();

  return (
    <CreativeEditForm
      creative={{
        id: creative.id,
        name: creative.name,
        productId: creative.productId,
        type: creative.type,
        status: creative.status,
        launchDate: creative.launchDate,
        notes: creative.notes,
        thumbnailUrl: creative.thumbnailUrl,
        tags: creative.tags,
      }}
      products={products}
      allTags={allTags}
    />
  );
}
