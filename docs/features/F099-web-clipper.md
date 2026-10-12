# F099 — @broberg/web-clipper: one codebase for every web clipper

> Epic · components · build order 01a13127-3dba-7157-b25f-23753b08fd4c (Christian, 12/10 2026, via claude.ai) · delivery card components-card-b9fbfcbf1bbb

## Motivation
Christian 12/10: components builds and maintains a shared web-clipper base as an npm package, and both **Trail Web Clipper** (broberg-ai/trail) and **Jam Clipper** (broberg-ai/jam) build on it — one codebase for web clippers in the whole portfolio, no forks or private copies. Origin: the Jam brainstorm (broberg-ai/jam docs/PLAN.md, decision 16). Trail has the existing clipper and got a matching order.

## What exists today (read 12/10 from broberg-ai/trail apps/web-clipper)
- Chrome MV3 extension (also Firefox via gecko id), built with Vite + @crxjs/vite-plugin; popup in Preact (@trail/ui).
- Extraction: @mozilla/readability + turndown → { title, markdown }, injected as a content script on demand (activeTab + scripting).
- Auth: a Trail API token pasted into the popup settings, kept in chrome.storage.local (F207 removed a token that used to be baked in — a public repo).
- Destination: POST to Trail's /api/v1/knowledge-bases/:kb/documents/upload, tenant header.
- Nothing for fingerprints, «send only new», resend, branches, or BID login.

## The base covers (shared by all clippers)
1. **Extension skeleton** (Chrome first — Edge, Brave, Arc for free; Safari later) with a shared build (manifest + Vite config factory).
2. **Login via Broberg ID** (https://id.broberg.ai): OAuth 2.1 + PKCE from the extension (chrome.identity.launchWebAuthFlow), token storage and refresh, access limited to the user's own data. Needs a BID public client for extensions — broberg-id.
3. **Destinations** as a plug-in point: each clipper supplies its own send; the base owns transport, resend and error handling.
4. **Extraction** as a plug-in point: generic page/article extraction in the base (lifted from Trail: Readability + turndown); specialised readers (chat readers) come from the consumer or as optional modules.
5. **Fingerprint engine**: a fingerprint per unit (e.g. per chat turn: role + content + position), a **chain fingerprint** (each includes the previous), «send only new», idempotent resend, and **branches** when an earlier unit changes (edited prompt / regenerated answer) — a new branch, nothing overwritten.
6. **Shared UI** for popup/side panel with data-testid on every interactive surface. Open question below: Preact (what Trail runs) vs shadcn/ui + Tailwind v4 (the order's wording).
7. **Versioned npm releases** so consumers upgrade on purpose.

## Jam's extra needs (must be possible ON TOP of the base, not in it)
Chat readers for chatgpt.com and claude.ai (turn by turn, code blocks, tables, artefacts, images, links, formatted snapshot); conversation id from the URL as anchor; branch registration; daily Lens monitoring of the readers against test pages. The base provides the extractor plug-in point and the fingerprint/branch engine those need.

## Not in scope
Trail's and Jam's own destinations, data models and server-side logic; compile-at-ingest (Trail); transcript storage (Jam).

## Architecture sketch
```
@broberg/web-clipper
  /core        fingerprint + chain + branch engine, send-only-new, resend queue (pure TS, no browser)
  /extract     Extractor interface + articleExtractor (Readability + turndown)
  /transport   Destination interface + sender (retry/backoff, idempotency key = chain fingerprint, error states)
  /auth        BID OAuth for extensions (PKCE, launchWebAuthFlow, refresh, storage)
  /extension   MV3 manifest + Vite config factory, background/content wiring helpers
  /ui          popup / side panel building blocks (data-testid)
```

## Stories
- F099.1 — The contract, agreed with trail and jam (Extractor, Destination, Unit, fingerprint format, auth surface, UI stack).
- F099.2 — Fingerprint engine: per unit, chain, send-only-new, idempotent resend, branches.
- F099.3 — Extraction plug-in point + the generic article extractor lifted from Trail.
- F099.4 — Destination plug-in point + transport (retry, idempotency, errors).
- F099.5 — Broberg ID login from the extension.
- F099.6 — Extension skeleton, shared build and UI building blocks.
- F099.7 — Release, and Trail's clipper + a minimal Jam prototype on the package.

## Acceptance criteria (epic)
1. The package is published, and both Trail Web Clipper and a minimal Jam Clipper prototype build on it.
2. Login via BID works in both.
3. The fingerprint engine has tests for: only-new, resend without duplicates, chain integrity, branching.

## Open questions
1. **UI stack:** Trail's popup is Preact; the order says shadcn/ui + Tailwind v4 (React). Decide with trail/jam in F099.1 (preact/compat can host shadcn components; or the UI layer stays headless + tokens).
2. **BID client for extensions:** an extension's redirect URI is https://<id>.chromiumapp.org/ — broberg-id must allow it per extension id. Agree with broberg-id in F099.5.
3. **Lens and extensions:** Lens cannot load an unpacked extension today; if a story needs that measurement, file a lens-gap.

## Reuse
Discovery search 12/10 for «clipper», «web clipper», «extension»: nothing in the fleet. Reuse: Trail's extractor (Readability + turndown) is lifted, not rewritten; @broberg/sso for the BID/OIDC knowledge (the extension flow itself is new); @broberg/theme tokens for the UI.

## Rollout
New package → v0.1.0 bootstrap publish (owner's npm OTP), then Trusted Publisher. Trail migrates its clipper; Jam builds its prototype. Release report to both on every version.
