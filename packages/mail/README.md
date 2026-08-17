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

if (isProd && mailer.mode !== "live") {
  throw new Error(`mail gate is closed in production: ${mailer.mode}`);
}
```

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

Precedence follows what happens at send time, not what reads nicely: `no-key` and
`disabled` beat `live`, because `send()` returns early on both before the
allowlist gate is consulted.

## API

- `createMailer(config?) → Mailer` — the returned mailer carries `.mode` (above)
- `createMailerFromEnv(overrides?) → Mailer`
- `mailAllowed(to, { live?, allowlist? }) → boolean` — the pure recipient gate.
- `buildFrom(name, address) → "name <address>"`
- `ALWAYS_ALLOWED` — fleet admins always reachable through the gate.

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F005**). MIT.

## Delivery webhook (v0.4.0) — the send response cannot tell you it arrived

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
