import { brandRedirect } from "@/lib/brand-redirect";

// Products admin moved to the Library in the 2026-09 IA pass.
export default async function ProductsAdminRedirect() {
  return brandRedirect("/library?tab=products");
}
