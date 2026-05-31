import { instagramAdapter } from "@/csv/platforms/instagram";
import { facebookAdapter } from "@/csv/platforms/facebook";
import { tiktokAdapter } from "@/csv/platforms/tiktok";
import { snapchatAdapter } from "@/csv/platforms/snapchat";
import { googleAdapter } from "@/csv/platforms/google";
import type { PlatformAdapter } from "@/csv/platforms/types";

export const ADAPTERS: Record<PlatformAdapter["platform"], PlatformAdapter> = {
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  tiktok: tiktokAdapter,
  snapchat: snapchatAdapter,
  google: googleAdapter,
};
