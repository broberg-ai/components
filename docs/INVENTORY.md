# @broberg/components — Inventory & Vision

> Origin: a code-grounded estate sweep (80 repos under `~/Apps`, 52-agent workflow, **2026-06-08**). **Re-synced 2026-07-13** against the single source of truth `scripts/inventory-data.mjs` (the same data that powers [discovery.broberg.ai](https://discovery.broberg.ai)). Each component below is a cardmem **epic** with a full plan-doc + stories on the [components board](https://www.cardmem.com/board).
>
> **This file is the scored, human-readable reference. The live authoritative roster is [discovery.broberg.ai/ai](https://discovery.broberg.ai/ai)** (one markdown fetch, all packages + tips) — always current because it re-renders from `inventory-data.mjs` at deploy time. When the two disagree, Discovery wins; open an edit to `inventory-data.mjs` (never hand-edit this doc to lead).
>
> **Reuse models:** 📦 runtime-package · 📋 copy-owned · 🏗️ scaffold · 🔀 hybrid. **Graduate** = should get its own repo + cardmem project. **Status:** ✅ = shipped on npm · — = planned / copy-source not yet extracted · ⤳ = moved / superseded.

**Snapshot (2026-07-13): 31 shipped `@broberg/*` primitives** owned + published by `components`, plus the sibling fleet SDKs installed here from their own repos (bottom table). See Discovery for the live count.

## L0 Rails — foundation every app stands on

| F | Component | Package | Model | Status | Impact | Graduate | Best source |
|---|---|---|---|---|---|---|---|
| F001 | Design tokens + theme preset | `@broberg/theme` | 🔀 | ✅ v0.3.1 | critical | — | `webhouse/cms` |
| F002 | Stack B base scaffold | `@broberg/stack-b-base` | 🏗️ | — planned | high | — | `broberg/cardmem` |
| F003 | Stack A base scaffold | `@broberg/stack-a-base` | 🏗️ | — planned | high | — | `webhouse/boilerplates-cms` |
| F004 | Config single-source helper | `@broberg/config` | 📦 | ✅ v0.2.0 | high | — | `broberg/xrt81` |
| F005 | Mail sending (Resend) | `@broberg/mail` | 📦 | ✅ v0.3.0 | high | — | `webhouse/sanneandersen` |
| F006 | Media storage (provider-agnostic R2) | `@broberg/media` | 📦 | ✅ v0.2.0 | high | — | `broberg/cardmem` |
| F043 | Branded email shell | `@broberg/mail-core` | 📦 | ✅ v0.1.0 | medium | — | `broberg-ai/components` |
| F042 | Image transform (HEIC→WebP) | `@broberg/media-transform` | 📦 | ✅ v0.1.0 | high | — | `broberg/xrt81` |
| F041 | Cron client (cronjobs.webhouse.net) | `@broberg/cron` | 📦 | ✅ v0.1.0 | high | — | `broberg-ai/components` |
| — | Web Push (PWA notifications) | `@broberg/webpush` | 📦 | ✅ v0.1.1 | high | — | `broberg-ai/components` |
| F007 | MCP Server Toolkit | `@broberg/mcp` | 🔀 | ✅ v0.4.0 | high | — | `webhouse/cms` |
| F035 | Secret / credential redaction | `@broberg/secret-scan` | 📦 | ✅ v0.1.7 | high | — | `broberg/trail` |
| F036 | Lens-mint compliance | `@broberg/lens` | 🔀 | ✅ v0.1.3 | high | — | `broberg/cardmem` |
| F058 | HTTP header helpers (`contentDisposition`) | `@broberg/http` | 📦 | 🔨 built · awaiting bootstrap-publish | medium | — | `broberg-ai/components` |

> **F058 `@broberg/http`** is the one row not yet on npm / not yet in the live Discovery roster: the code is built, tested + committed, but a brand-new npm name needs a one-time org-owner bootstrap publish (npm login + OTP) before its OIDC workflow can ship later versions. It joins Discovery the moment it goes live.

## L1 Identity — who the user is

| F | Component | Package | Model | Status | Impact | Graduate | Best source |
|---|---|---|---|---|---|---|---|
| F008 | Unified auth (Better Auth wrapper) | `@broberg/auth` | 📦 | ✅ v0.1.1 | high | — | `broberg/xrt81` |
| F009 | User management + invitation | — | 🔀 | — planned | high | — | `webhouse/cms` |
| F010 | API-key + rate-limit | `@broberg/apikey` | 📦 | ✅ v0.1.1 | high | — | `broberg/trail` |
| F011 | Event / activity log (GDPR) | `@broberg/event-log` | 🔀 | ✅ v0.1.0 | high | — | `webhouse/cms` |
| F012 | Profile + image upload | — | 🔀 | — planned | medium | — | `broberg/xrt81` |
| F013 | Gravatar connector | `@broberg/gravatar` | 📦 | ✅ v0.1.0 | medium | — | `webhouse/fysiodk-aalborg-sport` |
| F014 | Consent / cookie banner | `@broberg/consent-cookie` | 📋 | ✅ v0.1.0 | medium | — | `cbroberg/codepromptmaker` |

## L2 Shell — the app frame & controls

| F | Component | Package | Model | Status | Impact | Graduate | Best source |
|---|---|---|---|---|---|---|---|
| F015 | Mode-switch (dark / light / system) | `@broberg/theme` | 🔀 | ✅ v0.3.1 | high | — | `webhouse/cms` |
| F016 | Toasts / Modals / Custom controls | `@broberg/ui-controls-core` | 📋 | ✅ v0.1.0 | high | — | `webhouse/cms` |
| F017 | Settings — tabbed config shell | — | 🔀 | — planned | high | — | `webhouse/cms` |
| F018 | Command palette (Cmd+K) | `@broberg/cmdk` | 📋 | ✅ v0.1.0 | high | — | `webhouse/cms` |
| F019 | i18n / language switch | `@broberg/i18n` | 🔀 | ✅ v0.1.0 | medium | — | `broberg/trail` |
| F020 | SEO / metadata helpers (Stack A) | `@broberg/seo` | 📦 | — planned | high | — | `webhouse/cms` |
| F021 | PWA setup | — | 🔀 | — planned | medium | — | `broberg/xrt81` |
| F022 | PWA update banner | — | 📋 | ⤳ shipped as `@broberg/pwa` (F054) | medium | — | `broberg/cardmem` |
| F034 | User menu (account dropdown) | — | 📋 | — planned | high | — | `webhouse/cms` + `xrt81` |

## L3 Domain — feature surfaces

| F | Component | Package | Model | Status | Impact | Graduate | Best source |
|---|---|---|---|---|---|---|---|
| F023 | Mail templates — branded shell + primitives | `@broberg/mail-core` | 📦 | ✅ v0.1.0 | high | — | `broberg-ai/components` |
| F024 | Forms + Turnstile — spam-protected pipeline | `@broberg/forms-turnstile` | 🔀 | ✅ v0.1.0 | high | — | `webhouse/cms` |
| F025 | Chat / chatbot UI | — | 🔀 | — planned | high | — | `webhouse/cms` |
| F026 | SoundKit — browser audio effects | `@broberg/soundkit` | 📦 | ✅ v0.1.0 | medium | — | `cbroberg/catan-multi-player` |
| F033 | Deploy provider core + trigger UI | `@broberg/deploy-core` | 🔀 | ✅ v0.1.0 | high | — | `webhouse/cms` |
| F044 | Speech dictionary (STT vocabulary + corrections) | `@broberg/speech-dictionary` | 📦 | ✅ v0.1.1 | medium | — | `broberg-ai/components` |
| F045 | Team-chat webhook notifications | `@broberg/notify` | 📦 | ✅ v0.1.0 | medium | — | `broberg-ai/components` |
| F046 | Lens capture / flow engine (Playwright) | `@broberg/lens-engine` | 📦 | ✅ v0.4.1 | high | — | `broberg/cardmem` |
| F047 | Hosted-Lens client (no Playwright) | `@broberg/lens-client` | 📦 | ✅ v0.1.0 | high | — | `broberg-ai/components` |
| F052 | Body pain-map | `@broberg/bodymap` | 📦 | ✅ v0.2.4 | medium | — | `broberg-ai/components` |
| F053 | Stripe payments (Connect chokepoint) | `@broberg/stripe` | 📦 | ✅ v0.2.0 | high | — | `broberg-ai/components` |
| F054 | PWA update primitive | `@broberg/pwa` | 📦 | ✅ v0.2.2 | medium | — | `broberg/fysiodk-aalborg-sport` |
| F037 | SETI streaming chat — client + Preact UI | `@broberg/seti-client` | 🔀 | ✅ v0.3.2 | high | — | `broberg-ai/components` |
| F037 | SETI proxy router | `@broberg/seti-server` | 📦 | ✅ v0.2.5 | high | — | `broberg-ai/components` |
| F027 | Deployment Mgmt (observe half) | — | 🔀 | ⤳ moved → Upmetrics | — | — | `webhouse/cms` |
| F028 | Podcast manager / maker | — | 🏗️ | — planned | medium | yes | `webhouse/cms` |
| — | Auto product-changelog | `@broberg/changelog` | 📦 | — planned (lift candidate) | medium | — | `webhouse/fysiodk-aalborg-sport` |

## L4 Capstone — whole-product builders

| F | Component | Package | Model | Status | Impact | Graduate | Best source |
|---|---|---|---|---|---|---|---|
| F029 | Multi-tenant management | — | 🔀 | — planned | high | yes | `webhouse/cms` |
| F030 | Native mobile boilerplate (Capacitor) | — | 🔀 | — planned | high | yes | `webhouse/cms` |
| F031 | Greenfield scaffolder (npm vs pnpm+Turbo) | — | 🏗️ | — planned | high | — | `broberg/cardmem` |
| F032 | create-app CLI + machine-readable manifest | — | 🏗️ | — planned | high | yes | `webhouse/cms` |

## Fleet SDK spokes — sibling `@broberg` packages installed here, owned + shipped in their own repos

`components` is the **UI / app-shell spoke** of a larger fleet shared-library wheel. These sibling SDKs are **not** components epics — they are consumed as npm deps and owned where their domain lives:

| Package | Status | Domain | Owner repo |
|---|---|---|---|
| `@broberg/db-sdk` | ✅ v0.1.0 | Data | own repo |
| `@broberg/ai-sdk` | ✅ v0.22.0 | LLM / AI gateway | `broberg-ai/ai-sdk` |
| `@upmetrics/sdk` | ✅ v0.3.1 | Telemetry / cost / errors | `broberg/upmetrics` |
| `upmetrics-swift` | ✅ v0.1.0 | Telemetry (Swift / SwiftPM) | `broberg-ai/upmetrics-swift` |
| `@broberg/fleet-client` | ✅ v0.1.0 | Fleet comms (typed client) | `broberg-ai/fleet` (buddy F072) |
| `@broberg/fleet-contracts` | ✅ v0.1.0 | Fleet comms (zod schemas + endpoints) | `broberg-ai/fleet` (buddy F072) |
| `@broberg/complimenta-sdk` | ✅ v0.2.0 | Complimenta booking API | `broberg-ai/fdaa` |
| `@broberg/cms-inline-edit` | ✅ v0.4.14 | CMS click-to-edit widget | `webhousecode/cms` |
| `@broberg/cms-chat-client` | ✅ v0.4.16 | CMS chat quick-action cache-client | `webhousecode/cms` |

> The `@broberg/cms-*` packages publish under the `@broberg` scope from `webhousecode/cms` — a deliberate exception where only the npm scope moved, not the repo. Their `NPM_TOKEN` is **granular** (update-only), so a brand-new `@broberg` name needs a one-time org-owner bootstrap publish before its workflow can ship later versions (the same constraint that gates F058 `@broberg/http`).

## Why the components-owned cross-cutting primitives live here (not inside every app)

Three families are cross-cutting concerns needed by >1 repo, so they belong in one neutral, audited place rather than re-implemented per app:

- **Security / redaction — `@broberg/secret-scan` (F035, ✅ v0.1.7).** `redactSecrets(text)→{redacted,findings[]}` / `hasSecret(text)` + a curated ordered `SECRET_PATTERNS[]`. Pure, deterministic, dependency-free; redacts secrets at comms in/out boundaries. Lifted from `broberg/trail`; `@trail/shared` re-exports it. OIDC trusted-publishing live (`secret-scan-v*`).
- **The Lens family — a 3-package split** (keeping Playwright confined to the engine means an app that only *mints* a session never installs Chromium):
  - `@broberg/lens` (F036, ✅ v0.1.3) — the **F098.1 Lens-mint standard**: a dep-free headless `POST /api/lens-session` (`createLensMintHandler` + `/next` · `/hono` adapters) that mints a short-lived, read-only Playwright `storageState` so Cardmem Lens logs *past the auth wall*. Ship-dark 503, constant-time bearer, never-cb guard, TTL clamp + rate-limit.
  - `@broberg/lens-engine` (F046, ✅ v0.4.1) — the shared **Playwright capture + flow engine**: `capture()`→PNG+dom_hash · `runFlow()`→self-healing-locator flow (testid→css→role→label→placeholder→text + Set-of-Marks vision) · token-frugal page-READ primitives `read()` / `extract()` / `network()` · (**v0.4.0, F057**) the `expectEditable` flow-step + exported `isEditableElement()` predicate · and (**v0.4.1, F046.3**) a **GDPR-safe EU-default vision route** — Set-of-Marks vision defaults to Mistral EU (a screenshot can carry PII); a non-EU model is an explicit opt-in, sealed by a test. The hosted cloud Lens AND the local daemon import this ONE engine so they never drift.
  - `@broberg/lens-client` (F047, ✅ v0.1.0) — a thin, **no-Playwright** client for the *hosted* Lens (`createLensClient().capture()/.runFlow()` + cold-start retry + optional `/hono` proxy).
- **SETI streaming chat — `@broberg/seti-client` (✅ v0.3.2) + `@broberg/seti-server` (✅ v0.2.5)** (F037).** The embeddable live cc-session streaming-chat: `seti-server` = a mountable Hono proxy router the host mounts behind its OWN auth (session→edge resolver + fleet-wide @mention routing); `seti-client` = a framework-agnostic `FrameAccumulator` core + a mobile-first Preact `<SetiChat>`. A productized *feature* (>1 app embeds it: cardmem, buddy), not a cross-cutting primitive — it lives here for the same neutral-home reason.

## Method & guardrails

- **Evidence-based:** every "best source" is a file path read by a deep-read agent, not memory.
- **Ruthless share/copy line:** runtime-package only when genuinely identical across ≥3 repos, stable, and painful to sync; otherwise copy-owned. Over-sharing is the bigger risk.
- **Headless core + thin adapters:** Stack A (Next.js) and Stack B (Bun/Hono) share framework-agnostic core TS; a package importing `next/*` is dead weight in Stack B.
- **Foundation first:** F001 design-tokens underpins every UI layer.
- **Strangler, never big-bang;** owner-session per package; `components` stays a multi-package monorepo, big epics graduate out into their own repos.

_Full per-component specs (architecture, file refs, headless/adapter split, public API, stories, AC) live in each F-doc and on the board. The always-current roster is [discovery.broberg.ai/ai](https://discovery.broberg.ai/ai)._
