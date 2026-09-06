import { describe, it, expect } from "vitest";
import { shouldOfferUpdate } from "../src/should-offer.js";

/**
 * F054.8 — the decision, with NO service worker, NO DOM and no fake container.
 * That is the point of splitting it out: every branch is reachable from three
 * plain values, so none of it rests on a fake being faithful.
 */
const W = { fake: "waiting worker" };

describe("shouldOfferUpdate", () => {
  it("offers when a worker is waiting and nothing is snoozed", () => {
    expect(shouldOfferUpdate({ waiting: W, snoozedUntil: null, now: 1000 })).toBe(true);
  });

  it("does NOT offer when nothing is waiting — the whole question is 'is one waiting'", () => {
    expect(shouldOfferUpdate({ waiting: null, snoozedUntil: null, now: 1000 })).toBe(false);
    expect(shouldOfferUpdate({ waiting: undefined, snoozedUntil: null, now: 1000 })).toBe(false);
  });

  it("does NOT offer while snoozed", () => {
    expect(shouldOfferUpdate({ waiting: W, snoozedUntil: 2000, now: 1000 })).toBe(false);
  });

  it("offers again the moment the snooze expires — Later, never never", () => {
    expect(shouldOfferUpdate({ waiting: W, snoozedUntil: 1000, now: 1000 })).toBe(true);
    expect(shouldOfferUpdate({ waiting: W, snoozedUntil: 999, now: 1000 })).toBe(true);
  });

  it("a snooze cannot resurrect an offer that has no worker behind it", () => {
    // The ORDER of the two guards is load-bearing: an expired snooze must not
    // read as "yes" when nothing is waiting.
    expect(shouldOfferUpdate({ waiting: null, snoozedUntil: 1, now: 1000 })).toBe(false);
  });

  it("a snooze in the past is indistinguishable from no snooze at all", () => {
    expect(shouldOfferUpdate({ waiting: W, snoozedUntil: 0, now: 1000 })).toBe(
      shouldOfferUpdate({ waiting: W, snoozedUntil: null, now: 1000 }),
    );
  });
});
