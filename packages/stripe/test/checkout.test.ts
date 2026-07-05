import { describe, it, expect, vi } from "vitest";
import { buildConnectCheckout, type Stripe } from "../src/index.js";

function mockStripe() {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => ({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
    ...params,
  }));
  const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
  return { stripe, create };
}

describe("buildConnectCheckout", () => {
  it("payment mode stamps the destination-charge params + metadata and returns the session", async () => {
    const { stripe, create } = mockStripe();
    const session = await buildConnectCheckout(stripe, {
      mode: "payment",
      lineItems: [{ price: "price_1", quantity: 1 }],
      destination: "acct_123",
      applicationFeeAmount: 100,
      metadata: { kind: "booking", userId: "u1" },
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
    });

    const arg = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    const pid = arg.payment_intent_data!;
    expect(pid.application_fee_amount).toBe(100);
    expect(pid.on_behalf_of).toBe("acct_123");
    expect(pid.transfer_data!.destination).toBe("acct_123");
    expect(arg.metadata).toEqual({ kind: "booking", userId: "u1" });
    expect(arg.success_url).toBe("https://x/ok");
    expect(arg.cancel_url).toBe("https://x/no");
    expect(arg.subscription_data).toBeUndefined();
    expect(session.id).toBe("cs_test_1");
  });

  it("subscription mode uses application_fee_percent (not a flat fee) under subscription_data", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, {
      mode: "subscription",
      lineItems: [{ price: "price_sub", quantity: 1 }],
      destination: "acct_9",
      applicationFeePercent: 10,
      metadata: { kind: "qigong" },
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
    });

    const arg = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    const sub = arg.subscription_data!;
    expect(sub.application_fee_percent).toBe(10);
    expect(sub.transfer_data!.destination).toBe("acct_9");
    expect(sub.on_behalf_of).toBe("acct_9");
    expect(arg.payment_intent_data).toBeUndefined();
  });

  it("passes paymentIntentData through (description, receipt_email, rich metadata) while Connect invariants + fee win", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, {
      mode: "payment",
      lineItems: [{ price: "p", quantity: 1 }],
      destination: "acct_real",
      applicationFeeAmount: 200,
      metadata: { kind: "booking", booking_id: "b1" }, // session metadata (lean)
      paymentIntentData: {
        description: "Booking hos Sanne",
        receipt_email: "kunde@x.dk",
        metadata: { kind: "booking", booking_id: "b1", therapist: "sanne", room: "2" }, // richer
        on_behalf_of: "acct_HACK", // consumer tries to override → must LOSE
        transfer_data: { destination: "acct_HACK" }, // must LOSE
        application_fee_amount: 999, // params.applicationFeeAmount must WIN
      },
      successUrl: "s",
      cancelUrl: "c",
    });

    const arg = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    const pi = arg.payment_intent_data!;
    expect(pi.description).toBe("Booking hos Sanne");
    expect(pi.receipt_email).toBe("kunde@x.dk");
    expect(pi.metadata).toEqual({ kind: "booking", booking_id: "b1", therapist: "sanne", room: "2" });
    // Connect invariants + fee win over consumer-supplied values:
    expect(pi.on_behalf_of).toBe("acct_real");
    expect(pi.transfer_data!.destination).toBe("acct_real");
    expect(pi.application_fee_amount).toBe(200);
    // session metadata stays DISTINCT + leaner than PI metadata:
    expect(arg.metadata).toEqual({ kind: "booking", booking_id: "b1" });
  });

  it("does NOT auto-copy session metadata onto payment_intent_data (shop: no PI metadata)", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, {
      mode: "payment",
      lineItems: [{ price: "p", quantity: 1 }],
      destination: "acct_1",
      applicationFeeAmount: 50,
      metadata: { kind: "shop", order_id: "o1" }, // session only — no paymentIntentData given
      successUrl: "s",
      cancelUrl: "c",
    });

    const arg = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    expect(arg.metadata).toEqual({ kind: "shop", order_id: "o1" });
    expect(arg.payment_intent_data!.metadata).toBeUndefined();
  });

  it("passes subscriptionData through (description, metadata) while invariants win", async () => {
    const { stripe, create } = mockStripe();
    await buildConnectCheckout(stripe, {
      mode: "subscription",
      lineItems: [{ price: "price_sub", quantity: 1 }],
      destination: "acct_sub",
      applicationFeePercent: 12,
      subscriptionData: {
        description: "Qi Gong — Rod",
        metadata: { kind: "qigong", plan: "rod" },
        transfer_data: { destination: "acct_HACK" }, // must LOSE
      },
      successUrl: "s",
      cancelUrl: "c",
    });

    const arg = create.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    const sub = arg.subscription_data!;
    expect(sub.description).toBe("Qi Gong — Rod");
    expect(sub.metadata).toEqual({ kind: "qigong", plan: "rod" });
    expect(sub.transfer_data!.destination).toBe("acct_sub"); // invariant wins
    expect(sub.on_behalf_of).toBe("acct_sub");
    expect(sub.application_fee_percent).toBe(12);
  });
});
