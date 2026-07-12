# @broberg/lens-engine

The shared **Playwright capture + flow engine** for the cardmem-lens fleet. The
hosted cloud Lens **and** the local daemon import this ONE engine, so the
self-healing locators and the frozen `/flow` step grammar never drift between
them.

```bash
npm i @broberg/lens-engine
npx playwright install chromium   # the engine launches a real browser at runtime
```

## The three-package split

`lens-engine` is the heavy, Playwright-bearing one. Pick the right package:

| You need to… | Use |
| --- | --- |
| Mint / validate a Lens session (auth/compliance, **no browser**) | `@broberg/lens` (dep-free) |
| Drive a real browser: capture + flow + self-healing locators | **`@broberg/lens-engine`** |
| Call the **hosted** Lens over HTTP (no Playwright) | `@broberg/lens-client` |

Keeping them separate means an app that only mints a session never installs
Chromium.

## Usage

```ts
import { capture, runFlow } from "@broberg/lens-engine";

// Screenshot a page (viewport / fullPage / element)
const shot = await capture({ url: "https://example.com", mode: "fullPage" });
// → { png: Uint8Array, dom_hash, dims, title }

// Drive a multi-step flow with self-healing locators
const report = await runFlow({
  base_url: "https://appstoreconnect.apple.com",
  steps: [
    { action: "goto", url: "/apps" },
    { action: "click", target: { role: "button", name: "New Version" } },
    { action: "fill",  target: { label: "Version Number" }, value: "1.2.0" },
    { action: "upload", target: "screenshot-input", files: [{ name: "a.png", url: "https://r2/a.png" }] },
    { action: "expectVisible", target: "submit-btn" },
  ],
});
```

## Auth-agnostic — `storageState` in, PNG bytes out

The engine **never fetches a mint endpoint**. To capture behind a login, the
consumer supplies a `storageState` — either a resolved object or an async
resolver — which the engine applies to a fresh browser context before
navigation:

```ts
await capture({ url, storageState: myStorageStateObject });
await capture({ url, storageState: async () => await myMint() });   // resolver form
```

An **optional** consumer helper `fetchStorageState({ adapter: "mintEndpoint", url, secret })`
ships in the package for hosted services that want to turn a mint endpoint into a
`storageState` — but the engine core never calls it. Storage, serving, and the
Bearer-auth guard are the consumer's job; the engine returns PNG bytes and
structured reports.

## Self-healing locators

A step `target` is a plain string (CSS selector or a bare `data-testid` value) or
a `LocateSpec` tried in fixed priority order — first unique, visible match wins:

```
testid → css → role → label → placeholder → text → vision
```

`vision` is the **Set-of-Marks** fallback (via `@broberg/ai-sdk`). It **ships
dark**: `visionEnabled()` is `false` unless both `LENS_VISION_ENABLED` and a
provider key (`MISTRAL_API_KEY` / `OPENROUTER_API_KEY`) are set. A vision-only
DOM-miss fails cleanly — it never guesses.

## Flow step grammar (frozen, Zod-validated)

`goto · click · fill · type · press · select · upload · waitFor · assert ·
expectText · expectVisible · expectEditable · screenshot`. Reuse the exported Zod
schemas (`captureBodySchema`, `flowBodySchema`, `locateSpecSchema`,
`uploadFileSchema`, …) to validate at your own HTTP boundary.

## Assert a field is editable (v0.4.0) — prove click-to-edit worked

`expectEditable` asserts that a resolved element is editable **right now** — the
proof that a `@broberg/cms-inline-edit` click-to-edit field actually turned
editable (instead of the hand-rolled `assert({ js })` escape-hatch). Compose it
after a `click`:

```ts
await runFlow({
  base_url: "https://site.example",
  storageState,
  steps: [
    { action: "click", target: "bio-field" },       // enter edit mode
    { action: "expectEditable", target: "bio-field" }, // ← passes only if now editable
  ],
});
```

Editable = `contenteditable` (the nearest ancestor carrying the attribute wins —
`""`/`true`/`plaintext-only` ⇒ editable, `false` ⇒ not, inherited counts) **or**
an enabled, non-readonly native form control (`<input>`/`<textarea>` not
`disabled` + not `readOnly`, or a `<select>` not `disabled`). A present-but-not
-editable target throws, naming the target. The predicate is exported as the pure
`isEditableElement(el)` (offline-testable; the SAME function is serialized into
the page at runtime).

## Page-read primitives (v0.2.0) — token-frugal reads

