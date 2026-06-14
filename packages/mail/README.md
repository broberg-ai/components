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
| `MAIL_LIVE` | `1`/`true` ⇒ deliver to anyone. Default: live when a key is set. |
| `MAIL_ALLOWLIST` | Comma-separated recipients allowed when **not** live. |

## API

- `createMailer(config?) → Mailer`
- `createMailerFromEnv(overrides?) → Mailer`
- `mailAllowed(to, { live?, allowlist? }) → boolean` — the pure recipient gate.
- `buildFrom(name, address) → "name <address>"`
- `ALWAYS_ALLOWED` — fleet admins always reachable through the gate.

Owned + published by [`broberg-ai/components`](https://github.com/broberg-ai/components)
(epic **F005**). MIT.
