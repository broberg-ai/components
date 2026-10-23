// F053.14 — direct charges, multi-secret webhooks, account allow-list, direct refunds.
import { describe, it, expect, vi } from "vitest";
import StripeCtor from "stripe";
import { buildConnectCheckout, createStripeWebhookHandler, refundDirectCharge, type Stripe } from "../src/index.js";

function mockStripe() {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, _opts?: Stripe.RequestOptions) => ({ id: "cs_1", ...params }));
  return { stripe: { checkout: { sessions: { create } } } as unknown as Stripe, create };
}

const common = { successUrl: "https://x/ok", cancelUrl: "https://x/no", destination: "acct_1", metadata: { kind: "booking" } };

describe("buildConnectCheckout — destination parity with 0.4.1", () => {
  // Frozen from 0.4.1's output. The destination branch must not move a byte.
  const FROZEN_PAYMENT = {
    mode: "payment",
    line_items: [{ price: "price_1", quantity: 1 }],
    success_url: "https://x/ok",
    cancel_url: "https://x/no",
    metadata: { kind: "booking" },
    customer: "cus_1",
    payment_intent_data: { description: "d", on_behalf_of: "acct_1", transfer_data: { destination: "acct_1" }, application_fee_amount: 100 },
  };
  const FROZEN_SUB = {
    mode: "subscription",
    line_items: [{ price: "price_s", quantity: 1 }],
    success_url: "https://x/ok",
    cancel_url: "https://x/no",
    metadata: { kind: "booking" },
    subscription_data: { on_behalf_of: "acct_1", transfer_data: { destination: "acct_1" }, application_fee_percent: 10 },
  };

  for (const chargeType of [undefined, "destination"] as const) {
    it(`payment (chargeType=${chargeType}) is identical and takes no request options`, async () => {
      const { stripe, create } = mockStripe();
      await buildConnectCheckout(stripe, { ...common, chargeType, mode: "payment", lineItems: [{ price: "price_1", quantity: 1 }], applicationFeeAmount: 100, customer: "cus_1", paymentIntentData: { description: "d" } });
      expect(create.mock.calls[0].length).toBe(1);
      expect(JSON.stringify(create.mock.calls[0][0])).toBe(JSON.stringify(FROZEN_PAYMENT));
    });
    it(`subscription (chargeType=${chargeType}) is identical and takes no request options`, async () => {
      const { stripe, create } = mockStripe();
      await buildConnectCheckout(stripe, { ...common, chargeType, mode: "subscription", lineItems: [{ price: "price_s", quantity: 1 }], applicationFeePercent: 10 });
      expect(create.mock.calls[0].length).toBe(1);
      expect(JSON.stringify(create.mock.calls[0][0])).toBe(JSON.stringify(FROZEN_SUB));
    });
  }
});

describe("buildConnectCheckout — direct", () => {
  it("payment: no routing, fee kept, created ON the connected account", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, { ...common, chargeType: "direct", mode: "payment", lineItems: [{ price: "price_1", quantity: 1 }], applicationFeeAmount: 100, paymentIntentData: { description: "d" } });
    const [params, opts] = create.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_1" });
    expect(params.payment_intent_data).toEqual({ description: "d", application_fee_amount: 100 });
  });
  it("payment: carries no on_behalf_of and no transfer_data", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, { ...common, chargeType: "direct", mode: "payment", lineItems: [{ price: "price_1", quantity: 1 }], applicationFeeAmount: 50 });
    const pid = create.mock.calls[0][0].payment_intent_data!;
    expect("on_behalf_of" in pid).toBe(false);
    expect("transfer_data" in pid).toBe(false);
    expect(pid.application_fee_amount).toBe(50);
  });
  it("subscription: application_fee_percent kept, no routing, stripeAccount set", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, { ...common, chargeType: "direct", mode: "subscription", lineItems: [{ price: "price_s", quantity: 1 }], applicationFeePercent: 10 });
    const [params, opts] = create.mock.calls[0];
    expect(opts).toEqual({ stripeAccount: "acct_1" });
    expect(params.subscription_data).toEqual({ application_fee_percent: 10 });
    expect(params.payment_intent_data).toBeUndefined();
  });
});

