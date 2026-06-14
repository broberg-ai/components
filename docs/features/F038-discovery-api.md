# F038 — Discovery API (`discovery.broberg.ai`)

> L0-adjacent · **new: components' first hosted service** · owner `components`.
> **Status: LIVE (2026-06-15) at https://discovery.broberg.ai** — core delivered + prod-verified (Fly region arn; Cloudflare CNAME DNS-only; Let's Encrypt cert Issued). Self-describing `/api` root + components/packages/fleet/layers/stats/search + an **Infra** section (6 platforms, ~50 crowd-sourced tips) live. cardmem points the scaffolded "Reuse first" paragraph at `/api` (backfilling all repos). Ongoing: infra-tips + inventory-suggestion sweeps grow it.
> Human-flipped by Christian (2026-06-15) — "et API ALLE repos skal kende hvor de kan query efter alle vores komponenter ... for at spare tid og opfordre til genbrug, fællesskab og fælles forbedring."

> **Delivered beyond the original sketch (Christian's live expansion):** an **Infra best-practices section** (`/api/infra` + `/api/infra/:id` for fly/cloudflare/resend/supabase/turso/npm, crowd-sourced tips + long-form notes on card-click); a **self-describing root** (`/api` and `/` with `Accept: application/json` return every endpoint + searchable vocabularies, so a caller discovers the whole surface from one call); and **dist-aware `/api/packages`** (npm vs SwiftPM install strings, e.g. upmetrics-swift).

## Motivation
Every shareable component + dev guideline across broberg.ai ends up in the components inventory. Today it's discoverable only by a human (the dashboard) or by asking the components session over intercom. To truly enforce **reuse > re-roll**, every repo's cc-session needs a FAST, programmatic way to answer "do we already have X?" *before* building — and cardmem needs the same surface to recommend scaffolding for new projects. So: a read-only Discovery API at `discovery.broberg.ai` that any repo (human or agent) can query for all shared components, npm packages, and fleet tech.

This is the API-based Discovery the F149 "Reuse first" CLAUDE.md paragraph already anticipated (its points 1–4 will collapse to "query the endpoint").

## Scope (in)
- A **read-only HTTP/JSON API** serving the inventory: components, fleet roster, shipped packages — queryable by keyword/layer/status/model.
- **Single source of truth:** the existing inventory `DATA` + `FLEET` (today inline in `scripts/build-inventory.mjs`) refactored into a shared module that BOTH the HTML generator AND the API import. No duplicated component list.
- The existing dashboard (`docs/inventory.html`) becomes the **landing page** at `/`, kept current with every new component/package.
- Hosted on **Fly.io, region `arn`** (Stockholm) as `broberg-discovery`; custom domain `discovery.broberg.ai` (CNAME requested from buddy + TLS cert).

## Scope (out / non-goals)
- **No write API.** The inventory is curated via `build-inventory.mjs` DATA + the daily fleet sweep; Discovery is read-only.
- **No auth.** Public read-only catalogue — only package metadata that's already public on npm. No secrets.
- **Not a registry/proxy.** npm is that. Discovery describes WHAT exists + WHERE, and links to npm.
- **No live npm-version polling on the hot path.** Versions come from the curated DATA (refreshed by the daily sweep); live enrichment is a possible later follow-up.

## Architecture
- **Data module** `scripts/inventory-data.mjs` (ESM) — exports `DATA`, `FLEET`, `M`, `MODEL`, `EFFORT`. `build-inventory.mjs` imports it (zero behaviour change); the API imports it too. One source.
- **Service** `apps/discovery/` — **Bun + Hono** (Stack B), stateless (data compiled in, no DB):
  - `GET /` → landing page (`inventory.html`)
  - `GET /api` → endpoint index + version
  - `GET /api/components[?q=&layer=&status=&model=]` → flattened components
  - `GET /api/components/:f` → one component
  - `GET /api/packages` → shipped `@broberg/*` + sibling SDK npms (name, version, repo, owner)
  - `GET /api/fleet` → the fleet roster
  - `GET /api/stats` → totals
  - `GET /api/search?q=` → components + fleet + packages
  - `GET /health`
- **Deploy:** Fly app `broberg-discovery`, region `arn`, shared-cpu-1x, autostop/autostart (idle-cheap). Dockerfile on the Bun image.
- **DNS/TLS:** `discovery.broberg.ai` CNAME → `broberg-discovery.fly.dev` (buddy owns broberg.ai DNS); `fly certs add discovery.broberg.ai`.

## Stories
- **F038.1** — Extract inventory data into a shared module (single source). _AC:_ build-inventory.mjs imports it; generated HTML byte-identical to before.
- **F038.2** — Discovery API service (Hono) — components/packages/fleet/search/stats + landing page. _AC:_ each endpoint returns correct JSON from the shared data; `/` serves the dashboard; tests green.
- **F038.3** — Containerise + deploy to Fly (`arn`) + `discovery.broberg.ai` CNAME (buddy) + TLS. _AC:_ `GET https://discovery.broberg.ai/api/components?q=mail` returns @broberg/mail live.
- **F038.4** — cardmem folds the Discovery endpoint into the scaffolded "Reuse first" paragraph (F149) + syncs existing repos. _AC:_ new repos' CLAUDE.md points at the API.

## Acceptance criteria
1. `GET https://discovery.broberg.ai/api/components?q=mail` returns `@broberg/mail` (JSON), live.
2. `GET /api/packages` lists shipped npms with versions matching the inventory.
3. `GET /` serves the dashboard landing page.
4. The API + HTML read from ONE data module (no duplicated component list).
5. cardmem's scaffold paragraph points repos at the API.

## Dependencies
- **buddy** — CNAME `discovery.broberg.ai` on broberg.ai.
- **cardmem** — scaffold-paragraph update (F149) + existing-repo sync, once live.

## Rollout
Build API on `broberg-discovery.fly.dev` → verify endpoints → request CNAME + `fly certs add` → flip the cardmem paragraph to the live endpoint. The data module stays the single source the daily sweep already maintains, so the API + landing page never drift.

## Note — components gains a runtime
components has been npm-only (OIDC publish, no runtime service). F038 adds its first hosted service. Kept deliberately minimal: read-only, stateless (no DB; inventory compiled into the image), public, idle-cheap (Fly autostop) — so it stays low-maintenance and doesn't compromise the OIDC-publish posture (no secrets in the publish path).
