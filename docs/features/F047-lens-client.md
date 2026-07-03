# F047 — @broberg/lens-client: thin client for the hosted Lens

**Status:** in progress — Christian said build NOW (storeform + autodoc are blocked on it). Awaiting the hosted-Lens HTTP contract from cardmem (#15766) + storeform's existing bridge as seed (#15767).
**Owner:** `components` (owns + publishes). **Seed:** storeform's F001.2 hosted-Lens bridge (battle-tested) + cardmem's lens.cardmem.com API contract. **Model:** originator delivers the working code, components generalises + publishes (secret-scan / lens-engine precedent).
**Completes the 3-package Lens split:** `@broberg/lens` (mint, dep-free) · `@broberg/lens-engine` (browser, Playwright, F046) · **`@broberg/lens-client` (hosted-consumer, NO Playwright — this).**

## Motivation
autodoc + storeform call the HOSTED Lens (`lens.cardmem.com`) — they do NOT run a browser locally. Today they hand-roll the HTTP call + auth + cold-start retry (storeform built its own F001.2 bridge). That's the reuse-first gap: a raw fetch to a service each consumer re-rolls. `@broberg/lens-client` is the shared thin client so they exact-pin one implementation instead of drifting.

**This is NOT `@broberg/lens-engine`.** lens-engine RUNS Playwright locally (for the daemon + lens-cloud). lens-client only speaks HTTP to the hosted service — zero Playwright, zero Chromium. An app that just calls hosted Lens must never install a browser.

## Design (mirror `@broberg/seti-client`)
- **`createLensClient({ baseUrl, token?, fetch? })`** → `.capture(body)` / `.runFlow(body)` with **cold-start retry** (the hosted service may cold-start; retry on the agreed signal — 503/429/etc. — with backoff, like seti-client's reconnect). `token` is server-side only (never shipped to a browser); in a browser the client points at the same-origin proxy mount.
- **`createLensProxy({ baseUrl, token })`** → a mountable **Hono** route (exactly like `@broberg/seti-server`'s `createSetiProxy`) so a product's own frontend hits `/api/lens/*` same-origin and the token stays server-side. Browser → proxy → hosted Lens.
- Request bodies = the hosted Lens contract (the same JSON shapes as lens-engine's `captureBodySchema` / `flowBodySchema`). Re-declared lightweight in this package (or imported types-only) so lens-client carries NO Playwright dependency.
- Response = `{ png, dom_hash, dims, title }` (capture) / a flow report — exact shape per cardmem's contract (base64 PNG in JSON vs binary TBD, #15766).

## Scope (out / non-goals)
- **No Playwright / no browser launch** — that's `@broberg/lens-engine`. lens-client is HTTP-only.
- **No mint minting** — the caller supplies a token; minting/compliance is `@broberg/lens`.
- **No storage/serve** — the client returns bytes; the consumer stores.

## Dependencies
**Runtime: none** (global `fetch`). Peer: `hono` (`>=4`) for the optional `createLensProxy` (same shape as seti-client's peer-preact). Dev: tsup, typescript, vitest. Dual ESM/CJS/DTS.

## Open (blocks the build — pending cardmem #15766 / storeform #15767)
1. Exact hosted-Lens endpoint paths (capture / flow / health-warm).
2. Auth header form (Bearer? mint-session vs service-token).
3. Request body = captureBody/flowBody 1:1?
4. Response shape (PNG encoding).
5. Cold-start signal (status/body) so retry is precise.

## Rollout
1. Get contract/seed → build `@broberg/lens-client` v0.1.0 + tests (mock fetch, offline).
2. Bootstrap-publish (OTP) + README + `lens-client-v*` OIDC job + Discovery entry + enroll. Christian sets the Trusted Publisher.
3. **storeform** swaps its F001.2 bridge to the package (exact-pin) — the parity proof + the reason this exists. **autodoc** adopts too.

## Acceptance criteria (epic)
- `@broberg/lens-client` v0.1.0 on npm; `createLensClient` + `createLensProxy` + types resolve; ZERO runtime deps (no Playwright).
- `.capture()/.runFlow()` hit the hosted Lens with the correct path + auth; cold-start retry proven (mocked 503→200).
- `createLensProxy` mounts on Hono and forwards to the hosted baseUrl with the token server-side (never exposed to the browser).
- Offline tests green (mocked fetch); tsc clean; dual build.
- storeform migrates its F001.2 bridge onto the package + confirms parity (DONE GATE) — components shipping the npm is necessary but not sufficient.