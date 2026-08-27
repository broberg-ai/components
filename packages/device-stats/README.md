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

## What it may collect, and why that is the architecture

This package deliberately answers only the half that needs **no consent**.

**ePrivacy art. 5(3)** (DK: cookiebekendtgørelsen) requires consent to *store or
gain access to* information on the user's terminal equipment beyond what is
strictly necessary — and EDPB Guidelines 2/2023 read that broadly: **reading
device characteristics from JavaScript counts**, cookie or not. What the browser
**sends unprompted as part of the protocol** is a different thing: it was not
accessed, it arrived.

| Tier 0 — this package, no consent | Tier 1 — consent-gated, separate entry |
|---|---|
| OS + browser family and **major** version | Precise OS version (`getHighEntropyValues`) |
| Desktop / mobile / tablet | Real viewport + screen + `devicePixelRatio` |
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

56 tests against **21 real User-Agent strings with recorded provenance** — 18
from `playwright-core`'s device registry (harvested from real devices, versioned
with the release), 3 from vendor-documented formats and labelled as the weaker
evidence they are. A table tested against strings the author invented tests the
author's idea of the format.

## License

MIT · part of the [`@broberg/*`](https://discovery.broberg.ai) shared inventory.
