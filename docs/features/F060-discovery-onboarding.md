# F060 — Discovery onboarding surface

> **Status:** planned · **Owner:** components · **Service:** discovery.broberg.ai
> **Requested by:** Christian, 2026-07-13

## Problem

Discovery is **search-first** — the `/api` root says *“GET /api/search?q=<what-you-need>”*. That fails the exact case that matters most: a **new agent / new project that doesn't know the vocabulary**. If you don't know what to search for, you miss both the right package AND the tip that would have helped you start well. Search is recall; onboarding needs **browse-without-a-query**.

## The real fix (and the reframe)

Agents call APIs, not HTML pages. So the substance is a **one-call digest endpoint**, not a page:

- **`GET /api/onboarding`** — returns the WHOLE map in one response: every package grouped by category/layer (name + one-liner + version + install), ALL structured tips grouped by platform, the reuse-first rule, and how to enroll. A new agent's FIRST action becomes *“give me everything”* instead of guessing a query.
- **`/onboarding`** — a generated HTML page: the same data, for humans, on Discovery's existing design language.

Both are generated from the **single source** (`scripts/inventory-data.mjs`), so they update themselves — no hand-maintained second copy (that would drift, breaking the one-source rule).

## Scope (first cut)

- **Packages:** all, grouped by the existing layers (L0 Rails → L4 Capstone + SDK). One-liner = first sentence of each `desc`.
- **Tips:** ONLY the tips already structured as data — the 107 `{t, by, tag}` entries across 14 infra platforms. **No new curation** (Christian's call): keeps the page honest to what's captured + creates pressure to structure more tips over time.
- **Intro:** the reuse-first rule + enroll-when-you-adopt, lifted from the existing `/api` manifest copy.

## Non-goals (first cut)

- No house-style/hard-won-defaults curation from CLAUDE.md into data yet (deferred — a later `PLAYBOOK` structure could hold them; not now).
- No Trail-lesson ingestion (noise risk).
- No new package — this is a Discovery (server) feature, not an npm.

## Architecture

- A generator (`scripts/build-onboarding.*` OR an in-server renderer) reads `DATA` + `INFRA` and emits: (a) the JSON digest for `/api/onboarding`, (b) the HTML for `/onboarding`. One aggregation, two renderings.
- Inherits the landing page's oklch token themes (6 variants) so it feels native to Discovery.
- The `/api` root manifest gains an `/api/onboarding` entry and a “start here” pointer; the landing links to `/onboarding`.

## Rollout

1. **Mock the page first (F122)** — a cardmem mockup (real data + Discovery design) for Christian's OK before wiring live.
2. Build the aggregation + `/api/onboarding` (F060.1) and the `/onboarding` page (F060.2).
3. Deploy to `broberg-discovery` (Fly arn); verify both live.
4. Link from `/api` root + landing.
