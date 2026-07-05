/**
 * @broberg/stripe/next — a Web-standard route factory for the webhook handler.
 *
 * Named `/next` because the canonical consumer is a Next.js App Router route
 * handler, but it imports nothing from `next` — it uses only the global
 * `Request`/`Response`, so the same factory runs under Hono, Bun and edge too.
 *
 *   // app/api/stripe/webhook/route.ts
 *   export const runtime = "nodejs";
 *   export const POST = createStripeWebhookRoute(
 *     createStripeWebhookHandler({ stripe, secret, handlers }),
 *   );
 */
import type { StripeWebhookHandler } from "./index.js";

/**
 * Wrap a {@link StripeWebhookHandler} as a `(Request) => Response` route. Reads
 * the RAW body via `req.text()` (never JSON round-tripped, so the signature
 * still verifies) and the `stripe-signature` header. A missing signature is a
 * 400 before any verification runs.
 */
export function createStripeWebhookRoute(
  handler: StripeWebhookHandler,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return json({ error: "missing stripe-signature header" }, 400);
    }
    const rawBody = await req.text();
    const result = await handler(rawBody, signature);
    return json(
      result.ok ? { received: true } : { error: result.error ?? "webhook error" },
      result.status,
    );
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
