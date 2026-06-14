# F005 — Mail sending (Resend)

> L0 Rails · runtime-package · effort **S** · impact **high** · owner `components` (publishes the npm; reference impl lifted from `sanneandersen`).
> **Status:** in progress — `@broberg/mail` **v0.1.0** built + bootstrap-published this turn (2026-06-14). Done is gated on a pilot consumer migrating back with no regression + a second adopter (see Acceptance criteria), and on Christian adding the npm **Trusted Publisher** for `@broberg/mail` so 0.1.1+ publish token-free.
> Graduate-candidate: no — small core npm that stays in `components`.

> **Build decisions (v0.1.0, deviating from the original sketch below — recorded per the surgical-change rule):**
> - **One package, not three.** The `mail-next` / `mail-hono` adapter split was collapsed into a single `@broberg/mail` with `createMailerFromEnv()` built in — it only reads `process.env`, which works in Node, Bun *and* edge, so a per-stack package added ceremony without value. A Hono context-attach is a 3-line app-side `app.use`, not worth a subpath.
> - **Raw fetch to Resend's REST API, no SDK.** Zero runtime deps (matches the `@broberg/secret-scan` ethos), runs on edge, and resolves the open questions below (no SDK version-floor; the whole thing IS the fetch escape hatch). `broberg/xrt81` proves raw-fetch-to-REST in prod.
> - **Allowlist gate + `ALWAYS_ALLOWED`** (`cb@webhouse.dk`, `christian@broberg.ai/.dk`) is the mail mirror of lens's never-cb guard: test/preview sends only reach allowlisted recipients, but a developer can always receive their own.

## Motivation
A thin, framework-agnostic package that wraps the Resend SDK into a single, consistent send primitive: lazy-initialised client (avoid crash-on-import when RESEND_API_KEY is absent), a dev/disabled kill-switch (MAIL_DISABLED or no-key-console-log), a typed { ok, error? } return, and an allowlist guard. It does NOT own transactional template logic (each app supplies its own typed send-function wrappers) — it provides the stable chokepoint (mailAllowed guard, from resolver, attachment passthrough) every repo currently duplicates.

This pattern is currently re-implemented per repo. The cleanest existing example is **`webhouse/sanneandersen`** — lazy Resend init (getResend()), MAIL_DISABLED kill-switch, SA_FORCE_REAL_EMAIL override, automatic CID logo attachment, a consistent { ok, error? } return across 15+ typed send-functions, replyTo/attachments passthrough. Centralising it removes per-repo drift and makes a fix propagate.

## Solution
**runtime-package.** The same four-line pattern (lazy Resend init → mailAllowed guard → resend.emails.send → return {ok,error}) exists verbatim in six repos: sanneandersen, cms-admin, upmetrics, trail, contract-manager, xrt81. The chokepoint is identical; only the from-address config mechanism differs. Resend SDK surface is stable (~18 months). The template/HTML layer above the core is NOT shared (per-brand) and stays copy-owned (F023).

(Headless-core/adapter split is detailed under Architecture.)

## Scope

### In scope
- Extract core from `webhouse/sanneandersen` `site/src/lib/auth/email.ts` (lazy getResend, sendEmail chokepoint, MAIL_DISABLED guard).
- createMailer + mailAllowed + buildFrom + MailerConfig/MailResult types + Stack A/B convenience adapters.

