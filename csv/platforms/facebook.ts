/**
 * Facebook (Meta Ads Manager export) CSV adapter. Shares the Meta export
 * format with Instagram — see `instagram.ts` for the header map and quirks.
 * The two are distinct platforms; the user picks which one a file is at upload.
 */
import type { PlatformAdapter } from "@/csv/platforms/types";
import {
  META_DATE_FORMATS,
  META_HEADER_MAP,
  META_REQUIRED_FIELDS,
  metaSkipRow,
} from "@/csv/platforms/instagram";

export const facebookAdapter: PlatformAdapter = {
  platform: "facebook",
  headerMap: META_HEADER_MAP,
  requiredFields: META_REQUIRED_FIELDS,
  acceptedDateFormats: META_DATE_FORMATS,
  skipRow: metaSkipRow,
};

export default facebookAdapter;
