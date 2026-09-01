import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Stripe from "stripe";
import { readSubscriptionId, readPeriod } from "../src/fields.js";

/**
 * F053.10 — the fields Stripe moved.
 *
 * The invoice fixture is a trimmed, anonymised copy of a REAL invoice from
 * sanneandersen's live account (2026-04-22.dahlia), FETCHED rather than written.
 * That provenance is the point: a hand-written imitation would confirm the
 * author's understanding of the shape, and a wrong understanding of the shape
 * was the bug.
 *
 * BOTH FIXTURES ARE NOW FETCHED. The subscription one was constructed at first,
 * and that was said out loud rather than blurred — sanne had measured the number
 * but never saved the object, so the period tests carried a weaker claim than
 * the id tests. They went and pulled the real one with subscriptions.retrieve
 * when asked. The constructed shapes below are kept ALONGSIDE it, because they
 * isolate one branch each; the live object proves the shape they are modelling
 * is the shape Stripe actually sends.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(join(HERE, "__fixtures__/dahlia-invoice.json"), "utf-8")) as {
  dahlia: Stripe.Invoice;
  legacy: Stripe.Invoice;
  no_subscription: Stripe.Invoice;
};

const LIVE_SUB = (
  JSON.parse(readFileSync(join(HERE, "__fixtures__/dahlia-subscription.json"), "utf-8")) as {
    subscription: Stripe.Subscription;
  }
).subscription;

const EXPECTED = "sub_TESTabonnement";
/** The naive read that broke: `invoice.subscription`, straight off the object. */
const oldRead = (inv: unknown) => (inv as { subscription?: unknown }).subscription;

describe("can this suite even SEE the failure?", () => {
  // Without these, everything below would be green whether or not anything was
  // fixed — the tests would pass on a payload that never had the problem.
  it("the OLD read finds nothing on the payload Stripe sends today", () => {
    expect(oldRead(F.dahlia)).toBeUndefined();
  });

  it("and the key is ABSENT, not merely null — a null you can test for, a gone field you cannot", () => {
    expect(Object.prototype.hasOwnProperty.call(F.dahlia, "subscription")).toBe(false);
  });

  it("the fixture carries no field asserting its own shape", () => {
    // A fixture whose value is that nobody wrote it must not carry a fact
    // somebody wrote in it. sanne's original had `has_own_subscription_key`;
    // the claim belongs in the assertion above, against the object itself.
    expect("has_own_subscription_key" in (F.dahlia as object)).toBe(false);
  });
});

describe("readSubscriptionId — each location asserted on its own", () => {
  // Separately, so a chain that silently only ever uses one branch is caught.
  it("1 · parent.subscription_details, with no lines to fall back to", () => {
    const parentOnly = {
      ...F.dahlia,
      lines: { object: "list", data: [] },
    } as unknown as Stripe.Invoice;
    expect(readSubscriptionId(parentOnly)).toBe(EXPECTED);
  });

  it("2 · the invoice LINE, with parent gone", () => {
    const lineOnly = { ...F.dahlia, parent: null } as unknown as Stripe.Invoice;
    expect(readSubscriptionId(lineOnly)).toBe(EXPECTED);
  });

  it("3 · the REMOVED top-level field, for a stored older payload", () => {
    // A webhook replay of an event captured before dahlia still has this shape.
    // Dropping it would turn a replay into a second outage.
    expect(readSubscriptionId(F.legacy)).toBe(EXPECTED);
    expect(oldRead(F.legacy)).toBe(EXPECTED); // and it really is the only source here
  });

  it("the whole fixture, unmodified, resolves", () => {
    expect(readSubscriptionId(F.dahlia)).toBe(EXPECTED);
  });

  it("the NEW location wins over a stale legacy field", () => {
    // Precedence asserted where it is VISIBLE. Every other case has exactly one
    // source, so a swapped order returns the same id and nothing goes red — the
    // fallback chain would be untested in the one direction that matters. A
    // stored payload straddling the change carries both, and the old one is the
    // stale one.
    const both = {
      ...F.dahlia,
      subscription: "sub_STALE",
    } as unknown as Stripe.Invoice;
    expect(readSubscriptionId(both)).toBe(EXPECTED);

    const lineVsLegacy = {
      ...F.dahlia,
      parent: null,
      subscription: "sub_STALE",
    } as unknown as Stripe.Invoice;
    expect(readSubscriptionId(lineVsLegacy)).toBe(EXPECTED);
  });

  it("an expanded object rather than a string", () => {
    expect(readSubscriptionId({ subscription: { id: EXPECTED } } as unknown as Stripe.Invoice)).toBe(
      EXPECTED,
    );
  });

  it("a one-off invoice has no subscription, and that is not an error", () => {
    expect(readSubscriptionId(F.no_subscription)).toBeNull();
  });

  it("scans EVERY line, not just the first", () => {
    // A renewal invoice can carry a proration credit, and nothing guarantees
    // the subscription line comes first. Reading index 0 alone would fall
    // through to the REMOVED field and answer null — the same silent no-op.
    // CONSTRUCTED, not measured: we infer this shape from how proration works,
    // we have not seen one. sanne's original read index 0.
    const prorationFirst = {
      ...F.dahlia,
      parent: null,
      lines: {
        object: "list",
        data: [
          { id: "il_PRORATION", parent: { invoice_item_details: {}, subscription_item_details: null } },
          (F.dahlia as unknown as { lines: { data: unknown[] } }).lines.data[0],
        ],
      },
    } as unknown as Stripe.Invoice;
    expect(readSubscriptionId(prorationFirst)).toBe(EXPECTED);
  });
});

