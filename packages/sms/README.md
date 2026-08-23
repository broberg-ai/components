# @broberg/sms

One SMS send primitive for the fleet. The gateway is a **setting**, not a rewrite.

Danish / EU-hosted providers only — a phone number is personal data, and SMS bodies routinely carry one-time codes and appointment details.

```bash
npm i @broberg/sms
```

## Usage

```ts
import { createSms } from "@broberg/sms";

const sms = createSms({
  provider: gatewayapi({ apiKey: process.env.SMS_API_KEY }),
  from: "Moovyy",
  live: process.env.SMS_LIVE === "true",
  allowlist: ["+4512345678"],
});

sms.mode;                                   // 'live' | 'allowlist-only' | 'disabled' | 'no-key'
await sms.send({ to: "12345678", text: "Din kode er 1234" });
// → { ok: true, id: "…", estimate: { units: 20, segments: 1, encoding: 'gsm-7' } }
```

Zero runtime dependencies, `fetch` only — it loads on Node, Bun and edge alike.

## `estimate()` — what a message costs, before you pay for it

**The most useful function in this package.** A message is billed per *segment*, and the segment count is not a property of how long the text looks. It is a property of **which characters are in it**.

```ts
estimate("Din kode er 1234");
// { units: 16, segments: 1, encoding: 'gsm-7' }
```

### One character can triple the price

GSM-7 gives **160** characters per message. One character outside it — a curly apostrophe pasted from Word, an emoji, a non-breaking space — flips the **whole** message to UCS-2 at **70** per part.

```ts
estimate(msg155).segments;                    // 1
estimate(msg155.replace("'", "’")).segments;  // 3   ← same message, one quote mark
```

Triple price. No warning from the gateway, no error, and it still arrives looking perfect.

**Danish `æøå` are in GSM-7**, which makes this worse rather than better: Danish text looks completely safe, because it is — right up until someone pastes a quote mark. When a message does flip, `warning` names the exact character that did it, because a warning you cannot act on is one you stop reading.

### Two details that quietly under-report a bill

- **A split message costs 153/67 per part, not 160/70.** Concatenated SMS spends 7 bytes per part on the header that stitches them together.
- **The GSM-7 *extension* characters cost two septets each** — `€ [ ] { } \ ^ ~ |`. Eighty euro signs is two messages, not one.

## `normalisePhone()` — refusing matters more than accepting

Accepts `+4512345678`, `4512345678`, `12345678`, `00 45 …`, and the spaced/parenthesised forms people actually type. Returns E.164.

**It throws on anything ambiguous**, and that is the point: a guessed number is accepted by the gateway, **billed**, and never delivered — and nothing in the chain reports it. There is no bounce to see. So the refusal has to happen before the money is spent.

## `mode` — assert at boot what the client resolved to

```ts
if (isProd && sms.mode !== "live") throw new Error(`SMS is ${sms.mode}`);
```

Four states, one field, carrying the reason. Precedence follows what `send()` actually does: **disabled** beats **no-key** beats **live**.

Deliberately not a boolean `live`: three separate conditions stop delivery, and all three return the same success-shaped `{ ok: true, skipped: true }`. A `live`-only readback would let you write `if (isProd && !sms.live) throw` and have it **pass** over a client with no provider at all.

Derive "am I deployed" from a **platform-injected** signal (`FLY_APP_NAME`, `K_SERVICE`), never from the same variable that opens the gate — a check written circularly against `NODE_ENV` has an unreachable complaint branch.

## Ship dark

No provider → a logged no-op. `live` is an **explicit** opt-in, never inferred from "we have a provider": inferring it is how a staging deploy mass-sends to real customers, and here it also spends real money.

An allowlist entry that cannot be parsed is **dropped with a warning**, never silently widening the gate.

## `send()` never throws

```ts
{ ok, id?, error?, skipped?, estimate? }
```

`estimate` is present even when the send is skipped — so you can see what dark mode *would* have spent.

## "Accepted" is not "delivered"

A gateway answering `accepted` means it took the message, not that a handset received it — and **every one of those costs money**. Delivery status is F076.5; until it lands, a repo using this is paying for messages it cannot prove arrived.

## GatewayAPI

