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
});
