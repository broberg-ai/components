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
pnpm add @broberg/auth better-auth
```

**That is the whole cost of the core.** `better-auth` is the only required peer —
it is a peer so your server wrapper and `better-auth/client` on the frontend share
one pinned version.

Everything else is per-entry, and you pay for it only when you import that entry:

| import | also install |
| --- | --- |
| `@broberg/auth` | — |
| `@broberg/auth/hono` | `hono` |
| `@broberg/auth/next` | `next` |
| `@broberg/auth/passkey` | `@better-auth/passkey` |
| `@broberg/auth/drizzle` | `drizzle-orm` |

Magic-link needs `@broberg/mail` at runtime, but only as a **type** at build — it
never enters the import graph.

That table is not documentation, it is **data**: it lives in `package.json`
(`entryPeers`), and CI packs the tarball into an empty project and imports every
entry with exactly those peers. If an entry ever costs more than its row says,
the build fails.

> **0.1.x could not be installed as advertised.** This README already said
> *"install only what you use"*, `peerDependenciesMeta` already said `optional:
> true` — and the core entry statically imported `@better-auth/passkey` and (via
> the Drizzle adapter) `drizzle-orm`, so the module would not load without both.
> The claim was written in two places and true in neither, and nothing checked
> that the manifest and the code agreed. See **Versioning** for the 0.2.0 move.

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

### Typed plugin api (magic-link / passkey) — `createTypedAuth`

`createAuth` dark-ships magic-link/passkey *conditionally* at runtime, so its
return type can't statically know which plugins are present — plugin-augmented
`api.*` methods (`auth.api.signInMagicLink`, the passkey endpoints) drop off the
type. When you enable those and want them **fully typed with no cast**, use
`createTypedAuth` and pass the plugins explicitly:

```ts
import { createTypedAuth, buildMagicLinkPlugin, buildPasskeyPlugin } from "@broberg/auth";

const auth = createTypedAuth(
  { database: drizzle(db, { provider: "sqlite" }), socials: { google }, emailPassword: true },
  [buildMagicLinkPlugin({ mailer }), buildPasskeyPlugin({ rpID: "xrt81.com", rpName: "XRT81" })],
);

await auth.api.signInMagicLink({ body: { email } });   // fully typed, no cast
```

Social providers + email/password still dark-ship; the plugins you pass are
explicit (you opted in). `createAuth` is unchanged — use it when you don't need
the plugin endpoints statically typed.

The `createTypedAuth` result mounts through `mountAuth` / `toNextHandler` with
**no cast** — the mount helpers accept the structural slice they use, so the
plugin-narrowed instance is accepted just like a `createAuth` one (F008.8).

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

### 0.2.0 — two moves, both one line

The optional peers left the core import graph, so the package installs as
advertised. Two imports moved:

```diff
- import { drizzle } from "@broberg/auth";
+ import { drizzle } from "@broberg/auth/drizzle";
```

```diff
- createAuth({ database, passkey: { rpID, rpName } })
+ import { buildPasskeyPlugin } from "@broberg/auth/passkey";
+ createAuth({ database, plugins: [buildPasskeyPlugin({ rpID, rpName })] })
```

`config.passkey` was **removed** rather than left as a no-op. Silently not
registering a sign-in method you asked for is worse than a compile error telling
you where it went — the whole point of the package is that a method is absent only
when you did not configure it.

`passkeyConfigured()` and `configuredMethods()` are unchanged: they answer
*"should I render this button"*, which you know regardless of where the plugin was
built.
