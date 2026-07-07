import { redirect } from "next/navigation";

// Access management was merged into the unified Team page.
export default function AccessAdminRedirect() {
  redirect("/admin/users");
}