### Out of scope
- HTML shells / templates (F023, copy-owned per brand).
- Site-specific logo CID injection (stays in each app's send wrappers).

## Architecture

### Best source (reference implementation)
`webhouse/sanneandersen` — `site/src/lib/auth/email.ts`: lazy Resend init, MAIL_DISABLED, SA_FORCE_REAL_EMAIL override, CID logo attachment, { ok, error? } across 15+ send-functions, replyTo/attachments passthrough.

### Other implementations seen (contract cross-check)
- `broberg/xrt81` `apps/server/src/lib/mail.ts` — best allowlist guard (mailAllowed + MAIL_LIVE/MAIL_ALLOWLIST); raw-fetch-to-Resend-REST escape hatch.
- `webhouse/cms` `packages/cms-admin/src/lib/email.ts` — cleanest minimal; DB-driven from-name/address (multi-tenant injection).
- `webhouse/contract-manager` `lib/email/send.ts` — console-log fallback, to:string|string[], per-send providerName.
- `broberg/upmetrics` `apps/server/src/auth/email.ts` — lazy ??= init, throws on missing key, callbackURL injection.

### Headless core vs. adapters
- **Core (no React, no `next/*`, no Hono):** createMailer(config):Mailer (lazy Resend, from + allowlist state); Mailer.send(params):MailResult (chokepoint: mailAllowed → resolve from → resend.emails.send → {ok,id?,error?}); mailAllowed(to,{live,allowlist}):boolean (pure); buildFrom(name,address); MailerConfig/MailResult types. Dev kill-switch (disabled||no-key → log + {ok:true}) lives here. No HTML shell.
- **Stack A (@broberg/mail-next):** createMailerFromEnv() reads RESEND_API_KEY/MAIL_FROM/MAIL_FROM_NAME/MAIL_DISABLED/MAIL_LIVE/MAIL_ALLOWLIST from process.env; server-only (no next/navigation); optional logoAttachment() helper.
- **Stack B (@broberg/mail-hono):** createMailerFromEnv() (Bun.env) + registerMailer(app,config) attaching the mailer to Hono context.

### Public API
```ts
import { createMailer, mailAllowed, buildFrom } from '@broberg/mail';
const mailer = createMailer({ apiKey, from, fromName?, live?, allowlist?, disabled? });
const r: MailResult = await mailer.send({ to, subject, html, text?, replyTo?, attachments? });
// r: { ok:true, id } | { ok:false, error }
// '@broberg/mail-next' → createMailerFromEnv ; '@broberg/mail-hono' → createMailerFromEnv, registerMailer
```

## Stories
- **F005.1** — Core mailer package (createMailer/send/mailAllowed) — _AC:_ disabled=true returns {ok:true} without calling Resend; to-not-in-allowlist when live=false returns {ok:false}; valid key calls resend.emails.send once; no next/* or Hono imports.
- **F005.2** — Stack A adapter (createMailerFromEnv for Next.js) — _AC:_ reads the six env keys; sanneandersen can swap its sendEmail wrapper and all send-functions still type-check.
- **F005.3** — Stack B adapter (createMailerFromEnv + Hono middleware) — _AC:_ upmetrics + trail magic-link sends replaced by one-liners; both build and flows work end-to-end.
- **F005.4** — Pilot migration in sanneandersen — _AC:_ internal sendEmail replaced by @broberg/mail-next; 15+ send-functions compile; MAIL_DISABLED works; logo CID still injected (app wrapper); no regression in booking/magic-link/welcome (Lens smoke).
- **F005.5** — Allowlist parity across adopters — _AC:_ xrt81 removes its local mailAllowed; package mailAllowed produces identical outcomes (ported tests); MAIL_LIVE=true bypasses, absent = allowlist-only.

## Acceptance criteria
1. `@broberg/mail` builds + typechecks clean (`tsc --noEmit`); the headless core imports no framework packages.
2. Every story above (F005.1–F005.5) meets its own AC.
3. Piloted in **sanneandersen** and adopted back with no behavioural regression (Lens / runtime-verified, not just curl).
4. A second consumer (upmetrics or xrt81) migrates off its local mailer with identical behaviour.

## Dependencies
- External: resend (^4, peer).
- Related: F023 Mail templates consume this sender.

## Rollout
Strangler: 1) extract core from sanneandersen email.ts; 2) publish + update sanneandersen to import createMailer (full E2E); 3) Stack A adapter, adopt in cms-admin; 4) Stack B adapter, adopt in upmetrics + trail; 5) spread to xrt81/contract-manager/whop. Never big-bang.

Graduate-candidate: no — small core npm that stays in `components`.

## Open Questions (resolved in v0.1.0)
- ~~Support per-send apiKey override (xrt81 multi-tenant) or enforce single-config-at-creation?~~ → Single config at creation for v0.1.0. Multi-tenant per-send key is a named follow-up if a second tenant-keyed consumer appears (YAGNI now).
- ~~Include emailShell()/emailButton() HTML helpers or keep purely about delivery?~~ → **Delivery only.** Templates stay per-app/per-brand (F023) to avoid CSS-token lock-in. Confirmed.
- ~~Resend SDK major floor for the peer dep?~~ → **No SDK dependency.** Raw fetch to the stable REST endpoint; no peer dep, no floor.
- ~~beforeSend hook for sanneandersen's auto logo-CID?~~ → Not in v0.1.0. The `attachments` passthrough (with `contentId` → `content_id`) carries inline CID; the app's send-wrapper injects its own logo attachment. A `beforeSend` hook can be added later if ≥2 apps want the same pre-send mutation.

## Follow-ups (post-0.1.0)
- Pilot migration (F005.4) + second adopter (F005.5) — fdaa (fysio-dk-aalborg) is the first waiting consumer (#5107); sanne/xrt81/cms keep their template wrappers and swap only the delivery chokepoint.
- Optional `sendMany(messages, { intervalMs })` throttled helper — sanne (6s/100) + xrt81 (250ms) both hand-roll batch pacing; fold it in only when a consumer needs it from the package.

## Effort estimate
**S** — owner session: `sanneandersen`. Reuse model: runtime-package.

## Risks
From-address config heterogeneity (env vs per-call vs DB) — accept config at mailer-creation only; per-call apiKey override is a named escape hatch. CID logo is site-specific — must NOT be baked into core (forgetting strips logos on migration). Edge runtimes that can't use the SDK need a rawSend() fetch escape hatch. trail throws on error; package standardises on {ok,error} — callers catching throws need wrapping on migration.
