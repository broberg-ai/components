// F112.2 — Mollie webhooks, both kinds.
//
// CLASSIC (what Mollie still recommends for payments): the POST carries only
// `id=tr_…`. There is no signature; the authenticity check IS fetching the object
// back from Mollie with our key — a forged id fetches nothing, or a payment the
// forger cannot change. Handlers therefore only ever see the fetched object.
//
// NEXT-GEN: `X-Mollie-Signature: sha256=<hex>`, an HMAC-SHA256 of the RAW body
// with the webhook secret. Verified in constant time before anything is parsed.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MollieClient, MolliePayment } from "./client";

export interface ClassicWebhookOptions {
  mollie: MollieClient;
  /** Called with the payment as Mollie reports it NOW. Throw to make Mollie retry. */
  onPayment(payment: MolliePayment): Promise<void> | void;
}

/** (Request) → Response for Mollie's classic payment webhook. 200 on success; 500 makes Mollie retry. */
export function createClassicWebhookHandler(opts: ClassicWebhookOptions): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const form = new URLSearchParams(await req.text());
    const id = form.get("id") ?? "";
    if (!/^tr_[A-Za-z0-9]+$/.test(id)) return new Response("unknown id", { status: 400 });
    let payment: MolliePayment;
    try {
      payment = await opts.mollie.getPayment(id);
    } catch (e) {
      // 404 = an id Mollie does not know: forged or foreign. Acknowledge so it is not retried.
      if ((e as { status?: number }).status === 404) return new Response("not ours", { status: 200 });
      return new Response("fetch failed", { status: 500 });
    }
    try {
      await opts.onPayment(payment);
    } catch {
      return new Response("handler failed", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  };
}

/** True only if `signatureHeader` is a valid HMAC-SHA256 of `rawBody` under `secret`. */
export function verifyMollieSignature(rawBody: string | Uint8Array, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(m[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
