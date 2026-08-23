# F076 — `@broberg/sms`: one send primitive, three Danish providers, swap by config

> Requested by Christian 2026-08-22. He names the providers; **send-only** — inbound is deliberately out of scope.

## Motivation

The fleet has no way to send an SMS. **Measured, not assumed:** five Discovery searches (`sms`, `text message`, `gatewayapi`, `twilio`, `besked`) return zero hits. Nothing to reuse.

The requirement is Danish providers, hosted in Denmark/EU, with Danish GDPR terms — which is a *spec* constraint, not an ops one: a phone number is personal data, and SMS bodies routinely carry one-time codes and appointment details.

## Providers

Christian chose **GatewayAPI**, **inMobile** and **sms.dk**, and asked for a couple more around 0,29 kr/SMS.

**Prices fetched 2026-08-22 — not recalled.** My knowledge of current pricing is unreliable, and a price written from memory is wrong within months:

| Provider | Price/SMS (DK) | Subscription | Hosting / audit |
|---|---|---|---|
| **inMobile** | 0,0388 EUR ≈ **0,289 DKK** | **39 EUR/month** | EU-owned data centres in the EU · ISAE 3000 (Deloitte) |
| **GatewayAPI** | 0,3070 DKK | none | EU setup: hosting, ownership *and* routing in the EU · ISAE 3000 + 3402 |
| **CPSMS** | 0,39 → 0,29 kr at 100k (ex VAT) | none | GDPR mentioned; **DK hosting not confirmed** |
| **sms.dk** (Compaya) | not published | 0 kr/month | Danish company, Copenhagen · ISAE 3000 audited |

Also found: ZumoSMS (ISAE 3402 Type II), LINK Mobility DK, Computopic, SMS2GO.

### The number that decides it

inMobile hits the 0,29 target on unit price — and adds ~291 DKK/month. The gap to GatewayAPI is **1,8 øre per SMS**, so:

> **Break-even ≈ 16,000 SMS/month.** Below that, GatewayAPI is cheaper *despite* the higher unit price.

Volume has not been stated, and **does not need to be** — which is the real argument for this package. The price becomes a setting, not a decision.

## Two traps SMS has that email does not

Both cost money, and both are silent.

### 1. Encoding flips the price without telling you

GSM-7 gives **160** characters per segment. **One** character outside it — a curly apostrophe pasted from Word, an emoji, a non-breaking space — flips the *entire* message to UCS-2 at **70** characters per segment.

A 155-character message becomes **three segments instead of one**. Triple price. No warning, no error, and the message still arrives looking perfect.

Danish `æøå` are in GSM-7, which makes this *worse*, not better: everything looks fine right up until someone pastes a quote mark.

**So `estimate()` is core, not a utility.** The caller must be able to ask what a message will cost *before* paying for it.

### 2. A malformed number is billed, not rejected

`+45`, `45`, a bare 8 digits, spaces, parentheses — all reach a gateway, and most **accept and charge** for what they cannot deliver. The failure is silence; there is no bounce to see.

### And "accepted" is not "delivered"

The form this repo has been fighting all week, harder here than for mail: the provider answering `accepted` means it took the message, not that a handset received it. **Every one of those costs money.** Delivery status is therefore not a later refinement — a repo without it is paying for messages it cannot prove arrived.

## Design

Same shape as [`@broberg/mail`](F005-mail-sending-resend.md) — proven, and the fleet already reads it:

```ts
import { createSms, gatewayapi } from "@broberg/sms";

const sms = createSms({
  provider: gatewayapi({ apiKey: process.env.SMS_API_KEY }),
  from: "Moovyy",
  live: process.env.SMS_LIVE === "true",
  allowlist: ["+4512345678"],
});

sms.mode;                                  // 'live' | 'allowlist-only' | 'disabled' | 'no-key'
sms.estimate("Hej — din kode er 1234");    // { segments, encoding, chars, warning? }
await sms.send({ to: "+4512345678", text: "…" });   // { ok, id?, error?, skipped? }
```

- **Ship-dark**: no key → logged no-op, never a crash.
- **Allowlist gate** with fleet admins, so a test send never reaches a customer.
- **`mode` from day one** — F005.8's lesson, not re-learned after an incident.
- **Never throws.** A typed result, always.
- **Zero runtime dependencies**, `fetch` only, so it runs on Node, Bun and edge alike.
- **One entry point, not a subpath per adapter** (decided F076.2). This doc first sketched `@broberg/sms/gatewayapi`. An adapter here is ~40 lines of `fetch` with *no* dependency to keep external, so splitting the package buys nothing and re-opens the tsup clean-race that cost us two broken tarballs (F061). Tree-shaking already drops unused adapters for ESM consumers.

## Scope

**In:** the core, three adapters, phone normalisation, segment/cost estimation, delivery status.

**Out:** inbound SMS (Christian, explicitly — it needs owned numbers, inbound webhooks and conversation routing: a second product). Templates. Contact lists. Campaign scheduling.

## Build three adapters, not five

Christian asked for a couple more providers beyond his three. **Recommendation: record them, build three.**

An adapter nobody uses is an adapter nobody has proven works — this week's lesson applied to scope rather than to code. Each extra one is an afternoon *when someone actually needs it*, and by then its API will have been checked against reality rather than against a docs page read months earlier.

## Reuse

Checked Discovery before writing this (`sms`, `text message`, `gatewayapi`, `twilio`, `besked`): **zero hits**. No `@broberg/*` package owns SMS or any part of it.

What *is* reused is the **shape**: `@broberg/mail`'s create → mode → ship-dark → allowlist → typed-result contract, including the `mode` readback (F005.8) and the delivery-webhook lesson (F005.7). Deliberately not shared as code — the two have different result types, different failure modes and different units of cost, and a premature shared base would couple them for the sake of four similar lines.

## Rollout

Core first with a fake provider, so the contract is proven before any real API is wired. Then one real adapter, live-verified against a real handset. Then the others. Nothing goes to a customer until `mode` and delivery status have both been read back from a real send.
