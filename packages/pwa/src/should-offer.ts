/**
 * F054.8 — the decision, as a pure function.
 *
 * Split out so it can be proven with NO service worker, NO DOM and no fake
 * container: every branch is reachable from three plain values. The rest of the
 * updater is plumbing around this.
 *
 * Why it is a function and not a flag: the old updater REMEMBERED whether an
 * update was ready instead of READING whether one is waiting, so the answer
 * could only ever be given once.
 */
export interface ShouldOfferInput {
  /** `registration.waiting` — read fresh at the moment of the decision. */
  waiting: unknown;
  /** `registration.active` — the worker an update would REPLACE. Read fresh too. */
  active: unknown;
  /** Epoch ms until which the user has snoozed the offer, or null. */
  snoozedUntil: number | null;
  /** Epoch ms now. Passed in so the function stays pure and testable. */
  now: number;
}

/**
 * Should the consumer be offered the update right now?
 *
 * Three terms: something WAITING, something ACTIVE for it to replace, and no
 * snooze.
 *
 * F021.11 — THE `active` TERM, and why the earlier reasoning here was wrong.
 * This comment used to argue that `registration.waiting` being non-null already
 * implied «not a first install», and said in as many words that it had not been
 * verified against a real service worker. The spec's Install algorithm says
 * otherwise: the installed worker is set as `registration.waiting` and fires
 * `statechange` → `installed` on EVERY install, and only afterwards does Try
 * Activate promote it when nothing is active. The updater checks on exactly that
 * `installed` event, so a first visit raised «Ny version klar» (vn-leker,
 * measured in production) and kept it up until the next check.
 *
 * `active`, not `controller`: a page that is not yet controlled (shift-reload, no
 * clientsClaim) but has a genuine update waiting still has the OLD worker active,
 * so it keeps its banner (the F054.9 case). Only a first install has nothing active.
 */
export function shouldOfferUpdate({ waiting, active, snoozedUntil, now }: ShouldOfferInput): boolean {
  if (!waiting) return false;
  if (!active) return false;
  if (snoozedUntil !== null && snoozedUntil > now) return false;
  return true;
}
