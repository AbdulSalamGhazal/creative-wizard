import { redirect } from "next/navigation";

// CSV column mapping (with platform readiness merged in) moved to the ads
// Uploads page in the 2026-09 IA pass.
export default function PlatformsAdminRedirect() {
  redirect("/uploads?tab=mapping");
}
