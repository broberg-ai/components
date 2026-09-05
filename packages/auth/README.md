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
| `@broberg/auth` | `better-auth` |
| `@broberg/auth/hono` | `better-auth`, `hono` |
| `@broberg/auth/next` | `better-auth`, `next` |
| `@broberg/auth/passkey` | `better-auth`, `@better-auth/passkey` |
| `@broberg/auth/passkey-ceremony` | `@simplewebauthn/server` — **and no better-auth at all** |
| `@broberg/auth/drizzle` | `better-auth`, `drizzle-orm` |
| `@broberg/auth/two-factor` | `better-auth`, `uqr` |

> **`better-auth` moved from a required peer to a per-entry one in 0.6.0.** Seven
> of the eight entries need it; `passkey-ceremony` does not, and a manifest that
> demanded it globally was making a false claim about that entry. Measured, with
> a control: with `better-auth` absent from `node_modules`, `passkey-ceremony`
> imports and runs, and the core entry correctly fails with
> `Cannot find package 'better-auth'`. Nothing changes for existing consumers —
> you already install it.

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


## Passkeys when you already own your sessions

`@broberg/auth/passkey` mounts Better Auth's passkey plugin, and that plugin
**welds the ceremony to Better Auth's own session.** Measured in
`@better-auth/passkey@1.6.23`: `verify-authentication` unconditionally calls
`createSession()` → `findUserById()` → `setSessionCookie()`. No flag, no branch.
Its `afterVerification` hook fires *before* that block, so a consumer who mints
their own session there ends up with **two**. A hook that runs at the right
moment is not an opt-out, though from the signature it reads like one.

If your app already has a session table, a cookie and a login you are happy
with, use **`@broberg/auth/passkey-ceremony`** instead. It answers one question
and stops:

> which user just proved possession of this credential, and did their device
> verify who was holding it?

```ts
import { createPasskeyCeremony } from "@broberg/auth/passkey-ceremony";

const pk = createPasskeyCeremony({
  rpID: "app.example.com",
  rpName: "Example",
  origin: "https://app.example.com",
  requireUserVerification: true,     // see the warning below
  store,                             // your database, six methods
});

// enrol (the user is already signed in — you decided that, not us)
const { options, challengeId } = await pk.registration.begin({ userId, userName });
const { credentialId } = await pk.registration.finish({ challengeId, response });

// sign in
const begun = await pk.authentication.begin();          // no userId ⇒ usernameless
const { userId } = await pk.authentication.finish({ challengeId: begun.challengeId, response });
// …now mint YOUR session, exactly as you do today.
```

`authentication.finish` returns `{ userId, credentialId }` and nothing else. No
session, no cookie, no user object, no `Set-Cookie` anywhere in the module.

### The store is six methods, and there is deliberately no user method

```ts
interface PasskeyStore {
  putChallenge(record): void;
  takeChallenge(id): ChallengeRecord | null;   // MUST delete — that is what makes a challenge single-use
  getCredential(credentialId): StoredCredential | null;
  listCredentialsByUser(userId): StoredCredential[];
  saveCredential(credential): void;
  updateCredentialCounter(credentialId, counter): void;
}
```

Three absences are decisions, not omissions — each one measured against a real
consumer's schema:

- **No user method.** A passkey registration often *cannot* lawfully create a
  user: if your `users` table has a `NOT NULL` organisation FK, *which*
  organisation is a business decision an auth ceremony has no way to derive. An
  interface with a method a consumer must refuse to implement is broken, not
  flexible.
- **`userId` is opaque.** No UUID check, no prefix assumption. One consumer has
  two live formats, one of them a synthetic principal — a format check would
  have rejected that one and nothing else, i.e. broken only on the user nobody
  tests with.
- **No tenant scoping.** A credential is keyed by `credentialId` and carries a
  `userId`. Scope it to a tenant and the same person on the same phone gets a
  key that works in one workspace and not the other.

### ⚠️ `requireUserVerification` is device-owner verification, not Face ID

With no Face ID or Touch ID configured but a passcode set, iOS falls back to the
passcode and still reports the user as verified. **Never promise a user a face
and then accept a four-digit code.**

It defaults to `false`, because turning it on refuses sign-ins that work today.
On iOS the UV flag is always set anyway — so with the flag off, the guarantee
holds because of the *platform*, not because anything enforces it. Turn it on
for an unlock-the-app flow, where the guarantee **is** the feature.

When on, it fails **closed** on a missing `userVerified`, in *both* ceremonies.
That asymmetry is not hypothetical: 0.5.0 enforced it on authentication only, so
a credential could be enrolled unverified and then fail every subsequent login.

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

## Face ID in a PWA — passkeys, and the guarantee that was missing (0.5.0)

**Yes, an installed PWA on an iPhone can sign in with Face ID.** It is a passkey
(WebAuthn) ceremony: the site registers a platform credential, iOS stores it in
the iCloud keychain, and every later sign-in shows Apple's own prompt. There is
no biometric API on the web — Face ID cannot be *called*; it only ever appears as
the system's confirmation of a passkey.

```ts
import { createTypedAuth } from "@broberg/auth";
import { buildPasskeyPlugin } from "@broberg/auth/passkey";

const auth = createTypedAuth(
  { database: drizzle(db, { provider: "sqlite" }), secret: process.env.BETTER_AUTH_SECRET },
  [buildPasskeyPlugin({
      rpID: "cardmem.com",              // the registrable DOMAIN — no scheme, no port
      rpName: "cardmem",
      requireUserVerification: true,    // ← the guarantee; see below
   })],
);
```

