/**
 * The ONE upload size limit, for every surface (D5, 2026-10-23): 4 MB. It is
 * what actually fits — Vercel refuses a function request body over 4.5 MB, and
 * the server-action surfaces (store orders, bulk creatives, the Budget sheet)
 * accept 4.5 MB through `serverActions.bodySizeLimit` (next.config.ts). Every
 * screen used to promise 10 MB while files over 1 MB failed, some by hanging.
 *
 * Its own dependency-free module (W2-6, 2026-10): the upload DROPZONE needs
 * these three constants in the browser, and importing them from `csv/parse`
 * pulled papaparse and the whole SheetJS reader into three pages' bundles.
 * `csv/parse` re-exports them, so server code is unchanged.
 */
export const MAX_FILE_MB = 4;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
/** E001's sentence — one wording wherever a file is too big. */
export const FILE_TOO_LARGE_MESSAGE = `File exceeds the ${MAX_FILE_MB} MB upload limit.`;
