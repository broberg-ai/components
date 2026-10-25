import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStripeWebhookHandler, type Stripe } from "../src/index.js";

/**
 * F053.15 — under Bun every real Stripe webhook was refused with a 400.
 *
 * stripe's package.json maps the `bun` (and `worker`, `deno`, `workerd`,
 * `browser`) export condition to `stripe.esm.worker.js`, whose crypto is
 * SubtleCryptoProvider. That provider cannot verify synchronously, so the
 * sync `constructEvent` throws "SubtleCryptoProvider cannot be used in a
 * synchronous context" — and our catch turned it into a 400 that looks
 * exactly like a bad signature. Stripe retries until it gives up; nothing
 * is fulfilled. Reported by beacon (#4531), reproduced on bun 1.4 + stripe 23.
 *
 * These tests load the REAL worker build (the one Bun gets) by file path, so
 * the defect is visible from Node CI too — no Bun needed, and no stub, because
 * a stub cannot know which crypto provider the real SDK picks.
 */
const require = createRequire(import.meta.url);
// require.resolve("stripe") → <pkg>/cjs/stripe.cjs.node.js; the worker build sits beside it.
const stripeRoot = dirname(dirname(require.resolve("stripe")));
const workerBuild = pathToFileURL(join(stripeRoot, "esm", "stripe.esm.worker.js")).href;

async function workerStripe(): Promise<Stripe> {
  const mod = (await import(workerBuild)) as { default: new (key: string) => Stripe };
  return new mod.default("sk_test_x");
}

const payload = JSON.stringify({ id: "evt_worker", type: "checkout.session.completed", object: "event" });

describe("webhook verification on the worker build of stripe (what Bun loads)", () => {
  it("the instrument discriminates: the worker build really refuses SYNC verification", async () => {
    const stripe = await workerStripe();
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_x" });
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_x")).toThrow(/synchronous context/);
  });

  it("a genuinely signed event is accepted (200) and dispatched", async () => {
    const stripe = await workerStripe();
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_x" });
    let seen: string | null = null;
    const handle = createStripeWebhookHandler({
      stripe,
      secret: "whsec_x",
      handlers: { "checkout.session.completed": (e) => { seen = e.id; } },
    });
    const res = await handle(payload, header);
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(seen).toBe("evt_worker");
  });

  it("rotation still works: the right secret second in the list verifies", async () => {
    const stripe = await workerStripe();
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_new" });
    const handle = createStripeWebhookHandler({ stripe, secret: ["whsec_old", "whsec_new"], handlers: {} });
    const res = await handle(payload, header);
    expect(res.status).toBe(200);
  });

  it("negative control: a signature for another secret is still a 400 naming the signature", async () => {
    const stripe = await workerStripe();
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_other" });
    const handle = createStripeWebhookHandler({ stripe, secret: "whsec_x", handlers: {} });
    const res = await handle(payload, header);
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/signature/i);
    expect(res.error).not.toMatch(/synchronous/);
  });
});
