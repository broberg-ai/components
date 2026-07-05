import { describe, it, expect, vi } from "vitest";
import { createStripeWebhookRoute } from "../src/next.js";
import type { StripeWebhookHandler } from "../src/index.js";

function req(body: string, sig: string | null) {
  const headers = new Headers();
  if (sig !== null) headers.set("stripe-signature", sig);
  return new Request("https://x/api/stripe/webhook", { method: "POST", body, headers });
}

describe("createStripeWebhookRoute", () => {
  it("reads raw body + signature, calls the handler, returns its status", async () => {
    const handler = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as StripeWebhookHandler;
    const route = createStripeWebhookRoute(handler);

    const res = await route(req('{"a":1}', "sig_1"));
    expect(handler).toHaveBeenCalledWith('{"a":1}', "sig_1");
    expect(res.status).toBe(200);
  });

  it("preserves the raw-body invariant — exact bytes, no JSON round-trip", async () => {
    // Whitespace + key order a JSON.parse→stringify would destroy.
    const raw = '{ "b":2,  "a":1 }';
    let seen = "";
    const handler: StripeWebhookHandler = async (r) => {
      seen = typeof r === "string" ? r : r.toString("utf8");
      return { ok: true, status: 200 };
    };
    const route = createStripeWebhookRoute(handler);

    await route(req(raw, "sig"));
    expect(seen).toBe(raw);
  });

  it("missing stripe-signature header: 400 without calling the handler", async () => {
    const handler = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as StripeWebhookHandler;
    const route = createStripeWebhookRoute(handler);

    const res = await route(req("{}", null));
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
