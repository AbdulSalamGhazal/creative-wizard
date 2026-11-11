import { brandRedirect } from "@/lib/brand-redirect";

// CSV column mapping (with platform readiness merged in) moved to the ads
// Uploads page in the 2026-09 IA pass.
export default async function PlatformsAdminRedirect() {
  return brandRedirect("/uploads?tab=mapping");
}
