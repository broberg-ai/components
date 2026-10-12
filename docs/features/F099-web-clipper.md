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

## Contract (F099.1 — v1 LOCKED 12/10; confirmed by trail #2984 and jam #2983 · v1.1 additive: user tickets, trail #2996)

```ts
// ── units and clips ──────────────────────────────────────────────────────────
interface Unit {
  kind: string;              // "page" | "turn" | "artifact" | a consumer's own
  role?: string;             // turns: "user" | "assistant"
  content: string;           // markdown — the ONLY field (with kind/role/position) in the fingerprint
  position: number;          // 0..n-1 in clip order
  parent?: number;           // an artifact/canvas unit points at the turn it belongs to (jam 4)
  html?: string;             // formatted snapshot beside the markdown (jam 1) — not fingerprinted
  blocks?: Block[];          // code blocks and tables kept structured (jam 2) — not fingerprinted
  assets?: Asset[];          // images as references (jam 3)
  links?: string[];          // (jam 5)
}
type Block = { type: "code"; lang?: string; text: string } | { type: "table"; head: string[]; rows: string[][] };
interface Asset { type: "image" | "file"; url: string; alt?: string }
interface Clip {
  url: string; title: string;
  anchor?: string;           // conversation id from the URL (jam); absent for a plain page
  shareUrl?: string;         // anchor-level reference (jam 6)
  units: Unit[];
}

// ── extraction (plug-in) ─────────────────────────────────────────────────────
interface Extractor { id: string; matches(url: URL): boolean; extract(doc: Document, url: URL): Promise<Clip> }
// base ships articleExtractor (Trail's Readability + turndown, lifted unchanged); consumers register their own first
// DETERMINISTIC (jam #2983): the same DOM must give byte-identical markdown (whitespace normalised),
// or a plain reload of a chat becomes a false branch. Every extractor, base or consumer, is held to this.

// ── auth (Broberg ID, OAuth 2.1 + PKCE from the extension) ───────────────────
interface Session { accessToken: string; sub: string; expiresAt: number }
// createBidAuth({ issuer, clientId, scopes, audience?, ticketScope? }) → { login(), session(): Promise<Session | null>, logout() }
// v1.1 (trail #2996, 12/10): with `audience`, session() swaps the BID access token for a USER TICKET to that one
// receiver (BID F087.37 token exchange; 5 min) and Session.accessToken IS the ticket, not the BID token.
// Trail: audience https://app.trailmem.com, ticketScope trail:clip. A fresh ticket is fetched before each send;
// a 401 follows the locked rule — fetch a new ticket ONCE, else «log ind igen». BID's session_ended → session() null.
// refresh via offline_access; a refused refresh (user logged out of BID) → session() returns null → the UI shows «log ind igen»
// one BID client per extension (trail-clipper, jam-clipper); redirect https://<fixed-id>.chromiumapp.org/ (+ Firefox's allizom redirect)
// receivers verify the ticket with @broberg/sso createTicketVerifier (0.18.0+): aud = their own URL, scope, type "user", clientId = their clipper

// ── destinations (plug-in) ───────────────────────────────────────────────────
interface Target { id: string; label: string; group?: string }        // trail a): tenant × brain
interface Destination {
  id: string; label: string;
  appendOnly?: boolean;      // default false: the whole clip every time (Trail: one source per URL)
  requiresConsent?: boolean; // jam 7: recording switched on PER ANCHOR before anything is sent
  targets(session: Session): Promise<Target[]>;                         // the base shows the picker and remembers the choice
  lastSeen?(anchor: string, target: Target, session: Session): Promise<string[]>;  // chain fps already held (appendOnly only)
  send(units: Unit[], ctx: { idempotencyKeys: string[]; target: Target; session: Session; clip: Clip;
                            branch?: { forkAt: number; parentChainFp: string } }): Promise<void>;   // trail b)
  uploadAsset?(asset: Asset, ctx: { target: Target; session: Session }): Promise<{ url: string }>; // jam 3, EU storage is the destination's
}
// the base owns: diff (core), retry, error states, consent gate, target memory. Response rules (trail #2984):
//   401        → the login ended or the token is not this clipper's: call session() ONCE (refresh) and resend;
//                session() null, or 401 again → the UI shows «log ind igen» — NOT a generic error
//   503 / 5xx  → the receiver (or BID behind it) is down: retry with backoff — NEVER treated as a login failure
//   other 4xx  → give up with a named error
//   network    → retry with backoff
// Each extension is built with its own destinations; the base never sends a clip to a destination that build did not register, and keeps no store, queue or target memory shared across extensions (Trail Clipper and Jam Clipper are separate extensions with separate BID clients).
```

**Confirmed details:**
- The chain fp includes the PREVIOUS unit's chain fp, not only its identity (jam #2983) — `chain()` in `packages/web-clipper/src/core.ts` already does this (F099.2).
- Trail does not use `idempotencyKeys`: a resent page is updated in place on `clip.url` (sourceUrl), so retry is safe. The field stays for Jam. Trail's `send()` reads only `clip.url` and `clip.title` (trail #2984).

