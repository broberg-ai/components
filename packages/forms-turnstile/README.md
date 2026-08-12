# @broberg/forms-turnstile

Spam-protected **public form** primitives for the broberg.ai fleet: honeypot detection, an in-process IP rate limiter, and Cloudflare Turnstile server-side verification — plus a Preact widget hook and a Hono middleware. Extracted from `webhouse/cms`'s form pipeline (headless core) cross-checked against `xrt81`'s lead form (Preact/Hono e2e).

```bash
npm i @broberg/forms-turnstile      # exact-pin for prod-auth deps
```

## Core (`@broberg/forms-turnstile` / `@broberg/forms-turnstile/server`)

Framework-agnostic, `node:crypto` only.

```ts
import { applySpamGauntlet, hashIp, getSitekeyResponse } from "@broberg/forms-turnstile/server";

const ipHash = hashIp(clientIp); // GDPR-friendly — never store the raw IP

const result = await applySpamGauntlet({
  honeypot: { body },                                          // omit to skip this layer
  rateLimit: { ipHash, formName: "contact", maxPerHour: 5 },    // omit to skip this layer
  turnstile: { token: body.token, secret: env.TURNSTILE_SECRET_KEY, remoteip: clientIp },
});
if (result.blocked) {
  // result.reason: "honeypot" | "rate-limit" | "turnstile"
}
```

Each layer is **opt-in** — pass only the options key for the checks you want; they run fail-fast in the order honeypot → rate-limit → Turnstile.

The individual checks are exported too (`isHoneypotTriggered`, `isRateLimited`, `validateTurnstile`, `HONEYPOT_FIELD`) if you'd rather call them yourself.

**Rate limiter caveat:** in-process only (a `Map`, swept lazily) — protects a single-instance deployment (Fly single machine, one Bun worker) but each instance has its own counters, so it does **not** protect multi-instance/serverless. For a shared, pluggable-store limiter (Turso/Redis-backed), reach for `@broberg/apikey`'s `SlidingWindowRateLimiter` instead.

> **Measure your instance count, then write it next to the constant.** With N
> instances the effective ceiling is `maxPerHour × N`, not `maxPerHour` — so the
> number in your code is a lie for whoever reads it next unless the comment says
> so. `flyctl scale show -a <app>` answers it in one line. fd-sundhed measured 2
> machines against `maxPerHour: 5` and documented the real limit as 10 **at the
> constant**, not in a commit message, which is the right place for it.
>
> This is a brake on repetition, not a door. Honeypot and Turnstile carry the
> protection; if the rate limit is the layer you are relying on, you need a
> shared store.

### Local dev / CI — no real keys needed

```ts
import { TURNSTILE_TEST_SITE_KEY, TURNSTILE_TEST_SECRET_KEY } from "@broberg/forms-turnstile/server";
```

Cloudflare's official **always-pass** test keys — safe to commit, safe default so the flow works end-to-end without a real Turnstile widget.

> #### ⚠️ Do not E2E-assert the *unsolved* state against the test keys
>
> They solve **almost instantly**. So a check like *"the submit button is
> disabled before the user solves the challenge"* is racing the widget: the
> state you are trying to prove exists for under a second.
>
> fd-sundhed hit this on adoption — the same assertion passed on one page and
> failed on the other, **not because the app behaved differently, but because
> the assert raced**. They deleted the check rather than adding a wait, which is
> the right call: a test that passes or fails on timing proves nothing in either
> direction. It is not a flaky test, it is a test of a state the test keys do not
> hold still for.
>
> Assert the states that persist instead — `solved` after solving, `failed` with
> its `error` when you block the script. And note this trap is one *we* built,
> by shipping always-pass keys as the default: the convenience and the race are
> the same feature.

### Runtime site-key delivery

```ts
// GET /config route — serves the (public) site key at runtime so rotating it
// is a secret change, never a rebuild.
app.get("/config", (c) => c.json(getSitekeyResponse(env.TURNSTILE_SITE_KEY)));
```

## Widget hook — React (`/react`) or Preact (`/preact`)

Lazy-loads the Turnstile script (cached + deduped) and renders the widget once a
site key is available. **Both adapters are the same implementation** — they
differ only in which package the hooks come from, so a fix reaches both.

```tsx
import { useTurnstile } from "@broberg/forms-turnstile/react";   // or /preact

function ContactForm() {
  const { widgetRef, token, status, error, reset } = useTurnstile(siteKey);

  return (
    <form onSubmit={onSubmit}>
      {/* ...fields... */}
      <div ref={widgetRef} data-testid="contact-form-captcha" />
      <button type="submit" disabled={status !== "solved"}>Send</button>
      {status === "failed" && <p role="alert">Spam-tjekket kunne ikke indlæses. {error}</p>}
    </form>
  );
}
```

`siteKey` may be `null`/`undefined` while a runtime `/config` fetch is in
flight — that reads as `loading`.

### Gate the submit button on `status`, not on `token` (v0.2.0)

| `status` | meaning |
| --- | --- |
| `loading` | no site key yet, or the script is still loading |
| `ready` | the widget is up and waiting for the user |
| `solved` | `token` is valid — this is the only state you should submit in |
| `failed` | it will not work without intervention; `error` says why |

**Why this matters.** Before v0.2.0 the hook exposed only `token`, and an empty
token had two causes: *the user has not solved it yet*, and *this will never
work*. A form gating on `!token` therefore showed a submit button that never
enabled, with nothing anywhere saying why. Turnstile is blocked by ordinary
privacy extensions often enough that this is a normal user's experience, not an
edge case.

Three distinct paths used to end in that same silence — a script that failed to
load, a script that **loaded** while `window.turnstile` never appeared, and a
`widgetRef` that was never attached. All three now end in `failed` with a
distinct `error`. Raised by fd-sundhed, who found the first of the three by
reading the tarball.

`reset()` returns a solved widget to `ready`. It will **not** move a `failed`
widget out of `failed` — resetting a widget that never loaded cannot repair it,
and laundering that into a hopeful state would erase the only evidence of the
real problem.

### React notes

`react` is an optional peer (`>=18`). The bundle carries `"use client"`, so a
Next.js App Router project can import it from a client component without
marking anything extra — and only the React bundles carry it; `/server` and
`/hono` stay server-safe.

## Hono middleware (`@broberg/forms-turnstile/hono`)

Reads the JSON body itself (to inspect the honeypot field + Turnstile token), runs the gauntlet, and short-circuits with a `400` on block. On pass, the parsed body is stashed on the context as `spamCheckedBody` so your handler doesn't re-read the (already consumed) request stream.

```ts
import { honoTurnstileMiddleware } from "@broberg/forms-turnstile/hono";

app.post(
  "/api/contact",
  honoTurnstileMiddleware({ secret: env.TURNSTILE_SECRET_KEY, formName: "contact", maxPerHour: 5 }),
  (c) => {
    const body = c.get("spamCheckedBody");
    // ...persist + notify...
    return c.json({ ok: true });
  },
);
```
