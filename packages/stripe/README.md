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

## Reading the fields Stripe moves

Stripe relocates fields. Twice in two months it broke sanneandersen in
production, and both times **in the green direction** — no exception, no log,
just a branch that quietly did not run.

```ts
import { readSubscriptionId, readPeriod } from "@broberg/stripe";

readSubscriptionId(invoice); // string | null
readPeriod(subscription);    // { start: number | null, end: number | null }  — MILLISECONDS
```

**What moved, measured on a live account (`2026-04-22.dahlia`):**

| Field | Where it was | Where it is |
|---|---|---|
| the subscription on an invoice | `invoice.subscription` — **removed**, the key is absent, not null | `invoice.parent.subscription_details.subscription`, or any line's `parent.subscription_item_details.subscription` |
| the billing period | `subscription.current_period_end` | `subscription.items.data[0].current_period_end` |

Both readers try the **new location first and the old one as a fallback**, so a
stored event from an older API version still resolves and a webhook replay does
not become a second outage. Both return **`null` rather than throwing** — these
run inside a webhook handler, where an exception means the event is never
acknowledged and Stripe retries it forever.

`readSubscriptionId` scans **every** invoice line, not just the first: a renewal
invoice can carry a proration credit ahead of the subscription line. *(Inferred
from how proration works — we have not observed such an invoice.)*

### ⚠️ `null` from `readPeriod` means "could not read it", not "no expiry"

That translation is the entire F098.4 outage. Their access rule read a missing
end date as an unlimited gift, so an unreadable field silently became **free
lifetime access for a cancelled paying subscription**. Nothing threw, nothing
logged, and the only paying subscriber simply had no renewal date.

Nothing is guessed here on purpose. A fallback like `now + 30 days` writes a
number that looks right and is not — and a wrong date is never noticed, where a
missing one is. If your app grants access on a missing date, branch on `null`
explicitly before you get there.

### What is proven, and what is not

**Both fixtures are fetched.** The invoice and the subscription are trimmed,
anonymised copies of **real** objects pulled from a live account — a hand-written
imitation would only confirm the author's understanding of the shape, and a wrong
understanding of the shape was the bug.

The subscription one was constructed at first, and this section said so. sanne
went and pulled the real object with `subscriptions.retrieve` when asked, so the
period tests no longer carry a weaker claim than the id tests. On the live
object: `current_period_end` is **absent from the root** and present on
`items.data[0]` — the exact claim `readPeriod` rests on, now checkable against
something Stripe itself sent.

Still **unproven**: whether `customer.subscription.updated` fires on every
renewal (and has therefore been a safety net all along). It is an inference from
Stripe's documentation that nobody has watched happen. First real renewal:
2026-09-27.

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
| `readSubscriptionId(invoice)` | the subscription id, new location → any line → the removed field; `null`, never a throw |
| `readPeriod(subscription)` | `{ start, end }` in **ms**, item → top level. `null` means *unreadable*, not *no expiry* |
| `STRIPE_API_VERSION` | the fleet-pinned Stripe API version |

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
