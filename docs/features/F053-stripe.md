# F053 — @broberg/stripe (fleet Stripe chokepoint)

> **Status:** planned → building. Epic F053. Source + consumer #1: `sanneandersen` (webhousecode/sanneandersen).
> **One-line:** ÉN Stripe-primitiv for hele flåden — Connect-checkout-builder + webhook-route-factory + client-factory — så intet repo wirer rå `new Stripe()`, rå `constructEvent` eller rå destination-charges selv.

## 1. Motivation (reuse-first)

The reuse-first house rule forbids raw provider integrations: "if I want to swap the provider, do I change it in ONE place or in seventeen?". Stripe is currently hand-rolled inside `sanneandersen-site` (a full, live Connect marketplace). As more repos start taking payments (courses, bookings, shops, memberships across the estate), each would otherwise re-roll `new Stripe()`, its own `constructEvent` raw-body handling, and its own destination-charge shape — the exact drift this rule exists to kill. `@broberg/stripe` extracts the **shape** of sanneandersen's proven implementation into one npm, so every consumer shares one pinned Stripe SDK version, one signature-verification path, one Connect-charge builder, and one fee-calc contract. sanneandersen becomes source + consumer #1 and migrates onto it behind proven parity.

## 2. Scope

**In scope (the reusable SHAPE → npm):**
- **`createStripeClient()`** — a `getStripe` singleton factory: pins `apiVersion` (currently `2026-04-22.dahlia`), reads `STRIPE_SECRET_KEY` from env (or explicit opt), exposes `isTestMode()` (derived from the `sk_test_` key prefix). **Dark-ship:** with no key it returns `{ enabled:false, stripe:null }` and never constructs — no crash, no half-wired surface in prod (ship-dark house rule).
- **`buildConnectCheckout()`** — a Connect destination-charge Checkout-Session builder: takes `mode` (`payment`|`subscription`), line items / price, and Connect params, and stamps `application_fee_amount` + `on_behalf_of` + `transfer_data.destination` + `metadata` (incl. the `kind` routing-signal convention). Returns the created session; the consumer redirects to `session.url` (redirect-based hosted Checkout, no client SDK).
- **`createFeeCalculator(config)`** — the fee-calc **shape** only: `calculateApplicationFee(amountØre, type)`. The percentage **values** are injected by the consumer (they are app-specific business numbers) — the package owns the maths + rounding, not the rates.
- **`createStripeWebhookHandler()`** — a webhook factory: `constructEvent(rawBody, signature, secret)` (preserving the raw-body invariant), then dispatch-by-`event.type` to consumer-supplied handlers. Dev-fallback: `JSON.parse` without verify when the secret is absent (with a loud warn), matching sanneandersen's dev ergonomics.
- **`@broberg/stripe/next`** — a Next.js App Router route-handler factory (`createStripeWebhookRoute`) that reads `await req.text()` (raw), pulls the `stripe-signature` header, runs the core handler, and returns a `Response`. Consumer keeps `export const runtime = "nodejs"`.

