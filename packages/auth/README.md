# @broberg/auth

A thin fleet wrapper around [Better Auth](https://better-auth.com) — **one `createAuth()`**
for email + password, magic-link (delivered through `@broberg/mail`), social login
(Google, Apple, GitHub, Microsoft, LinkedIn, Facebook) and passkey / WebAuthn.

It runs **inside your own app, against your own database** — no external service, no
recurring cost, no vendor lock-in, EU-data stays where you host it. The wrapper adds the
fleet's opinions on top of Better Auth: **dark-ship** provider guards, magic-link routed
through `@broberg/mail`, and per-stack mount helpers (Hono + Next).

> Mirrors `@broberg/ai-sdk` (a thin wrapper over the Vercel AI SDK). The heavy lifting —
> OAuth2/OIDC + PKCE, Apple's ES256/`form_post` quirks, the WebAuthn ceremony — is Better
> Auth's; this package is the fleet-shaped config surface over it.

## Install

```bash
pnpm add @broberg/auth better-auth drizzle-orm
# optional, per method you enable:
pnpm add @broberg/mail            # magic-link delivery
pnpm add @better-auth/passkey     # passkey / WebAuthn
```

`better-auth` is a **peer** so your server wrapper and `better-auth/client` on the frontend
share one pinned version. `@broberg/mail`, `@better-auth/passkey`, `hono` and `next` are
**optional** peers — install only what you use.

## Usage

```ts
import { createAuth } from "@broberg/auth";
import { drizzle } from "@broberg/auth";              // = Better Auth's drizzleAdapter
import { createMailer } from "@broberg/mail";

const auth = createAuth({
  database: drizzle(db, { provider: "sqlite" }),       // or "pg" / "mysql"
  baseURL: process.env.APP_URL,
  emailPassword: true,
  magicLink: { mailer: createMailer({ apiKey: process.env.RESEND_API_KEY, from: "..." }) },
  passkey: { rpID: "xrt81.com", rpName: "XRT81" },
  socials: {
    // Only the providers whose config is present REGISTER (dark-ship).
    google:    { clientId: env.GOOGLE_ID,    clientSecret: env.GOOGLE_SECRET },
    apple:     { clientId: env.APPLE_ID,     clientSecret: env.APPLE_SECRET },
    github:    { clientId: env.GITHUB_ID,    clientSecret: env.GITHUB_SECRET },
    microsoft: { clientId: env.MS_ID,        clientSecret: env.MS_SECRET },
    linkedin:  { clientId: env.LINKEDIN_ID,  clientSecret: env.LINKEDIN_SECRET },
    facebook:  { clientId: env.FB_ID,        clientSecret: env.FB_SECRET },
  },
});
```

### Mount it

```ts
// Stack B — Hono
import { mountAuth } from "@broberg/auth/hono";
mountAuth(app, auth);                                  // GET+POST /api/auth/*

// Stack A — Next.js App Router  (app/api/auth/[...all]/route.ts)
import { toNextHandler } from "@broberg/auth/next";
export const { GET, POST } = toNextHandler(auth);
```

### Dark-ship + login buttons

A provider with no secret is never registered and never crashes. Render buttons for exactly
the enabled methods:

```ts
import { configuredMethods } from "@broberg/auth";
const m = configuredMethods(cfg);   // { google, apple, ..., magicLink, passkey, emailPassword }
// show the Google button only when m.google === true
```

Individual guards are exported too: `googleConfigured`, `appleConfigured`,
`githubConfigured`, `microsoftConfigured`, `linkedinConfigured`, `facebookConfigured`,
`emailPasswordConfigured`, `magicLinkConfigured`, `passkeyConfigured`.

## MitID (and other custom IdPs) — deferred

MitID is **not** bundled. It is OIDC, but it requires a broker
(Criipto / Signaturgruppen / Nets DanID) + a NemLog-in agreement + a certificate — real
authority onboarding, not "add a provider". When that is in place, slot it in via Better
Auth's [Generic OAuth plugin](https://www.better-auth.com/docs/plugins/generic-oauth):

```ts
import { genericOAuth } from "better-auth/plugins/generic-oauth";
createAuth({
  // ...
  plugins: [
    genericOAuth({ config: [{ providerId: "mitid", /* broker discoveryUrl + client creds */ }] }),
  ],
});
```

## What this package does NOT own

- **DB schema / migrations** — Better Auth owns its `user`/`session`/`account` tables; you
  run its migrations against your DB.
- **Session creation** — Better Auth mints sessions; this wrapper only configures it.
- **Email templates** — magic-link delivery routes through `@broberg/mail` (which owns
  delivery only); branded bodies are yours via the `render` option.

## Versioning

Auth is prod-critical — **exact-pin** `@broberg/auth` (and `better-auth`) in production
consumers. Published from `broberg-ai/components` via OIDC Trusted Publishing.
