# F040 — `@broberg/mail-templates`: storage-agnostic mail-template engine

> **Status:** Backlog · **Owner:** components (published pkg) · **Src / first-consumer:** cardmem (xrt81 pattern)
> **Origin:** reuse-first call from cardmem (intercom #5731), 2026-06-22. Christian wants an "edit mail-templates" surface in cardmem Settings→Mail; cardmem checked with components before re-rolling the plumbing a 4th time.

## Motivation

The machinery to **create + edit + render** mail templates has been hand-rolled at least three times in divergent shapes:

- **xrt81** (Stack B = cardmem's stack): `mailTemplates` = per-tenant **override** of `{subject, body}` over a **coded default**; render = `{{token}}` with HTML-escape + `RICH_FIELDS` raw-injection + never-throws fallback; `listEffectiveMailTemplates` → `effective + defaults + isCustom` (powers "reset" / diff). Clean, brand-agnostic — the best-shaped of the three.
- **contract-manager** (Stack A): `email_templates {slug, name, subject, html}` + WYSIWYG `{{var}}` preview. Full-HTML-in-DB.
- **fds**: Supabase-native. **senti / cdn**: hardcoded TS files.

Three re-rolls of the **same** plumbing = drift — and the escape rules + fallback semantics are **security-sensitive** (HTML-escaping untrusted values into an email body; one wrong branch = injection). That is the textbook signal for a single, audited extraction — same rationale as `@broberg/secret-scan` (one canonical pattern set) and `@broberg/apikey` (own the primitives, not the policy).

## The three (+1) layers — only layer 3 is new shared code

| Layer | What | Disposition |
|---|---|---|
| **1 — CONTENT** | coded default subject/body + per-brand skeleton/copy | per-brand **copy** — **F023 unchanged** |
| **2 — SEND** | hand the rendered `{subject, html}` to Resend | `@broberg/mail` — **F005 unchanged** |
| **3 — ENGINE** | override-store **contract** + `{{token}}` render (escape + rich rules) + never-throws resolve + effective-list for the editor | **NEW shared pkg → this epic** |
| **4 — EDITOR UI** | the actual Settings→Mail editing surface | per-stack **copy** component (Preact for Stack B, React for Stack A) — **not** a runtime dep |

## Scope (what the package owns)

A **storage-agnostic** core — exactly the `@broberg/webpush` shape (the package owns the logic; the host app owns persistence). The package exports:

- `renderMailBody(template, values, opts?)` — `{{token}}` substitution with HTML-escape by default, a `RICH_FIELDS` allow-list for raw HTML injection, and **never-throws** fallback (a bad token renders empty / the literal, never a 500 on a transactional mail path).
- `resolveMailTemplate(coded_default, stored_override?)` — merge a stored `{subject?, body?}` override over the coded default → the **effective** template.
- `listEffectiveTemplates(defaults, overrides)` → `[{ slug, effective, default, isCustom }]` — powers the editor's diff / "reset to default" / "is customised" badge.
- Types for the override record + the coded-default registry shape.

**The host provides storage.** The package never reads/writes a DB — the app passes the stored override in and persists the edited override out (Turso, Supabase, KV — the package doesn't care). This is the swap-seam.

## Non-goals

- **No storage binding.** Per-tenant override persistence stays in each app (it's genuinely divergent: xrt81 per-tenant, contract-manager full-HTML-in-DB, fds Supabase). Forcing one store would be wrong.
- **No editor UI in the package.** The WYSIWYG / form surface is per-stack copy (Preact vs React), not a runtime dependency — same call as the seti-client `<SetiChat>` vs host-app-composer split.
- **No sending.** Rendering ≠ sending. The engine has **no** dependency on Resend / `@broberg/mail`; you can render with this and send with anything. This is the key reason for a **standalone** `@broberg/mail-templates` rather than a `@broberg/mail/templates` submodule — a template consumer must not be forced to pull the Resend dep, and the two version independently.
- **No new {{ }} template language.** Stay with the existing `{{token}}` shape xrt81 already uses; this is an extraction, not a redesign.

## Architecture decision

- **Standalone package** `@broberg/mail-templates` (not coupled to the sender). `[Likely]` — strong single-responsibility + independent-versioning case; revisit only if a concrete consumer wants them bundled.
- **Storage-agnostic core**, host-provided persistence (the webpush pattern).
- **xrt81's source is the starting point** — `resolveMailTemplate` / `renderMailBody` / `listEffectiveMailTemplates` is ~finished, brand-agnostic, and already has the override-over-coded-default + effective-list model (the cleanest of the three). cardmem delivers it as the extraction seed.

## Rollout (graduate, don't block)

Proven webpush path — **do not block Christian's cardmem feature on the npm publish**:

1. **cardmem builds its layer-3 locally NOW**, behind a swap-seam, shaped to the contract above (from the xrt81 pattern). Unblocks the Settings→Mail editor immediately.
2. **components extracts** the seam'd module into `packages/mail-templates` (lens / seti-server / webpush copy-in pattern), adds tests (escape rules + never-throws + override-merge + effective-list are the must-cover cases), tsup dual ESM/CJS build.
3. **Publish** `@broberg/mail-templates@0.1.0` via the OIDC `publish.yml` (add a `mail-templates-v*` tag prefix + Trusted Publisher entry; v0.1.0 bootstrapped by hand like every other pkg). **Gate the bootstrap publish on Christian's go** (webpush precedent) + a verified pilot consumer.
4. cardmem swaps its local module for the exact-pinned package; second consumer = a Stack-A app (contract-manager / fds) proves brand-agnosticism.
5. Catalogue in Discovery (`scripts/inventory-data.mjs` DATA + `build-inventory.mjs` + `sync-mockup.sh`).

## Dependencies

- **xrt81** source (`resolveMailTemplate` / `renderMailBody` / `listEffectiveMailTemplates`) — extraction seed, delivered by cardmem.
- **F005** `@broberg/mail` (send) — adjacent, not a dep.
- **F023** template content/copy — adjacent, not a dep.

## Open questions

1. Standalone `@broberg/mail-templates` vs `@broberg/mail/templates` submodule — leaning standalone (above); confirm with first Stack-A consumer.
2. `RICH_FIELDS` raw-injection allow-list: package-level default vs per-call config? (lean per-call, app owns its trusted-field list.)
3. Subject-line escaping rules (plain-text, no HTML) vs body (HTML) — keep as two render modes.
