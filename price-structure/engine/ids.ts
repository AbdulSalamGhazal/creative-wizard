/**
 * Ids for the entities INSIDE a version document (products, offers, targets,
 * plans, periods). They are minted wherever the edit happens — in the browser
 * as the user adds things, on the server for sample/blank data — so they come
 * from the Web Crypto API both sides share.
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
