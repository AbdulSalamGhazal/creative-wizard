import { redirect } from "next/navigation";

// The Store module split into /store/orders (table) + /store/uploads (history).
// Bare /store lands on the orders table, like /admin/products → /admin/catalog.
export default function StoreIndexRedirect() {
  redirect("/store/orders");
}
