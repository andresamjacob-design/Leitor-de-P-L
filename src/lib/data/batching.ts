/**
 * Splitting long `in.(...)` filters.
 *
 * PostgREST puts filters in the **query string**, so a list of ids travels in the URL and
 * servers reject anything past roughly 8 KB. The failure surfaces as a bare
 * `TypeError: fetch failed` with nothing pointing at the length — it cost a real import to
 * find, on the very first file (see the dedup check in `imports.ts`).
 *
 * The limits below keep each URL near 3 KB, which leaves room for the rest of the query.
 */

/** A sha256 is 64 characters; 50 of them is about 3,4 KB of URL. */
export const HASH_BATCH = 50;

/** A uuid is 36 characters; 80 of them is about 3,3 KB. */
export const UUID_BATCH = 80;

export function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}
