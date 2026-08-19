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

**Priority holds even when the element has not rendered yet** (0.8.1). While
waiting, the layers are raced against one shared budget — but the layer that
*answers first* is not necessarily the one you listed first, so the winner's
timing is taken and the layer is then decided by priority. One element rendering
makes all of its layers true at the same instant, and that ordinary case is now
deterministic instead of depending on which locator answered a few milliseconds
sooner.

**What priority does not promise:** a higher-priority layer that becomes present
*strictly later* than a lower-priority one still loses. Waiting to find out
whether `testid` eventually shows up would cost the full budget on every
self-heal. Layers are meant to describe **one** element, so layers arriving at
different times means they matched different elements — check the spec.

`vision` is the **Set-of-Marks** fallback (via `@broberg/ai-sdk`). It **ships
dark**: `visionEnabled()` is `false` unless both `LENS_VISION_ENABLED` and a
provider key (`MISTRAL_API_KEY` / `OPENROUTER_API_KEY`) are set. A vision-only
DOM-miss fails cleanly — it never guesses.

### The bare-string form is ambiguous, on purpose

A `target` string with no CSS punctuation is read as a **`data-testid` value**,
not as a selector — so `"save-button"` becomes `[data-testid="save-button"]`.
That convenience has one consequence worth knowing before it costs you an hour:

```
"save-button"  →  [data-testid="save-button"]     ← what you wanted
"#save"        →  #save                            ← untouched, it has punctuation
"body"         →  [data-testid="body"]             ← NOT the <body> element
```

A bare **element name** (`body`, `main`, `form`, `h1`, `section`, `table`, …)
carries no punctuation either, so it takes the test-id reading too. This is not a
bug that was fixed — it is a property of the shorthand, and it cannot be resolved
by a smarter rule: `main` is as plausible a test id as it is a tag name, so any
rule that got one right would get the other wrong.

**Use the explicit forms when it matters** — `{ css: "body" }` for the element,
`{ testid: "body" }` for the test id. Both are unambiguous and neither is
rewritten.

Since **0.7.1**, when a rewritten element name resolves to nothing the failure
says so, names the selector it used, and names the alternative — instead of a
bare `Timeout 30000ms exceeded` about a locator you never wrote. The hint is
attached **only** when the target really matched zero elements, so a genuine
test-id miss and a slow-but-present element never collect it.

## Flow step grammar (frozen, Zod-validated)

`goto · click · fill · type · press · select · upload · waitFor · assert ·
expectText · expectVisible · expectEditable · screenshot`. Reuse the exported Zod
schemas (`captureBodySchema`, `flowBodySchema`, `locateSpecSchema`,
`uploadFileSchema`, …) to validate at your own HTTP boundary. Every step also
accepts an optional `timeout_ms`, and **since v0.7.0 an unknown key is rejected
rather than silently deleted** — see below.

## v0.8.1 — the race decided *which* layer, and it should only decide *when*

Not breaking, but it changes which element a multi-layer `LocateSpec` acts on.

0.8.0 raced every layer with a bare `Promise.any`, which settles on whichever
check finishes first. Nothing ordered two layers that became true in the same
instant — and that is the ordinary case, because one element rendering makes all
of its layers true at once. So the layer that came back depended on which
locator's machinery answered sooner:

```
spec { testid, css } · both present from t+200ms · css answers in 5ms, testid in 30ms
  0.8.0  →  resolved_via "css"        ← the caller listed testid FIRST
  0.8.1  →  resolved_via "testid"
```

With four layers settling in reverse order, 0.8.0 returned `text` — the lowest
priority one. When the layers happen to match *different* elements, that acts on
the wrong element and reports success.

The fix keeps the race for timing and re-asks the priority question once there is
something to look at. It waits for nothing extra: a resolve whose element lands
at 200ms out of a 3000ms budget still returns at ~200ms.

The residual is deliberate and documented under **Self-healing locators** above: a
higher-priority layer arriving strictly later still loses.

