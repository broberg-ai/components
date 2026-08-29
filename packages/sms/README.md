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
// → { ok: true, outcome: 'sent', id: "…", estimate: { units: 20, segments: 1, encoding: 'gsm-7' } }
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

### The second argument is a DIALLING CODE, not a country (0.12.0)

```ts
normalisePhone("22680880")        // "+4522680880"  — 45 is the default
normalisePhone("22680880", "45")  // "+4522680880"
normalisePhone("22680880", "+45") // "+4522680880"  — one leading plus is stripped
normalisePhone("22680880", "DK")  // THROWS
```

It used to be called `defaultCountry` and nothing validated it, so `"DK"` went
straight into the string and the function returned **`"+DK22680880"`** without an
error — the exact number it exists to refuse, produced by itself. A gateway
accepts that, bills it, and never delivers it. Reported by a consumer against
0.11.0; renamed to `defaultDiallingCode` and validated in 0.12.0.

There is deliberately **no ISO country table**. A table goes stale, and the
invitation to write `"DK"` came from the *name* — remove the invitation and the
table is unnecessary. Passing `"DK"` is a programmer error, not bad user input,
so it throws with the value named in the message.

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

## `send()` never throws — and it has **four** answers, not two

```ts
{ ok, outcome, id?, error?, skipped?, estimate? }
```

> ## ⚠️ The retry rule
>
> **Retry on `refused`. NEVER retry on `unknown`** — an unknown may already have been sent *and billed*.

`ok` is a boolean and there are four things that can happen, so `ok` alone cannot tell you what to do next. **`outcome` is what you branch on:**

| `outcome` | `ok` | What happened | Retry? |
|---|---|---|---|
| `sent` | `true` | The gateway took it and gave us a handle | no |
| `skipped` | `true` | Dark mode / not allowlisted / no key — nothing was sent, nothing was billed | n/a |
| `refused` | `false` | **The gateway told us no.** Bad number, rejected key, unapproved sender | **yes** |
| `unknown` | `false` | **We never heard the answer.** It may be on its way to a handset already | **no** |

```ts
const res = await sms.send({ to, text });
if (res.outcome === "refused") return retry();      // safe: nothing went out
if (res.outcome === "unknown") return alertAndCheckDeliveryStatus(res);
```

### Why `unknown` exists

A request that times out, a socket that dies mid-flight, a `2xx` whose body we cannot read — in every one of those we do **not** know what happened. The message may have reached the gateway, may already be on its way, and **may already be billed**.

Collapsed into `ok: false`, that is indistinguishable from a rejected key. And the obvious response to `ok: false` is to retry — which double-sends, double-charges, and on a one-time code sends the user **two different codes, of which only one works**.

The rule the classifier follows, in one line:

> **`refused` means the gateway told us no. Anything else that is not a confirmed send is `unknown`.**

Note that two of the three gateways deliver a refusal on a **`2xx`** (sms.dk's `207` with the number in `rejected`, inMobile's `200` with `isValidMsisdn: false`), so this is not an HTTP-status test — see *Three gateways, three hiding places* below.

**`ok` still means what it always did.** An `unknown` is `ok: false`, so an existing `if (!res.ok)` alarm keeps firing. Reading `outcome` is what's new, not a behaviour change.

`estimate` is present even when the send is skipped — so you can see what dark mode *would* have spent.

### Writing your own retry wrapper?

Branch on `outcome`, never on `error` text. If you need to classify an error you caught yourself, use the exported `isUnknownSendError(err)` — it reads a **brand** on the error, not `instanceof`, so it survives two copies of this package ending up in one bundle.

## The duplicate lock — nothing sends the same message twice

> **On by default.** A double-clicked button, a retried job, a resubmitted form — each one used to call the gateway again, be accepted, and be billed. The recipient got the same SMS twice.

```ts
const sms = createSms({ provider, from: "Moovyy", live: true });
sms.duplicateGuard;                      // 'process' — assert this at boot

await sms.send({ to, text });            // → { outcome: 'sent', id: 'msg_1' }
await sms.send({ to, text });            // → { outcome: 'skipped',
                                         //     skippedReason: 'duplicate',
                                         //     id: 'msg_1' }   ← the ORIGINAL id
```

