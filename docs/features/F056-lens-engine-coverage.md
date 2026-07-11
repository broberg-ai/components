# F056 — @broberg/lens-engine `coverage()` — inline-edit coverage extractor

> **Status:** Backlog (blocked on: current bootstrap-publish task + one cardmem answer). **Owner:** components (lens-engine). **Co-solve:** cardmem epic F236. Christian green-lit 2026-07-11.

## Open question (resolve before pinning the type)
- **Schema object shape.** cardmem fetches + parses `webhouse-schema.json` and passes the PARSED object into `coverage()`. Pending their confirm: per-collection fields-map `{[collection]: { fields: string[] }}` **or** a flat expected list per `(collection, slug)`. `CoverageSchema` pins to their form 1:1. (Asked in intercom #17195; contract otherwise locked.)

## Motivation
cms rolls out **click-to-edit inline editing** (`@broberg/cms-inline-edit`) as the gold standard on every `@webhouse/cms` site (broberg.ai now, Sanne next). An element becomes editable by carrying `data-cms-collection` + `data-cms-slug` + `data-cms-field` (+ optional `data-cms-richtext`/`data-cms-html`). Problem: elements are tagged **manually per render** → fields get forgotten, and there is **no way to PROVE** "we caught every editable field" per page. That is precisely a Lens job (it drives the browser + reads the DOM).

## Split ownership (cardmem F236)
- **F056.1 (this repo, @broberg/lens-engine):** the coverage extractor — a new READER, same family as `read`/`extract`/`network` (F055). Pure, I/O-free.
- **cardmem F236.2:** the `lens_coverage` MCP tool + daemon route — navigates the URL via Lens' EXISTING mint/flow-auth (no new ad-hoc token), calls this extractor, persists the report as a Lens-run artifact, delivers summary + `MISSING[]` to the agent wiring inline-editing (via Agent Inbox to the site repo).

## Contract (locked cc-to-cc, #17195)
```ts
coverage(target: string | Page, schema: CoverageSchema, opts?: { ignoreFields?: string[] }): Promise<CoverageReport>

interface CoverageReport { pages: CoveragePage[] }
interface CoveragePage {
  collection: string;
  slug: string;
  present: string[];   // data-cms-field values found on the page for this (collection,slug)
  expected: string[];  // from the schema for this collection
  missing: string[];   // expected − present (the actionable list)
  orphans: string[];   // present but not in schema
  coveragePct: number; // present∩expected / expected
}
// CoverageSchema — pinned to cardmem's parsed shape (open question above).
```
- Enumerates all `[data-cms-field]` on the page, **grouped by** `(data-cms-collection, data-cms-slug)`; several `(collection,slug)` on one page → several `CoveragePage` entries.
- An element with a `data-cms-field` but **no** `data-cms-collection`/`-slug` → reported as an **orphan**, never crashes.
- `ignoreFields` (deliberately-not-editable allowlist) is removed from **BOTH** `present` and `expected` before the diff.
- The report type is **exported** so consumers type against it.

## Architecture
- Built as a lens-engine reader that runs on `page.content()` server-side via **jsdom** (identical pattern to F055's `read`/`extract`) → a pure `computeCoverage(html, schema, opts)` core that is **fully offline-testable**, wrapped by `coverage(target, …)` which handles the string-URL-vs-live-Page acquisition (via the existing `withPageSession`).
- **I/O-free:** the engine never fetches the schema — cardmem passes the parsed object in. No new auth: authed navigation is cardmem's daemon route (F236.2) using Lens' existing mint/flow-auth; the engine just reads a handed-in page.

## Non-goals
- Schema fetching/parsing (cardmem does it).
- The MCP tool / daemon route / artifact persistence (cardmem F236.2).
- Any new token or auth path (reuse Lens mint/flow-auth via F236.2).

## Rollout
Ship as **@broberg/lens-engine 0.3.0** (minor, OIDC tag `lens-engine-v0.3.0`) so every Lens consumer inherits `coverage()`. cardmem pins 0.3.0 and builds F236.2 on top.

## Dependencies
- F055 (lens-engine readers) — same reader/jsdom pattern + `withPageSession`.
- cardmem F236.2 (consumer) — blocked-by this shipping + the schema-shape answer.

## Stories
- **F056.1** — `coverage()` reader + report types + publish lens-engine 0.3.0.
