import { describe, it, expect, vi } from "vitest";
import { createStripeWebhookHandler, type Stripe } from "../src/index.js";

function stripeWith(constructEvent: (...a: unknown[]) => unknown) {
  return { webhooks: { constructEvent } } as unknown as Stripe;
}

describe("createStripeWebhookHandler", () => {
  it("valid signature: constructEvent + dispatch to the matching handler", async () => {
    const event = { type: "checkout.session.completed", id: "evt_1" } as unknown as Stripe.Event;
    const stripe = stripeWith(vi.fn(() => event));
    const fulfil = vi.fn();
    const handle = createStripeWebhookHandler({
      stripe,
      secret: "whsec_x",
      handlers: { "checkout.session.completed": fulfil },
    });

    const res = await handle("raw-body", "sig");
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith("raw-body", "sig", "whsec_x");
    expect(fulfil).toHaveBeenCalledWith(event);
    expect(res).toMatchObject({ ok: true, status: 200, event });
  });

  it("unknown event type is acked (200) via onUnhandled, never a 4xx", async () => {
    const event = { type: "charge.updated", id: "evt_2" } as unknown as Stripe.Event;
    const onUnhandled = vi.fn();
    const handle = createStripeWebhookHandler({
      stripe: stripeWith(vi.fn(() => event)),
      secret: "whsec_x",
      handlers: {},
      onUnhandled,
    });

    const res = await handle("b", "s");
    expect(onUnhandled).toHaveBeenCalledWith(event);
    expect(res).toMatchObject({ ok: true, status: 200 });
  });

  it("invalid signature: 400 and NO handler runs", async () => {
    const stripe = stripeWith(vi.fn(() => {
      throw new Error("No signatures found matching the expected signature");
    }));
    const fulfil = vi.fn();
    const handle = createStripeWebhookHandler({
      stripe,
      secret: "whsec_x",
      handlers: { "checkout.session.completed": fulfil },
    });

    const res = await handle("b", "s");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(fulfil).not.toHaveBeenCalled();
  });

  it("missing signature with a secret configured: 400 without calling constructEvent", async () => {
    const stripe = stripeWith(vi.fn());
    const handle = createStripeWebhookHandler({ stripe, secret: "whsec_x", handlers: {} });
    const res = await handle("b", null);
    expect(res.status).toBe(400);
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it("no secret + allowUnverifiedInDev: JSON.parse fallback dispatches with a warn", async () => {
    const stripe = stripeWith(vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fulfil = vi.fn();
    const handle = createStripeWebhookHandler({
      stripe,
      handlers: { "checkout.session.completed": fulfil },
      allowUnverifiedInDev: true,
    });

    const res = await handle(JSON.stringify({ type: "checkout.session.completed", id: "evt_dev" }), null);
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled();
    expect(fulfil).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("no secret + not allowed: 400 (no silent unverified processing in prod)", async () => {
    const handle = createStripeWebhookHandler({ stripe: stripeWith(vi.fn()), handlers: {} });
    const res = await handle("{}", null);
    expect(res.status).toBe(400);
  });
});
