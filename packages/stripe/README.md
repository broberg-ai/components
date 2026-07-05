# @broberg/stripe

The fleet's **one Stripe chokepoint**. Four primitives extracted from
sanneandersen-site's proven live Connect marketplace, so no `@broberg/*` app
re-rolls a raw `new Stripe()`, raw `constructEvent`, or raw destination-charges
— the exact drift the reuse-first house rule exists to kill. One pinned Stripe
SDK version, one signature-verification path, one Connect-charge builder, one
fee-calc contract for the whole estate.

> The package owns the **shape** only. Fee **values**, the connected-account id,
> fulfillment per `kind`, and price-ID resolution all stay in your app.

```bash
pnpm add @broberg/stripe stripe   # stripe is a peer — you pin ONE version
```

## Client factory — dark-ship

```ts
import { createStripeClient } from "@broberg/stripe";

const { stripe, enabled, isTestMode } = createStripeClient();
// STRIPE_SECRET_KEY unset → { enabled:false, stripe:null } and NEVER throws.
// An app that hasn't wired Stripe boots fine (ship-dark).
if (!enabled) return; // no half-wired payments surface in prod
```

`apiVersion` is pinned fleet-wide (`STRIPE_API_VERSION`), so every consumer
speaks the same wire regardless of install date. `isTestMode` is derived from
the `sk_test_…` key prefix.

## Fee calculator — you inject the numbers

```ts
import { createFeeCalculator } from "@broberg/stripe";

// The percentages are YOUR business numbers (one source, never hardcoded around
// the app). The package owns the maths + rounding.
const fees = createFeeCalculator({ booking: 1, shop_physical: 5, shop_online: 30 });
fees.calculateApplicationFee(10_000, "booking"); // → 100 øre (1% of 10 000, integer)
fees.calculateApplicationFee(10_000, "unknown");  // → 0 (with a warn), never NaN
```

## Connect checkout builder

Builds a Connect **destination-charge** Checkout Session. In `payment` mode the
Connect params land under `payment_intent_data`; in `subscription` mode under
`subscription_data` (Connect wants a `application_fee_percent`, not a flat fee).
Returns the session — you redirect to `session.url` (hosted Checkout).

```ts
import { buildConnectCheckout } from "@broberg/stripe";

// app/api/booking/checkout/route.ts
const session = await buildConnectCheckout(stripe, {
  mode: "payment",
  lineItems: [{ price: priceId, quantity: 1 }],
  destination: process.env.STRIPE_CONNECTED_ACCOUNT_ID!, // on_behalf_of + transfer_data
  applicationFeeAmount: fees.calculateApplicationFee(totalØre, "booking"),
  metadata: { kind: "booking", userId },                 // your routing signal
  successUrl: `${base}/ok`,
  cancelUrl: `${base}/cancel`,
});
return Response.redirect(session.url!, 303);
```

Subscription:

```ts
await buildConnectCheckout(stripe, {
  mode: "subscription",
  lineItems: [{ price: recurringPriceId, quantity: 1 }],
  destination: accountId,
  applicationFeePercent: 10,             // → subscription_data.application_fee_percent
  metadata: { kind: "qigong", planTier: "rod" }, // SESSION metadata
  subscriptionData: {                    // richer SUBSCRIPTION shape (v0.2.0)
    description: "Qi Gong — Rod",
    metadata: { kind: "qigong", planTier: "rod", memberId },
  },
  successUrl, cancelUrl,
});
```

### PaymentIntent / Subscription passthrough (v0.2.0)

The session is only half the object. Real routes need `description`, `receipt_email`,
and a **richer, distinct** metadata on the PaymentIntent/Subscription than on the
session. Pass them via `paymentIntentData` / `subscriptionData` — they are merged
in first, and the Connect invariants (`on_behalf_of`, `transfer_data`) and the fee
are applied **after** so they always win:

```ts
await buildConnectCheckout(stripe, {
  mode: "payment",
  lineItems, destination: accountId,
  applicationFeeAmount: fees.calculateApplicationFee(totalØre, "booking"),
  metadata: { kind: "booking", booking_id },          // SESSION metadata (lean)
  paymentIntentData: {
    description: "Booking hos Sanne",                  // Sanne reads it in the dashboard
    receipt_email: customerEmail,                      // customer receipt
    metadata: { kind: "booking", booking_id, therapist, room }, // RICHER PI metadata
  },
  successUrl, cancelUrl,
});
```

> **Session metadata is NOT auto-copied onto the PaymentIntent/Subscription.**
> PI/sub metadata comes ONLY from `paymentIntentData.metadata` /
> `subscriptionData.metadata` — so a `shop` route with no `paymentIntentData` gets
> a PaymentIntent with no metadata, and a `booking` route gets its full 8-field set.
> `extra` remains an escape hatch for other **top-level** session params (use the
> two fields above for PI/sub).

## Webhook handler + `/next` route

`createStripeWebhookHandler` verifies the signature against the **raw body**
(the invariant — the bytes are never re-serialized) and dispatches by
`event.type` to your handlers. Unhandled types are acked with `200` so Stripe
doesn't retry them; a bad signature is `400`; a throwing handler is `500`.

`createStripeWebhookRoute` (from `@broberg/stripe/next`) wraps it as a
Web-standard `(Request) => Response` — it imports nothing from `next`, so it
runs under Next.js App Router, Hono, Bun and edge alike.

```ts
// app/api/stripe/webhook/route.ts
import { createStripeWebhookHandler } from "@broberg/stripe";
import { createStripeWebhookRoute } from "@broberg/stripe/next";

export const runtime = "nodejs"; // raw body needs the Node runtime

export const POST = createStripeWebhookRoute(
  createStripeWebhookHandler({
    stripe,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    handlers: {
      "checkout.session.completed": async (e) => fulfil(e),           // your domain logic
      "customer.subscription.updated": async (e) => syncSubscription(e),
      "charge.refunded": async (e) => onRefund(e),
    },
    onUnhandled: (e) => console.debug("stripe: unhandled", e.type),
    // allowUnverifiedInDev: true, // dev only, when no secret is set (loud warn)
  }),
);
```

## Non-goals

- Concrete **fee percentages** (yours — inject them).
- The **connected-account id** and other tenant identity (env / per call).
- **Fulfillment** per `kind` — the package routes the verified event to your
  handler; enrolling a course / crediting a klippekort / confirming a booking is
  your domain logic.
- **Price-ID resolution** (resolve from your CMS/DB).
- A client-side `@stripe/stripe-js` / Elements surface — this is redirect-based
  hosted Checkout only.

## API

| Export | What |
|---|---|
| `createStripeClient(opts?)` | `{ enabled, stripe, isTestMode }` — dark-ship, pinned apiVersion |
| `createFeeCalculator(config)` | `{ calculateApplicationFee(øre, type), percentFor(type) }` |
| `buildConnectCheckout(stripe, params)` | Connect destination-charge Checkout Session |
| `createStripeWebhookHandler(config)` | `(rawBody, signature) => { ok, status, event?, error? }` |
| `createStripeWebhookRoute(handler)` | `@broberg/stripe/next` — `(Request) => Response` |
| `STRIPE_API_VERSION` | the fleet-pinned Stripe API version |

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
