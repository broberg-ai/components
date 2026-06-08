# Mission Brief — @broberg/components Inventory & Vision

> **Handoff:** Scoped in the `tools` session with Christian on 2026-06-08. **This (`components`) session now owns the mission end-to-end.** You are cardmem-enrolled → create the real F-plans + epics/stories on your own board.
>
> **Authoritative companion doc:** `docs/MISSION-inventory-source.md` — Christian's own edited strategy doc with his inline `CB:` comments. Read it; his comments override anything here on conflict.

## The mission

Build a **deep, realizable inventory + vision** for a curated universe of reusable components for the broberg.ai estate — so the path from *idea to running platform* drops from weeks to days. Output is **F-plans + epics/stories on the cardmem board**, each backed by a **mini-spec** grounded in real code (not memory).

This repo is the **incubator + home for the small core npm packages** and the home of the *plan*. Most components are ultimately built in their own owner-repos.

## Locked decisions (do not relitigate)

1. **Scope:** Read **ALL repos under `~/Apps`** (~80). No cherry-picking from memory — find the *best existing implementation* per pattern, with file references.
2. **Home:** `broberg-ai/components` monorepo = the **core npm packages**; bigger things live in their own repos.
3. **Depth:** DEEP. Full scored inventory **+ a mini-spec per component**, materialized as **F-plans/epics/stories on the cardmem board** (you're enrolled → do it now, not as one flat `.md`).
4. **Role + LEAP:** You develop strategy + inventory here. `components` = incubator + home for the small core npms. Cardmem gets a new **"LEAP"** feature that promotes a big epic *out* into its own repo + cardmem project — moving its specs out of `components`. `components` stays a multi-package monorepo.

## The framework to apply

### Three reuse models — choose the right one *per component*

| Model | What | When |
|---|---|---|
| 📦 **Runtime package** | A versioned engine you install (`ai-sdk` model) | Logic ~identical everywhere; a bugfix must propagate to all |
| 📋 **Copy-owned** | You copy the code in, it becomes yours (shadcn model) | UI that must diverge per brand/tenant — no version lock |
| 🏗️ **Scaffold/template** | A starting skeleton, not a dependency | Whole app skeletons (mobile, PWA, multi-tenant) |

**Ruthless rule:** runtime package only if (a) genuinely identical across ≥3 repos, (b) stable enough that changes are rare, (c) actually painful to sync manually. Otherwise copy-owned. Over-sharing is the bigger long-term risk.

### Two-stack reality → headless core + thin adapters
Stack A (Next.js 16 / React 19 / Tailwind v4 / shadcn) and Stack B (Bun / Hono / bun:sqlite / Vite / Preact). Share as **framework-agnostic core TS + thin per-stack bindings**. A package importing `next/navigation` is dead weight in Stack B.

### Foundation first: design tokens (#0)
"Identical in design" (Settings #8, mode-switch #9) is impossible unless colors/spacing/typography come from one source (CSS vars / `@theme`). Build the token/preset package before the UI layers.

## The components — 5 layers (starting map; verify + deepen against real code)

**Layer 0 — The rails**
| # | Area | Model | Best source |
|---|---|---|---|
| 0 | Design tokens + theme preset | 📦+📋 | `nextjs-shadcn-base` (already duplicated across 2 repos) |
| 0b | **Stack A base-scaffold** (`@broberg/stack-a-base`) | 🏗️ | `nextjs-shadcn-base` |
| 0c | **Stack B base-scaffold** (`@broberg/stack-b-base`) — **PRIORITIZED (most used now)** | 🏗️ | best Bun/Hono repo (trail/buddy/cardmem) |
| 15 | Mail sending (Resend) | 📦 | `cms`, `sanneandersen` |
| 19 | Media / R2 (buckets, upload, fetch) | 📦 | `senti-object-store`, `cdn-platform` |
| 20 | MCP server toolkit | 📦+🏗️ | `dns-mcp`, `apple-music-mcp`, `cardmem`, `buddy`, `trail` |
| — | (db-sdk, ai-sdk, upmetrics — exist / on the way) | 📦 | — |

**Layer 1 — Identity & access**
| # | Area | Model | Best source |
|---|---|---|---|
| 6 | Login providers (OAuth: Google/Apple/Azure/GitHub/LinkedIn/FB) | 📦 | `apple-music-mcp` (OAuth 2.1), `cronjobs`; OAuth identity-linking: `trail`, `xrt81` |
| 4 | User mgmt + invitation | 🔌 | `sanneandersen`, FDS (RBAC), `trail` |
| 11 | Profile + image upload | 🔌 | FDS, `trail` |
| 10 | Gravatar connector | 📦 | (easy win) |
| 12 | Event log (GDPR + activity log) | 📦 | FDS, `sanneandersen` |

**Layer 2 — The app shell** (consumes tokens)
| # | Area | Model | Best source |
|---|---|---|---|
| 8 | Settings (identical design, feature adapters) | 🔌 | `cms`, `trail`, FDS |
| 9 | Mode-switch (dark/light/system) | 📦 | part of #0 |
| 5 | CMD+K palette | 📋 | `cms`, `cardmem` |
| 18 | i18n / language switch | 🔌 | FDS, `cms` |
| 13 | PWA setup | 🏗️+📦 | FDS |

**Layer 3 — Domain surfaces**
| # | Area | Model | Best source |
|---|---|---|---|
| 1 | Chat / chatbot UI | 🔌 (ai-sdk engine + copy UI) | `sanneandersen`, `trail`, `cms` |
| 7 | Forms + Turnstile | 🔌 | `sanneandersen`, `cms` |
| 14 | Mail templates | 📋 | `cms`, `sanneandersen` |
| 16 | SoundKit | 📦 | `trail` (app.trailmem.com) |
| 17 | Podcast manager/maker | 🏗️ | `trail` |
| 21 | Deployment mgmt (watch/report/CI) | 📦+🏗️ | `cronjobs`, `code-launcher`, `claudestatus` |

**Layer 4 — Capstone**
| # | Area | Model | Best source |
|---|---|---|---|
| 2 | Native mobile boilerplate (Capacitor) | 🏗️ | FDS |
| 3 | Multi-tenant management | 📦+🏗️ | `xrt81`, `cms`/whop |
| — | **Cardmem greenfield-scaffolder** — on new repo choose Plain (npm) vs monorepo (pnpm+turbo); consumes the base-scaffolds; Stack A/B adapted to both | 🏗️ | cardmem + #0b/#0c |
| — | `create-app` CLI + machine-readable manifest for an AI product builder (may be subsumed by the cardmem LEAP/scaffolder vision) | 🏗️ | — |

### 21++ additions (identical-everywhere; Christian's rules nearly mandate them)
- **Toasts/modals + custom controls** (CustomSelect, DatePicker) — his rule forbids native dialogs/controls everywhere → de-facto shared. Copy-owned.
- **API-key + rate-limit helper** — same `x-api-key` pattern recurs in pitch, dns, upmetrics, apple-music.
- **Consent/cookie banner** (ties to #12 GDPR).
- **Config single-source helper** — his "one source, trickle down" rule as a reusable mechanism.
- **SEO/metadata helpers** (Stack A).
- **PWA update banner** (Stack A + Stack B).

### Dropped as sources
`webhouse/repo-template` and `webhouse/boilerplates-cms` — Christian: not relevant.

## Senior guardrails
- **Evidence-based:** read the real implementations; never claim something exists/works without reading the code.
- **Strangler migration, never big-bang:** pilot each package in the one repo where the best example lives → extract → republish → adopt back → spread.
- **Owner-session per package** (like ai-sdk, upmetrics today). The inventory points to who builds what.
- **Christian's UFRAVIGELIGE rule:** the F-doc plan must be written FULLY in the same step the F-number is created. No empty FEATURES/ROADMAP index rows without a plan-doc behind them.
- Work on a **feature branch** (branch-guard protects `main`).

## The estate (already mapped — ~80 repos under `~/Apps`)

Deepest-value production repos to read first: **cms, sanneandersen, trail, fysiodk-aalborg-sport (FDS), xrt81, whop, cronjobs, dns-mcp, apple-music-mcp, code-launcher, claudestatus, senti-object-store, cdn-platform, ai-sdk, upmetrics, buddy, cardmem.**

```
broberg/:    ai-sdk app-server broberg.ai cardmem lhd notesmem trail upmetrics xrt81
cbroberg/:   abr ai-tech-radar app-ports-db apple-music-mcp backup-cli catan-multi-player
             cc-docker-demo cc-recall cctalk cctalk-ios claude-agents claude-usage code-launcher
             codepromptmaker copilot-sdk-demo coverletter-generator(nextjs-shadcn-base)
             cpm-knowledge-extractor experiments fmc-automation fmc-translator
             fysio-sundhedsordning-prototype gausta-offpiste install llmwiki-ts mail miles-davis
             mistral-* music-quiz ocd-app openai-whisper-docker pitch playwithmathilde pm2-launcher
             python-play run-cc screenshot_documentation sensor-dashboard-next senti-messages
             sproutlake(-site) supabase-demo terminal-claude tools torrent-search-api
webhouse/:   agentic ai-provider-test boilerplates-cms buddy cdn-platform cms cms-docs cms-sites
             contract-manager cronjobs dns-api dns-gui dns-mcp fysiodk-aalborg-sport maurseth
             repo-template saloneventyrspejlet sanneandersen senti-object-store
             senti-website-redesign(nextjs-shadcn-base) svg-logo-generator-cli webhouse-site
             whai-gateway whapi whop
webhousecode/: claudestatus
```
(legacy/, java/, xcode/, memxengine/, devclean = mostly dormant/non-TS — skim, don't deep-read.)

## How to proceed
1. Read this + `docs/MISSION-inventory-source.md` (authoritative — Christian's edits).
2. Deep-read the estate (start with the production list above).
3. Per component (27): write a mini-spec — what, reuse-model, best source impl **+ file refs**, headless-core vs adapter split, dependencies, effort/impact, owner-session, migration order.
4. Materialize as F-plans + epics/stories on your cardmem board (group by component or by layer — your call; follow your `feature` skill; plan-doc written in the same step).
5. Report back to Christian on his phone (your Chat tab) when the first wave of F-plans is on the board.
