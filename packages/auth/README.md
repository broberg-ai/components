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

## Two-factor authentication (`@broberg/auth/two-factor`)

```ts
import { createTypedAuth, secretsFrom } from "@broberg/auth";
import { buildTwoFactorPlugin, totpQr } from "@broberg/auth/two-factor";

const auth = createTypedAuth(
  {
    database: drizzle(db, { provider: "sqlite" }),
    secrets: secretsFrom({ 1: process.env.AUTH_KEY_V1! }),
    secret: process.env.BETTER_AUTH_SECRET,   // legacy fallback — see below
  },
  [buildTwoFactorPlugin({ issuer: "WebHouse" })],
);

const { totpURI, backupCodes } = await auth.api.enableTwoFactor({ body: { password } });
const svg = totpQr(totpURI);        // scan this with any authenticator app
// totpQr(totpURI, "dataUri")        // base64 data-URI for an <img src="…">
```

**Both output formats run in a browser and on a server**, asserted by a test that
deletes `globalThis.Buffer` — because the first version of the data-URI branch
used `Buffer.from()` and threw in a browser while this README already claimed
otherwise. The test it had only checked that `document` and `window` were
absent, which is Node, which is the one runtime where `Buffer` exists. Fixed in **0.3.2**. **`0.3.0` has a `dataUri` that throws in a browser** —
verified against the published tarball with 0.3.2 as the comparison, both with
`Buffer`, `btoa` and `TextEncoder` deleted:

```
0.3.2   OK
0.3.0   THROWS  Buffer is not defined
```

**There is no `0.3.1` on npm.** Its commit carried the test and the version bump
but not the source fix, so its own gate failed it — correctly, on the very test
that was right while the code was not. If you pinned 0.3.1 on the strength of an
earlier message from us, that install cannot resolve; take 0.3.2.

**Any authenticator app works, and there is nothing to integrate.** Microsoft
Authenticator, Google Authenticator, 1Password, Authy — all of them implement
TOTP (RFC 6238). Nothing here talks to Microsoft or Google: a secret is
generated, shown as a QR code, and codes are verified locally. An app nobody has
heard of works exactly as well as the famous two.

Proven, not assumed: the test suite computes a code the way a phone does —
its own RFC 6238 implementation, checked against the **RFC's published test
vector** — and requires Better Auth to accept it. A code produced by the library
under test would only prove the library agrees with itself.

### ⚠️ Read this before you enable 2FA in production

**The TOTP secret and the recovery codes are both encrypted with your app key.**
On a lone `secret` string, that ciphertext carries no version marker, so a key
rotation makes every 2FA account unopenable — recovery codes included, because
they use the same key. Measured against better-auth 1.6.23:

```
secret only   after rotation   TOTP secret: "invalid tag" · codes: "invalid tag"
secrets[]     after rotation   readable, byte-exact
```

For sessions a rotation is a forced re-login. For 2FA it is a lockout with no
self-service way back.

**Use `secretsFrom()`, and keep `secret` set as the legacy fallback.** With it,
ciphertext written in the string era still decrypts; without it the same read
fails with `Cannot decrypt legacy bare-hex payload`. **So the deadline is not
"before your first 2FA user" — it is "while you still have the old secret".**

`secretsFrom()` also closes a footgun nothing else checks: Better Auth reads the
current key **positionally** (`secrets[0]`), and its own validation checks
integers, duplicates, length and entropy but **not order**. A hand-written
ascending array therefore encrypts new data under the *old* key, silently.
`secretsFrom()` derives the order from the version numbers.

### What Better Auth already handles, so you do not

Enrolment requires a valid code before 2FA switches on (asserted here by reading
the stored row, not the response). The secret and the recovery codes are
encrypted at rest. Repeated failures lock the account rather than allowing an
online brute-force. Ten single-use recovery codes are returned once at
enrolment — **show them then, and say they are the only way back.**

### `totpURI` is a credential

It contains the shared secret in plain text. Anyone who reads it has the second
factor. Never log it, never put it in an error message, never send it to
analytics. **And never email the QR code** — both output formats render
unreliably in mail clients, and the stronger reason is that mailing a QR mails
the secret into a stored, forwardable message. 2FA enrolment belongs in an
authenticated session.

### Types

Use `createTypedAuth`, not `createAuth`: the plugin's `api` methods
(`enableTwoFactor`, `verifyTOTP`, `verifyBackupCode`) are invisible to
`createAuth`'s annotated return type — the dark-ship/inference tension from
F008.7. Runtime is identical; only the static type differs.

**Install cost:** `@broberg/auth/two-factor` needs `uqr` (zero dependencies) for
the QR. The core entry does not — asserted by `verify-clean-install.mjs`, which
installs the packed tarball in an empty directory and imports every entry with
exactly the peers that entry declares.
