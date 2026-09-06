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
  /** Epoch ms until which the user has snoozed the offer, or null. */
  snoozedUntil: number | null;
  /** Epoch ms now. Passed in so the function stays pure and testable. */
  now: number;
}

/**
 * Should the consumer be offered the update right now?
 *
 * WHY `controller` IS NOT A TERM HERE, though the sketch we were shown had one
 * and the old code checked it on one of its two paths.
 *
 * The old updater answered this question inconsistently: the attach path
 * (`if (registration.waiting)`) offered with no controller check, while the
 * `updatefound` path required `container.controller` to suppress a first
 * install. Same situation, two answers, depending on which path happened to see
 * it. Making them agree is part of this fix — the question is which way.
 *
 * Requiring a controller would be the tighter rule, and it would REMOVE a banner
 * that some consumer sees today: a page that is not yet controlled (no
 * `clientsClaim`, or a hard reload) but has a genuine update waiting. With
 * fd-sundhed live to 16,838 people on the current version, a change in that
 * direction is not one to make on an unverified reading.
 *
 * And the reading in question is this: a worker only enters `waiting` when
 * another worker is already ACTIVE — on a first install there is nothing to wait
 * behind, so it activates directly. If that is right, `registration.waiting`
 * being non-null already implies this is not a first install, and the controller
 * term is redundant rather than protective. **I have not verified that against a
 * real service worker.** So the old, more permissive behaviour stays as the
 * floor, and first-install suppression rides on the same fact rather than on a
 * second guard that could disagree with it.
 *
 * If someone later measures that a first-install worker CAN sit in `waiting`,
 * this is the function to add the term to — and the test to write first is the
 * one that fails today.
 */
export function shouldOfferUpdate({ waiting, snoozedUntil, now }: ShouldOfferInput): boolean {
  if (!waiting) return false;
  if (snoozedUntil !== null && snoozedUntil > now) return false;
  return true;
}
