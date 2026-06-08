# @broberg/components — Inventory & Vision

> Generated from a code-grounded estate sweep (80 repos under `~/Apps`, 52-agent workflow, 2026-06-08). Each component below is a cardmem **epic** with a full plan-doc + stories on the [components board](https://www.cardmem.com/board). This file is the scored reference; the board is the live index.
>
> **Reuse models:** 📦 runtime-package · 📋 copy-owned · 🏗️ scaffold · 🔀 hybrid. **LEAP** = graduates to its own repo+project later.

## L0 Rails

| F | Component | Model | Effort | Impact | LEAP | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F001 | Design tokens + theme preset | hybrid | M | critical | — | `webhouse/cms` | `cms` |
| F002 | @broberg/stack-b-base — Stack B base scaffold | scaffold | M | high | — | `broberg/cardmem` | `cardmem` |
| F003 | Stack A base-scaffold (@broberg/stack-a-base) | scaffold | M | high | — | `webhouse/boilerplates-cms` | `boilerplates-cms — the cc session in webhouse/boilerplates-cms already maintains the canonical variants. Extraction into @broberg/components and publication as a create-* CLI should be piloted there.` |
| F004 | Config single-source helper | runtime-package | S | high | — | `broberg/xrt81` | `xrt81` |
| F005 | Mail sending (Resend) | runtime-package | S | high | — | `webhouse/sanneandersen` | `sanneandersen` |
| F006 | Media / R2 — Cloudflare R2 object-storage core | runtime-package | M | high | — | `broberg/cardmem` | `cardmem` |
| F007 | MCP Server Toolkit | hybrid | M | high | — | `webhouse/cms` | `cms` |

## L1 Identity

| F | Component | Model | Effort | Impact | LEAP | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F008 | OAuth Login Providers (Google / Apple / GitHub + identity linking) | runtime-package | M | high | — | `broberg/xrt81` | `xrt81` |
| F009 | User Management + Invitation | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F010 | API-key + rate-limit helper | runtime-package | M | high | — | `broberg/trail` | `trail` |
| F011 | Event Log (GDPR + Activity Log) | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F012 | Profile + Image Upload | hybrid | M | medium | — | `broberg/xrt81` | `xrt81` |
| F013 | Gravatar Connector | runtime-package | S | medium | — | `webhouse/fysiodk-aalborg-sport` | `fysiodk-aalborg-sport` |
| F014 | Consent / Cookie Banner | copy-owned | M | medium | — | `cbroberg/codepromptmaker` | `codepromptmaker` |

## L2 Shell

| F | Component | Model | Effort | Impact | LEAP | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F015 | Mode-switch (dark / light / system) | hybrid | S | high | — | `webhouse/fysiodk-aalborg-sport` | `fysiodk-aalborg-sport` |
| F016 | Toasts / Modals + Custom Controls (CustomSelect, DatePicker, ConfirmModal) | copy-owned | M | high | — | `webhouse/cms` | `cms` |
| F017 | Settings — Tabbed Config Shell with Section Panels | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F018 | CMD+K Command Palette | copy-owned | M | high | — | `webhouse/cms` | `cms` |
| F019 | i18n / Language Switch | hybrid | M | medium | — | `broberg/trail` | `trail` |
| F020 | SEO / Metadata Helpers (Stack A) | runtime-package | M | high | — | `webhouse/cms` | `cms` |
| F021 | PWA Setup | hybrid | M | medium | — | `broberg/xrt81` | `xrt81` |
| F022 | PWA Update Banner | copy-owned | M | medium | — | `broberg/cardmem` | `cardmem` |

## L3 Domain

| F | Component | Model | Effort | Impact | LEAP | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F023 | Mail Templates | copy-owned | M | high | — | `webhouse/sanneandersen` | `sanneandersen` |
| F024 | Forms + Turnstile — spam-protected form pipeline | hybrid | M | high | — | `webhouse/cms` | `cms` |
| F025 | Chat / Chatbot UI | hybrid | L | high | — | `webhouse/cms` | `cms` |
| F026 | SoundKit — synthesized & file-based audio effects for browser apps | runtime-package | M | medium | — | `cbroberg/catan-multi-player` | `buddy` |
| F027 | Deployment Management (watch/report/CI) | hybrid | L | high | yes | `webhouse/cms` | `cms` |
| F028 | Podcast Manager / Maker | scaffold | L | medium | yes | `webhouse/cms` | `webhouse/cms — F05 already specifies the canonical design (collection templates, RSS generator, admin page, PodcastAgent). The CMS session should implement F05 first, then the extraction into @broberg/components scaffold follows naturally. The ai-sdk session (broberg/ai-sdk) already owns the AI generation half and needs no changes.` |

## L4 Capstone

| F | Component | Model | Effort | Impact | LEAP | Best source | Owner |
|---|---|---|---|---|---|---|---|
| F029 | Multi-Tenant Management | hybrid | L | high | yes | `webhouse/cms` | `cms` |
| F030 | Native Mobile Boilerplate (Capacitor) | hybrid | L | high | yes | `webhouse/cms` | `cms` |
| F031 | Cardmem Greenfield-Scaffolder (Plain npm vs pnpm+Turbo monorepo) | scaffold | M | high | — | `broberg/cardmem` | `cardmem` |
| F032 | create-app CLI + machine-readable manifest (AI product builder) | scaffold | L | high | yes | `webhouse/cms` | `cms` |

## Method & guardrails
- **Evidence-based:** every "best source" is a file path read by a deep-read agent, not memory.
- **Ruthless share/copy line:** runtime-package only when genuinely identical across ≥3 repos, stable, and painful to sync; otherwise copy-owned. Over-sharing is the bigger risk.
- **Headless core + thin adapters:** Stack A (Next.js) and Stack B (Bun/Hono) share framework-agnostic core TS; a package importing `next/*` is dead weight in Stack B.
- **Foundation first:** F001 design-tokens underpins every UI layer.
- **Strangler, never big-bang;** owner-session per package; `components` stays a multi-package monorepo, big epics LEAP out.

_Full per-component specs (architecture, file refs, headless/adapter split, public API, stories, AC) live in each F-doc and on the board._
