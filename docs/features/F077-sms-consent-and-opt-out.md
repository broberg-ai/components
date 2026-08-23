# F077 — `@broberg/sms`: consent and opt-out

> Requested by Christian 2026-08-23: «byg samtykke/framelding». Flagged first as a risk on F076, because he intends to bill for sending — which moves the exposure from the consumer to him.

## The limit, first

**A package cannot make anyone compliant.** It can make the mechanics correct, refuse the sends that are obviously wrong, and keep evidence that can be produced later. Whether a given consent is *valid*, whether the existing-customer exception applies, whether the wording is adequate — all of that stays with whoever sends.

This has to be the README's first paragraph, not a footnote. A green `consent: 'enforced'` readback is a statement about wiring, not a legal opinion, and the difference is exactly the kind that gets forgotten between the day it ships and the day it matters.

## What the law asks for

| | |
|---|---|
| **Markedsføringsloven § 10** | Prior consent before electronic marketing (email, SMS). `[Certain]` |
| **§ 10, stk. 2** | An existing-customer exception for *similar own products*, conditional on the address being obtained in connection with a sale **and** an easy opt-out being offered both then and in **every** subsequent message. `[Likely — the conditions are the whole thing, and applying them is the sender's call, not ours]` |
| **GDPR art. 7(1)** | You must be able to **demonstrate** consent. A yes/no flag cannot: in a year nobody can say where the yes came from. |
| **GDPR art. 7(3)** | Withdrawal must be **at least as easy** as giving consent. |

What the law does **not** say: that opt-out must be a STOP reply. It wants a clear, free way out. A link satisfies that.

## The decision that must not be guessed

> **A transactional message is NEVER blocked by a marketing opt-out.**

A one-time code, an appointment change, a delivery notice — none are marketing. Blocking them locks people out of their own accounts, which is a worse outcome than the problem being solved. It gets an explicit test, not a comment.

### Therefore: `category` is required when the gate is on

There is no safe default.

- Default `transactional` → a marketing blast silently bypasses the gate.
- Default `marketing` → one-time codes get blocked.

Both are wrong in a dangerous direction. So with the gate on, a send with no `category` is **refused** — loudly, in development, at the twenty call-sites that each need a human decision. That friction is the correct amount.

With no consent store configured the layer is **off** and nothing changes. Ship-dark, as everything else in this package.

## The consent record

A yes/no flag is not consent. The record carries what art. 7(1) asks you to produce:

| Field | Why |
|---|---|
| `phone` | Normalised E.164, so one person is one key |
| `consentedAt` | |
| `basis` **(required)** | The sentence you could read aloud — *"Tilmeldt nyhedsbrev på sanneandersen.dk"*, *"Mundtligt ved konsultation 12/8"*. A record without one is **refused**: better no row than a row nobody can account for. |
| `textVersion` | *Which wording* they agreed to |
| `source` | Where it came from |
| `ip`, `userAgent` | Optional web-signup evidence |
| `withdrawnAt`, `withdrawalSource` | Set on opt-out — **the row is never deleted** |

Two of these are borrowed from precedents in this fleet rather than invented:

- **`basis` is required** — xrt81 F077.1: a consent nobody can account for is in practice no consent.
- **`textVersion`, and the row survives withdrawal** — sanneandersen F052: version the *document*, not a field inside it, or a version bump overwrites the very text earlier consents point at.

### The asymmetry, on purpose

| | |
|---|---|
| **Recording consent** | Requires a `basis`. Refuses on a withdrawn number unless `overrideWithdrawal` is passed — otherwise a re-run of a signup import silently un-withdraws everyone. |
| **Recording an opt-out** | Requires nothing. Never refuses. |

Withdrawal must be at least as easy as consent (art. 7(3)), and a guard that can reject an opt-out is the one bug in this file nobody would forgive.

## Two refusal reasons, not one

`no-consent` and `opted-out` are different facts. The first often means an import failed; the second is a person's decision. Collapsing them sends the reader to fix the wrong thing.

## The opt-out instruction in the body

Every marketing message needs one. When `optOutText` is configured, a marketing send whose body does not contain it is **refused**.

**It is not appended silently.** SMS is billed per segment, and quietly adding characters can flip a one-segment message to two — the exact class of surprise `estimate()` exists to prevent. Refuse, name the problem, let the sender see the cost.

## Scope

**In:** the consent register + store seam · the `category` gate · `recordConsent` / `recordOptOut` · `parseOptOutKeyword()` as a pure function · the opt-out-instruction requirement.

**Out — and why:**

- **STOP-by-reply.** Needs inbound. **Measured at GatewayAPI 2026-08-23, not recalled:** two-way requires a **keyword on a short code or a virtual number**, ordered under Subscriptions or via their support; the price is **not published**; their keyword/number module is currently **limited to Denmark**. That is real per-provider setup with a real cost, and F076 is send-only by Christian's own decision. Its own card, blocked on his call.
- **A hosted unsubscribe page.** That is a service, not a package — and it revives the parked `sms.broberg.ai` redirect-domain idea, since a link needs a host and GatewayAPI whitelists link domains.
- **Anything claiming to make a consumer compliant.**

`parseOptOutKeyword()` ships anyway, even with no inbound: it is a pure function, it costs nothing, and it means the fleet agrees on what counts as an opt-out the day inbound exists.

## Reuse

Checked Discovery first (F217): `consent` · `samtykke` · `opt-out` · `unsubscribe` · `afmeld` · `gdpr` · `suppression`.

`@broberg/consent-cookie` exists and is **the wrong thing** — browser cookie-banner consent in `localStorage`: different subject, different lifetime, different legal basis. Nothing in the fleet owns messaging consent.

**And the store is deliberately not the one F076.7 shipped.** `SmsEventStore` carries a TTL and defaults to 48 hours. A consent record must never expire — you may have to produce it years later. Reusing it would put a TTL-shaped hole in a legal record.

## Rollout

Off unless a store is configured. Nothing existing changes until a consumer opts in, and the moment they do, every send call-site has to declare what it is.

## Stories

| | |
|---|---|
| **F077.1** | The consent register + the `category` gate. Marketing needs a recorded consent; transactional is never blocked. |
| **F077.2** | The opt-out half: `recordOptOut`, `parseOptOutKeyword`, and the requirement that every marketing body carries an opt-out instruction. |
| **F077.3** | STOP-by-reply — **blocked** on Christian's decision (rent a keyword/number per gateway, or use links). |
