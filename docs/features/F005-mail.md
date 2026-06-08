# F005 — Mail sending (Resend)

> L0 Rails · runtime-package · effort **S** · impact **high** · owner `sanneandersen`. Status: Backlog.
> LEAP-candidate: no — stays in `components`.

## Motivation
A thin, framework-agnostic package that wraps the Resend SDK into a single, consistent send primitive: lazy-initialised client (avoid crash-on-import when RESEND_API_KEY is absent), a dev/disabled kill-switch (MAIL_DISABLED or no-key-console-log), a typed { ok, error? } return, and an allowlist guard. It does NOT own transactional template logic (each app supplies its own typed send-function wrappers) — it provides the stable chokepoint (mailAllowed guard, from resolver, attachment passthrough) every repo currently duplicates.

## Solution
**runtime-package.** The same four-line pattern (lazy Resend init → mailAllowed guard → resend.emails.send → return {ok,error}) exists verbatim in six repos: sanneandersen, cms-admin, upmetrics, trail, contract-manager, xrt81. The chokepoint is identical; only the from-address config mechanism differs. Resend SDK surface is stable (~18 months). The template/HTML layer above the core is NOT shared (per-brand) and stays copy-owned (F023).

## Scope

### In scope
- Extract core from `webhouse/sanneandersen` `site/src/lib/auth/email.ts` (lazy getResend, sendEmail chokepoint, MAIL_DISABLED guard).
- createMailer + mailAllowed + buildFrom + MailerConfig/MailResult types.
- Stack A (process.env) + Stack B (Bun.env + Hono middleware) convenience adapters.

### Out of scope
- HTML shells / templates (F023, copy-owned per brand).
- Site-specific logo CID injection (stays in each app's send wrappers).

## Architecture

### Best source (reference implementation)
`webhouse/sanneandersen` — `site/src/lib/auth/email.ts`: lazy Resend init, MAIL_DISABLED kill-switch, SA_FORCE_REAL_EMAIL override, CID logo attachment, consistent { ok, error? } across 15+ typed send-functions, replyTo/attachments passthrough.

### Other implementations seen
- `broberg/xrt81` `apps/server/src/lib/mail.ts` — best allowlist guard (mailAllowed + MAIL_LIVE/MAIL_ALLOWLIST); raw-fetch-to-Resend-REST escape hatch.
- `webhouse/cms` `packages/cms-admin/src/lib/email.ts` — cleanest minimal; DB-driven from-name/address (multi-tenant injection).
- `webhouse/contract-manager` `lib/email/send.ts` — console-log fallback, to:string|string[], per-send providerName.
- `broberg/upmetrics` `apps/server/src/auth/email.ts` — lazy ??= init, throws on missing key, callbackURL injection.

### Headless core vs. adapters
- **Core (no React/next/Hono):** createMailer(config):Mailer; Mailer.send(params):MailResult (chokepoint: mailAllowed → resolve from → resend.emails.send → {ok,id?,error?}); mailAllowed(to,{live,allowlist}):boolean (pure); buildFrom(name,address). Dev kill-switch (disabled||no-key → log + {ok:true}) lives here.
- **Stack A (@broberg/mail-next):** createMailerFromEnv() reads RESEND_API_KEY/MAIL_FROM/MAIL_FROM_NAME/MAIL_DISABLED/MAIL_LIVE/MAIL_ALLOWLIST; server-only (no next/navigation); optional logoAttachment() helper.
- **Stack B (@broberg/mail-hono):** createMailerFromEnv() (Bun.env) + registerMailer(app,config) attaching the mailer to Hono context.

### Public API
```ts
import { createMailer, mailAllowed, buildFrom } from '@broberg/mail';
const mailer = createMailer({ apiKey, from, fromName?, live?, allowlist?, disabled? });
const r: MailResult = await mailer.send({ to, subject, html, text?, replyTo?, attachments? });
// r: { ok:true, id } | { ok:false, error }
```

## Stories
- **F005.1** — Core mailer package (createMailer/send/mailAllowed) — _AC:_ disabled=true returns {ok:true} without calling Resend; to-not-in-allowlist when live=false returns {ok:false}; valid key calls resend.emails.send once; no next/* or Hono imports.
- **F005.2** — Stack A adapter (createMailerFromEnv) — _AC:_ reads the six env keys; sanneandersen can swap its sendEmail wrapper for the adapter and all send-functions still type-check.
- **F005.3** — Stack B adapter (createMailerFromEnv + Hono middleware) — _AC:_ upmetrics + trail magic-link sends replaced by one-liners; both build and flows work end-to-end.
- **F005.4** — Pilot migration in sanneandersen — _AC:_ internal sendEmail replaced by @broberg/mail-next; 15+ send-fns compile; MAIL_DISABLED works; logo CID still injected (in the app wrapper); no regression in booking/magic-link/welcome (Lens smoke).
- **F005.5** — Allowlist parity across adopters — _AC:_ xrt81 removes its local mailAllowed; package mailAllowed produces identical outcomes (ported tests); MAIL_LIVE=true bypasses, absent = allowlist-only.

## Acceptance criteria
1. @broberg/mail builds + typechecks clean; core imports no framework packages.
2. Each story (F005.1–F005.5) meets its own AC.
3. Piloted in sanneandersen and adopted back with no regression (Lens / runtime-verified).
4. A second consumer (upmetrics or xrt81) migrates off its local mailer with identical behaviour.

## Dependencies
- External: resend (^4, peer).
- Related: F023 Mail templates consume this sender.

## Rollout
Strangler: 1) extract core from sanneandersen email.ts; 2) publish + update sanneandersen to import createMailer (full E2E); 3) Stack A adapter, adopt in cms-admin; 4) Stack B adapter, adopt in upmetrics + trail; 5) spread to xrt81/contract-manager/whop. Never big-bang.

LEAP-candidate: no — stays in `components`.

## Open Questions
- Support per-send apiKey override (xrt81 multi-tenant) or enforce single-config-at-creation?
- Include emailShell()/emailButton() HTML helpers or keep purely about delivery (CSS-token lock-in risk)?
- Resend SDK major floor for the peer dep?
- Expose a beforeSend hook to replicate sanneandersen's auto logo-CID without baking site logic into core?

## Effort estimate
**S** — owner session: `sanneandersen`. Reuse model: runtime-package.

## Risks
From-address config heterogeneity (env vs per-call vs DB) — accept config at mailer-creation only; per-call apiKey override is a named escape hatch. CID logo is site-specific — must NOT be baked into core (forgetting strips logos on migration). Edge runtimes that can't use the SDK need a rawSend() fetch escape hatch. trail throws on error; package standardises on {ok,error} — callers catching throws need wrapping on migration.