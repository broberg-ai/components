# F008 — @broberg/auth — Unified fleet authentication (Better Auth wrapper)

> L1 Identity · runtime-package (thin wrapper) · effort **M** · impact **high** · owner `components`. Status: In progress.
> **Supersedes** the original "hand-rolled OAuth providers" plan (replanned 2026-06-30 on Christian's build-vs-buy decision). Graduate-candidate: no — stays in `components`.

## Motivation
Every app in the estate re-implements authentication: xrt81 hand-rolls Google + Apple + magic-link, trail hand-rolls GitHub/Google + identity-linking, sanneandersen hand-rolls Google JWKS + magic-link, cms hand-rolls GitHub. That is four separate security postures for the same flows (trail uses `userinfo` without JWKS verify; sanne uses strict `jose` JWKS) — drift that is already live. The product target (cardmem questionnaire **D.3.1 Login-metoder**) is ALL of: email+password, magic-link, Google, Apple, **Microsoft**, **LinkedIn**, Facebook, **passkey/biometri** — and MitID later. Hand-rolling six OAuth providers + WebAuthn + password + magic-link and maintaining their security quirks (Apple `form_post`/ES256, the WebAuthn ceremony, PKCE) forever is the wrong investment.

## Solution — thin wrapper over Better Auth
`@broberg/auth` is a thin config-wrapper around **Better Auth** (TS-native, open-source, framework-agnostic; npm `better-auth@1.6+`), exactly mirroring how `@broberg/ai-sdk` wraps the Vercel AI SDK. Better Auth bundles every method the fleet needs as core + plugins, runs **inside each app against its own Drizzle DB** (no external service, no recurring cost, no vendor lock-in, EU-data stays on Fly `arn` → GDPR-safe), and follows global standards (OAuth2/OIDC + PKCE, WebAuthn/FIDO2). The wrapper adds the fleet's opinions on top: dark-ship provider guards, env→config single-source mapping, magic-link routed through `@broberg/mail`, and per-stack mount helpers (Hono + Next).

### Capability verification (2026-06-30, against better-auth@1.6.23 docs)
| D.3.1 method | Better Auth | Source |
|---|---|---|
| Google · Apple · GitHub · Microsoft Entra · LinkedIn · Facebook | built-in social providers | docs/concepts/oauth |
| Email + password | core | — |
| Magic link | plugin; `sendMagicLink({email,url,token})` callback → route via `@broberg/mail` | docs/plugins/magic-link |
| Passkey / biometri | plugin (WebAuthn, SimpleWebAuthn) | docs/plugins/passkey |
| MitID (deferred) | Generic OAuth plugin + broker | docs/plugins/generic-oauth |
Runs in both stacks: Hono (`app.on(["POST","GET"], "/api/auth/*", c => auth.handler(c.req.raw))`) and Next.js; Drizzle adapter for sqlite/libsql/postgres.

### Why wrap — not hand-roll, not SaaS (decision record)
- **Hand-roll** (original plan) → re-implement + own security-critical code forever. Rejected.
- **SaaS** (Clerk/Auth0/WorkOS) → recurring cost at scale + US data residency (Schrems II for personal data) + lock-in. Rejected — conflicts with house principles (Max not API, `arn`/EU, no lock-in).
- **Wrap Better Auth** → standards-compliant, all methods, both stacks, own DB, no cost/lock-in. **Chosen (Christian, 2026-06-30).**

### Why ONE package, not three
Christian's first instinct was to split (oauth / passkey / local) into three packages. Better Auth **is** the bundling — one lib, one session/DB core, methods as opt-in plugins. Splitting into three npm packages would fight the library. So "split" is realized as **opt-in config within `@broberg/auth`**: a consumer enables only the methods it wants. `@broberg/oauth` (the old F008 package name) is renamed/absorbed into `@broberg/auth`.

## Scope

### In scope (v1)
- `@broberg/auth` core: `createAuth(config)` factory wrapping Better Auth with the Drizzle adapter, email+password, the six social providers, magic-link (→ `@broberg/mail`), passkey/WebAuthn.
- **Dark-ship guards:** each provider/method registers ONLY when its config/secret is present — no crash on missing env.
- Stack mount helpers: `@broberg/auth/hono` + `@broberg/auth/next`.
- Pilot: xrt81 strangler-migrates onto it; runtime/Lens-verified.

### Out of scope (deferred)
- **MitID** — needs a broker (Criipto / Signaturgruppen / Nets) + a NemLog-in agreement + certificate. Its OWN epic; `@broberg/auth` exposes the Generic-OAuth hook so it slots in later.
- 2FA/TOTP, organisation/multi-tenant plugins — available in Better Auth, enabled per-consumer later.
- Migrating trail / sanneandersen / cms — follow-on stories after xrt81 proves the wrapper.

## Architecture
Better Auth core mints sessions in the consumer's DB via `@better-auth/drizzle-adapter`. The wrapper:
- `createAuth(cfg)` → a configured Better Auth instance. `cfg` carries the DB handle, base URL, and a `socials` block; only configured providers register (dark-ship).
- magic-link plugin's `sendMagicLink({ email, url })` → routed to `@broberg/mail`'s send primitive (reuse-first — **no raw mail**).
- passkey plugin enabled with the app's `rpID`/`rpName` from `cfg`.
- `@broberg/auth/hono`: `mountAuth(app, auth)` → `app.on(["POST","GET"], "/api/auth/*", c => auth.handler(c.req.raw))`.
- `@broberg/auth/next`: `toNextHandler(auth)` → `{ GET, POST }` route handlers.

### Public API (sketch)
```ts
import { createAuth } from "@broberg/auth";
const auth = createAuth({
  database: { db, provider: "sqlite" },   // wrapped drizzleAdapter
  baseURL: env.APP_URL,
  emailPassword: true,
  magicLink: true,                        // sender wired to @broberg/mail internally
  passkey: { rpID, rpName },
  socials: {                              // only the configured ones register (dark-ship)
    google:    { clientId, clientSecret },
    apple:     { clientId, teamId, keyId, privateKey },
    github:    { clientId, clientSecret },
    microsoft: { clientId, clientSecret, tenantId },
    linkedin:  { clientId, clientSecret },
    facebook:  { clientId, clientSecret },
  },
});
// Hono:  import { mountAuth } from "@broberg/auth/hono"; mountAuth(app, auth)
// Next:  export const { GET, POST } = toNextHandler(auth)
```

## Stories
- **F008.1** — Core `createAuth()` wrapper — _AC:_ wraps Better Auth with Drizzle adapter + email/password + the six social providers; dark-ship (only configured providers register); typed config; tsc clean; unit tests assert provider-registration gating.
- **F008.2** — Magic-link via `@broberg/mail` — _AC:_ magic-link plugin enabled; `sendMagicLink` routes through `@broberg/mail` (no raw mail); disabled cleanly when mail/secret absent; test asserts the mail primitive is called with the link.
- **F008.3** — Passkey/WebAuthn — _AC:_ passkey plugin enabled + configured from `cfg.passkey` (rpID/rpName); registration + authentication endpoints exposed; dark-ship when unset.
- **F008.4** — Stack mount helpers — _AC:_ `@broberg/auth/hono` (`mountAuth`) + `@broberg/auth/next` (`toNextHandler`) subpath exports; no Hono import in the Next entry and vice-versa; both typecheck clean.
- **F008.5** — Pilot: xrt81 adopts `@broberg/auth` — _AC:_ xrt81 hand-rolled `oauth-google.ts`/`oauth-apple.ts` + magic-link replaced by the wrapper; Google + Apple + magic-link + passkey flows pass a live Lens smoke; no UI-observable regression.
- **F008.6** — Dark-ship guards + Discovery enroll + publish + README — _AC:_ `*Configured()` guards exported; npm publish (`@broberg/auth@0.1.0`) + Trusted Publisher job; Discovery enroll (`src`); README documents the MitID-via-generic-OAuth path.

## Acceptance criteria (epic)
1. `@broberg/auth` builds + typechecks clean; the core returns a Better Auth instance with the six socials + email/password + magic-link + passkey wired.
2. Dark-ship: missing provider config never crashes; only configured methods are active.
3. Magic-link sends through `@broberg/mail` (no raw mail integration anywhere).
4. Piloted in xrt81 (Hono) with no UI-observable regression, runtime/Lens-verified.
5. Published to npm + enrolled on Discovery; README documents the MitID-via-generic-OAuth path.

## Dependencies
- `@broberg/mail` (magic-link sender). `@broberg/config` (env parsing) optional.
- External: `better-auth`, `@better-auth/drizzle-adapter`, `better-auth/plugins` (magicLink, passkey). `drizzle-orm` in the consumer.
- F009 — User Management + Invitation (related: consumes the user/identity tables Better Auth owns).

## Rollout (strangler)
1) Build `@broberg/auth` core + plugins. 2) Stack helpers. 3) Pilot xrt81 — replace hand-rolled `oauth-google`/`oauth-apple` + magic-link, verify all flows live. 4) Publish + enroll. 5) Adopt trail/sanne/cms in follow-on stories. 6) MitID as its own epic via the generic-OAuth hook.

## Risks
- **Better Auth is a dependency** — mitigated: open-source, can patch/pin; exact-pin in prod consumers.
- **Schema migration per consumer** (Better Auth expects its own user/session/account tables) — strangler per repo, map existing rows; this is real work and the main risk in F008.5.
- **Apple/passkey config correctness** — Better Auth handles the quirks; we verify live in the pilot, not by tsc alone.

## Open Questions (resolved 2026-06-30)
- Build vs buy → **wrap Better Auth** (Christian).
- One package vs three → **one** (`@broberg/auth`), methods as opt-in config.
- Providers in v1 → **Google / Apple / GitHub / Microsoft / LinkedIn / Facebook**.
- MitID → **deferred** to its own epic (broker + NemLog-in agreement required).

## Effort estimate
**M** — owner session: `components`. Reuse model: runtime-package (thin wrapper). Mirrors `@broberg/ai-sdk`.
