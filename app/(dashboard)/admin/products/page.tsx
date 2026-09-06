import { redirect } from "next/navigation";

// Products admin moved to the Library in the 2026-09 IA pass.
export default function ProductsAdminRedirect() {
  redirect("/creatives?tab=products");
}
