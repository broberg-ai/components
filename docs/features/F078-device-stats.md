# F078 — `@broberg/device-stats`

> **What are our users actually on?** Christian, 2026-08-25. Stack A + B.

## Motivation

Every surface decision in the fleet currently rests on an assumption nobody has measured. fd-sundhed is aimed at ~18.000 municipal employees, sanneandersen is a public clinic site, xrt81 is a club PWA — and **not one of them can say** whether its users arrive on a desktop browser, a phone browser, or a phone with the app installed. That is the difference between which surface deserves the next hour of work, and today it is guesswork.

### Reuse check (F217) — run BEFORE this plan was written

Searched `discovery.broberg.ai` for `analytics` · `telemetry` · `device` · `stats` · `user agent` · `consent` · `privacy`.

| Result | Verdict |
|---|---|
| No analytics / device-statistics capability anywhere in the fleet | **Real gap — build** |
| `@upmetrics/sdk` (shipped, booted in every app) | Adjacent — candidate **sink**, asked directly, not assumed |
| `@broberg/consent-cookie` (shipped) | **Consume** for the Tier-1 gate |
| `beacon` | False match — "device" meant Philips Hue lamps |

## The legal boundary decides the architecture

Christian asked what may *lawfully* be collected. That is not a disclaimer paragraph — it is the thing that splits the module in two.

**ePrivacy art. 5(3)** (DK: cookiebekendtgørelsen) requires consent to **store or gain access to information on the user's terminal equipment**, beyond what is strictly necessary for the service. EDPB Guidelines 2/2023 on the technical scope read that broadly: **actively reading device characteristics from JavaScript counts**, cookie or no cookie. What the browser **sends unprompted as part of the protocol** is a different thing — it was not "accessed", it arrived.

**GDPR** is a separate question on top: aggregated counts that cannot single out a person are not personal data — but *device + screen + OS version + browser version combined* is a fingerprint, and a fingerprint can.

So:

### Tier 0 — no consent required

Derived **server-side** from what already arrived, plus what the app declares about **its own** launch:

| Signal | Source | Gives |
|---|---|---|
| `User-Agent` | request header | OS family, browser family, rough form factor |
| `Sec-CH-UA`, `-Platform`, `-Mobile` | low-entropy Client Hints, sent by default | same, more reliably on Chromium |
| **launch context** | `start_url` in the web manifest carries `?src=pwa` | **installed PWA vs browser** |

That last row is the trick worth naming: when a user opens the app from the home screen, the browser navigates to the manifest's `start_url`. The app is **declaring its own launch context** — nothing was read from the device — and it answers the exact question Christian asked ("er det mobil web (pwa)") without touching Tier 1.

### Tier 1 — consent-gated (`@broberg/consent-cookie`)

Requires reading the device from JS, so it is gated and the module is **fully useful without it**:

- `matchMedia('(display-mode: standalone)')` — confirms the launch-context signal
- `window.innerWidth/innerHeight`, `screen.width/height`, `devicePixelRatio` — real viewport vs real screen
- `navigator.userAgentData.getHighEntropyValues(['platformVersion'])` — the **actual iOS/Android major version**, which modern Chromium freezes out of the plain User-Agent

**Never**: `Accept-Language` as a stored dimension (high entropy, low value here), canvas/WebGL/font probing, any hash of the combination, any persistent id.

## Anti-fingerprinting by construction

Buckets are **not a setting**. A consumer must not be able to widen this into a fingerprint by passing an option:

- OS + browser: **major version only** (`iOS 18`, not `18.6.2`)
- screen + viewport: snapped to named buckets (`≤360` · `361–768` · `769–1024` · `1025–1440` · `>1440`)
- `devicePixelRatio`: `1x` · `2x` · `3x`
- **no identifier of any kind**, so two visits from the same phone are indistinguishable from two phones

The last point is the one that keeps this out of GDPR's scope, and it is why sessionisation is explicitly a *separate future decision with its own review* rather than an option here.

## Shape

```
@broberg/device-stats
  /            headless core — deriveDevice(headers, launchCtx) → bucketed facts. No framework, no I/O.
  /next        Stack A adapter — middleware / route handler
  /hono        Stack B adapter
  /client      Tier-1 collector (consent-gated), framework-free + preact/react hooks
  /sink-*      pluggable sinks — same pattern as @broberg/mail's provider and ai-sdk's cost sink
```

**Ship dark:** no sink configured → inert. No throw, no half-wired surface.

## The sink is asked, not assumed

upmetrics has been asked directly whether this belongs in their pipe. **For:** their SDK is already booted in every app, so landing there costs consumers *zero* new integration — and integration friction is exactly what left four repos on a stale `secret-scan`. **Against:** their model is issues / grouping / resolve, with a different retention and a different legal profile; merging product analytics in could make both worse.

The design does not block on the answer, because **the collector is identical either way**. If they want it, we ship an upmetrics sink as the default; if not, it stands with its own.

## Non-goals

- Not a product-analytics suite. No funnels, no user journeys, no cohorts.
- **No identity.** Not who, not returning-vs-new — only what.
- No native mobile SDK in this epic (`upmetrics-swift` already exists for the native side; revisit if Capacitor consumers need it).
- No dashboard in the first story — the core and its correctness come first.

## Rollout

1. **F078.1** headless core + bucketing, framework-free, table-tested against real User-Agent strings (measured, not invented).
2. Stack A + Stack B adapters.
3. Tier-1 client collector behind the consent gate.
4. Sink + aggregation, once upmetrics has answered.

First consumer: fd-sundhed or xrt81 — both have a real PWA-vs-browser question they cannot answer today.
