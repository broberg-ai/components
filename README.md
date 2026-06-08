# @broberg/components

**The shared building kit for the broberg.ai universe** — a curated portfolio of reusable components, patterns and scaffolds, so the path from *idea to running platform* drops from weeks to days.

> **Status: Phase 0 — Research & Plan.** This repo is currently primarily an *inventory & vision*. The components themselves are usually built in their own owner-repos; this monorepo is the home for the plan — and a safe harbor for the components that make sense to bundle together under `@broberg/*`.

---

## What this is

A private version of what shadcn + Vercel + `create-app` do for the rest of the world, but curated to exactly **our two stacks** and **our domains**. Instead of copy-pasting the same login, mail, media and UI patterns into every new project, we collect the best of it in one place, maintain it in one place, and reuse it everywhere.

We've already proven the model with `@broberg/ai-sdk` (shared LLM gateway), `upmetrics` (errors + token/cost telemetry) and `db-sdk` (on the way). This repo takes the deliberate step from *"we share infrastructure"* to *"we share the whole building kit."*

## Why

- **Speed:** 80% of a new domain is already built, tested and maintained.
- **One design source:** Settings, mode-switch and UI look identical because colors/spacing/typography come from one place — not from hardcoded values scattered across 9 files.
- **Lower maintenance:** A bugfix is made in one place and propagates to all consumers.

## Three reuse models (pick the right one *per component*)

The most important discipline in this repo: **not everything should be an npm package.**

| Model | What | When |
|---|---|---|
| 📦 **Runtime package** | A versioned "engine" you install (the `ai-sdk` model) | Logic that's ~identical everywhere; a bugfix must propagate to all |
| 📋 **Copy-owned** | You copy the code in, it becomes yours (the shadcn model) | UI that must be able to diverge per brand/tenant — no version lock |
| 🏗️ **Scaffold/template** | A starting skeleton, not a dependency | Whole app skeletons (mobile, PWA, multi-tenant) |

**Rule of thumb:** Something only becomes a runtime package if it's (a) genuinely identical across ≥3 repos, (b) stable enough that changes are rare, and (c) actually painful to keep in sync manually. Otherwise: copy-owned. Over-sharing is a bigger long-term risk than under-sharing.

## The five layers (build order)

1. **Layer 0 — The rails:** design tokens/theme preset, mail, media/R2, MCP toolkit (+ existing ai-sdk, upmetrics, db-sdk)
2. **Layer 1 — Identity & access:** login providers (OAuth), user mgmt + invitation, profile + image upload, gravatar, GDPR event log
3. **Layer 2 — The app shell:** settings, mode-switch, CMD+K, i18n, PWA, toasts/modals/custom controls
4. **Layer 3 — Domain surfaces:** chat, forms + Turnstile, mail templates, SoundKit, podcast, deployment mgmt
5. **Layer 4 — Capstone:** native mobile boilerplate, multi-tenant, `create-app` CLI + machine-readable manifest for an AI product builder

> The full, scored inventory (model, effort, impact, source, owner, dependencies) lives in `docs/` as F-numbered plan docs.

## Stack & principles

- **TypeScript, always.** No exceptions.
- **Two stacks:** Stack A (Next.js 16 / React 19 / Tailwind v4 / shadcn) and Stack B (Bun / Hono / bun:sqlite / Vite / Preact).
- **Headless core + thin adapters:** Almost everything is shared as an "engine without looks" (pure TS, framework-agnostic) + a thin binding per stack. A package that imports `next/navigation` is dead weight in the Hono stack.
- **Tokens are one source:** Colors/spacing/typography via CSS variables (`@theme`). No `color: "#0f7391"` in components.
- **Deployment region:** always `arn` (Stockholm).

## Repo structure (intended)

```
components/
├─ docs/            # F-numbered plan docs + INVENTORY (the plan IS the product here)
├─ packages/        # reusable packages, published under @broberg/*
│  ├─ tokens/       # → @broberg/tokens
│  ├─ mail/         # → @broberg/mail
│  └─ ...           # one folder per component
└─ turbo.json
```

pnpm workspaces + Turbo. Packages are published as `@broberg/<name>` (e.g. `@broberg/gravatar`, `@broberg/mail`) — npm doesn't support slash paths in package names, so it's one scope, many names.

## Relationship to existing shared infrastructure

| Package/service | Role | Status |
|---|---|---|
| `@broberg/ai-sdk` | Shared gateway for all LLM | In use |
| `upmetrics` | Error tracking + token/cost telemetry | In use |
| `db-sdk` | Shared database adapter | On the way |
| cardmem / cardmem-lens / buddy / trail (MCP) | Board/SDLC, visual regression, review, memory | In use |

This repo *builds on top of* them — it doesn't replace them.

## Migration: strangler, never big-bang

Each package is piloted in the one repo where the best example already lives → extracted → republished → adopted back → spread to the rest. We replace one tile at a time, never the whole floor at once.

## Ownership

Each package has an **owner session** (like ai-sdk and upmetrics do today). The inventory in `docs/` points to who builds what.

---

*Cardmem-enrolled · board + F-docs are the primary product in Phase 0.*
