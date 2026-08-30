import type { PwaUpdaterOptions } from "./index.js";

/**
 * A stable identity for an options object, for an adapter's effect dependency.
 *
 * F054.7 — WHY THIS EXISTS INSTEAD OF A DEPENDENCY LIST. Both adapters used to
 * destructure four named options and list those same four as their effect deps.
 * That is a second copy of the core's option list, and it had already drifted:
 * `register` and `updateOnFocus` were never forwarded, so a consumer writing
 * `register: false` got a service-worker registration anyway, with no error and
 * no warning. fd-sundhed found it by reading our shipped dist, which is not a
 * detector anyone should need.
 *
 * Deriving the key from the options the CALLER passed means a new core option
 * reaches both adapters with neither adapter edited. The list was the defect —
 * not the two names missing from it.
 *
 * Keys are SORTED so `{a, b}` and `{b, a}` are the same identity, and
 * `undefined` values are dropped so an explicitly-omitted option and an absent
 * one do not look like different configurations.
 */
export function optionsKey(options: PwaUpdaterOptions): string {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