## v0.8.0 — a `LocateSpec` object finally waits (BREAKING: `resolveTarget`)

**Read this before upgrading if you call `resolveTarget` directly.** It now takes
a required `timeoutMs` and returns a third field:

```ts
// 0.7.x
const { locator, resolved_via } = await resolveTarget(page, target, { action });
await locator.click({ timeout: timeoutMs });

// 0.8.0
const { locator, resolved_via, remaining_ms } =
  await resolveTarget(page, target, { action, timeoutMs });
await locator.click({ timeout: remaining_ms });   // ← the REMAINDER, not the original
```

Required rather than optional on cardmem's own request, against their own build:
an optional budget is an absent guard that looks like a present one — the fix
would read as landed in the shared resolver while every consumer kept the defect.

### What was broken

**A `LocateSpec` object never waited at all.** Measured in a real browser against
0.7.1, element injected at t+800ms with a 5000ms timeout, against a control that
never injects:

```
                arrives at t+800ms        never arrives
{ css: … }      FAIL   457ms             fail   331ms
{ testid: … }   FAIL   318ms             fail   316ms
"#css"          ok    1124ms             fail  5377ms
"testid"        ok    1341ms             fail  5252ms
```

**The object form's two columns are indistinguishable** — same verdict, same time,
same message for *not there yet* and *never there*. Every layer was gated on
`await loc.count() > nth`, an instantaneous probe; the bare-string form was fine
only because it skips the probe and lets Playwright auto-wait.

Which made the advice in the section below **actively harmful**: it tells you to
prefer `{ css: "body" }` when precision matters, and that was the form that could
not wait. A consumer following it got a flakier flow.

### What changed

Resolution is now two passes under **one shared budget**:

| pass | question | cost |
|---|---|---|
| 1 | **identity** — was it renamed? Snapshot, all layers, strict priority. | ~0 |
| 2 | **time** — has it rendered yet? Races every layer against the remaining budget. | ≤ `timeout_ms`, once |

Racing rather than serialising is the point: a `waitFor` per layer would turn a
total miss into `n × timeout`. Four layers that all miss now cost **one** timeout.

**Self-heal got better as a side effect.** A first layer matching only a *hidden*
element used to match and then time out; it now falls through to the next layer,
which is what "fallback" promised all along.

### The per-verb criterion — and why `upload` is exempt

`visible` for every verb **except `upload`**, which uses `attached`.
`setInputFiles` deliberately does not require visibility, and a `display:none`
file input is the standard pattern behind every styled upload control — a blanket
`visible` would break uploads everywhere.

`visible` is safe for the others **by construction**, not by corpus:
`click`/`fill`/`type`/`press`/`select` require Playwright actionability, and
`expectVisible`/`expectEditable`/`screenshot`/`waitFor`/`expectText` each wait for
visibility right after resolving. So the old probe's inclusion of hidden elements
could never produce a *passing* step — only a worse message.

### `remaining_ms`, and the zero that means "forever"

The verb waits on what is **left**, never the original. Otherwise resolve and
action each spend the full budget: ask for 5000ms against a missing element and
you wait 10s while being told 5000ms — which is the exact defect `timeout_ms` was
built to remove, reproduced inside its own fix.

`remainingBudget(budget, spent)` is exported and floored at **1, never 0**:
Playwright reads `timeout: 0` as *disable the timeout*, so an exhausted budget
would become an infinite wait. Third time that inversion has appeared in this
epic, after `badge = 0` meaning *remove the badge* and `timeout_ms: 0` meaning
*never time out*.

## v0.7.0 — unknown keys are now REJECTED, and `timeout_ms` finally works

**Read this before upgrading: a flow that parses today can stop parsing.** That is
the change, not a side effect.

`flowBodySchema` and every member of `flowStepSchema` are now `.strict()`. Until
0.6.1 they were Zod's default `.strip()`, which **deletes** an unknown key
silently, before the engine ever sees it:

```js
// 0.6.1
flowStepSchema.safeParse({ action:'click', target:'#save', timeout_ms:1000 })
//  → ok: true,  data: { action:'click', target:'#save' }     ← the field is gone

// 0.7.0
//  → ok: false, "Unrecognized key(s) in object: 'timeout_ms'"
```

Nobody decided that behaviour, which is exactly why nobody caught it. cardmem's
formulation, adopted here: **a missing capability fails visibly; an ignored field
lies.** The migration is mechanical — the error names the key.

**Since v0.7.2 the error names the ESCAPE HATCH too, not only the key:**

```
Unrecognized key(s) in object: 'project'. This schema is strict — an unknown key
is refused rather than silently deleted. If it is YOUR field, carry it with
flowBodySchema.extend({ project: … }), which stays strict and still refuses
everything else. If it was meant to be one of ours, check the spelling.
```

That exists because this section did not help the consumer it was written for.
cardmem's cloud path was rejected by 0.7.0 and they found `.extend()` by reading
the source, not this file — **a consumer running `pnpm update` does not read
release notes**, and the person who needs this line is holding a stack trace. A
rejected key on a *step* points at the body instead, since a discriminated union
cannot be extended.

**The evidence this is worth the break.** cardmem mined 1258 real request bodies
from fleet session transcripts. One flow sent `baseUrl` instead of `base_url`;
the key was deleted and the flow ran against the wrong origin. `base`, `project`,
`url` and `label` are the same shape of bug. Every one is caught at the boundary
now.

**Adding your own key is supported — `.extend()` survives strict:**

```ts
const myBody = flowBodySchema.extend({ auth: myAuthSchema.optional() });
myBody.safeParse({ …, auth })   // true  — your key is admitted
myBody.safeParse({ …, junk: 1 }) // false — everything else still refused
```

That is how Cloud Lens's 874 `auth`-carrying calls keep working untouched, and it
is where a **consumer-owned** field belongs. It does not belong in this schema:
the engine would be promising a key nothing here acts on, which is the same lie
in the other direction.

### `timeout_ms` — per step, or per flow

```ts
runFlow({
  base_url: 'https://example.com',
  timeout_ms: 5_000,                                   // default for every step
  steps: [
    { action: 'goto', url: '/login' },
    { action: 'click', target: '#save', timeout_ms: 1_000 },   // this one wins
  ],
});
```

**Step beats flow beats the built-in 30s.** With neither set, behaviour is
unchanged. `resolveStepTimeout(step, flow)` is exported so a consumer running its
own loop resolves it the same way instead of rebuilding the rule.

The plumbing was already there — every Playwright call took the timeout; only the
inlet was missing. And **the value you choose is the value that fails**: the
motivating incident (cardmem F074.51) was a caller asking for 1000 ms and being
told *"Timeout 15000ms exceeded"*, which cost storeform two days believing Google
Play Console was slow.

> **`timeout_ms: 0` is rejected.** Playwright reads `timeout: 0` as *disable the
> timeout*, so a caller who means "fail immediately" would get "wait forever" —
> the exact inversion this field exists to prevent. Minimum is 1; a whole-flow
> deadline is a different mechanism and is not in this release.

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

### v0.5.0 — fail at boot when the browser is missing

If you bake browsers into an image (a Docker/Fly deploy rather than a dev
machine), call this once at startup:

```ts
import { assertBrowserAvailable } from '@broberg/lens-engine';
assertBrowserAvailable(); // throws if the Chromium build Playwright expects is absent
```

It resolves `chromium.executablePath()` and stats it — no launch, no network —
and throws with the expected path plus `PLAYWRIGHT_BROWSERS_PATH`, which are the
two lines that actually diagnose it. `getBrowser()` calls it too, so you get the
clear error either way; calling it yourself just moves the failure from *the
first capture in production* to *a failed deploy*.