// Real signatures, made by Stripe's own SDK — not a mocked constructEvent.
const real = new StripeCtor("sk_test_x");
const signed = (payload: object, secret: string) => {
  const body = JSON.stringify(payload);
  return { body, sig: real.webhooks.generateTestHeaderString({ payload: body, secret }) };
};
const PLATFORM = "whsec_platform";
const CONNECT = "whsec_connect";

describe("createStripeWebhookHandler — several secrets", () => {
  it("verifies an event signed with either secret, refuses one signed with neither", async () => {
    const seen: string[] = [];
    const handle = createStripeWebhookHandler({ stripe: real, secret: [PLATFORM, CONNECT], handlers: { "charge.refunded": (e) => void seen.push(e.id) } });
    const a = signed({ id: "evt_platform", type: "charge.refunded", object: "event" }, PLATFORM);
    const b = signed({ id: "evt_connect", type: "charge.refunded", object: "event", account: "acct_1" }, CONNECT);
    const c = signed({ id: "evt_forged", type: "charge.refunded", object: "event" }, "whsec_other");
    expect((await handle(a.body, a.sig)).status).toBe(200);
    expect((await handle(b.body, b.sig)).status).toBe(200);
    const bad = await handle(c.body, c.sig);
    expect(bad.status).toBe(400);
    expect(bad.ok).toBe(false);
    expect(seen).toEqual(["evt_platform", "evt_connect"]);
  });
  it("a single string secret still works (unchanged)", async () => {
    const handle = createStripeWebhookHandler({ stripe: real, secret: PLATFORM, handlers: {} });
    const a = signed({ id: "evt_1", type: "x", object: "event" }, PLATFORM);
    expect((await handle(a.body, a.sig)).status).toBe(200);
  });
});

describe("createStripeWebhookHandler — allowedAccounts", () => {
  const run = async (allowedAccounts: string[] | undefined, account: string | undefined) => {
    const handler = vi.fn();
    const handle = createStripeWebhookHandler({ stripe: real, secret: CONNECT, allowedAccounts, handlers: { "checkout.session.completed": handler } });
    const e = signed({ id: "evt", type: "checkout.session.completed", object: "event", ...(account ? { account } : {}) }, CONNECT);
    return { res: await handle(e.body, e.sig), handler };
  };
  it("an account NOT on the list is never dispatched, and is acked 200 so Stripe does not retry", async () => {
    const { res, handler } = await run(["acct_1"], "acct_stranger");
    expect(handler).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(200);
    expect(res.error).toBe("event.account acct_stranger is not in allowedAccounts");
  });
  it("an account on the list is dispatched and the handler can read event.account", async () => {
    const { res, handler } = await run(["acct_1"], "acct_1");
    expect(res.ok).toBe(true);
    expect((handler.mock.calls[0][0] as Stripe.Event).account).toBe("acct_1");
  });
  it("a platform event (no event.account) passes as before", async () => {
    const { res, handler } = await run(["acct_1"], undefined);
    expect(res.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("without allowedAccounts any account is dispatched (unchanged)", async () => {
    const { res, handler } = await run(undefined, "acct_stranger");
    expect(res.ok).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("refundDirectCharge", () => {
  it("refunds on the connected account, with the application fee, and no reverse_transfer", async () => {
    const create = vi.fn(async () => ({ id: "re_1" }));
    const stripe = { refunds: { create } } as unknown as Stripe;
    await refundDirectCharge(stripe, { paymentIntent: "pi_1", account: "acct_1" });
    await refundDirectCharge(stripe, { paymentIntent: "pi_2", account: "acct_1", amount: 500 });
    expect(create.mock.calls[0]).toEqual([{ payment_intent: "pi_1", refund_application_fee: true }, { stripeAccount: "acct_1" }]);
    expect(create.mock.calls[1]).toEqual([{ payment_intent: "pi_2", refund_application_fee: true, amount: 500 }, { stripeAccount: "acct_1" }]);
  });
});