The suppressed call is **not an error** — the caller has nothing to fix — and it hands back the id of the message that *did* go, so you keep the handle you need for delivery status.

### Four ways a send can be deliberately skipped, four values

`skippedReason` tells them apart, because they are not the same problem:

| `skippedReason` | Meaning |
|---|---|
| `duplicate` | The lock stopped it. **In production this is a signal** — something upstream is double-firing. |
| `not-allowlisted` | Dark mode, and this number is not on the allowlist. Expected in staging. |
| `disabled` | The kill-switch is on. |
| `no-provider` | Ship-dark: no gateway is configured. |

### The window is short on purpose — 60 seconds

The two windows in this package fail in **opposite** directions, so they are not the same number:

- **Too short** → a duplicate slips through. Cost: one extra SMS.
- **Too long** → a *legitimate* repeat is blocked. Cost: a customer never gets a message they needed.

The second is worse, so the lock stays near the length of the thing it actually catches. A re-requested one-time code is safe either way (a new code is different text), but *"Din bestilling er klar"* for two separate orders inside a minute would be blocked — pass an `idempotencyKey` for those.

```ts
await sms.send({ to, text, idempotencyKey: `order-${id}` });
```

It **replaces** the derived key, so it works both ways: two identical messages with different keys both go out, and two different call-sites sharing one key collapse to a single send.

### A failed send does not hold the lock — an unknown one does

