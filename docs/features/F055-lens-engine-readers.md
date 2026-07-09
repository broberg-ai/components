# F055 — @broberg/lens-engine v0.2.0: token-frugal page-read primitives

> **Status:** planned · **Package:** `@broberg/lens-engine` (owner: `components`) · **Consumer #1:** cardmem Research Adapter (F125)
> **Origin:** idea `019f458e` (cardmem capability-request, Christian's direct go 2026-07-09). Design locked cc-to-cc in intercom #16693 → #16694 → #16695.

## Motivation

Lens' browser **automation** (`verify` / `capture` / `runFlow`) is already deterministic and token-free — nothing about driving a page costs an LLM a single token. The gap is agent **reads**: when a cc-agent needs to pull a *live* page into its **own** LLM context (cardmem's Research Adapter F125 today; any future agentic-Lens mode later), it currently swallows raw HTML — **15–30k tokens for ~2–3k of real signal**. That is pure waste on every read.

This epic adds three small, deterministic **reader** primitives to the engine so an agent gets compact markdown / structured JSON / raw API data instead of a wall of HTML. Inspiration (idea only, not the tool) is [`chrome-agent`](https://github.com/sderosiaux/chrome-agent) — a Rust/CDP CLI we deliberately do **not** adopt (stack-fork, immature, unlicensed, and it solves a per-step agentic-loop problem our deterministic Lens does not have). We steal the *compact-observation* idea and build it native on the Playwright `Page` the engine already owns.

## Scope

Three add-on readers on `@broberg/lens-engine`, auth-agnostic (reuse the existing `storageState` path exactly like `capture()` / `runFlow()`), **zero LLM tokens in the extraction itself** — the saving is downstream (what the agent then reads into context).

| # | Primitive | What it does | Leverage / risk |
|---|---|---|---|
| 1 | `network(target, opts?)` | Capture the page's own XHR/fetch API responses → skip HTML entirely when the data comes from an API | **Highest leverage, lowest risk** — ship first |
| 2 | `read(target, opts?)` | Clean markdown of the **main content only** (strip nav/chrome/boilerplate) | Mature building blocks (Readability + turndown); easy |
| 3 | `extract(target, hint?)` | Auto-detect **repeating** DOM structures (tables / explicit lists) → structured JSON | Valuable but the only fragile one → **tightly scoped** (see fence) |

### Non-goals (deliberately out)

- **No arbitrary "card" decomposition in `extract()` v1.** Generic card-layout heuristics produce noise on real pages. v1 fences to `<table>`, explicit lists (`<ul>/<ol>/<dl>`), and a repeated-sibling-grid gate (`≥ minRows` same-class-signature siblings) surfaced as `{text, href?}` — **no** decomposition into arbitrary sub-fields.
- **No LLM anywhere in detection/extraction.** DOM heuristics only; the whole point is a deterministic, token-free reader.
- **No new automation surface.** These are readers, not actions — `capture`/`verify`/`runFlow` are untouched.
- **Web push, screenshots, flows** stay where they are — this is strictly the read gap.

## Architecture — locked shapes (cc-to-cc #16695)

All three take a `string` URL (navigate) **or** a live `Page` (attach), reuse the engine's `storageState`, and return compact data. `extract()`'s contract is locked:

```ts
extract(target: string | Page, hint?: ExtractHint): Promise<ExtractResult>

interface ExtractHint {
  selector?: string;             // WHERE: only inside this container (CSS/testid). default = document
  kind?: 'auto' | 'table' | 'list'; // WHICH detector. default 'auto' (both)
  mustHaveColumns?: string[];    // keep a region only if its columns ⊇ these (disambiguate multiple tables). default none
  columns?: string[];            // rename/whitelist output keys (detected header → these; drop the rest). default = detected
  minRows?: number;              // a repeated-sibling-grid counts as 'list' only at ≥ this many same-signature siblings. default 3
  limit?: number;                // cap rows per region (token-guard). default = all
}

interface ExtractResult {
  url: string;                   // final URL after redirects
  regions: ExtractRegion[];      // detected structures in DOM order; [] = nothing qualified → caller falls back to read()
}

interface ExtractRegion {
  kind: 'table' | 'list';
  selector: string;              // stable CSS path to the region (drill / verify anchor)
  columns: string[];             // table: header keys; list: field keys (['text'] | ['text','href']; dl → ['term','definition'])
  rows: Record<string, string>[]; // trimmed, whitespace-collapsed text; keys = columns
  totalRows: number;             // total detected BEFORE limit
  truncated: boolean;            // true if limit clipped
  confidence: 'high' | 'medium'; // high = real <table>/<ul|ol|dl>; medium = inferred repeated-sibling-grid
}
```

**Detector fence (v1):**
- **table:** `<table>` + `role=table|grid` → `columns` from `<th>` (else first row); `rows` = header→cell. `confidence: 'high'`.
- **list:** `<ul>/<ol>` → `{text, href?}`; `<dl>` → `{term, definition}`; repeated-sibling-grid = `≥ minRows` siblings with the same class-signature → `{text, href?}` (aggregated text + primary link), `confidence: 'medium'`.

`read()` and `network()` follow the same `target + opts` style:
- `read(target, { selector? }) → { url, title, markdown }` — Readability picks the main article; turndown renders markdown; nav/header/footer/aside/script/style stripped.
- `network(target, { urlPattern?, limit? }) → { url, responses: { url, status, method, contentType, json?, text? }[] }` — only `fetch`/`xhr` resource-types; JSON content-types parsed into `json`, others as `text`; `urlPattern` filters.

## Dependencies

- **Playwright 1.61.1** — already an engine dep (the `Page`, `page.on('response')`, `storageState`). `network()` is a pure add-on on existing hooks.
- **`read()`** adds `@mozilla/readability` + `turndown` (small, mature, MIT). No other heavy deps.
- **`extract()`** is pure DOM heuristics evaluated in-page — no new runtime dep.
- No `@broberg/ai-sdk` involvement — these are LLM-free (unlike the engine's `vision` route).

## Rollout

1. **Ship order = leverage order:** `network()` → `read()` → `extract()`, all in **v0.2.0**.
2. **Publish** via the existing OIDC tag (`lens-engine-v0.2.0`) — Trusted Publisher already set (F046.2), so token-free, no OTP. Registry `dist-tags.latest` must read `0.2.0`.
3. **Discovery** roster (`scripts/inventory-data.mjs`) bumped to 0.2.0 + redeploy; self-enroll POST version 0.2.0.
4. **DONE gate:** cardmem **F125** adopts `read()` + `extract()` as consumer #1 (parity/consumer proof). Not urgent — no active blocker; pure token-efficiency.
5. **Harness:** the release job depends on the test job (existing 39 engine tests + new reader tests) so a red reader test blocks publish.

## Stories

| Story | Title | Ships |
|---|---|---|
| F055.1 | `network()` — capture the page's XHR/fetch API responses | v0.2.0 (first) |
| F055.2 | `read()` — main-content → markdown (Readability + turndown) | v0.2.0 |
| F055.3 | `extract()` — deterministic table/list → JSON (locked shape, scoped) | v0.2.0 |
| F055.4 | Publish v0.2.0 + README + OIDC + Discovery bump + cardmem F125 adoption (DONE gate) | v0.2.0 |
