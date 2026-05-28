import { redirect } from "next/navigation";

// CSV column mapping moved into the merged Catalog tab.
export default function PlatformsAdminRedirect() {
  redirect("/admin/catalog?tab=mapping");
}