**trail c) (token per audience)** — v1 said introspection; **superseded by v1.1 (12/10):** BID answers introspection only to the client the token was issued to (broberg-id #38659, via trail #2996), so a receiver cannot introspect a clipper's token. BID F087.37 user tickets give exactly the per-receiver audience trail asked for, and `createBidAuth` gains the `audience` option v1 foresaw — additive, nothing else in the contract moves. `introspectToken` stays in @broberg/sso for a client checking its OWN tokens.

**UI:** Preact + Tailwind v4 + @broberg/theme, no shadcn (owner decision D-7598d1).

## Saved 12/10 (Christian: «Gem de 4 spørgsmål straks»)

### Jam's four reuse questions (jam #2965) — measured against Discovery 12/10
1. **Shared web-clipper base?** Did not exist, was not planned → now this epic (F099), Christian's build order.
2. **Yjs/CRDT sync primitive?** Does not exist anywhere in the fleet.
3. **PDF export primitive?** Partly: @broberg/lens-svg (owner: lens) turns a rendered page into SVG/PDF vectors. No document-to-PDF without a browser.
4. **MCP server with BID OAuth?** Yes: @broberg/mcp 0.8.0 + /oauth-web (OAuth 2.1/PKCE for claude.ai/ChatGPT connectors); its authorize step calls the app's own login, which is Broberg ID via @broberg/sso.

### Answers that shape the contract (F099.1)
- **trail (#2971):** nothing more in their clipper than popup/extractor/background/manifest + packaging; ambient (F201) is a Swift app, not on the base. Keep Firefox from the start (gecko id trail-clipper@broberg.ai; launchWebAuthFlow on Firefox gives a different redirect, …extensions.allizom.org). Trail migrates itself. **UI: Preact + Tailwind v4 + @broberg/theme, NO shadcn — owner decision D-7598d1 (Stack B without shadcn) overrides the order's shadcn wording.** Contract additions: Destination.targets(session) → [{id,label,group?}] (Trail picks tenant × brain; the base shows the picker and remembers the choice); send(units, {idempotencyKey, target, session}); auth must request a token for a destination-named audience + scopes (Trail checks aud=https://engine.trailmem.com, scope trail:clip). Trail does not use send-only-new: a page is one unit, updated by sourceUrl, lastSeen → null, whole page each time — the default for destinations without appendOnly.
- **jam (#2974, jam-F002):** chat units need more than {role, content, position}: a formatted HTML snapshot beside markdown per turn; code blocks and tables kept structured; images as references (url + optional upload hook, EU storage); artefacts (claude.ai artifacts / ChatGPT canvas) as their own units tied to the turn; links; the share link as an anchor-level reference; and a **consent gate in the base: recording is switched on PER CONVERSATION (anchor) before anything is sent** (their locked decision 17). Fingerprint = role + content + position, chain incl. previous. Jam builds the chatgpt.com/claude.ai readers on the Extractor plug-in.
- **broberg-id (#2972, read from code, chromiumapp.org not tried live):** public clients exist (no secret, PKCE required for all); redirect is matched character for character incl. the trailing slash; one client per extension (trail-clipper, jam-clipper) registered by broberg-id — needs clientId, the FIXED extension id (manifest key; send dev and store ids if both are wanted) and a display name. **User tokens carry only openid/profile/email/offline_access (+ profile:write) — no per-destination audience/scopes today**; without new BID code the token's client (azp) IS the destination check. Real resource scopes on user tokens = a BID card (offered). offline_access gives refresh, but refresh is refused once the user's BID login ends (logout, «log ud overalt», expiry) → the extension must handle «log in again» calmly.
- **Conflict to settle:** trail asks for a token per audience (aud=engine.trailmem.com + trail:clip); BID cannot issue that on a user token today. Either BID builds resource scopes on user tokens (their card) or Trail checks azp=trail-clipper. Decision pending between trail and broberg-id.

## Open questions
1. **UI stack:** Trail's popup is Preact; the order says shadcn/ui + Tailwind v4 (React). Decide with trail/jam in F099.1 (preact/compat can host shadcn components; or the UI layer stays headless + tokens).
2. **BID client for extensions:** an extension's redirect URI is https://<id>.chromiumapp.org/ — broberg-id must allow it per extension id. Agree with broberg-id in F099.5.
3. **Lens and extensions:** Lens cannot load an unpacked extension today; if a story needs that measurement, file a lens-gap.

## Reuse
Discovery search 12/10 for «clipper», «web clipper», «extension»: nothing in the fleet. Reuse: Trail's extractor (Readability + turndown) is lifted, not rewritten; @broberg/sso for the BID/OIDC knowledge (the extension flow itself is new); @broberg/theme tokens for the UI.

## Rollout
New package → v0.1.0 bootstrap publish (owner's npm OTP), then Trusted Publisher. Trail migrates its clipper; Jam builds its prototype. Release report to both on every version.
