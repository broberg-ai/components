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
 *
 * THE ONE BOUNDARY, stated because the claim above is otherwise broader than
 * what is true: the identity is JSON, so a value JSON cannot express collapses.
 * Measured — `{onError: () => 1}` and `{onError: () => 2}` produce the byte-
 * identical key `[["onError",null]]`, so a caller swapping the callback would
 * keep the first updater and never see the new one take effect. Every option
 * the core has today is a string, number or boolean, so nothing is affected;
 * this is here for whoever adds the first FUNCTION option (an `onUpdateReady`
 * is the obvious candidate). That option must be given its own identity here,
 * not merely added to the core.
 */
export function optionsKey(options: PwaUpdaterOptions): string {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
