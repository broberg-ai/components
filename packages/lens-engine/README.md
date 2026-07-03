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
expectText · expectVisible · screenshot`. Reuse the exported Zod schemas
(`captureBodySchema`, `flowBodySchema`, `locateSpecSchema`, `uploadFileSchema`, …)
to validate at your own HTTP boundary.

## API

```ts
function capture(opts: CaptureOptions): Promise<CaptureResult>;   // { png, dom_hash, dims, title }
function runFlow(opts: FlowOptions): Promise<FlowResult>;         // step reports + resolution layers
function plannedLayers(spec: LocateSpec): string[];               // the locator layers, in order
function applyStorageState(ctx, state): Promise<void>;            // core (used by capture/flow)
function fetchStorageState(auth: MintAuth): Promise<StorageState>;// OPTIONAL consumer helper
function visionEnabled(): boolean;                                // dark-ship gate
// + resolveSelector, resolveViewport, getBrowser, closeBrowser, armIdleTimer, and all Zod schemas
```

**Runtime deps:** `playwright`, `zod`, `@broberg/ai-sdk` (vision only). MIT · part
of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
