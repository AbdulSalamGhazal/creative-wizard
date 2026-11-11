import { brandRedirect } from "@/lib/brand-redirect";

// The Store module split into /store/orders (table) + /store/uploads (history).
// Bare /store lands on the orders table, like /admin/products → /admin/catalog.
export default async function StoreIndexRedirect() {
  return brandRedirect("/store/orders");
}
