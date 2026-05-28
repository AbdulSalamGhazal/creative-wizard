import { redirect } from "next/navigation";

// Products admin moved into the merged Catalog tab.
export default function ProductsAdminRedirect() {
  redirect("/admin/catalog?tab=products");
}