**Non-goals (STAYS app-side — never in the npm):**
- Concrete **fee values** / percentages (`{booking:1, shop_physical:5, shop_online:30}` are sanneandersen's numbers).
- The **connected-account id** (`STRIPE_SANNE_ACCOUNT_ID`) and any other tenant identity.
- **Fulfillment** per `kind` (enroll a course, credit a klippekort, confirm a booking, start a Qi Gong cadence) — that is consumer domain logic; the package only routes the verified event to the consumer's handler.
- **Price-ID resolution** (sanneandersen resolves these from CMS content + DB; F020 price-sync stays theirs).
- A **client-side** `@stripe/stripe-js` surface — sanneandersen uses redirect-based hosted Checkout; no Elements/embedded flow in v1.

## 3. Architecture sketch

```
@broberg/stripe            (core, framework-neutral, peer: stripe)
  createStripeClient()     → { enabled, stripe, isTestMode }     ── dark-ship guard
  createFeeCalculator(cfg) → { calculateApplicationFee(øre,type) } ── values injected
  buildConnectCheckout(stripe, params) → Checkout.Session         ── application_fee + on_behalf_of + transfer_data + metadata.kind
  createStripeWebhookHandler({ stripe, secret, handlers, onUnhandled?, allowUnverifiedInDev? })
        → (rawBody, signature) => { ok, status, event?, error? }  ── constructEvent + dispatch-by-type

@broberg/stripe/next       (optional peer: next)
  createStripeWebhookRoute(handler) → (req: Request) => Response  ── await req.text() raw + stripe-signature header
```

Consumer wiring (sanneandersen, post-migration):
```ts
// lib/stripe.ts
export const { stripe, enabled, isTestMode } = createStripeClient();
export const fees = createFeeCalculator({ booking:1, shop_physical:5, shop_online:30 });
// app/api/booking/checkout/route.ts
const session = await buildConnectCheckout(stripe, {
  mode:"payment", lineItems, destination: process.env.STRIPE_SANNE_ACCOUNT_ID!,
  applicationFeeAmount: fees.calculateApplicationFee(totalØre, "booking"),
  metadata:{ kind:"booking", userId, ... }, successUrl, cancelUrl,
});
return Response.redirect(session.url!, 303);
// app/api/stripe/webhook/route.ts
export const runtime = "nodejs";
export const POST = createStripeWebhookRoute(createStripeWebhookHandler({
  stripe, secret: process.env.STRIPE_WEBHOOK_SECRET,
  handlers: { "checkout.session.completed": fulfil, "customer.subscription.updated": syncSub, ... },
}));
```

## 4. Dependencies

- **`stripe`** as a **peerDependency** (`>=22.0.0`) — consumer pins ONE Stripe version shared across the app (same reasoning as `@broberg/auth` pinning `better-auth`). Dev-dep locally for build/test.
- **`next`** as an **optional** peer (only for the `/next` subpath).
- No runtime deps beyond that; core is dependency-free apart from the Stripe peer.
- Build/test/publish: tsup (esm+cjs+dts), vitest, OIDC Trusted Publisher via `publish.yml` (`stripe-v*` tag prefix). Bootstrap v0.1.0 by hand (one OTP), then token-free.

## 5. Rollout (load-bearing → no naked cutover)

Stripe = **load-bearing** (real payments). Per the harness contract: **replace, prove, THEN remove.**
1. Build + publish `@broberg/stripe@0.1.0` (dark-ship; inert without env).
2. sanneandersen adopts it **alongside** its existing raw code, exact-pinned.
3. Prove **parity** — the built checkout params (application_fee + on_behalf_of + transfer_data + metadata) and the webhook constructEvent/dispatch match the current live behaviour (Stripe test-mode session + a signed test webhook event). Sealed with a RED test.
4. Only after parity is proven does sanneandersen delete its raw `lib/stripe/*` internals. The `constructEvent` raw-body invariant is preserved throughout.
5. Enroll in Discovery (`role:"src"` for sanneandersen once migrated; `@broberg/stripe` added to the shared roster).

## 6. Stories

| Story | Title | Ship |
|---|---|---|
| F053.1 | Core client factory + fee calculator (dark-ship + isTestMode + injected fee config) | 0.1.0 |
| F053.2 | Connect checkout builder (application_fee + on_behalf_of + transfer_data + metadata.kind) | 0.1.0 |
| F053.3 | Webhook handler factory (constructEvent raw-body + dispatch-by-type + dev-fallback) | 0.1.0 |
| F053.4 | `/next` adapter — App Router webhook route factory (nodejs raw body) | 0.1.0 |
| F053.5 | Publish v0.1.0 + README + OIDC job + Discovery enroll | 0.1.0 |
| F053.6 | sanneandersen pilot adoption behind proven parity (no naked cutover) | coord |
| F053.7 | buildConnectCheckout escape hatches — paymentIntentData/subscriptionData passthrough + drop metadata auto-copy | 0.2.0 |

### v0.2.0 (F053.7) — parity escape hatches

Filed by sanne (consumer #1) during the F029.3 side-by-side rollout: `buildConnectCheckout@0.1.0` couldn't byte-match their 5 live route variants. Two fixes: `paymentIntentData` / `subscriptionData` (`Partial<…>`) now merge INTO the built PaymentIntent/Subscription — carrying `description`, `receipt_email` and a richer, DISTINCT metadata — with the Connect invariants (`on_behalf_of`, `transfer_data`) and the fee applied after so they always win; and the session `metadata` is NO LONGER auto-copied onto the PaymentIntent/Subscription (a `shop` route gets no PI metadata, a `booking` route gets its full set). `extra` stays a top-level escape hatch. Minor bump (sanne is the only consumer). Reuse-first in action: the package grew instead of the consumer working around it.

## 7. Open questions

- **Subscription-mode checkout** shape: v0.1.0 supports `mode:"subscription"` in `buildConnectCheckout` (line items with recurring prices). Connect application-fee on subscriptions uses `subscription_data.application_fee_percent` rather than a flat `application_fee_amount` — the builder branches on `mode` accordingly. Confirm against sanneandersen's Qi Gong flow during parity (F053.6).
- **Multi-tenant destination**: v0.1.0 takes `destination` per call (not a package-level constant), so a future multi-connected-account consumer needs no change. Good.