**Why a path check and not a version check.** Playwright encodes the browser
revision in the path (`…/ms-playwright/chromium-1228/…`), so this is exact where
a version compare is a proxy. It avoids a false alarm when two Playwright
versions share one revision, and — the one that matters — it catches the case a
version compare cannot see: the version matching while the browser is *gone*,
because a base image changed and the package did not.

**Note for image builders:** `playwright` is an ordinary dependency here, not a
peer, deliberately. Making it a peer was tried and measured: pnpm auto-installs
peers by default, so an undeclared peer produced no warning at all and silently
resolved a *newer* Playwright than the one baked into the image — worse than the
problem it was meant to solve. A Playwright bump in this package is still a
breaking change for you; it ships in its own minor (a caret on `0.x` locks the
minor, so you are never upgraded into one by accident).

### v0.6.0 — an assert that returns a bag of data asserted nothing

An assert body may return a boolean, or `{ pass, detail }`. As of 0.6.0 a **plain
object with no `pass` key** is a hard error instead of a silent pass:

```ts
{ action: 'assert', js: "return { passed: drawer.open, detail: '…' }" }
// ✗ assert returned an object with no 'pass' key (got: passed, detail)
//   — did you mean { pass }? Return a boolean, or { pass, detail }

{ action: 'assert', js: 'return {}' }
// ✗ assert returned an empty object, so nothing was asserted — this is usually
//   a template that was never filled in.
```

Before this, no `pass` key meant bare-truthy, so `{passed:…}` `{ok:…}`
`{found:…}` — any near-miss on the verdict key — was **green forever, whatever
the page did**. Measured in two months of real fleet history: the worst example
computed the answer and then handed it back as a data field
(`return {picker_left, sidebar_right, behind}`) without ever using it as the
verdict. That form is more dangerous than a bare `true`, because it looks
careful and no reviewer stops at it.

**Narrow by design.** The discriminator is the prototype, so only *plain* objects
are rejected. A DOM Element, an array, a `Date`, a `Map`, a class instance — all
still pass bare-truthy, which is why `assert: document.querySelector('#drawer.open')`
keeps working. `{pass:false}` remains an ordinary assert *failure*, not an error.

**Not covered:** a body ending in a literal `return true` is still green whatever
happened. No engine can see the difference between that and a real verdict —
that one is on the author. (Measured caveat: `return true` is only *vacuous*
when it stands alone. If the chain above it can throw — a dead `fetch`, a
missing node — the assert is thin but real. The genuinely empty ones fire work
**without awaiting it** and return before the answer arrives.)

> ### ⚠️ Upgrading from 0.5.x — `AssertOutcome` gained a member
>
> **Who this is for:** repos with `lens-engine` in `node_modules` — i.e. anyone
> who *embeds* the engine. **Not** the much larger set that drives Lens as a
> service through the cardmem daemon or MCP: they only ever see the finished
> `status` field, and are unaffected at any version. The two groups are easy to
> confuse — one repo ran 144 Lens runs without ever having had the package.
>
> `AssertOutcome` is now a **four**-way union. If you switch on `kind` or read
> `.value`, handle `no-verdict` explicitly:
>
> ```ts
> if (out.kind === 'no-verdict') fail(noVerdictMessage(out.keys, body));
> ```
>
> TypeScript catches this at compile time. **Plain JS does not** — `out.value` is
> `undefined` on a `no-verdict`, which is falsy, so the assert fails *with no
> explanation* and the named message never reaches the author. That throws away
> the entire point of the release. Reported by cardmem, whose typecheck caught it
> on both of their call-sites.
>
> `noVerdictMessage(keys, body?)` is exported (0.6.1) so there is **one**
> definition of those two sentences — rebuild them by hand in a consumer and the
> engine's wording and yours drift apart, which is the same mistake as two copies
> of the verdict logic.

**Runtime deps:** `playwright`, `zod`, `@broberg/ai-sdk` (vision only), and — for the
readers — `jsdom` + `@mozilla/readability` + `turndown`. MIT · part of the
[`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
