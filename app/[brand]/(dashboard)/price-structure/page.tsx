import { brandRedirect } from "@/lib/brand-redirect";

/** The module's index is its Overview; the open version travels along. */
export default async function PriceStructureIndex({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  return brandRedirect(v ? `/price-structure/overview?v=${encodeURIComponent(v)}` : "/price-structure/overview");
}
