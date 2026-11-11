import { brandRedirect } from "@/lib/brand-redirect";

// Access management was merged into the unified Team page.
export default async function AccessAdminRedirect() {
  return brandRedirect("/admin/users");
}
