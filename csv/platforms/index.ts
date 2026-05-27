import { metaAdapter } from "@/csv/platforms/meta";
import { tiktokAdapter } from "@/csv/platforms/tiktok";
import { snapchatAdapter } from "@/csv/platforms/snapchat";
import { googleAdapter } from "@/csv/platforms/google";
import type { PlatformAdapter } from "@/csv/platforms/types";

export const ADAPTERS: Record<PlatformAdapter["platform"], PlatformAdapter> = {
  meta: metaAdapter,
  tiktok: tiktokAdapter,
  snapchat: snapchatAdapter,
  google: googleAdapter,
};
