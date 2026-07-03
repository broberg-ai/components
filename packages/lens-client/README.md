# @broberg/lens-client

A **thin client for the hosted Lens** (`lens.cardmem.com`). Screenshot pages and
drive self-healing flows over HTTP — **no Playwright, no browser** on your side.

```bash
npm i @broberg/lens-client
```

## The three-package split

| You need to… | Use |
| --- | --- |
| Call the **hosted** Lens over HTTP (no browser) | **`@broberg/lens-client`** |
| Run a real browser yourself (capture + flow) | `@broberg/lens-engine` (Playwright) |
| Mint / validate a Lens session (auth/compliance) | `@broberg/lens` (dep-free) |

## Usage (server-side)

```ts
import { createLensClient } from "@broberg/lens-client";

const lens = createLensClient({
  baseUrl: process.env.LENS_CLOUD_URL,   // default https://lens.cardmem.com
  token: process.env.LENS_CLOUD_TOKEN,   // Bearer service token — server-side only
});

const shot = await lens.capture({ url: "https://example.com", mode: "fullPage" });
// → { run_id, screenshot_url, dom_hash, status: "ok", width, height, final_url, title }
const png = shot.screenshot_url ? await lens.fetchArtifact(shot.screenshot_url) : null;

const run = await lens.runFlow({
  base_url: "https://appstoreconnect.apple.com",
  steps: [
    { action: "goto", url: "/apps" },
    { action: "click", target: { role: "button", name: "New Version" } },  // self-healing LocateSpec
    { action: "fill",  target: { label: "Version Number" }, value: "1.2.0" },
  ],
});
```

`baseUrl`/`token` default to `LENS_CLOUD_URL` / `LENS_CLOUD_TOKEN`.

## Self-healing locators

A step `target` is a plain string (CSS selector / bare `data-testid`) or a
`LocateSpec` — `{ testid?, css?, role?, name?, label?, placeholder?, text?, exact?, nth?, vision? }` —
tried in fixed priority: `testid → css → role → label → placeholder → text → vision`.

Each step result carries **`resolved_via`** (which layer matched), so you can log a
*degraded-match* alert when a flow drifted off `testid` onto a fuzzier layer.

## Errors — a failed flow is data, not an exception

A **failing step stops the flow and pins a screenshot**; the flow comes back as a
normal result with `status: "failed"` — read `steps` to see *which* step failed and
*why* (never a thrown exception that loses context):

```ts
const run = await lens.runFlow(manuscript);
if (run.status === "failed") {
  const bad = run.steps.find((s) => s.status === "failed");
  // bad.index, bad.action, bad.error, bad.screenshot_url
}
```

Only **transport/auth failures throw** a `LensClientError` (`.kind` = `auth` on 401,
`unavailable` on 503, `network` after retries, `http` otherwise).

## Cold start

The hosted Lens auto-stops when idle. The client **pre-warms** with `GET /health`
and retries a `502` / network error (1–2 tries, backoff). It **never** retries a
`401` (bad token) or `503` (ship-dark) — those are terminal. Tune with
`{ retries, retryBackoffMs, prewarm }`.

## Artifact token gotcha

`screenshot_url` points at `/artifact?key=…` and needs the **same Bearer** to fetch.
`fetchArtifact(url)` attaches it **only** when the URL is same-origin as `baseUrl` —
never leaking the token to a foreign host.

## Browser proxy — `@broberg/lens-client/hono`

So a product's **frontend** can call Lens without ever seeing the token, mount the
proxy on your own server (same-origin `/api/lens/*`, token stays server-side):

```ts
import { createLensProxy } from "@broberg/lens-client/hono";

app.route("/api/lens", createLensProxy());   // token from LENS_CLOUD_TOKEN

// browser:
const lens = createLensClient({ baseUrl: "/api/lens" });   // no token in the browser
```

`hono` is an **optional peer** — only needed for the proxy. The core client (`.`) has
**zero runtime dependencies**.

## API

```ts
function createLensClient(opts?: LensClientOptions): LensClient;
//   .capture(body) → CaptureResult   .runFlow(body) → FlowResult
//   .health() → boolean              .fetchArtifact(url) → Uint8Array
function createLensProxy(opts?: LensProxyOptions): Hono;   // "@broberg/lens-client/hono"
class LensClientError extends Error;   // .kind, .status
```

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