describe("readSubscriptionId — foreign input returns null, never throws", () => {
  // A throw here means the webhook never acknowledges the event and Stripe
  // retries it forever.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a string", "in_123"],
    ["a number", 42],
    ["an empty string id", { subscription: "" }],
    ["fields of the WRONG TYPE", { parent: "nope", lines: 7, subscription: { id: 12 } }],
    ["a lines.data that is not an array", { lines: { data: { 0: { parent: {} } } } }],
    ["a null entry inside lines.data", { lines: { data: [null] } }],
  ])("%s", (_label, input) => {
    expect(() => readSubscriptionId(input as unknown as Stripe.Invoice)).not.toThrow();
    expect(readSubscriptionId(input as unknown as Stripe.Invoice)).toBeNull();
  });
});

describe("sanne's actual outage: a declined payment that triggered nothing", () => {
  /**
   * F102, reproduced. `invoice.payment_failed` arrived in dahlia form, the
   * branch read `invoice.subscription`, got undefined and fell out with
   * `break`. No status change, no message — and because a missing end date
   * means "gift without expiry" in their access rule, the customer kept full
   * access without paying. Nothing logged, nothing threw.
   */
  const event = {
    type: "invoice.payment_failed",
    data: { object: F.dahlia },
  } as unknown as Stripe.Event;
  const invoice = (event.data as { object: Stripe.Invoice }).object;

  it("the old read gives undefined — this is the branch falling out", () => {
    expect(oldRead(invoice)).toBeUndefined();
  });

  it("and the package read resolves the same payload", () => {
    expect(readSubscriptionId(invoice)).toBe(EXPECTED);
  });
});

describe("readPeriod — milliseconds, from wherever Stripe put them", () => {
  const END = 1790539830;
  const START = 1787861430;

  it("the REAL subscription: the root field is GONE, the item carries it", () => {
    // Fetched, not written — sanne pulled it from their live account with
    // subscriptions.retrieve on 2026-04-22.dahlia after we asked. Same
    // provenance as the invoice fixture, so the period tests no longer carry a
    // weaker claim than the id tests.
    //
    // The pre-check first, for the same reason as above: without it the test
    // below would be green on a payload that never had the problem.
    expect(Object.prototype.hasOwnProperty.call(LIVE_SUB, "current_period_end")).toBe(false);
    expect((LIVE_SUB as unknown as { current_period_end?: unknown }).current_period_end).toBeUndefined();

    expect(readPeriod(LIVE_SUB)).toEqual({ start: START * 1000, end: END * 1000 });
  });

  it("from the ITEM, where Stripe puts it now", () => {
    const sub = {
      items: { data: [{ current_period_start: START, current_period_end: END }] },
    } as unknown as Stripe.Subscription;
    expect(readPeriod(sub)).toEqual({ start: START * 1000, end: END * 1000 });
  });

  it("falls back to the TOP LEVEL, for an older stored payload", () => {
    const sub = {
      items: { data: [{}] },
      current_period_start: START,
      current_period_end: END,
    } as unknown as Stripe.Subscription;
    expect(readPeriod(sub)).toEqual({ start: START * 1000, end: END * 1000 });
  });

  it("the ITEM WINS when both carry a value", () => {
    // Precedence asserted on its own: with both present, a swapped order would
    // still return a plausible date, so equality on the item's value is the
    // only thing that separates the two.
    const sub = {
      items: { data: [{ current_period_start: START, current_period_end: END }] },
      current_period_start: 1,
      current_period_end: 2,
    } as unknown as Stripe.Subscription;
    expect(readPeriod(sub).end).toBe(END * 1000);
  });

  it("NEITHER location: nulls, not a guess", () => {
    // The old code guessed `now + 30 days` here. A guessed date looks right and
    // is never noticed; a missing one is.
    expect(readPeriod({ items: { data: [{}] } } as unknown as Stripe.Subscription)).toEqual({
      start: null,
      end: null,
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a string", "sub_123"],
    ["items.data not an array", { items: { data: "nope" } }],
    ["a period of the WRONG TYPE", { items: { data: [{ current_period_end: "1790539830" }] } }],
    ["zero, which is not a date", { current_period_end: 0, current_period_start: 0 }],
    ["a negative timestamp", { current_period_end: -5, current_period_start: -5 }],
    ["NaN", { current_period_end: NaN, current_period_start: NaN }],
  ])("foreign input — %s — gives nulls and does not throw", (_label, input) => {
    expect(() => readPeriod(input as unknown as Stripe.Subscription)).not.toThrow();
    expect(readPeriod(input as unknown as Stripe.Subscription)).toEqual({ start: null, end: null });
  });

  it("null means COULD NOT READ, never 'no expiry'", () => {
    // The distinction this package must not let a consumer lose. F098.4 was an
    // access rule reading a null end date as an unlimited gift, so an unreadable
    // field became free lifetime access for a cancelled subscription. The
    // package cannot enforce the consumer's rule; it can refuse to hand back
    // anything that looks like a decision.
    const unreadable = readPeriod({ items: { data: [{}] } } as unknown as Stripe.Subscription);
    expect(unreadable.end).toBeNull();
    expect(unreadable.end).not.toBe(0);
    expect(unreadable.end).not.toBe(Infinity);
  });
});
