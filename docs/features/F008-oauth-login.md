# F008 — OAuth Login Providers (Google / Apple / GitHub + identity linking)

> L1 Identity · runtime-package · effort **M** · impact **high** · owner `xrt81`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A headless package implementing the server-side OAuth 2.0 authorization-code flow for Google (OIDC), Apple (form_post + ES256 client-secret JWT), and GitHub (code exchange + /user/emails fallback), plus a shared identity-linking contract mapping any (provider, stable-sub) pair to a local user. It handles CSRF state-cookie generation/verification, code exchange, profile normalisation to a common OAuthProfile, and idempotent link/find helpers. Framework route bindings (Hono / Next Route Handlers) are thin adapters that call the headless core and set the app's own session cookie.

## Solution
**runtime-package.** The four-step pattern (authorize URL + CSRF state cookie → redirect → exchange code → normalise profile → link identity) is repeated verbatim in xrt81 (oauth-google/apple), trail (OAuthProvider abstraction), sanneandersen (jose JWKS), cms (GitHub route). Every repo re-implements the Apple ES256 client-secret JWT from node:crypto + duplicates the state-cookie CSRF guard. The Apple form_post SameSite=None quirk + Apple sub-only-on-repeat edge case are subtle correctness details solved in xrt81 that WILL be re-broken elsewhere. Drift is already live (trail/server uses userinfo without JWKS verify; sanneandersen uses jose jwtVerify — two security postures for the same Google flow).

## Scope

### In scope
- Extract from `broberg/xrt81`: `apps/server/src/lib/{oauth-google,oauth-apple,auth}.ts` + `routes/auth.ts`.
- Headless core (providers, buildAuthorizeUrl, exchangeCode, state, Apple JWT, Google JWKS verify, config guards) + Hono/Next route adapters + a DB-agnostic ProviderIdentityStore contract.

### Out of scope
- DB schema / session creation (consumer owns these).
- LinkedIn/Azure/Facebook (deferred — unused in estate).

## Architecture

### Best source (reference implementation)
`broberg/xrt81` — `apps/server/src/lib/{oauth-google,oauth-apple,auth}.ts` + `routes/auth.ts`. Only repo with both Google AND Apple; most-correct Apple (ES256 client-secret via node:crypto, response_mode=form_post + SameSite=None state cookie, sub-only fallback via findMemberByAuthIdentity, magic-token handoff for Safari). authIdentities table contract generalises to any provider.

### Other implementations seen (contract cross-check)
- `broberg/trail` `apps/admin-server/src/oauth.ts` — best OAuthProvider registry (name/authorizeUrl/tokenUrl/profileUrl/scope/parseProfile); GitHub /user/emails fallback; link-vs-login detection + conflict guard + unlink.
- `webhouse/sanneandersen` `site/src/lib/auth/oauth-google.ts` — strictest Google verify: jose createRemoteJWKSet + jwtVerify with issuer/audience asserts (the verification path to adopt).
- `webhouse/cms` `packages/cms-admin/src/app/api/auth/github/{route,callback/route}.ts` — Next.js Route Handler shape; base64url state dual-flow (login vs connect); GitHub token storage.

