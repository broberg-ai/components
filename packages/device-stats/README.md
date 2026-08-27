# @broberg/device-stats

**What are our users actually on?** Desktop web, mobile web, or the app installed
to the home screen — on which OS, which browser, which screen size.

Framework-free core. Derives everything from **what the browser already sent**
plus **what the app declares about its own launch** — so nothing is read from the
user's device, and there is no identifier of any kind.

```bash
npm i @broberg/device-stats
```

## Usage

```ts
import { deriveDevice } from "@broberg/device-stats";

const facts = deriveDevice({
  headers: request.headers,          // a Headers, a Node/Bun header bag, or a plain object
  launchCtx: url.searchParams.get("src"),  // from the manifest's start_url — see below
  screenWidth: 1280,                 // optional; bucketed, never stored raw
});

// {
//   formFactor: "desktop",
//   os:      { family: "macOS",  majorVersion: "unknown" },
//   browser: { family: "Safari", majorVersion: 26 },
//   launch:  "browser",
//   screenBucket: "1025-1440",
//   source:  "ua",
// }
```

Pure: no I/O, no clock, no storage, no framework. The same input always gives the
same output, so it runs anywhere and is trivially testable.

## Stack A — Next.js

```ts
// middleware.ts / a route handler
import { deviceFromNextRequest } from "@broberg/device-stats/next";
const facts = deviceFromNextRequest(request);

// a Server Component — headers() has NO url, so pass searchParams
import { headers } from "next/headers";
import { deviceFromNextHeaders } from "@broberg/device-stats/next";
const facts = deviceFromNextHeaders(await headers(), { searchParams });
```

Without `searchParams` the launch context is **`unknown`, not `browser`** — see
"unknown is an answer" below. Defaulting to `browser` there would label every
server render an un-installed visit and hide your installed-PWA traffic in the
one surface most likely to be measured.

## Stack B — Hono / Bun

```ts
import { deviceMiddleware } from "@broberg/device-stats/hono";

app.use("*", deviceMiddleware({ onDevice: (facts) => sink.record(facts) }));
```

`onDevice` runs once per request. **If it throws or rejects, the request is
unaffected** — a device statistic is never worth a 500 on a user's page. Pass
`onError` if you want to hear about it.

## No vendor types cross the boundary

Neither adapter imports a `next` or `hono` type. They take *structural slices*
of what they actually touch (`.headers`, sometimes `.url`), so the same reading
serves Next middleware, Next route handlers, Hono, `Bun.serve` and a plain
`fetch` `Request` — and cannot break when a vendor renames or re-parameterises
its request type.

This repo paid for the alternative once already: `@broberg/auth` typed a
parameter as Better Auth's own `Auth<O>`, which is invariant, so a
plugin-narrowed instance did not satisfy it and every consumer had to write a
cast.

Both packages are **optional** peer dependencies and build externals — measured:
zero vendor `import`/`require` in any of the seven emitted files, and the
adapters weigh 576 and 1207 bytes.

`deviceFromRequest(req)` in the core does the same job for anything else.

## What it may collect, and why that is the architecture

This package deliberately answers only the half that needs **no consent**.

**ePrivacy art. 5(3)** (DK: cookiebekendtgørelsen) requires consent to *store or
gain access to* information on the user's terminal equipment beyond what is
strictly necessary — and EDPB Guidelines 2/2023 read that broadly: **reading
device characteristics from JavaScript counts**, cookie or not. What the browser
**sends unprompted as part of the protocol** is a different thing: it was not
accessed, it arrived.

| Tier 0 — the main entry, no consent | Tier 1 — `/client`, consent-gated |
|---|---|
| OS + browser family and **major** version | The **real** OS version (`getHighEntropyValues`) |
| Desktop / mobile / tablet | Real viewport + screen + `devicePixelRatio`, bucketed |
| **Installed vs browser** (see below) | `display-mode: standalone` confirmation |

Never, in any tier: `Accept-Language` as a stored dimension, canvas/WebGL/font
probing, or a hash of the combination.

### Installed-PWA vs browser, without touching the device

Put `?src=pwa` in your web manifest's `start_url`:

```json
{ "start_url": "/?src=pwa" }
```

When the user opens the app from the home screen, the browser navigates there —
so **the app declares its own launch context in the URL**. Nothing is read from
the terminal equipment, which is exactly why this stays in Tier 0. Absent the
marker the answer is `browser`, which is what an un-installed visit is.

An unrecognised marker returns `unknown` rather than `browser` — a misconfigured
`start_url` should be visible, not silently indistinguishable from a real
browser visit.

## Tier 1 — `/client`, behind a consent gate

```ts
import { collectDeviceDetail } from "@broberg/device-stats/client";

const detail = await collectDeviceDetail({ consent: manager });
if (detail) sink.record(detail);   // null = no consent, and nothing was read
```

`consent` is anything with `has(category)` — a `@broberg/consent-cookie`
`ConsentManager` fits as-is, and so does your own consent store. **No concrete
type is imported**, so using our statistics does not oblige you to install our
consent package. The gate defaults to the `analytics` category; pass `category`
to move it.