```ts
import { createSms, gatewayapi } from "@broberg/sms";

const sms = createSms({
  provider: gatewayapi({ apiKey: process.env.SMS_API_KEY }),   // region defaults to 'eu'
  from: "Moovyy",                                              // 3–18 characters, enforced
  live: process.env.SMS_LIVE === "true",
});
```

Built against their **Mobile Messaging API** (OpenAPI `2026.08.21-1807`, fetched 2026-08-23), not against recalled knowledge — which mattered three times:

| Trap | What memory would have produced | What the spec says |
|---|---|---|
| **The endpoint** | `POST /rest/mtsms` — every example on the web | That API now lives under `/docs/apis/**legacy**/rest/` and opens with a deprecation notice telling new customers to use this one. We *are* a new customer. |
| **Success status** | `200` (what the legacy API answered) | **`202 Accepted`.** `if (res.status !== 200) throw` reads like the obvious check and would fail *every successful send*. |
| **Recipient** | `recipients: [{ msisdn: "+4512345678" }]` | `recipient: 4512345678` — a bare **integer**, singular, no `+`. |

### `region` is not a URL preference

`'eu'` (default) → `messaging.gatewayapi.eu` · `'com'` → `messaging.gatewayapi.com`

A key is issued by, and valid for, **one** dashboard, so the region decides where the account and the message data live. `'eu'` is the default because EU hosting is the reason this package exists. Pick the wrong one and the key simply `403`s — which is why that error names the region it was pointed at.

### 401 and 403 are different faults

Measured against the live endpoint on 2026-08-23 — **their docs list only 403**:

| | | The fix |
|---|---|---|
| **401** | no credentials reached them | the `Authorization` header is missing or malformed. Your key is probably fine. |
| **403** | credentials arrived and were **rejected** | wrong/revoked key — or a key minted in the *other* region. |

Collapsing the two sends you off to rotate a perfectly good key.

### A timeout is not a failure

`{ ok: false }` on a timeout does **not** mean nothing was sent. The request may have arrived and the message may already be billed — we simply never heard the answer. The error says so in as many words. **Do not retry blindly**; confirm via delivery status (F076.5) first.

### What is proven, and what is not

- ✅ **Proven against the live service:** both hosts exist, the path and method are right, the `Token` scheme is recognised, and a rejected credential produces the correct 403 diagnosis end-to-end from the built package.
- ✅ **Proven against their published schema:** the request body this adapter sends validates against `MobileMessageRequest` — required fields, types, lengths and enums. The schema is the one part of the test suite we did not write.
- ❌ **Not proven:** that a *valid* token returns `202` with a `msg_id`, and that an SMS reaches a handset. Both need a real account. Until then this adapter is **unverified against a successful send**.

## Providers

| Provider | Price/SMS (DK) | Subscription | Hosting / audit |
|---|---|---|---|
| inMobile | 0,0388 EUR ≈ 0,289 DKK | 39 EUR/month | EU-owned data centres in the EU · ISAE 3000 (Deloitte) |
| GatewayAPI | 0,3070 DKK | none | EU setup: hosting, ownership *and* routing in the EU · ISAE 3000 + 3402 |
| CPSMS | 0,39 → 0,29 kr at 100k (ex VAT) | none | GDPR mentioned; DK hosting not confirmed |
| sms.dk (Compaya) | not published | 0 kr/month | Danish company, Copenhagen · ISAE 3000 audited |

> **Fetched 2026-08-22, not recalled** — and stated with its date because an inventory cannot know it has gone stale. Re-check before quoting.
>
> **Break-even ≈ 16,000 SMS/month.** inMobile wins on unit price and loses on the subscription; below that volume GatewayAPI is cheaper *despite* costing more per message. Which is exactly why the provider is a setting.

## Writing an adapter

```ts
const myGateway: SmsProvider = {
  name: "my-gateway",
  async send({ to, text, from }) {
    const res = await fetch("https://…", { method: "POST", body: JSON.stringify({ to, text, from }) });
    if (!res.ok) throw new Error(`my-gateway ${res.status}: ${await res.text()}`);
    return { id: (await res.json()).id };
  },
};
```

One method, one shape. Throw on failure — the core turns it into `{ ok: false, error }` and never lets it reach the caller as an exception.