This is [the retry rule](#sendnever-throws--and-it-has-four-answers-not-two) enforced rather than documented:

| The send was… | The lock | Because |
|---|---|---|
| `refused` | **released** | The gateway said no. Retrying is exactly what you should do. |
| `unknown` | **held** | It may already have gone *and* been billed. The lock is what stops the retry. |
| `sent` | held, with the id | |

### Configuring it

```ts
createSms({ …, duplicates: { window: 60_000, store: myStore } })   // shared across instances
createSms({ …, duplicates: false })                                // off
```

`duplicateGuard` reads `'process'` · `'shared'` · `'shared-atomic'` · `'off'` — the same three-value honesty as the delivery inbox, plus off. **`'process'` means a second instance behind a load balancer will send again.**

**The store never holds the message or the number.** The key is a SHA-256 hash of sender + recipient + text. Both a phone number and an SMS body are personal data, and a key travels — to Redis, into logs, into a dump.

**If the store is unreachable, the message still goes out** and a warning says protection was lost. A guard that takes the whole SMS capability down when Redis hiccups is worse than the duplicate it was preventing — nobody logs in while the one-time codes are blocked.

## Consent and opt-out

> ### This does not make you compliant
>
> It makes the mechanics correct, refuses the sends that are obviously wrong, and keeps evidence you can produce later. Whether a given consent is **valid**, whether the existing-customer exception applies, whether your wording is adequate — that stays with you. `consentMode: 'enforced'` is a statement about *wiring*, not a legal opinion.

```ts
import { createSms, createConsentRegistry } from "@broberg/sms";

const consent = createConsentRegistry({ store: myConsentStore });
const sms = createSms({ provider, from: "Moovyy", live: true, consent });

sms.consentMode;                       // 'enforced' | 'body-only' | 'off' — assert at boot

await consent.record({
  phone: "+4522680880",
  basis: "Tilmeldt nyhedsbrev på webshoppen 23/8",   // required
  textVersion: "samtykke-v2",
});

await sms.send({ to, text, category: "marketing" });      // → sent
await sms.send({ to: other, text, category: "marketing" }); // → skipped / 'no-consent'
```

### The rule that is a test, not a comment

> **A transactional message is NEVER blocked by a marketing opt-out.**

A one-time code, an appointment change, a delivery notice — none of those are marketing. Blocking them locks people out of their own accounts, which is worse than the problem being solved.

### So `category` is required, and there is no default

With a register wired, **every** send must say what it is. A send without a `category` is **refused**.

| A default of… | would… |
|---|---|
| `transactional` | let a marketing blast bypass the gate **silently** |
| `marketing` | block one-time codes |

Both wrong in a dangerous direction. The friction of touching every call-site is the point — each one needs a human decision.

**With no register wired, nothing changes.** No category needed, nothing blocked.

### Two reasons, not one

| `skippedReason` | Usually means |
|---|---|
| `no-consent` | Your import failed, or you never asked. |
| `opted-out` | A person's decision. |

Same outcome, entirely different thing to do about it.

### The record is not a boolean

GDPR art. 7(1) asks you to **demonstrate** consent — a yes/no flag cannot, because in a year nobody can say where the yes came from.

| Field | |
|---|---|
| `basis` **(required)** | The sentence you could read aloud. A record without one is **refused**: better no row than one nobody can account for. |
| `textVersion` | *Which wording* they agreed to. Version the document, not a field inside it — otherwise a bump overwrites the text earlier consents point at. |
| `consentedAt`, `source`, `ip`, `userAgent` | |
| `withdrawnAt`, `withdrawalSource` | Set on opt-out. **The row is never deleted.** |

### The asymmetry is deliberate

| | |
|---|---|
| `consent.record()` | Needs a `basis`. **Refuses on a withdrawn number** unless `overrideWithdrawal: true` — otherwise re-running a signup import silently un-withdraws everyone who ever opted out, with no error to notice. |
| `consent.optOut()` | Needs **nothing**. Never refuses. Works on a number that never consented. Idempotent, and the **earliest** withdrawal date stands. |

Withdrawal must be at least as easy as giving consent (art. 7(3)), and a guard that can reject an opt-out is the one bug here nobody would forgive.

### Every marketing message must carry a way out

Markedsføringsloven wants a clear and **free** way out in every marketing message — and for the existing-customer exception (§10 stk. 2) it is one of the *conditions*, not a courtesy. **The mechanism is not specified**, so a link satisfies it and none of this needs inbound SMS.

```ts
const consent = createConsentRegistry({
  store: myConsentStore,
  optOutText: "Afmeld: sms.broberg.dk/a/x7k2",
});

await sms.send({ to, text: "Tilbud i weekenden!", category: "marketing" });
// → refused: this body does not contain "Afmeld: sms.broberg.dk/a/x7k2"
```

> **It is never appended for you.** SMS is billed per segment, so silently adding characters can turn a one-segment message into two — and you would meet that on the invoice rather than in an error. The send is refused, you put the line where you want it, and `estimate()` tells you what it costs.

A **transactional** message is never asked to carry it. A one-time code should not have marketing furniture on it.

### `parseOptOutKeyword()` — ready before there is anything to read

```ts
parseOptOutKeyword("STOP");                          // true
parseOptOutKeyword("AFMELD");                        // true  (Danish and English)
parseOptOutKeyword("Kan I stoppe leveringen fredag?") // false ← the important one
```

This package **does not receive SMS**. A STOP *reply* needs two-way messaging: a keyword on a short code or a virtual number, **per gateway**, at a price none of them publish. That is a decision, not a config toggle — so this ships as a pure function instead, and the day inbound exists the whole fleet already agrees on what counts as an opt-out.

It matches the **whole message**, not a substring. A false positive unsubscribes someone who asked a question, and they only find out when they wonder why nothing arrives.

### `consentMode` — three values, because there are three

| | You wired | What is checked |
|---|---|---|
| `off` | nothing | nothing. No category needed. |
| `body-only` | `optOutText`, no store | marketing **bodies** — but not consent, because there is nothing to check against |
| `enforced` | a store | consent, and the body if `optOutText` is set |

The middle value exists so nobody reads *"enforced"* over a register that cannot read a single consent record.

### The store has no TTL, on purpose

It is **not** the `SmsEventStore` used by the delivery inbox and the duplicate lock — that one expires after 48 hours. A consent record must never expire; you may have to produce it years later.

```ts
interface SmsConsentStore {
  get(phone: string): Promise<ConsentRecord | null> | ConsentRecord | null;
  put(record: ConsentRecord): Promise<void> | void;
}
```

`MemorySmsConsentStore` ships for tests. It dies with the process, which makes it useless as a legal record — `consentMode` cannot tell you that, but your deployment can.

## "Accepted" is not "delivered"

A gateway answering `accepted` means it took the message, not that a handset received it — and **every one of those costs money**. Delivery status is F076.5; until it lands, a repo using this is paying for messages it cannot prove arrived.

## Delivery status — proving a message ARRIVED

`"accepted"` is the gateway saying it took your message. Every one of those costs money whether or not a handset ever saw it.

```ts
import { fetchSmsDkLog, fetchInMobileReports,
         parseGatewayApiWebhook, verifyGatewayApiSignature } from "@broberg/sms";

const reports = await fetchSmsDkLog({ apiKey, limit: 50 });
// [{ provider, id, state: "delivered", raw: "Received", recipient, at, charged, segments }]
```

**One vocabulary, five states**, and `pending` is deliberately not `unknown`:

| state | meaning |
|---|---|
| `delivered` | the network confirmed it reached the handset |
| `failed` | permanently not delivered |
| `expired` | the gateway gave up |
| `pending` | the gateway says **not yet** |
| `unknown` | the gateway said something we do not recognise |

**An unrecognised status becomes `unknown` — never `delivered`, never `failed`** — and the provider's own word is always kept in `raw`. This is not defensive padding: GatewayAPI publishes the RCS status values and *not* the full SMS set, so meeting a status we have never seen is the **common** case. Rounding it to the nearest one we know is how a message nobody received gets recorded as arrived.

`pending` vs `unknown` matters because the gateways themselves distinguish them: inMobile's state 0 is literally named *Unknown*, while sms.dk's 0 is *"No status yet"*. Collapsing them throws away a fact they went to the trouble of reporting.

### Three providers, three mechanisms

| | webhook | polling |
|---|---|---|
| **GatewayAPI** | POST, **HMAC-SHA-256 signed** | **none, by design** — "the Mobile Message API does not include APIs for polling message states" |
| **inMobile** | `statusCallbackUrl` | `GET /v4/sms/outgoing/reports` — **read-once** |
| **sms.dk** | `dlrUrl`, delivered by **GET** | `POST /v1/sms/listlog` — repeatable |

**inMobile's poll is destructive.** Their words: *"Each report will only be returned once. Once called, the status has been removed from our side and cannot be retrieved again."* Measured: a second read of the same report returns `[]`. So **persist before you filter**, and never run two pollers — they do not each see everything, they split the reports and both believe they saw it all.

**GatewayAPI webhooks retry with exponential backoff for up to 24 hours** and require a 2xx within 5 seconds. Duplicates are guaranteed, not an edge case — dedupe on `id` + `state`.

### Verifying a GatewayAPI webhook

```ts
const raw = await request.text();               // the RAW body, not a re-serialised object
if (!(await verifyGatewayApiSignature(raw, request.headers.get("Signature"), secret))) {
  return new Response("bad signature", { status: 403 });
}
for (const report of parseGatewayApiWebhook(JSON.parse(raw))) { /* … */ }
```

Pass the body **exactly as received**. Re-serialising a parsed object changes the bytes — key order, whitespace, number formatting — and the signature will not match. That is the most common way this check fails. Verification uses `crypto.subtle` (so it works on Node, Bun, Deno, workers and the browser) and compares in constant time.

**An empty secret is rejected**, never treated as "verification not configured".

### One provider timestamp is not a date

`new Date("23.08.2026 12.33.57")` — sms.dk's format, Danish order with **dots in the time too** — is `Invalid Date`. inMobile's and GatewayAPI's parse fine. It is handled explicitly, and **an unparseable timestamp leaves `at` absent rather than emitting a guess**.

## Duplicate + out-of-order delivery events

> **GatewayAPI retries a webhook that does not answer `2xx` within 5 seconds — with backoff, for up to 24 hours.** Duplicates are the normal case, not an edge case. A slow query, a deploy, one pause, and the identical event arrives again.

```ts
import { createDeliveryInbox, parseGatewayApiWebhook } from "@broberg/sms";

const inbox = createDeliveryInbox({ store: myStore });   // omit store → in-process
console.log(inbox.guarantee);                            // assert this at boot

app.post("/sms/status", async (c) => {
  for (const v of await inbox.accept(parseGatewayApiWebhook(await c.req.json()))) {
    if (!v.fresh) continue;                  // a retry, or older news than we hold
    await db.setStatus(v.report.id, v.state);
    if (v.state === "failed") await alertSomeone(v.report);
  }
  return c.body(null, 200);
});
```

### Two problems, and only the first is obvious

**1. The same event twice.** Harmless for a status write; expensive for anything hanging off it — a "your code is on its way" push sent twice, a fan-out fired twice, a per-message charge counted twice.

**2. A status arriving out of order.** This is the one that bites silently. Retries plus backoff mean a delayed `enroute` can land *after* the `delivered` it preceded. Last-write-wins then downgrades a delivered message back to pending — and it **stays wrong forever**, because no further event is coming.

The rule `accept()` enforces:

> **A resolved state is never replaced by an unresolved one.**
>
> `delivered` / `failed` / `expired` are resolved. `pending` and `unknown` are not — and `unknown` sits there deliberately: *a status we could not read must never displace one we could.*

Within one tier, the gateway's own timestamps decide; with no timestamps the newest arrival wins.

### `guarantee` — read it at boot, like `mode`

A dedupe you believe is fleet-wide and is really per-process is exactly the kind of thing nobody discovers until it has already cost money. So it says so:

| `guarantee` | You passed | What you actually have |
|---|---|---|
| `process` | no store | Dedupes **within this process**. Restart, or a second instance, and the same event is processed again. |
| `shared` | a store | Real dedupe — but `get`-then-`set` is not atomic, so two copies arriving in the *same instant* can both be judged fresh. |
| `shared-atomic` | a store with `setIfAbsent` | The real thing. Redis `SETNX`, a unique constraint, a conditional put. |

### The store is yours

**This package does not own a database.** You supply two methods (three for the strong guarantee):

```ts
interface SmsEventStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, ttlMs?: number): Promise<void> | void;
  setIfAbsent?(key: string, value: string, ttlMs?: number): Promise<boolean> | boolean;
}
```

Events are remembered for **48 hours** by default — GatewayAPI retries for 24, so anything shorter lets the tail of a retry storm through as "new".

The default `MemorySmsEventStore` is **bounded** (50k entries, oldest evicted). An unbounded `Map` fed by a webhook endpoint is a memory leak with a public URL.

## Retry — off by default, and never on an `unknown`

```ts
createSms({ …, retry: true })                              // 2 retries, 500ms then 2s
createSms({ …, retry: { attempts: 3, delaysMs: [200, 1000, 5000] } })

sms.retryPolicy;   // { attempts, delaysMs, maxRetryAfterMs, worstCaseMs } | null
```

> **`unknown` is never retried, whatever you configure.** It may already be on its way to a handset *and already billed*. Retrying it double-sends, double-charges, and on a one-time code delivers two different codes of which only one works.

This is why retry could not exist before [the four outcomes](#sendnever-throws--and-it-has-four-answers-not-two) and [the duplicate lock](#the-duplicate-lock--nothing-sends-the-same-message-twice) did.

### And not every refusal is worth retrying either

| | |
|---|---|
| **429, 5xx** | retried |
| **400, 401, 403, 404, 422** | **not** — they fail identically on attempt five, and retrying wastes your caller's time |
| **timeout, dropped socket** | never — that is `unknown` |

A 5xx *is* retried because a gateway that failed on its own side has almost certainly not queued anything. **"Almost certainly" is not "certainly"** — if your traffic is one-time codes and a duplicate is worse than a miss, leave retry off for that client.

The decision is made on a **brand** on the error, never on its message text. `err.message.includes("429")` agrees with any message containing those three characters; a test proves an ordinary `Error` shouting *429* is **not** retried.

### `Retry-After` is honoured, and a `0` is not

A gateway asking you to wait replaces the backoff. A `Retry-After: 0` — or a missing, past-dated or unparseable one — falls back to the backoff instead of retrying instantly. An absurd one is **capped** (`maxRetryAfterMs`, default 10s) with a warning, so a request handler is never parked for ten minutes.

### The worst case is a number, not an adjective

`delaysMs` is a **list, not a formula**. "Exponential with jitter" cannot be read off a config to answer the only question that matters:

> *What is the worst case inside my request handler?*

`retryPolicy.worstCaseMs` answers it. **Read it together with your provider's `timeoutMs`** — three attempts against a 15-second timeout is 45 seconds of requests *plus* the waits, and that total is what your caller waits for.

Which is why retry is **off by default**. The duplicate lock prevents money being spent; retry *spends time*, in someone else's request handler.

## `sendMany()` — 5,000 recipients without 5,000 HTTP calls

```ts
const results = await sms.sendMany([
  { to: "+4512345678", text: "Tilbud! Afmeld: …", category: "marketing" },
  { to: "+4587654321", text: "Tilbud! Afmeld: …", category: "marketing" },
  // …4,998 more
]);

results.length;              // 5000 — ALWAYS one per recipient, in the order given
results.filter(r => r.outcome === "sent").length;
results.filter(r => r.skippedReason === "opted-out");   // who was gated, and why
```

**One result per recipient, always.** A batch that reports a single status hides the forty people out of five thousand who were blocked — behind a green result.

**One failure does not abort the rest.** A bad number at position 300 is the ordinary case, not the exceptional one. Every recipient after it is still attempted.

**Every per-recipient gate still runs per recipient** — consent, the opt-out line, the duplicate lock, the allowlist, and the price. `sendMany()` and `send()` share one gate function, so a rule added to one is a rule added to both.

### What it costs, before you pay it

```ts
const bill = sms.estimateMany(messages);
bill.segments;    // 6,412 — this is the number on the invoice
bill.encodings;   // { "gsm-7": 4,998, "ucs-2": 2 }
bill.warnings;    // [{ index: 17, warning: "“ is not in GSM-7 …" }]
```

Exactly the sum of the individual estimates. **Look at `encodings`:** one curly apostrophe in a template used for 5,000 people is 5,000 messages billed at UCS-2 rates, and the total alone will not tell you — it just looks like a big send.

### How it actually goes out — read it at boot

```ts
sms.batch;   // { mode: "gateway-batch", size: 1000, concurrency: 5 }
```

| Provider | `mode` | Recipients per call | Measured from |
|---|---|---|---|
| **GatewayAPI** | `gateway-batch` | **1000** | live OpenAPI — `MultiMobileMessageRequest.messages.maxItems` |
| **inMobile** | `gateway-batch` | **250** | live swagger — `SmsOutgoingPostRequest.messages.maxItems` |
| **sms.dk** | `fan-out` | 1 | *see below* |

The difference between five requests and five thousand is worth being able to read rather than infer — and it changes when you change provider, not when you change your code.

**A batch larger than the limit is SPLIT, never rejected.** You asked to reach 1,001 people; the transport's ceiling is this package's problem.

> **Two different 1000s in GatewayAPI's spec.** `messages` has `maxItems: 1000` — the batch limit. `recipient` has `gt: 1000` — a floor on the *phone number as an integer*. Both are 1000, only one of them splits a send correctly, and reading the wrong one fails silently.

**Why sms.dk fans out:** their own validation answers `"receiver" needs to be a digit`, which reads as a scalar rather than a list. Their reply carries a `batchId`, so a multi-recipient form may well exist — but their docs render entirely as a JavaScript app and we could not enumerate a second endpoint. **Not proven either way**, and the only way to settle it is to POST an array of real numbers at a live send endpoint. A wrong guess about a batch limit is not a bug you find in a test; it is an invoice.

### The failure modes it is careful about

**A timed-out chunk is `unknown` for every recipient in it — never `refused`.** The gateway may have taken all thousand. This is precisely where a naive retry re-sends a thousand delivered messages, so the same rule holds as for a single send: **never retry an `unknown`.**

**Fewer answers than recipients is `unknown`, not silence.** If a gateway returns 999 results for 1,000 messages, the missing one is reported — it may well have been sent. It is never quietly dropped.

**An id is never attributed by position alone.** Both GatewayAPI and inMobile echo the recipient back on every answer, so each is matched to the number *we* sent and consumed once. Trusting array order would let a reordered reply write one person's delivery status against another — and nothing downstream could catch it, because both ids are real.

**A repeat inside one batch is caught.** The same number twice in an uploaded list is blocked by the duplicate lock, because the gates run sequentially before anything is dispatched. That also makes the lock hold on a *shared* store with no atomic claim — where a parallel gate pass would let both copies through and bill both.

```ts
// Tune it if you need to
await sms.sendMany(messages, { concurrency: 10, chunkSize: 100 });
```

`concurrency` defaults to **5**. It is the knob that turns a large send into a 429.

## The webhook route — one line, all three providers

```ts
import { createSmsWebhook, createDeliveryInbox } from "@broberg/sms";

const inbox = createDeliveryInbox({ store: myStore });

export const POST = createSmsWebhook({
  secret: process.env.GATEWAYAPI_WEBHOOK_SECRET,
  sharedToken: process.env.SMS_WEBHOOK_TOKEN,
  async onReports(reports) {
    for (const v of await inbox.accept(reports)) {
      if (v.fresh) await db.setStatus(v.report.id, v.state);
    }
  },
});
```

Hono, same options:

```ts
app.all("/sms/status", smsWebhookHono({ secret, sharedToken, onReports }));
```

It handles **all three shapes** — GatewayAPI's signed POST, inMobile's POST, and sms.dk's GET-with-query — and tells your handler which one arrived.

### The three ways assembling this by hand goes wrong

**1. The raw body.** Verification must run on the bytes *as received*. Parse first and re-serialise for the signature and it will not match — key order alone is enough — and the natural "fix" is to stop verifying. **The handler owns the read**, so it cannot happen.

**2. The 5-second, 2xx contract.** GatewayAPI retries for **24 hours** unless it gets a 2xx within five seconds. So: verify, parse, **acknowledge**, *then* do your work. Your `onReports` runs after the response and may be as slow as it likes.

> **On serverless, pass `waitUntil`.** Cloudflare and Vercel freeze the process once the response returns. The Hono adapter wires `c.executionCtx.waitUntil` for you; for a bare handler, pass it yourself. Without it the work can be cut short — and for GatewayAPI that loses the status permanently, because they offer no polling to fall back on.

**3. A throw is a non-2xx**, and earns the same storm. Nothing here throws: a `onReports` that fails is reported to `onError` *after* the 2xx has already gone.

### Securing the endpoint

| Provider | Signs its callbacks? |
|---|---|
| GatewayAPI | **yes** — HMAC-SHA-256. Set `secret` and a bad or missing signature is a `401`, with the body never parsed. |
| sms.dk | no |
| inMobile | no |

**Those last two have no defence but `sharedToken`.** Without it their callback URL is a public endpoint that writes to your database on request. Generate one (`openssl rand -hex 32`), put it in the URL you give them, and the handler checks `?token=` or `X-Sms-Token` on every call.

Leaving `secret` unset does not fail — it *warns*, every call. That is a decision, and a silent one would be indistinguishable from having forgotten.

### One caveat, stated rather than buried

`parseSmsDkDlr` has **not** been verified against a real sms.dk callback. Their callback parameters are undocumented — `docs.sms.dk` and their Postman workspace both render as JavaScript apps with no readable content — and confirming it needs a publicly reachable URL for them to call.

The field names it reads are not invented: they are the vocabulary sms.dk uses in **its own delivery-log API**, measured from a live response. That is a strong prior and it is not proof. If you wire this and the reports come back empty, log the raw query string first — and send it back to `components` so the next repo does not repeat the work.

## Three gateways, three hiding places for a failed send

**This is the single most useful thing in this package.** All three providers
were wired the same week, and not one of them reports a failure the same way:

| | How a message that will not arrive comes back | Does `res.ok` catch it? |
|---|---|---|
| **GatewayAPI** | a non-2xx status | **yes** |
| **sms.dk** | `207 Multi-Status`, number in a `rejected` array | **no** — 207 is "ok" |
| **inMobile** | `200 OK`, a real `messageId`, and `numberDetails.isValidMsisdn: false` | **no** — nothing at the top level dissents |

Write the obvious check — "did the HTTP call succeed?" — and you get a correct
adapter for one of these and a silently broken one for the other two. Both of the
silent cases still **bill you**.

So each adapter's success test is written against *its own* gateway's shape, and
each one has a test named after the trap it exists for. If you add a fourth
provider, assume it has invented a fourth hiding place and go looking for it
before you trust a 200.

### And the sender name is a fourth variant of the same thing

| | Text sender | Numeric | What happens if you exceed it |
|---|---|---|---|
| GatewayAPI | 11 | 15 | the network **replaces** it (their schema accepts 18) |
| sms.dk | 11 | 15 | `409` — but only if the name is also pre-approved |
| inMobile | 11 | **14** | **silently truncated** |

`checkSenderName()` holds the tightest line in front of all three, because two of
those three failures never produce an error.

## GatewayAPI

```ts
import { createSms, gatewayapi } from "@broberg/sms";

const sms = createSms({
  provider: gatewayapi({ apiKey: process.env.SMS_API_KEY }),   // region defaults to 'eu'
  from: "Moovyy",                                              // max 11 chars — see below
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

### The sender name limit is 11, not the 18 their schema accepts

| Source | Limit |
|---|---|
| Their OpenAPI schema (`sender`) | **18** characters — and the API really does accept it |
| Their own limitations page | **11** characters for a *text* sender, 15 digits for a numeric one |

A 12-character name passes validation, is billed, is delivered — and **arrives showing something else**, because a sender that does not fit "may be replaced automatically" by the network. Nothing reports it.

So this adapter holds the tighter line and refuses before anything is sent, with an error that says *why* the API would have accepted it. The gap between what an API accepts and what the network carries is exactly the kind of silence this package exists to remove.

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

## sms.dk

```ts
import { createSms, smsdk } from "@broberg/sms";
const sms = createSms({ provider: smsdk({ apiKey: process.env.SMSDK_API_KEY }), from: "SMSDKDemo", live: true });
```

`POST https://api.sms.dk/v1/sms/send`, Bearer auth. Optional `dlrUrl` (delivery reports) and `userReference`.

**Sender names must be pre-approved** in the sms.dk web interface — an unapproved one is a `409`, and the error says so rather than making you guess. `GET /v1/sendername/list` shows what the account already has.

Their credit endpoint is `/v1/user/**getcreditvalue**` under `/v1` — the path in their own published collection omits it and 404s, serving an HTML page rather than JSON. Hence the "wrong path" hint in the adapter's parse error.

## inMobile

```ts
import { createSms, inmobile } from "@broberg/sms";
const sms = createSms({ provider: inmobile({ apiKey: process.env.INMOBILE_API_KEY }), from: "Broberg", live: true });
```

`POST https://api.inmobile.com/v4/sms/outgoing`, **Basic auth with the key as the password** (the username is ignored — theirs, not ours). Optional `statusCallbackUrl`, `respectBlacklist`, `validityPeriodInSeconds`.

**A demo account appends text to your message — and does NOT bill you for it.** Measured 2026-08-23: inMobile added `\n\nSMS sent from a demo account at inMobile.com` (46 characters) to every message. The received text is therefore *not* what you sent, and a 126-character message arrived as 172. But their charge record says `smsCount: 1`, `isCharged: true` — they bill your text, not theirs. So `estimate()` stays right about money and wrong about what the recipient reads. If you assert on received text in a test, that trailer will break strict equality on a trial account.

**Delivery status is available today** via `GET /v4/sms/outgoing/reports?limit=1..250`, and it is the real thing — `deliveryInfo.stateDescription: "Delivered"` with a `doneTime`, plus `chargeInfo` and the carrier. **Read it exactly once**: their own words are *"Each report will only be returned once. Once called, the status has been removed from our side and cannot be retrieved again."* Persist what you read before you filter it, and never run two pollers — they will split the reports between them and each will think it saw everything.

**They tell you what they will charge**, and we check it. `smsCount` is their own segment count computed from the same GSM-7 rules `estimate()` implements, so a disagreement means one of the two is wrong about your invoice — and you get a warning instead of a surprise. Agreement is silent.

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

**`sendMany` is optional**, and leaving it out is not a gap — it is the honest statement that this gateway has no proven multi-recipient endpoint, and `createSms()` fans out instead:

```ts
const myGateway: SmsProvider = {
  name: "my-gateway",
  batchLimit: 500,                       // the gateway's OWN limit, measured
  async send({ to, text, from }) { … },
  async sendMany(messages) {
    // ONE outcome per input message, in input order. Throw only for a
    // whole-request failure; a per-message refusal belongs in its own outcome,
    // so one bad number cannot take the other 499 with it.
    return messages.map((m) => ({ ok: true, id: "…" }));
  },
};
```
