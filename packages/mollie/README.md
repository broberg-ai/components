# @broberg/mollie

Mollie payments where **you** decide how every payment is divided — between the
platform, the developer, the clinic, or any number of parties — exact to the øre.
Mollie executes the split with **Connect for Marketplaces · delayed routing**.

```bash
npm i @broberg/mollie
```

> **Not live-verified yet.** Everything below is tested against a faithful fake of
> Mollie's v2 API, and the routing/refund field names are checked against Mollie's
> official SDK (`mollie-api-typescript`). It has NOT run against a real Mollie
> account: that needs a test key, and routing must be enabled by Mollie. Whether
> routing works on **recurring** payments is not documented by Mollie and has been
> asked in writing.

## 1. Decide the split — `computeSplit`

```ts
import { computeSplit } from "@broberg/mollie";

// 199 kr: 25 kr operations surcharge to the platform, the rest 30/60/10.
computeSplit(19_900, {
  rules: [
    { recipient: "platform", fixed: 2_500 },
    { recipient: "platform", percent: 30 },
    { recipient: "dev:acme", percent: 60 },
    { recipient: "clinic:nord", percent: 10 },
  ],
  remainderTo: "platform",
  knownRecipients: ["platform", "dev:acme", "clinic:nord"], // a typo is refused, never paid out
});
// → [{ platform, 7720 }, { dev:acme, 10440 }, { clinic:nord, 1740 }]  — sums to 19 900, always
```

- **Fixed amounts first**, then **percent of what is left**.
- Every share is rounded **down**; crumbs and unallocated percent go to `remainderTo`.
- Invalid rules (over 100 %, fixed > amount, negatives, unknown recipient, > 2 decimals)
  throw `SplitError` **before** anything is sent to Mollie.
- The numbers are yours (your app's config); the package owns only the maths.

## 2. Take the money

```ts
import { createMollieClient } from "@broberg/mollie";

const { enabled, mollie } = createMollieClient(); // MOLLIE_API_KEY unset → enabled:false, never throws
if (!enabled) return;

const { id: customerId } = await mollie.createCustomer({ name: "Klinik Nord", email });
const { checkoutUrl } = await mollie.createFirstPayment({          // creates the card mandate
  customerId, amount: 19_900, currency: "DKK", description: "fysio.work — november",
  redirectUrl: "https://fysio.work/ok", webhookUrl: "https://fysio.work/api/mollie",
});
// every month, from YOUR scheduler (Mollie's Subscriptions API cannot carry a split):
await mollie.createRecurringPayment({ customerId, mandateId, amount: 19_900, currency: "DKK", description: "fysio.work — december", webhookUrl });
```

## 3. Split it once it is paid — `routePayment`

```ts
await mollie.routePayment({
  paymentId, lines: computeSplit(19_900, rules), platform: "platform",
  recipients: { "dev:acme": { organizationId: "org_…" }, "clinic:nord": { organizationId: "org_…" } },
});
```

- Only on a **paid** payment; the lines must sum to exactly what was paid.
- The platform's share is simply not routed — it stays with the platform.
- **Idempotent:** a retry creates no duplicate routes; a route that exists with a
  different amount is refused ("refusing to pay twice"). A Mollie answer without
  the routes list is an error, never read as "none yet".
- Routes must be created within **90 days** of the payment (Mollie's limit).

## 4. Refunds

```ts
await mollie.refundPayment({ paymentId, amount: 19_900, currency: "DKK", reverseRouting: true });          // full: claw back every route
await mollie.refundPayment({ paymentId, amount: 5_000, currency: "DKK", routingReversals: [{ organizationId: "org_…", amount: 3_500 }] }); // partial
```

## 5. Webhooks

```ts
import { createClassicWebhookHandler, verifyMollieSignature } from "@broberg/mollie";

// Classic (Mollie's recommendation for payments): the POST carries only the id;
// the handler fetches the payment from Mollie — that fetch IS the authenticity check.
app.post("/api/mollie", (c) => createClassicWebhookHandler({ mollie, onPayment: async (p) => {
  if (p.status === "paid") await mollie.routePayment({ paymentId: p.id, lines, platform: "platform", recipients });
}})(c.req.raw));

// Next-gen webhooks: HMAC over the raw body, constant-time compare.
verifyMollieSignature(rawBody, req.headers.get("x-mollie-signature"), process.env.MOLLIE_WEBHOOK_SECRET!);
```

A throwing `onPayment` answers 500 so Mollie retries (10 times over ~26 h); an id Mollie
does not know is acknowledged and never reaches your handler.

## Money flow you are signing up for (Marketplaces)

The platform **owns** the payment: it receives the money first, carries chargebacks,
and is invoiced all Mollie fees monthly; developers and clinics are onboarded as
Mollie organizations (Client Links) and receive routes. Prices (mollie.com/dk/pricing,
5/11 2026): Danish consumer cards 1.20 % + 1.80 kr; Connect/routing priced on request.
