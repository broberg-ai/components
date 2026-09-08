import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { probeStripeShape, LiveKeyRefused } from "../src/probe.js";

// A fake Stripe. NOT a claim that the probe works against the real API — see
// AC#7 on the card: a stub cannot disagree with us. What these prove is the
// DECISION LOGIC: three outcomes, the location reported, the key refused,
// cleanup performed.
const END = 1790539830;
const START = 1787861430;

type Overrides = {
  sub?: Record<string, unknown>;
  throwOn?: string;
  failDelete?: boolean;
};

function fakeStripe(o: Overrides = {}) {
  const boom = (what: string) => {
    if (o.throwOn === what) {
      const e = new Error("getaddrinfo ENOTFOUND api.stripe.com");
      e.name = "StripeConnectionError";
      throw e;
    }
  };
  const deleted: string[] = [];
  const del = async (id: string) => {
    if (o.failDelete) throw new Error("nope");
    deleted.push(id);
    return { id, deleted: true };
  };
  const stripe = {
    _deleted: deleted,
    products: { create: async () => (boom("product"), { id: "prod_1" }), del },
    prices: { create: async () => ({ id: "price_1" }) },
    customers: { create: async () => (boom("customer"), { id: "cus_1" }), del },
    subscriptions: {
      create: async () => (
        boom("subscription"),
        o.sub ?? {
          id: "sub_1",
          items: { data: [{ current_period_start: START, current_period_end: END }] },
          latest_invoice: { parent: { subscription_details: { subscription: "sub_1" } } },
        }
      ),
      cancel: del,
    },
  };
  return stripe as unknown as Stripe & { _deleted: string[] };
}

const KEY = "sk_test_abc";

describe("probeStripeShape — the fields, not the uptime", () => {
  it("everything in the CURRENT location → ok, and it SAYS which location", async () => {
    const r = await probeStripeShape({ stripe: fakeStripe(), apiKey: KEY });
    expect(r.status).toBe("ok");
    // "it resolved" and "it resolved from where we expect" are separate claims,
    // so the location is asserted, not just the boolean.
    expect(r.readers.find((x) => x.reader === "readPeriod")).toEqual({
      reader: "readPeriod",
      resolved: true,
      from: "current",
    });
  });

  it("the period ONLY at the removed top level → DRIFT, naming the location", async () => {
    // This is F098.4 exactly: the reader still WORKS, because the fallback
    // catches it. That is what makes it an early warning rather than an outage.
    const r = await probeStripeShape({
      stripe: fakeStripe({
        sub: {
          id: "sub_1",
          items: { data: [{}] },
          current_period_start: START,
          current_period_end: END,
          latest_invoice: { parent: { subscription_details: { subscription: "sub_1" } } },
        },
      }),
      apiKey: KEY,
    });
    expect(r.status).toBe("drift");
    const p = r.readers.find((x) => x.reader === "readPeriod");
    expect(p?.resolved).toBe(true);
    expect(p?.from).toBe("deprecated");
  });

  it("no period ANYWHERE → drift, and the reader reports not-found", async () => {
    const r = await probeStripeShape({
      stripe: fakeStripe({ sub: { id: "sub_1", items: { data: [{}] }, latest_invoice: null } }),
      apiKey: KEY,
    });
    expect(r.status).toBe("drift");
    expect(r.readers.find((x) => x.reader === "readPeriod")).toEqual({
      reader: "readPeriod",
      resolved: false,
      from: "not-found",
    });
  });

  // THE OUTCOME THAT GETS COLLAPSED. Reported as drift it wakes someone for
  // Stripe's outage; reported as ok it hides a real move. Neither is a verdict
  // about our readers.
  it("a network failure is UNKNOWN — never drift, never ok", async () => {
    const r = await probeStripeShape({ stripe: fakeStripe({ throwOn: "product" }), apiKey: KEY });
    expect(r.status).toBe("unknown");
    expect(r.status).not.toBe("drift");
    expect(r.reason).toMatch(/could not reach Stripe/);
  });

  it("unknown is reachable at EVERY create step, not just the first", async () => {
    for (const step of ["product", "customer", "subscription"]) {
      const r = await probeStripeShape({ stripe: fakeStripe({ throwOn: step }), apiKey: KEY });
      expect(r.status, `throwing on ${step}`).toBe("unknown");
    }
  });

  it("REFUSES a live key, before it creates anything", async () => {
    const stripe = fakeStripe();
    await expect(probeStripeShape({ stripe, apiKey: "sk_live_real" })).rejects.toBeInstanceOf(
      LiveKeyRefused,
    );
    // The refusal must happen BEFORE the first write. A refusal after one
    // create is not a refusal.
    expect(stripe._deleted).toHaveLength(0);
  });

  it("cleans up what it created, and SAYS so", async () => {
    const r = await probeStripeShape({ stripe: fakeStripe(), apiKey: KEY });
    expect(r.cleanedUp).toEqual(["subscription:sub_1", "customer:cus_1", "product:prod_1"]);
    expect(r.leaked).toEqual([]);
  });

  it("a LEAK is reported rather than swallowed", async () => {
    // A monitor that leaks a subscription per run is a monitor someone turns
    // off. Silence about it is how that goes unnoticed for a month.
    const r = await probeStripeShape({ stripe: fakeStripe({ failDelete: true }), apiKey: KEY });
    expect(r.leaked).toEqual(["subscription:sub_1", "customer:cus_1", "product:prod_1"]);
    expect(r.cleanedUp).toEqual([]);
  });

  it("cleanup runs even when the probe could not reach Stripe", async () => {
    const r = await probeStripeShape({ stripe: fakeStripe({ throwOn: "subscription" }), apiKey: KEY });
    expect(r.status).toBe("unknown");
    expect(r.cleanedUp).toEqual(["customer:cus_1", "product:prod_1"]);
  });
});