Automation (`capture` / `runFlow`) is already token-free. These three **readers**
close the other gap: pulling a *live* page into an agent's **own** LLM context
without swallowing 15–30k tokens of raw HTML. Each is deterministic and spends
**zero LLM tokens** in the extraction itself.

```ts
import { read, extract, network } from "@broberg/lens-engine";

// 1) Clean markdown of the MAIN content only (nav/header/footer/chrome stripped)
const { title, markdown } = await read("https://example.com/post");

// 2) Repeating structures (tables + explicit lists) → structured JSON
const { regions } = await extract("https://example.com/pricing");
// regions: [{ kind:'table'|'list', columns, rows, totalRows, truncated, confidence, selector }]

// 3) Capture the page's own XHR/fetch API responses — skip the HTML entirely
const { responses } = await network("https://example.com/app", { urlPattern: "/api/" });
// responses: [{ url, status, method, contentType, json? | text? }]
```

**Auth:** a **string URL** opens an anonymous context; to read behind a login pass
a **live (already-authed) `Page`** — the caller owns its lifecycle (never navigated
or closed here). This keeps the reader signatures minimal and the locked types stable.

**`extract()` v1 fence (deterministic, no LLM):** `<table>` + `role=table|grid`
(columns from `<th>`, `confidence:'high'`); explicit lists `<ul>/<ol>` → `{text, href?}`,
`<dl>` → `{term, definition}` (`'high'`); and a repeated-sibling-grid — `≥ minRows`
(default 3) siblings sharing a non-empty class-signature → `{text, href?}`
(`confidence:'medium'`). It does **not** decompose arbitrary "cards" into sub-fields
(that heuristic is the noise this fence omits). `regions: []` means nothing qualified —
fall back to `read()`. Hints: `selector` (scope) · `kind` (`auto|table|list`) ·
`mustHaveColumns` (disambiguate) · `columns` (positional rename + drop the rest) ·
`minRows` (grid gate) · `limit` (row cap → `truncated` + `totalRows`).

## Inline-edit coverage (v0.3.0) — prove you tagged every editable field

`coverage()` proves click-to-edit completeness for `@broberg/cms-inline-edit`
sites: it enumerates every `[data-cms-field]` on a page, groups by
`(data-cms-collection, data-cms-slug)`, and diffs against the CMS schema.

```ts
import { coverage } from "@broberg/lens-engine";

const schema = { page: { fields: ["title", "body", "hero"] } };   // parsed by the caller (I/O-free)
const report = await coverage(page, schema, { ignoreFields: ["computedAt"] });
// report.pages[i] → { collection, slug, present[], expected[], missing[], orphans[], coveragePct }
//   missing  = editable fields you forgot to tag (the actionable list)
//   orphans  = tagged but not in the schema (incl. elements with no collection/slug)
```

Pure + offline-testable (`computeCoverage(html, schema, opts)` over jsdom).
`ignoreFields` is removed from **both** `present` and `expected` before the diff;
an unknown collection yields `expected: []` (all present become orphans, never a
crash). cardmem's `lens_coverage` MCP tool drives the authed page + feeds the
parsed schema; the engine never fetches.

## API

```ts
function capture(opts: CaptureOptions): Promise<CaptureResult>;   // { png, dom_hash, dims, title }
function runFlow(opts: FlowOptions): Promise<FlowResult>;         // step reports + resolution layers
function plannedLayers(spec: LocateSpec): string[];               // the locator layers, in order
function applyStorageState(ctx, state): Promise<void>;            // core (used by capture/flow)
function fetchStorageState(auth: MintAuth): Promise<StorageState>;// OPTIONAL consumer helper
function visionEnabled(): boolean;                                // dark-ship gate
// v0.2.0 readers:
function read(target: string | Page, opts?: ReadOptions): Promise<ReadResult>;       // { url, title, markdown }
function extract(target: string | Page, hint?: ExtractHint): Promise<ExtractResult>; // { url, regions[] }
function network(target: string | Page, opts?: NetworkOptions): Promise<NetworkResult>; // { url, responses[] }
// pure, offline-testable cores: htmlToMarkdown, extractRegions, matchesUrlPattern, shapeResponseParts
// + resolveSelector, resolveViewport, getBrowser, closeBrowser, armIdleTimer, and all Zod schemas
```

**Runtime deps:** `playwright`, `zod`, `@broberg/ai-sdk` (vision only), and — for the
readers — `jsdom` + `@mozilla/readability` + `turndown`. MIT · part of the
[`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
