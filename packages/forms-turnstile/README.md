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

### Local dev / CI — no real keys needed

```ts
import { TURNSTILE_TEST_SITE_KEY, TURNSTILE_TEST_SECRET_KEY } from "@broberg/forms-turnstile/server";
```

Cloudflare's official **always-pass** test keys — safe to commit, safe default so the flow works end-to-end without a real Turnstile widget.

### Runtime site-key delivery

```ts
// GET /config route — serves the (public) site key at runtime so rotating it
// is a secret change, never a rebuild.
app.get("/config", (c) => c.json(getSitekeyResponse(env.TURNSTILE_SITE_KEY)));
```

## Preact adapter (`@broberg/forms-turnstile/preact`)

Lazy-loads the Turnstile script (cached + deduped) and renders the widget once a site key is available.

```tsx
import { useTurnstile } from "@broberg/forms-turnstile/preact";

function ContactForm() {
  const { widgetRef, token, reset } = useTurnstile(siteKey); // siteKey: string | null while /config loads

  return (
    <form onSubmit={onSubmit}>
      {/* ...fields... */}
      <div ref={widgetRef} data-testid="contact-form-captcha" />
      <button type="submit" disabled={!token}>Send</button>
    </form>
  );
}
```

Call `reset()` after a failed submit to let the user solve the challenge again.

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
