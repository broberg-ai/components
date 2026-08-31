# @broberg/mail

The fleet's thin **Resend** send primitive — one consistent, dependency-free way
to send transactional mail across every `@broberg/*` app.

- **No SDK, no deps.** Raw POST to Resend's stable REST API, so it runs in Node,
  Bun and edge runtimes alike — and there's no SDK version-floor to chase.
- **Never throws.** Every send returns a typed `{ ok, id?, error?, skipped? }`.
- **Ship-dark + allowlist.** No API key ⇒ a logged no-op (your dev/preview flows
  don't crash). A non-`live` mailer only delivers to allowlisted recipients —
  the fleet admins (`cb@webhouse.dk` …) are always reachable — so test mail never
  hits real users.
- **Delivery only.** HTML templates stay per-app (they diverge per brand). This
  package is the chokepoint every repo used to duplicate.

```bash
pnpm add @broberg/mail
```

## Usage

```ts
import { createMailerFromEnv } from "@broberg/mail";

// Reads RESEND_API_KEY, MAIL_FROM, MAIL_FROM_NAME,
//       MAIL_DISABLED, MAIL_LIVE, MAIL_ALLOWLIST (comma-separated).
const mailer = createMailerFromEnv();

const r = await mailer.send({
  to: "user@example.com",
  subject: "Booking confirmed",
  html: "<p>See you Tuesday.</p>",
  text: "See you Tuesday.",
});
// r: { ok: true, id: "…" } | { ok: false, error } | { ok: true, skipped: true }
```

Explicit config instead of env:

```ts
import { createMailer } from "@broberg/mail";

const mailer = createMailer({
  apiKey: process.env.RESEND_API_KEY,
  from: "noreply@webhouse.dk",
  fromName: "Sanne Andersen", // composes "Sanne Andersen <noreply@webhouse.dk>"
  live: process.env.NODE_ENV === "production",
  allowlist: ["team@webhouse.dk"], // who gets real mail when not live
});
```

`send()` passes through `text`, `replyTo`, `cc`, `bcc`, `headers`, `tags`, and
`attachments` (byte content is base64-encoded for you; `contentId` enables inline
`cid:` images).

## Env vars

| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend key. **Absent ⇒ ship-dark** (logged no-op). |
| `MAIL_FROM` | Default sender — `"Name <email>"` or a bare address. |
| `MAIL_FROM_NAME` | Display name when `MAIL_FROM` is bare. |
| `MAIL_DISABLED` | `1`/`true` ⇒ hard kill-switch (every send a no-op). |
| `MAIL_LIVE` | `1`/`true` ⇒ deliver to anyone. **Default (0.3.0+): NOT live** — you must opt in explicitly, else only the allowlist + fleet admins receive mail (fail-safe; pre-0.3.0 it defaulted to live whenever a key was set). |
| `MAIL_ALLOWLIST` | Comma-separated recipients allowed when **not** live. |
| `MAIL_ID` | Per-project **cardmem MailID** stamped on every send (see below). |

## Project correlation — the cardmem MailID

Pass a per-project `mailId` (on the mailer config, or per `send()`) and a
discreet `Ref: <mailId>` footer is appended to **every** outbound mail — html
*and* text. cardmem watches `cb@webhouse.dk` for that code and auto-routes the
mail (and its quoted replies) into the right project's Inbox, and filters its own
E2E test mail by it.

```ts
const mailer = createMailer({ apiKey, from: "noreply@webhouse.dk", mailId: "CM-3k9f…" });
// every send now carries: <div style="…color:#9ca3af">Ref: CM-3k9f…</div>  (+ "Ref: CM-3k9f…" in text)
```

- The token is **read verbatim** — cardmem generates + owns it (project config
  `settings_json.mail_id`, format `CM-`+20 Crockford base32). This package never
  generates or reformats it.
- The footer is **real, faint text** — never `display:none`/white-on-white,
  which gets stripped on reply and hurts spam scoring. That's what lets it
  survive in a quoted reply.
- **Idempotent**: a body already carrying the token is not double-stamped.
- Absent `mailId` ⇒ no footer (backward compatible).

## `mailer.mode` (v0.5.0) — assert at boot what the gate actually resolved to

```ts
const mailer = createMailer({ apiKey, live: isProd });

if (isDeployed && mailer.mode !== "live") {
  // throw ONLY if mail is the only way in — see below
  throw new Error(`mail gate is closed in production: ${mailer.mode}`);
}
```

**Throw or shout? It depends on whether mail is the ONLY way in.** Throwing is
right when a dead mailer means nobody can sign in at all — a magic-link-only app
is already down, and failing at boot makes that visible instead of mysterious.
Throwing is *wrong* when mail is one feature among many: a consumer with password
login beside magic link correctly refused this example, because crashing would
turn a **degraded** service into a **dead** one over a mail setting. They log a
loud line at startup instead. Pick the one that matches your blast radius; the
snippet above is an illustration, not a recommendation.

**Handle an unknown mode as unknown, never as live.** A lookup table beats a
chain of ifs here, and the fall-through must be the non-accepting answer — the
same rule as any other outcome union. Adding a fifth mode should never widen a
gate by landing in a permissive `default`.

`mode` is `"live" | "allowlist-only" | "disabled" | "no-key"`, resolved **once at
creation**.

**Why you need it even with a test.** A test proves your gate *logic*. Only a
startup check catches an **environment that lies** — a renamed base image, an
overridden variable, a typo in `NODE_ENV`. Filed by a repo doing exactly the
right thing: they set `live` explicitly, which is what v0.3.0 asks for, and
thereby opted out of the creation-time warning (it only fires when `live` is left
`undefined`). Their gate then hung on one env var with nothing checking it.

**Derive "am I deployed" from something you do not control.** The same consumer's
first attempt read *"are we in production?"* from `NODE_ENV` — **the very value
that opens the gate**. So the check read

```ts
NODE_ENV === "production" || isMailLive()   // can never be false
```

The complaint branch was not *hard* to reach, it was **unreachable**: the
condition and the gate consulted the same variable, so no environment could make
it fire. That is why you cannot find this by reading the code — it looks
perfectly sensible. They found it only when they sat down to write the test that
proves it complains, and could not construct a state where it did. **Trying to
write the failing test is the reliable way to detect this whole class.**

Prefer a platform-injected signal (`FLY_APP_NAME`, `K_SERVICE`, `DYNO`) that
survives exactly the drift you are hunting.

**Multi-tenant: read `mode` per send, not once at boot.** If each tenant resolves
its own API key at send time, key presence is *not* a boot property and your
startup check cannot know it — asserting it there would be false precision. Check
the platform signal against your own config at boot, and read `mailer.mode` per
mailer when you send. That second half catches **the one tenant whose key fell
out** — the only failure here that hits a single customer instead of all of them,
and the hardest to notice precisely because everyone else is fine.

**Why one field and not a boolean `live`.** Three separate conditions stop this
package from delivering — `live: false`, `disabled: true`, and a missing
`apiKey` — and all three return the same success-shaped `{ ok: true, skipped: true }`.
A `live`-only readback would let you write `if (isProd && !mailer.live) throw`
and have it **pass** over a mailer with no API key at all. One field carrying the
reason means there is exactly one thing to assert on and no way to assert the
wrong one.

This is not theoretical. The first consumer to adopt `mode` had already derived
its own status from `RESEND_API_KEY` + `MAIL_LIVE`, and cross-checking it against
the package found a mismatch in under an hour:

```
no key                  no-key           their derivation: dark              ✓
key, MAIL_LIVE unset    allowlist-only   their derivation: allowlist-only    ✓
key + MAIL_LIVE=1       live             their derivation: live              ✓
MAIL_DISABLED=1         disabled         their derivation: LIVE              ✗
```

They did not know `MAIL_DISABLED` existed. Their gate asked two questions; three
things stop a mail. Their own field would have reported **"live"** for a service
sending nothing at all — the exact false green they had built it to prevent.
**Read `mode`; do not re-derive it from env vars.** The package knows all three
conditions and your derivation only knows the ones you remembered.

Precedence follows what happens at send time, not what reads nicely: `no-key` and
`disabled` beat `live`, because `send()` returns early on both before the
allowlist gate is consulted.

## `verifySendingDomain()` (v0.6.0) — is the domain you send FROM able to deliver?

A **different question** from `mailer.mode`, and the difference is the whole reason this exists.

On 2026-08-22 Christian could not log in to moovyy.com. The magic-link mail never arrived. Every measurable link was green — token minted, `mode: 'live'`, `send()` → `{ok:true, id}`, Resend accepted it.

`mode` said `live` and **that was correct**. The mailer *was* live. It really did send. What was broken was the **sending domain**:

```
send.broberg.ai     DKIM ok   SPF MISSING   DKIM-only is not "configured"
send.webhouse.dk    SPF ok    MX ok         DKIM MISSING
```

Two fleet domains, both half-configured, in exactly opposite ways. Nobody knew. It was found by accident while looking at a login bug.

So `mode: 'live'` was **a green that was TRUE and still insufficient** — not a lie, an answer to a question nobody had thought to ask a second one alongside. The two answer different things:

| | question |
|---|---|
| `mailer.mode` | given how this mailer was **configured**, will it deliver? |
| `verifySendingDomain()` | is the domain it sends **from** able to deliver at all? |

```ts
import { verifySendingDomain } from "@broberg/mail/verify";

const r = await verifySendingDomain("send.broberg.ai", { region: "eu-west-1" });
if (!r.ok) console.warn("[mail]", r.summary, ...r.missing);
// send.broberg.ai: INCOMPLETE — deliverability is degraded (spam-folder risk), not necessarily blocked.
//   SPF — add TXT on send.broberg.ai: "v=spf1 include:amazonses.com ~all"
//   MX  — bounces cannot come back; add MX on send.broberg.ai: 10 feedback-smtp.eu-west-1.amazonses.com
```

**Three states, never two.** Each record is `ok` | `missing` | `unknown`. A DNS lookup that *failed* (timeout, SERVFAIL, no resolver) is **not** a record that is absent, and the two are decided on the error code — never on an empty result. Collapsing them turns a network hiccup into a confident false alarm about a domain that is fine, and a false alarm at boot is how a check gets switched off. Both absence codes are handled: `ENOTFOUND` (NXDOMAIN — the name does not exist) *and* `ENODATA` (NOERROR with no answer — the name exists, the record does not). The fleet's two domains produce one of each.

**It reports incompleteness, not failure.** `send.webhouse.dk` has no DKIM and still *passes* DMARC — relaxed alignment means SPF alone carries it. It is downweighted by Google, not rejected. A check that shouts "mail will not arrive" about that domain would be wrong, and over-harsh checks get disabled.

**Never throws, never blocks a send.** It is a report; you decide what to do with it. A repo that does not call it is unaffected; one that calls it on a broken resolver still boots.

**Node-only, on its own subpath.** The core entrypoint keeps zero dependencies and stays importable on edge/workers, where `node:dns` does not exist — same reason `./webhook` is separate.

**`dkimSelector` is provider-specific.** It defaults to `resend`. On another provider you would otherwise be told "DKIM missing" about a domain that is perfectly fine — another false alarm, another reason to switch the check off. Pass your own selector.

**`MAIL_FROM` is an ADDRESS, not a domain — pass it anyway (v0.7.0).** The check accepts a bare domain, `noreply@send.broberg.ai`, or `Moovyy <noreply@send.broberg.ai>`, and `senderDomain()` is exported if you want the parse on its own. It lives here because it is three lines every consumer writes identically, and the wrong version produces **no error** — only an alarm that looks right.

The normalisation is **never silent**: `report.domain` carries the domain actually looked up, not the string you passed. And unreadable input (`""`, a URL, a bare word) claims **nothing** — it reports `not a domain … NOTHING was checked` rather than inventing a plausible one. `senderDomain()` itself throws on those; `verifySendingDomain()` never throws, because a boot check that crashes the boot is worse than the problem it reports.

> Measured before fixing: `""` resolved as `ENODATA` and produced *"add TXT on ''"* instructions for a domain that does not exist — the real confident false alarm. `Moovyy <…>` resolved as `EBADNAME`, which the three-state design already handled as *unknown* rather than *missing*.

**The DNS error code is runtime-dependent — measured, not assumed.** Same machine, same inputs, node 25.7 vs bun 1.3.14:

| input | node | bun |
|---|---|---|
| `Moovyy <noreply@x.dev>` | `EBADNAME` → *unknown* | `ENOTFOUND` → *missing* |
| `""` | `ENODATA` | `ERR_INVALID_ARG_TYPE` |
| name exists, no record | `ENODATA` | `ENOTFOUND` |

Both absence codes are handled, so a genuinely missing record is classified correctly on either. But it is why `senderDomain()` **throws** rather than letting an unparsed string reach the lookup: on bun a malformed name reads as *absent*, which is a confident false alarm about a domain that is fine. Parsing first is the only deterministic path.

One caveat for anyone extending this: **bun cannot tell NXDOMAIN from NODATA** — both surface as `ENOTFOUND`. Harmless today (both mean absent), but do not build logic on that distinction; it will not survive a runtime change, and it will fail quietly.

**`region` is not guessed.** Without it the MX fix reads `feedback-smtp.<region>.amazonses.com` and says the region must be supplied. A confidently wrong region produces a record that looks right and routes bounces nowhere.

## `mailer.getStatus(id)` (v0.8.0) — did it actually arrive?

`send()` returning `{ ok: true, id }` means the provider **accepted** the mail.
It does not mean anyone received it. `getStatus` asks:

```ts
const sent = await mailer.send({ to, subject, html });
// ...later, from the id you stored
const s = await mailer.getStatus(sent.id);

switch (s.verdict) {
  case "delivered": break;                       // it reached them
  case "failed":    fixTheAddress(s.to); break;  // it did not, and will not
  case "pending":   break;                       // still moving; ask again later
  case "unknown":   console.warn(s.reason);      // WE COULD NOT LOOK — not a failure
}
```

### Four states, and the fourth is the one that matters

| verdict | means | provider events behind it |
|---|---|---|
| `delivered` | it reached the recipient | `delivered` `opened` `clicked` `complained` |
| `failed` | it did not, and will not | `bounced` `failed` `suppressed` |
| `pending` | still moving | `sent` `scheduled` `delivery_delayed` |
| `unknown` | **we could not look** | 401 · 404 · network · a shape we do not know · `received` |

Two rows are worth reading twice, because they are the ones a hand-rolled version
gets backwards:

- **`complained` counts as delivered.** The mail arrived; the recipient then
  pressed "spam". Filed under failure, you tell a customer their address is
  broken when it is fine.
- **`suppressed` counts as failed.** It was never attempted — the address is on
  a suppression list. Filed under pending, you wait for a delivery that cannot
  come.

**`unknown` is never `ok: false`, and never `failed`.** A send-only key answers
`401`, an id the provider does not have answers `404`, an unreachable network
answers nothing — and none of those is a delivery failure. Every `unknown`
carries a `reason` saying which one it was.

### The key right this needs

**`getStatus` requires a Resend key with read access.** A **send-only** key
answers `401`, which this reports as:

> `verdict: "unknown"` — *this API key is not authorised to read email status (a
> send-only key answers 401) — this is NOT a delivery failure*

Said out loud here because the failure mode is silent: without the distinction, a
key-permission problem reads as "not delivered" and the next thing that happens
is an email to a customer about an address that was never wrong.

### The body is not returned unless you ask

The provider returns the **entire message** (`html`, `text`) on this endpoint,
and a status object is the first thing anyone logs. So it is dropped:

```ts
await mailer.getStatus(id);                        // no html/text keys at all
await mailer.getStatus(id, { includeBody: true }); // opt in explicitly
```

### Lookup or webhook? Both, and they answer different questions

|  | `getStatus(id)` | the webhook (below) |
|---|---|---|
| answers | what is the state of **this id**, now | what just happened, to anything |
| catches a bounce an hour later | only if you ask again | yes, when it happens |
| needs | a read-capable key | a public endpoint + the signing secret |

`getStatus` reports the provider's **latest** event, so it is a snapshot, not a
history — it cannot tell you a mail was delivered and complained about
afterwards; it shows the newest. Use the webhook as the record and `getStatus`
to answer a question about one message.

## API

- `createMailer(config?) → Mailer` — carries `.mode` and `.getStatus(id, opts?)` (above)
- `createMailerFromEnv(overrides?) → Mailer`
- `mailAllowed(to, { live?, allowlist? }) → boolean` — the pure recipient gate.
- `buildFrom(name, address) → "name <address>"`
- `ALWAYS_ALLOWED` — fleet admins always reachable through the gate.
- `verdictForEvent(event) → MailVerdict` · `MAIL_EVENT_TYPES` — the shared
  event vocabulary, so the webhook parser and `getStatus` cannot disagree.

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F005**). MIT.