### What `requireUserVerification` buys you

Without it, a passkey proves **possession of a device**. With it, the assertion
also carries proof that the device **checked who was holding it**.

Measured in `@better-auth/passkey@1.6.23`, which is why this option exists:

```
dist/index.mjs:273   userVerification: "preferred"    authentication — hardcoded
dist/index.mjs:444   requireUserVerification: false   verification   — hardcoded

PasskeyAuthenticationOptions = { extensions, afterVerification }
                                 ↑ no userVerification field at all
```

So the server accepts an assertion with the user-verification flag **clear**, and
the authentication ceremony cannot be configured to ask for more. This option
enforces it through the `afterVerification` hook instead — no fork.

**It is off by default**, because turning it on would start refusing sign-ins
that work today.

**Both ceremonies are guarded, and the registration half is not symmetry.**
Asking for `userVerification: "required"` in the options is only a *request* —
Better Auth verifies the registration with `requireUserVerification: false`
(`dist/index.mjs:339`), so a credential can still be enrolled without it. That
credential then fails the sign-in guard at **every** later attempt: the enrolment
appears to succeed and the login never works, with the failure surfacing later,
elsewhere, to someone who did not enrol it. So 0.5.1 refuses the enrolment
instead, where the person can still do something about it.

### The part worth reading even though it changes nothing on iPhone

**On iOS the UV flag is always set.** iOS verifies locally *before* it will
produce an assertion at all, and `"preferred"` and `"required"` behave
identically there. So an iPhone shows Face ID whether or not the server asked.

Which means the guarantee currently holds **because of the platform, not because
anything enforces it**. That is fine until a security key, an Android device or a
future browser behaves differently — and for an *unlock-the-app* flow, the
guarantee is the entire feature.

### ⚠️ This is device-owner verification, NOT Face ID

With no Face ID or Touch ID configured but a **passcode** set, iOS falls back to
the passcode and still reports the user as verified. So the honest label for the
button is "unlock with your device", not "unlock with Face ID". **Never promise a
user a face and then accept a four-digit code.**

### Two more things a PWA needs to get right

- **`rpID` is the registrable domain** (`cardmem.com`), never a URL and never a
  path. A credential is bound to it, so moving the app to another subdomain
  without planning for it strands every passkey already enrolled.
- **HTTPS only.** `http://localhost` is the single exception, for development.

### "Lock the app on open"

There is no separate API for it: you call `signIn.passkey()` again when the app
becomes visible. The user sees the same prompt, the app unlocks. Two consequences
worth knowing before you design around it — the prompt is Apple's own bottom
sheet and cannot be styled, and the user must have enrolled a passkey once
before, so the flow needs an "enable this" step after an ordinary first login.

**And standalone home-screen web apps DO work in the EU.** Apple announced
removing them under the DMA and then reversed it before iOS 17.4 shipped — but
articles asserting the removal are still the top search result, so it is written
down here rather than looked up again.

## The signing secret is asserted, not assumed (0.4.0)

`createAuth` and `createTypedAuth` **refuse to build** when no signing secret
resolves, or when the one that resolves is Better Auth's own default.

Why: Better Auth resolves the key as

```
options.secret || BETTER_AUTH_SECRET || AUTH_SECRET || "better-auth-secret-12345678901234567890"
```

and that last term is a literal in its own source — it ships in every copy on
npm, so it is public, and a session cookie signed with it can be forged by
anyone. Better Auth refuses it **only** when `NODE_ENV` is exactly `"production"`
and `TEST` is unset. Measured on 1.6.23, spawned per state so the env precedes
module load:

```
NODE_ENV unset                boots  -> the public default
NODE_ENV=development          boots  -> the public default
NODE_ENV=production           throws
NODE_ENV=production + TEST=1  boots  -> the public default
NODE_ENV=test                 boots  -> the public default
```

So the protection rested on two environment variables the platform owns, and a
stray `TEST=1` removed it. Now the package asserts it, at call time, in every
env state — and also inside a `secrets` array, which bypasses Better Auth's
check entirely.

**0.4.1 — skip 0.4.0.** The guard reads Better Auth's resolution chain, and
0.4.0 read four of its six sources. Two valid configurations were REFUSED as a
result, and one route into the hole stayed open. All three measured against the
published 0.4.0:

```
BETTER_AUTH_SECRETS="1:<key>" in env      valid (Better Auth resolves it)  0.4.0 THREW
extend: { secret: <key> }                 valid (extend is spread last)    0.4.0 THREW
extend: { secret: <the default> }         must be refused                  0.4.0 PASSED
```

The middle one is the trap worth naming: `buildAuthOptions` spreads
`...config.extend` **last**, so `extend` WINS over `config.secret`. A guard that
reads only the config field therefore blocks a working setup *and* lets the
public constant through the one field that overrides it. If you are on 0.4.0 and
your app boots, you are not affected — the failure is loud, not silent — but
upgrade before anyone sets either of those.

**What this breaks:** nothing in production. Anything with a real secret is
unaffected, and anything without one was already broken. It breaks **tests that
boot auth with no secret at all** — pass one:

```ts
const auth = createAuth({ database: db(), secret: TEST_SECRET });
```

A test booting on the public default is testing a configuration nobody should
run, so the fix is a test secret, not an exemption.

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
