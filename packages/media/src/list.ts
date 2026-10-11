// F006.8 — listing and deleting under a folder, shared by every provider.
import type { MediaStore } from "./types";
import { safeKey } from "./safe-key";

/** S3's page size, and therefore ours, so a page means the same on every provider. */
export const MAX_LIST = 1000;

export const clampLimit = (limit?: number) => Math.min(MAX_LIST, Math.max(1, Math.floor(limit ?? MAX_LIST)));

/**
 * A prefix is a FOLDER, never a string match: as a string, "kunder/1" also
 * matches "kunder/10/…", and a GDPR delete would then take another customer's
 * files with it. "kunder/1" and "kunder/1/" both become "kunder/1/". The same
 * key guard as upload refuses `..`, backslash and NUL. "" means everything,
 * which only list() may ask for.
 */
export function folderPrefix(prefix: string, provider: string, allowEverything: boolean): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") {
    if (!allowEverything) throw new Error(`media(${provider}): deletePrefix needs a folder; an empty prefix would empty the whole store`);
    return "";
  }
  return `${safeKey(trimmed, provider)}/`;
}

/**
 * Delete everything under a folder. It re-lists from the start each round
 * instead of following a cursor, because the keys it just deleted are what the
 * cursor would point past. A key that cannot be deleted throws, so this cannot
 * loop on it.
 */
export async function deleteUnder(store: Pick<MediaStore, "list" | "delete">, prefix: string, provider: string): Promise<{ deleted: number }> {
  folderPrefix(prefix, provider, false);
  let deleted = 0;
  let previous = "";
  for (;;) {
    const { keys } = await store.list(prefix);
    if (keys.length === 0) return { deleted };
    // A delete that reports success but leaves the object would otherwise loop
    // forever. Same page twice = the store did not delete what it said it did.
    const page = keys.join("\n");
    if (page === previous) {
      throw new Error(`media(${provider}): deletePrefix stopped — ${keys.length} object(s) under "${prefix}" are still there after being deleted (${deleted} removed before that); first: ${keys[0]}`);
    }
    previous = page;
    for (const key of keys) await store.delete(key);
    deleted += keys.length;
  }
}