## Delivery webhook (v0.4.0) — the send response cannot tell you it arrived

> **v0.8.0 — four events used to be dropped on the floor, and `onEvent` now
> fires for them.** `parseMailEvent` refuses to guess at a type it does not know,
> which is right — but its list was written before Resend had
> `email.failed`, `email.received`, `email.scheduled` and `email.suppressed`,
> and it returned `null` for all four. **Two of them (`failed`, `suppressed`)
> mean the mail did not arrive**, so a consumer wired only to `onEvent` was
> losing exactly the events worth waking up for; a non-delivery nobody was told
> about looks identical to a webhook that never came. If your handler switches
> on `event.type`, add cases for the four — otherwise they fall through whatever
> your `default` does. A type Resend invents *tomorrow* still parses to `null`
> and still reaches `onIgnored` as `unknown_type`.

`send()` succeeding means the provider **accepted** the mail. Whether it landed
only ever appears on the webhook stream:

```ts
import { handleMailWebhook } from "@broberg/mail/webhook";

app.post("/api/mail/webhook", async (c) => {
  const raw = await c.req.text();          // RAW body — see the warning below
  const { status, body } = await handleMailWebhook(raw, c.req.raw.headers, {
    secret: process.env.RESEND_WEBHOOK_SECRET,
    onEvent: (e) => db.insert(deliveries).values({
      providerId: e.providerId, to: e.to[0], type: e.type, bounceType: e.bounceType, at: e.at,
    }),
  });
  return c.json(body, status);
});
```

