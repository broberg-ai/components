# F024 — Forms + Turnstile — spam-protected form pipeline

> L3 Domain · hybrid · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A reusable pipeline for public form submission with layered spam protection. The headless core covers three defence layers in fail-fast order: honeypot field detection, IP-based rate limiting (in-memory, TTL-swept, GDPR-friendly via SHA-256 IP hashing), and Cloudflare Turnstile server-side token verification via siteverify. The UI side provides a lazy-loading Turnstile widget helper (explicit render mode) + the client fetch pattern passing token + honeypot. The CMS variant adds submission persistence (per-form JSON), status lifecycle, CSV export, notifications — cms-specific, not shared.

## Solution
**hybrid.** The server-side verification (validateTurnstile, isHoneypotTriggered, isRateLimited, hashIp) is genuinely identical across all three repos + stable (a thin HTTP call + pure functions) → runtime package. The client widget loader is near-identical but coupled to each framework's reactivity (React useEffect/useRef vs Preact) → copy-owned per stack adapter. The cms FormService persistence (JSON files, status, CSV, notifications) is cms-specific → stays copy-owned, NOT in the package.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-admin/src/lib/forms/{spam,types,service,notify}.ts`.
- Headless server core + React + Preact useTurnstile hooks + Hono middleware + GET /config sitekey helper.

### Out of scope
- cms FormService persistence (JSON/status/CSV/notify) — cms-owned.
- Per-brand form styling.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-admin/src/lib/forms/spam.ts` + `types.ts`: validateTurnstile/isHoneypotTriggered/isRateLimited/hashIp all pure (no framework) + _resetRateLimiter test helper; FormSubmission type; already a standalone lib module (easy extraction).

### Other implementations seen
- `broberg/xrt81` `apps/web/src/routes/KomIGang.tsx` + `apps/server/src/routes/leads.ts` + `packages/shared/src/env.ts` — full e2e: env always-pass test-key defaults, Preact loadTurnstile lazy-loader, Hono route verifyTurnstile + honeypot + CF-Connecting-IP, GET /config sitekey (no rebuild on key rotation).
- `webhouse/sanneandersen` `site/src/app/api/contact/route.ts` + `components/forms/contact-form.tsx` — Next/React; widget cleanup (turnstile.remove on modal close, turnstile.reset on error) — improvements to fold into the Stack A adapter; credits xrt81 as the recipe source.

### Headless core vs. adapters
- **Core (@broberg/forms-turnstile/server, no React/next):** validateTurnstile(token,secret,remoteip?) (async siteverify → boolean); isHoneypotTriggered(body); HONEYPOT_FIELD; isRateLimited(ipHash,formName,maxPerHour) (in-memory Map + TTL sweep); hashIp(ip) (SHA-256, 8 hex); applySpamGauntlet(body,opts) (chains all three fail-fast → {blocked, reason?}); _resetRateLimiter(). node:crypto only.
- **Stack A (Next/React):** useTurnstile(siteKey) (lazy-load CF script via GET /config, render into ref, token state, reset()/remove() on unmount) + ContactForm shell; route handler calls applySpamGauntlet.
- **Stack B (Bun/Hono/Preact):** useTurnstile ported to preact/hooks; honoTurnstileMiddleware(opts) (reads CF-Connecting-IP, applySpamGauntlet, 400 on block); GET /config sitekey helper (xrt81 one-liner).

### Public API
```ts
// @broberg/forms-turnstile/server
export { validateTurnstile, isHoneypotTriggered, isRateLimited, hashIp, applySpamGauntlet, HONEYPOT_FIELD, _resetRateLimiter };
export type SpamCheckResult = { blocked: boolean; reason?: 'honeypot'|'rate-limit'|'turnstile' };
// '@broberg/forms-turnstile/react' → useTurnstile, ContactForm ; '/preact' → useTurnstile ; '/hono' → honoTurnstileMiddleware
```

## Stories
- **F024.1** — Extract headless core to /server — _AC:_ exports validateTurnstile/isHoneypotTriggered/isRateLimited/hashIp/applySpamGauntlet/HONEYPOT_FIELD/_resetRateLimiter; tests cover honeypot detection, rate-limit counter + TTL expiry, Turnstile happy path (mock fetch), applySpamGauntlet short-circuit order.
- **F024.2** — Cloudflare always-pass test-key defaults in env schema — _AC:_ exported envDefaults provides TURNSTILE_SITE_KEY '1x00000000000000000000AA' + TURNSTILE_SECRET_KEY '1x0000000000000000000000000000000AA'; a consuming Zod schema spreads them so the form works out of the box (xrt81 pattern).
- **F024.3** — Preact adapter useTurnstile + Hono middleware — _AC:_ useTurnstile(siteKey) → {widgetRef, token, reset}; honoTurnstileMiddleware; pilot xrt81 lead route replaces inline logic; existing lead e2e/Lens smoke passes.
- **F024.4** — React adapter useTurnstile with widget lifecycle cleanup — _AC:_ useTurnstile(siteKey) with remove() on unmount + reset() on submission error (sanneandersen improvements); adopted in sanneandersen contact-form; Lens smoke on contact-form-modal passes.
- **F024.5** — Adopt in cms: replace inline spam.ts — _AC:_ cms spam.ts deleted; all callers import from /server; CI passes; no behaviour change.
- **F024.6** — GET /config runtime sitekey helper — _AC:_ getSitekeyResponse(siteKey) → {turnstileSiteKey} single-source; both Next + Hono routes use it (response shape stays in sync).

## Acceptance criteria
1. @broberg/forms-turnstile builds + typechecks clean; headless core imports no framework packages.
2. Each story (F024.1–F024.6) meets its own AC.
3. Piloted in cms and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (xrt81 or sanneandersen) migrates onto the shared package with identical behaviour.

## Dependencies
- F001 tokens (blocks). F016 ui-controls (related). External: node:crypto, @broberg/config (env defaults), preact/react/hono (peer per adapter).

## Rollout
Strangler: 1) extract spam.ts + types.ts from cms → /server + applySpamGauntlet; 2) pilot xrt81 (replace inline verify + honeypot + port loadTurnstile to Preact adapter); 3) adopt cms (swap spam.ts import); 4) adopt sanneandersen (React adapter, fold in widget.remove/reset); 5) apply to new public forms.

Graduate-candidate: no — stays in `components`.

## Open Questions
- applySpamGauntlet include rate-limit by default or opt-in? (cms uses all three; xrt81/sanneandersen only honeypot+Turnstile) — opt-in is safer initially.
- Multi-instance: expose a RateLimitStore interface (libSQL/Redis) or in-memory good enough at current scale?
- GET /config route-factory helper or too trivial?
- Mirror sanneandersen remove()/reset() in the Preact adapter or leave cleanup to the caller?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
In-process rate limiter: works single-process (Fly single instance, Bun single worker) but no protection on multi-instance/serverless (each instance has its own Map) — caller swaps in an external store; document, don't silently break. siteverify is an external HTTP call on every POST — a CF outage causes 502s unless the catch falls back gracefully (block-vs-pass should be a configurable policy). In-memory sweep runs only on incoming requests — the Map can grow on a quiet server; a periodic timer sweep is safer for long-running processes.