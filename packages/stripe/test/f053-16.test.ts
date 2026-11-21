// F053.16 — buildCheckout: the platform sells itself. No Connect field may reach Stripe.
import { describe, it, expect, vi } from "vitest";
import { buildCheckout, type Stripe } from "../src/index.js";

function fakeStripe() {
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, _opts?: Stripe.RequestOptions) => ({
    id: "cs_test_p", url: "https://checkout.stripe.com/c/pay/cs_test_p", ...params,
  }));
  return { stripe: { checkout: { sessions: { create } } } as unknown as Stripe, create };
}

const CREDITS: Stripe.Checkout.SessionCreateParams.LineItem = {
  quantity: 1,
  price_data: { currency: "dkk", unit_amount: 4900, product_data: { name: "100 AI-kreditter" } },
};

describe("buildCheckout (F053.16)", () => {
  it("payment mode with price_data + metadata.kind, and NO Connect fields or account", async () => {
    const { stripe, create } = fakeStripe();
    const s = await buildCheckout(stripe, {
      mode: "payment", lineItems: [CREDITS], metadata: { kind: "credits", userId: "u1" },
      successUrl: "https://x/ok", cancelUrl: "https://x/no", customerEmail: "a@b.dk",
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [arg, opts] = create.mock.calls[0]!;
    expect(arg).toEqual({
      mode: "payment", line_items: [CREDITS], success_url: "https://x/ok", cancel_url: "https://x/no",
      metadata: { kind: "credits", userId: "u1" }, customer_email: "a@b.dk",
    });
    expect(opts).toBeUndefined(); // no stripeAccount, no request option at all
    expect(JSON.stringify(arg)).not.toMatch(/on_behalf_of|transfer_data|application_fee/);
    expect(s.id).toBe("cs_test_p");
  });

  it("subscription mode passes subscriptionData, not payment_intent_data", async () => {
    const { stripe, create } = fakeStripe();
    await buildCheckout(stripe, {
      mode: "subscription", lineItems: [{ price: "price_sub", quantity: 1 }], metadata: { kind: "plan" },
      successUrl: "https://x/ok", cancelUrl: "https://x/no", subscriptionData: { description: "Pro" },
      paymentIntentData: { description: "ignored in subscription mode" },
    });
    const [arg] = create.mock.calls[0]!;
    expect(arg.subscription_data).toEqual({ description: "Pro" });
    expect(arg.payment_intent_data).toBeUndefined();
  });

  const base = { mode: "payment" as const, lineItems: [CREDITS], successUrl: "https://x/ok", cancelUrl: "https://x/no" };

  it("payment mode: refuses a Connect field via paymentIntentData or extra.payment_intent_data", async () => {
    const { stripe, create } = fakeStripe();
    await expect(buildCheckout(stripe, { ...base, paymentIntentData: { transfer_data: { destination: "acct_1" } } })).rejects.toThrow(/transfer_data/);
    await expect(buildCheckout(stripe, { ...base, paymentIntentData: { on_behalf_of: "acct_1" } })).rejects.toThrow(/on_behalf_of/);
    await expect(buildCheckout(stripe, { ...base, paymentIntentData: { application_fee_amount: 1 } })).rejects.toThrow(/application_fee_amount/);
    await expect(buildCheckout(stripe, { ...base, extra: { payment_intent_data: { on_behalf_of: "acct_1" } } })).rejects.toThrow(/payment_intent_data\.on_behalf_of/);
    expect(create).not.toHaveBeenCalled();
  });

  it("subscription mode: refuses a Connect field via subscriptionData or extra.subscription_data", async () => {
    const { stripe, create } = fakeStripe();
    const sub = { ...base, mode: "subscription" as const };
    await expect(buildCheckout(stripe, { ...sub, subscriptionData: { application_fee_percent: 5 } })).rejects.toThrow(/application_fee_percent/);
    await expect(buildCheckout(stripe, { ...sub, extra: { subscription_data: { transfer_data: { destination: "acct_1" } } } })).rejects.toThrow(/subscription_data\.transfer_data/);
    expect(create).not.toHaveBeenCalled();
  });

  it("idempotencyKey goes out as Stripe's request option", async () => {
    const { stripe, create } = fakeStripe();
    await buildCheckout(stripe, { ...base, idempotencyKey: "order-42" });
    expect(create.mock.calls[0]![1]).toEqual({ idempotencyKey: "order-42" });
  });

  it("an empty idempotencyKey is refused before any call", async () => {
    const { stripe, create } = fakeStripe();
    await expect(buildCheckout(stripe, { ...base, idempotencyKey: "" })).rejects.toThrow(/idempotencyKey/);
    await expect(buildCheckout(stripe, { ...base, idempotencyKey: "   " })).rejects.toThrow(/idempotencyKey/);
    expect(create).not.toHaveBeenCalled();
  });
});
