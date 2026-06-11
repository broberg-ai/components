# @broberg/components — Inventory & Vision

> Generated from a code-grounded estate sweep (80 repos under `~/Apps`, 52-agent workflow, 2026-06-08). Each component below is a cardmem **epic** with a full plan-doc + stories on the [components board](https://www.cardmem.com/board). This file is the scored reference; the board is the live index.
>
> **Reuse models:** 📦 runtime-package · 📋 copy-owned · 🏗️ scaffold · 🔀 hybrid. **Graduate** = should get its own repo + cardmem project.

## L0 Rails

| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F001 | Design tokens + theme preset — **`@broberg/theme` ✅ shipped v0.2.0** (npm; Tailwind v4; + DESIGN.md→v4 generator) | hybrid | M | critical | — | `webhouse/cms` | `cms` |
| F002 | @broberg/stack-b-base — Stack B base scaffold | scaffold | M | high | — | `broberg/cardmem` | `cardmem` |
| F003 | Stack A base-scaffold (@broberg/stack-a-base) | scaffold | M | high | — | `webhouse/boilerplates-cms` | `boilerplates-cms — the cc session in webhouse/boilerplates-cms already maintains the canonical variants. Extraction into @broberg/components and publication as a create-* CLI should be piloted there.` |
| F004 | Config single-source helper | runtime-package | S | high | — | `broberg/xrt81` | `xrt81` |
| F005 | Mail sending (Resend) | runtime-package | S | high | — | `webhouse/sanneandersen` | `sanneandersen` |
| F006 | Media / R2 — Cloudflare R2 object-storage core | runtime-package | M | high | — | `broberg/cardmem` | `cardmem` |
| F007 | MCP Server Toolkit | hybrid | M | high | — | `webhouse/cms` | `cms` |

## L1 Identity

| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F008 | OAuth Login Providers (Google / Apple / GitHub + identity linking) | runtime-package | M | high | — | `broberg/xrt81` | `xrt81` |
| F009 | User Management + Invitation | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F010 | API-key + rate-limit helper | runtime-package | M | high | — | `broberg/trail` | `trail` |
| F011 | Event Log (GDPR + Activity Log) | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F012 | Profile + Image Upload | hybrid | M | medium | — | `broberg/xrt81` | `xrt81` |
| F013 | Gravatar Connector | runtime-package | S | medium | — | `webhouse/fysiodk-aalborg-sport` | `fysiodk-aalborg-sport` |
| F014 | Consent / Cookie Banner | copy-owned | M | medium | — | `cbroberg/codepromptmaker` | `codepromptmaker` |

## L2 Shell

| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F015 | Mode-switch (dark / light / system) | hybrid | S | high | — | `webhouse/fysiodk-aalborg-sport` | `fysiodk-aalborg-sport` |
| F016 | Toasts / Modals + Custom Controls (CustomSelect, DatePicker, ConfirmModal) | copy-owned | M | high | — | `webhouse/cms` | `cms` |
| F017 | Settings — Tabbed Config Shell with Section Panels | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F018 | CMD+K Command Palette | copy-owned | M | high | — | `webhouse/cms` | `cms` |
| F019 | i18n / Language Switch | hybrid | M | medium | — | `broberg/trail` | `trail` |
| F020 | SEO / Metadata Helpers (Stack A) | runtime-package | M | high | — | `webhouse/cms` | `cms` |
| F021 | PWA Setup | hybrid | M | medium | — | `broberg/xrt81` | `xrt81` |
| F022 | PWA Update Banner | copy-owned | M | medium | — | `broberg/cardmem` | `cardmem` |
| F034 | User Menu (account dropdown + quick-prefs) — composition of F012/13 · F015 · F019 · F016 · F008/09 | copy-owned | M | high | — | `webhouse/cms` | `cms` + `xrt81` |

## L3 Domain

| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F023 | Mail Templates | copy-owned | M | high | — | `webhouse/sanneandersen` | `sanneandersen` |
| F024 | Forms + Turnstile — spam-protected form pipeline | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F025 | Chat / Chatbot UI | hybrid | L | high | — | `webhouse/cms` | `cms` |
| F026 | SoundKit — synthesized & file-based audio effects for browser apps | runtime-package | M | medium | — | `cbroberg/catan-multi-player` | `buddy` |
| ~~F027~~ → **Upmetrics F019** | Deployment Mgmt — observe half (probe/health/CI-watch/deploy-events + relay + release-registry) **re-homed to Upmetrics** | — | — | — | moved | `webhouse/cms` | `upmetrics` |
| F033 | Deploy provider core + trigger UI (`@broberg/deploy-core`) — execution half of former F027 | hybrid | L | high | — | `webhouse/cms` | `cms` |
| F028 | Podcast Manager / Maker | scaffold | L | medium | yes | `webhouse/cms` | `webhouse/cms — F05 already specifies the canonical design (collection templates, RSS generator, admin page, PodcastAgent). The CMS session should implement F05 first, then the extraction into @broberg/components scaffold follows naturally. The ai-sdk session (broberg/ai-sdk) already owns the AI generation half and needs no changes.` |

## L4 Capstone

| F | Component | Model | Effort | Impact | Graduate | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F029 | Multi-Tenant Management | hybrid | L | high | yes | `webhouse/cms` | `cms` |
| F030 | Native Mobile Boilerplate (Capacitor) | hybrid | L | high | yes | `webhouse/cms` | `cms` |
| F031 | Cardmem Greenfield-Scaffolder (Plain npm vs pnpm+Turbo monorepo) | scaffold | M | high | — | `broberg/cardmem` | `cardmem` |
| F032 | create-app CLI + machine-readable manifest (AI product builder) | scaffold | L | high | yes | `webhouse/cms` | `cms` |

## Where this fits — the fleet shared-library landscape

`components` is the **UI / app-shell spoke** of a larger fleet shared-library wheel. The sibling spokes live in their own repos and are consumed as npm deps — they are **not** components epics:

- **UI / app-shell / identity** → this inventory (`@broberg/*`, owned by `components`)
- **Data** → `@broberg/db-sdk`
- **LLM** → `@broberg/ai-sdk`
- **Telemetry / cost / errors** → `@upmetrics/sdk`
- **Fleet comms** (intercom dispatch, terminal provision, notify-mobile, board digest, submit-idea) → **`@broberg/fleet-client`** + **`@broberg/fleet-contracts`** — **published v0.1.0** (repo `broberg-ai/fleet`, buddy epic **F072**). `fleet-contracts` = zod schemas + `FLEET_ENDPOINTS` (single source of truth); `fleet-client` = typed client — `createFleetClient({buddyBaseUrl,buddyKey}).dispatchIntercom(…)`, validates against contracts before send. Replaces hand-rolled fetch+bearer fleet calls.
- **Security / secret-redaction** → **`@broberg/secret-scan`** — *components-owned*, lifted from `broberg/trail` (F197): `redactSecrets(text)→{redacted,findings[]}` / `hasSecret(text)` / a curated ordered `SECRET_PATTERNS[]` (+ optional `extraPatterns`). Redacts secrets at comms in/out boundaries (ingest-gate + egress-scrub); pure, deterministic, dependency-free. **✅ shipped** (epic **F035**, v0.1.1 on npm via OIDC trusted-publishing) — `@trail/shared` re-exports it and trail re-validated parity against the npm (0 leaks / 0 false positives); Cloudflare Turnstile + API-token patterns folded in from sanne/xrt81. Christian to add OIDC trusted-publishing (`publish.yml`, tag `secret-scan-v*`) like `@broberg/theme`.
- **Lens-compliance / auth-mint** → **`@broberg/lens`** — *components-owned*, implements the fleet **F098.1 Lens-mint standard** (cardmem owns the spec, `docs/LENS-MINT-ENDPOINT.md`). A headless `POST /api/lens-session` endpoint — `createLensMintHandler` + thin `@broberg/lens/next` · `@broberg/lens/hono` adapters — that mints a **short-lived, read-only Playwright `storageState`** so Cardmem Lens can log *past the auth wall* and screenshot the real authed surface, incl. prod. The app supplies only a `createLensSession` hook (mints + signs its own cookie); the package guarantees ship-dark 503, constant-time bearer, a **never-cb** principal guard, TTL clamp + rate-limit, and the correct cookie-domain (never `0.0.0.0`). **✅ v0.1.0 on npm** (epic **F036**) — replaces the mint each authed repo hand-rolled (sanne/upmetrics/fysiodk), where two silent-false-green bugs already surfaced. OIDC `lens-v*` job wired; Christian to add the Trusted Publisher; epic **Done-gated** on a pilot consumer validating real-surface capture.

This keeps the share/copy discipline honest: `components` owns UI; each cross-cutting concern has one canonical SDK owned where the domain lives. **`@broberg/secret-scan` and `@broberg/lens` are the deliberate exceptions** — cross-cutting *security* primitives that `components` itself owns + publishes (alongside the UI spoke), because a secret-redaction standard and a session-minting standard each belong in one neutral, audited place rather than re-implemented inside every domain repo.

## Method & guardrails
- **Evidence-based:** every "best source" is a file path read by a deep-read agent, not memory.
- **Ruthless share/copy line:** runtime-package only when genuinely identical across ≥3 repos, stable, and painful to sync; otherwise copy-owned. Over-sharing is the bigger risk.
- **Headless core + thin adapters:** Stack A (Next.js) and Stack B (Bun/Hono) share framework-agnostic core TS; a package importing `next/*` is dead weight in Stack B.
- **Foundation first:** F001 design-tokens underpins every UI layer.
- **Strangler, never big-bang;** owner-session per package; `components` stays a multi-package monorepo, big epics graduate out into their own repos.

_Full per-component specs (architecture, file refs, headless/adapter split, public API, stories, AC) live in each F-doc and on the board._