Returns `null` — never throws — when consent is absent, when it is granted for a
different category, or when there is no browser at all (SSR). Importing the
module on a server touches nothing.

### The gate makes the read impossible, not merely unused

This is the whole design, and it is worth stating plainly because it is *not*
visible in the return value:

> "We read the device and then discarded it because there was no consent" and
> "we never read the device" produce **identical output**. Only the first is
> unlawful. ePrivacy art. 5(3) prohibits the **access**, not the retention.

So the consent check is the first statement in the function, before anything
device-shaped is in scope — and a test spies on `matchMedia`, `innerWidth`,
`screen`, `devicePixelRatio` and `navigator.userAgentData` and asserts **zero
touches** without consent, and **non-zero** with it. The second half matters as
much as the first: without it, a collector that never works at all would pass.

Moving the gate below the reads turns **four named tests red**. It was measured,
not assumed.

### What it buys, and what it costs

`getHighEntropyValues(['platformVersion'])` returns the OS version that Tier 0
must refuse to guess — the honest trade the section below promises. Only
`platformVersion` is requested; `model`, `architecture` and `fullVersionList`
are the fingerprinting surface this package exists to avoid, so they are **not
asked for**, rather than asked-for-and-dropped.

**Windows is the trap.** Chromium's `platformVersion` on Windows is not the
Windows version: `13.0.0` and up means Windows **11**, `1.0.0`–`12.x` means
Windows **10**, and `0.x` is Windows 7/8/8.1 and cannot be told apart. Passing
it through would report "Windows 13" — a version that does not exist, and one
that would be believed because it looks like a number. Same rule as `Android
10; K`: mapped, or `unknown`.

Every read is guarded on its own. Older Safari has no `userAgentData`, so that
one fact degrades to `unknown` and the viewport, screen and display-mode facts
still come back.

## Anti-fingerprinting is enforced, not documented

Buckets are **not a setting**, and that is the whole guarantee:

- OS/browser: **major version only** (`iOS 17`, never `17.5.1`)
- width: snapped to `<=360` · `361-768` · `769-1024` · `1025-1440` · `>1440`
- **no identifier** — two visits from one phone are indistinguishable from two
  phones, which is what keeps aggregate counts outside GDPR's scope

There is no option, second argument or exported helper that returns a full
version string, a raw pixel width, an id or a hash. A test *attempts* each and
asserts it is impossible. Buckets as a *setting* would mean the guarantee lasts
until the first consumer who wants a bit more detail.

Sessionisation is not an option here and never will be without its own decision
and legal review.

## `unknown` is an answer, not a gap

The most important behaviour in the package:

```ts
// Chrome sends this EXACT sentinel on every Android device, whatever it runs:
"Mozilla/5.0 (Linux; Android 10; K) …Chrome/126.0.0.0 Mobile Safari/537.36"
//                        ^^         ^ model pinned to "K", version pinned to "10"

deriveDevice({ headers }).os.majorVersion; // → "unknown", NOT 10
```

That string parses cleanly to `10` and the `10` is a fiction — Chrome's UA
Reduction pins it. Same for `Windows NT 10.0` (Windows 10 and 11 are
indistinguishable) and Safari's frozen `Mac OS X 10_15_7`.

> A derived statistic that quietly reports a **wrong** version gets used.
> One that reports it does not know gets investigated.

So we never guess. If you need the real OS version, that is Tier 1 and it costs
you a consent prompt — an honest trade, made visible.

## `source` — how much to trust the answer

Every result says which evidence produced it: `ua`, `client-hints`, `mixed`, or
`none`. Client-Hints-derived facts are more reliable than User-Agent-derived
ones, and Client Hints only ever **refine what the UA could not say** — they
never overwrite a fact the UA stated.

## Ordering is the contract

Browser tokens nest: Edge's UA contains `Chrome`, Samsung Internet's contains
both `SamsungBrowser` and `Chrome`, and every Chromium UA ends in `Safari`.
Detection runs most-specific-first. Reorder it and a whole browser family is
silently re-labelled as another — and the statistic still looks plausible, which
is why a test pins the order rather than trusting a comment.

The same shape appears in form factor: an Android **tablet** is an Android UA
*without* the `Mobile` token, so the **absence** is the signal. And an iPad sends
`Mobile/15E148`, so the tablet check must run before the mobile one.

## Testing

93 tests against **21 real User-Agent strings with recorded provenance** — 18
from `playwright-core`'s device registry (harvested from real devices, versioned
with the release), 3 from vendor-documented formats and labelled as the weaker
evidence they are. A table tested against strings the author invented tests the
author's idea of the format.

The adapters are tested against the **real** `hono` and `next` packages — a real
`new Hono()` driven through `app.request()`, a real `NextRequest` — not mocks.
A mock of a framework tests your idea of the framework.

And the claims are **mutation-proven** rather than merely green: removing the
UA-reduction guard, reordering Chrome above Edge, moving the iPad check after
Mobile, removing the middleware's try/catch, dropping the no-URL rule, moving
the consent gate below the reads, passing the Windows `platformVersion` through
raw, collapsing an unaskable `display-mode` into `browser`, and dropping the
`getHighEntropyValues` catch each turn *named* tests red.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