### Headless core vs. adapters
- **Core (no React/next/Hono):** OAuthProvider interface + PROVIDERS registry (google/apple/github, typed parseProfile); buildAuthorizeUrl; exchangeCode → OAuthProfile {sub,email,name,avatarUrl}; generateState/verifyState (node:crypto); appleClientSecret (ES256 via node:crypto); verifyGoogleIdToken (jose JWKS); google/apple/githubConfigured guards. DB link helpers stay in consumer.
- **Stack A (Next.js):** Route Handler wrappers (app/api/auth/[provider]/route.ts + callback); NextRequest/NextResponse cookies; redirects to app session logic after exchangeCode. No Hono.
- **Stack B (Hono):** oauthRoutes group at /api/auth/:provider (+callback); hono/cookie; Apple callback is POST (form_post); appleConnectRoute for link-from-profile (OAUTH_LINK_COOKIE). No next/*.

### Public API
```ts
export type ProviderName = 'google' | 'apple' | 'github';
export interface OAuthProfile { sub: string; email: string|null; name: string|null; avatarUrl: string|null }
export function generateState(): string;
export function verifyState(received: string, stored: string): boolean;
export function buildAuthorizeUrl(p: ProviderName, state: string, redirectUri: string, cfg: ProviderClientConfig): string;
export function exchangeCode(p: ProviderName, code: string, redirectUri: string, cfg: ProviderClientConfig): Promise<OAuthProfile|null>;
export function googleConfigured(env): boolean; export function appleConfigured(env): boolean; export function githubConfigured(env): boolean;
// '@broberg/oauth-core/next' and '/hono' — route factories
```

## Stories
- **F008.1** — Headless core: Google+Apple+GitHub providers — _AC:_ exports buildAuthorizeUrl/exchangeCode/state for all three; Google via jose JWKS; Apple ES256 via node:crypto; GitHub /user/emails fallback; all pure (no DB/cookies/framework); tests cover CSRF round-trip, Apple JWT structure, Google JWKS mock, GitHub email fallback.
- **F008.2** — Hono adapter: authorize + callback + Apple connect — _AC:_ oauthRoutes at /api/auth/:provider; SameSite=Lax for Google/GitHub, None;Secure for Apple; Apple callback POST; appleConnectRoute sets OAUTH_LINK_COOKIE; CallbackHandler (session) injected by consumer; verified in xrt81 vs real Google+Apple.
- **F008.3** — Next.js adapter: route-handler factories — _AC:_ createAuthorizeRoute + createCallbackRoute return GET/POST handlers; state cookie via NextResponse; verified in cms replacing GitHub OAuth files; no hono import.
- **F008.4** — Identity-linking helpers (DB-agnostic) — _AC:_ ProviderIdentityStore interface (findByProviderSub, linkIdentity idempotent, unlink, list); Drizzle reference impl + stub; matches xrt81 authIdentities + trail oauthIdentities.
- **F008.5** — Pilot: xrt81 adopts @broberg/oauth-core — _AC:_ xrt81 oauth-google/apple.ts deleted; routes/auth.ts imports from /hono; magic-link + Google + Apple + connect flows pass smoke; no UI-observable change.
- **F008.6** — Config guard + 501 graceful degradation — _AC:_ absent provider env → authorize route returns 501 JSON (not 500); *Configured() guards exported for conditional login buttons (xrt81 pattern).

## Acceptance criteria
1. @broberg/oauth-login builds + typechecks clean; headless core imports no framework packages.
2. Each story (F008.1–F008.6) meets its own AC.
3. Piloted in xrt81 and adopted back with no regression (runtime-verified).
4. A second consumer (cms or trail) migrates onto the shared package with identical behaviour.

## Dependencies
- F009 — User mgmt (related: consumes identity linking).
- External: node:crypto, jose; consumer's session layer (package does NOT create sessions).

## Rollout
Strangler: 1) extract core from xrt81 oauth-google/apple + trail registry + sanneandersen JWKS; 2) Hono adapter, pilot xrt81 (verify Google+Apple+connect); 3) Next adapter, pilot cms; 4) publish; 5) adopt trail + sanneandersen, then remaining.

Graduate-candidate: no — stays in `components`.

## Open Questions
- verifyGoogleIdToken: injected JWKS fetcher (testable) or module-level createRemoteJWKSet singleton (simpler)?
- Package owns state-cookie name+TTL or consumer overrides (every repo uses a different name today)?
- LinkedIn/Azure/Facebook in v1 or deferred?
- Hono adapter takes APP_URL prefix or full redirectUri per provider?

## Effort estimate
**M** — owner session: `xrt81`. Reuse model: runtime-package.

## Risks
Apple quirks dominate: (a) email only on FIRST auth — store sub at first login or returning users can't match; (b) form_post cross-site POST needs SameSite=None;Secure, but older Safari/iOS WebView is inconsistent — ship the xrt81 magic-token same-site verify-GET handoff in the Hono adapter; (c) jose is a runtime dep — edge runtimes may need a polyfill or CachedRemoteJWKSet. Module-level JWKS singleton is simpler but harder to unit-test.
