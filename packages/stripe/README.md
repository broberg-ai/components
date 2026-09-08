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
readPeriod(subscription);    // { ok: true, start: number | null, end: number }  — MILLISECONDS
                             // { ok: false, reason: "no-subscription" | "no-period-field" }
```

### `ok: false` means UNREADABLE. It never means "no expiry". (0.4.0, breaking)

That one translation is the whole of F098.4. sanneandersen stores the end date
in a column where `null` **already** means *"gift, deliberately no expiry"* — so
when the old `readPeriod` returned `end: null` for *"I could not read it"*, the
two arrived as the same value and their access rule could not tell them apart. A
cancelled paying subscription would have kept access forever.

The old shape documented that trap. **A warning is not a guard**, so 0.4.0
removes it: the failure branch carries **no `end` property at all**, and the
compiler stops the write.

```ts
// before (0.3.x)                    // after (0.4.0)
const { end } = readPeriod(sub);     const p = readPeriod(sub);
row.current_period_end = end;        row.current_period_end = p.ok ? p.end : /* your call */ row.current_period_end;
```

Deciding what an unreadable period means is **yours** — keep the date you
already have, refuse the write, alert. What you can no longer do is store it by
accident.

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

### Migrating a repo that has its own copy

Two corrections from the first migration (sanne, 2026-09-01), both worth having
before you start:

**The return field is `end`.** If your local version called it something else,
reading the old name on the new object yields `undefined` — the exact
green-direction failure this package exists to end. `tsc` catches it *if you are
typed the whole way*, and does nothing if you are not, so run it and read the
count rather than assuming. They measured **6 errors**, and the important one was
a local annotation binding a whole guard block: without it three call sites would
have gone silently undefined.

**Delete your local reader — but NOT necessarily its fixture.** Their invoice
fixture stays, because their own route test drives the real webhook against it
(a real `invoice.payment_failed` in, their branches asserted, plus a negative
control). That is app-side and the package cannot replace it. They deleted it on
our advice, the suite went red immediately, and they put it back.

**Keep your own webhook guard.** A test that forbids the removed field in your
route, and requires your branches to call the shared reader, is app-side too —
repoint it at the new name rather than deleting it with the module.

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

## Watching Stripe move a field (0.4.0)

Stripe has broken a consumer of this package **twice in two months, and neither
time was an outage.** `current_period_end` moved onto the subscription's items;
`invoice.subscription` was removed outright. Both times every request answered
200, nothing threw, and a webhook branch simply stopped running — one of them the
branch that reacts to a declined card, so a customer kept full access without
paying. A monitor asking *"is Stripe up?"* would have been green through both.

So the thing this package watches is not uptime. It is **whether the fields we
read are still where we read them.**

```ts
import { checkSpecDrift } from "@broberg/stripe";

const r = await checkSpecDrift();
// { status: "ok" | "drift" | "unknown", specVersion, findings: [
//     { reader: "readPeriod", role: "primary",
//       schema: "subscription_item", property: "current_period_end",
//       present: true }, … ] }
```

It reads **Stripe's own published OpenAPI spec** — no account, no key, nothing
created and nothing to clean up. That was a deliberate correction: the first
build used a test-mode account, and a test-mode account is *one* account, whose
key someone has to hold, rotate and pay attention to. Stripe publishes where its
fields live openly, so the cheaper instrument is also the more honest one.

`FIELD_EXPECTATIONS` is the list it asserts, and it lives beside the readers it
guards. That placement is the whole point — a copy of this list in a monitoring
repo is wrong the day one of the two is updated, which is the drift this package
exists to remove, one layer up.

**Three outcomes, and the third is not one of the first two.** A spec that cannot
be fetched is `unknown`, never `ok` and never `drift`: reported as drift it wakes
someone for a network blip, reported as ok it hides a real move.

**Only a missing PRIMARY is drift.** Both fallbacks — the pre-move locations — are
absent from today's spec and reported so, without turning the run red. A check
that fires every single day is a check someone switches off.

Run it on a schedule; this repo runs it daily and routes a `drift` to its
incident tracker. `probeStripeShape` answers the same question against a real
test-mode account when you have one — it refuses a non-`sk_test_` key *before* it
creates anything, and reports whether its own cleanup succeeded.

### The limit of it, stated plainly

**The spec it reads is Stripe's LATEST. Your consumers speak the pinned
`STRIPE_API_VERSION`, which is older.** They are not the same document, so:

- A field that moves in a version we have not adopted goes **red before it can
  hurt us**. That is early warning, and it is the direction you want.
- A field present in the latest spec but *not* in our pinned version reads **ok
  while a consumer breaks**. That direction is not covered.

Neither incident above would have escaped it, because both moved the field in the
version we were already on. But `ok` here means *"the readers point where the
newest spec says"* — it does not mean *"the wire our consumers speak is
unchanged"*, and those are two claims.

Not yet proven: that this catches a **real future** move. The tests exercise it
against a spec document we mutate ourselves, and against the real spec it returns
real, discriminating data (two properties present, two absent). What no one has
watched happen is Stripe moving a field with this running.

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
| `readPeriod(subscription)` | `{ ok:true, start, end }` in **ms**, item → top level — or `{ ok:false, reason }` with **no `end` at all**, so an unreadable period cannot be stored by accident (0.4.0, breaking) |
| `checkSpecDrift(opts?)` | asks Stripe's **published spec** whether our readers still point where the fields live. `ok` / `drift` / `unknown`. No account, no key |
| `FIELD_EXPECTATIONS` | the four (reader, role, schema, property) rows `checkSpecDrift` asserts — this is the list that must stay in one place |
| `STRIPE_SPEC_URL` | where that spec is fetched from |
| `probeStripeShape({stripe, apiKey})` | the same question against a **real test-mode account**. Refuses a non-`sk_test_` key before it creates anything, and reports its own cleanup |
| `STRIPE_API_VERSION` | the fleet-pinned Stripe API version |

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