`e.providerId` is the same id a successful `send()` returned, so a delivery joins
straight to the send that produced it.

**Why this exists.** A bounced onboarding mail looks exactly like a delivered one
the recipient ignored. One means *fix the address and resend*, the other means
*leave them alone* — and without the stream you either nag people who got it or
abandon people who didn't. `bounceType` is carried through for the same reason: a
hard bounce and a soft one call for opposite actions.

> **⚠️ Pass the RAW body.** A body that was JSON-parsed and re-stringified will
> not verify — key order and whitespace both change the signature — and the
> failure looks exactly like a wrong secret.

**Verification is not optional and cannot be skipped by accident.** With no
secret, every request is rejected (`no_secret`); the endpoint never runs
unverified. An open webhook is a write-surface where anyone can assert that
anything was delivered, which is *worse than having no delivery data*, because it
looks like evidence. Failures return a **reason** rather than a bare false —
`missing_headers`, `timestamp_out_of_tolerance`, `no_signature_match` — and reach
`onIgnored` so a misconfigured endpoint is visible instead of quietly silent.

Also handled: replay (timestamps outside ±5 min are rejected, in **both**
directions), secret rotation (several signatures in the header, any one may
match), and an unknown event type, which returns `null` from `parseMailEvent`
rather than being reshaped into a type we do model.

`verifyWebhook` and `parseMailEvent` are exported separately if you want to wire
your own handler. Zero dependencies — `node:crypto` only.
