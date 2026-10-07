# WEBMCP-PLAN — Agent-ready websites for all customers

Status: Draft v2 · Owner: Christian · Created: 2026-10-06 · Updated: 2026-10-07

Changelog v2: added §8 "Agent booking — how a user books from their AI without installing anything", updated channel table, sanneandersen.dk as booking pilot, Chrome timeline.

## 1. Goal

Every customer site and client app built on our stack exposes its key actions (search, contact forms, booking, shop, signup) as structured WebMCP tools, so AI agents in the browser can use the site reliably — without scraping or guessing.

It must be **progressive enhancement**: browsers without WebMCP (Firefox, Safari today) see the normal site, nothing breaks.

## 2. Core insight — define once, expose several ways

| Channel | Where it runs | Who uses it | Requires user install? | Status |
|---|---|---|---|---|
| `cms-mcp-client` (`yoursite.com/mcp`) | Server | External agents (Claude, ChatGPT) | **Yes, per site** — does not scale for consumers | Exists |
| ACP endpoints (Shop plugin) | Server | Commerce agents | No (protocol-level) | Planned (PATCH-SHOP-ACP) |
| **WebMCP** | **Browser, in the page** | Browser agents (Claude in Chrome, Gemini in Chrome, Copilot in Edge, Comet, Atlas) | **No** | **New** |
| **Schema.org + prefilled deep links** | Static, in the page | Any AI that reads the web (chat search, answer engines) | **No** | **New (v2)** |

A "tool" (e.g. `searchProducts`, `submitContactForm`, `bookAppointment`) should be **defined once** and exposed through all channels. WebMCP is not a new system — it is another output of a tool registry we are partly building anyway.

## 3. Who executes what (ownership)

WebMCP runs in the browser, so whoever renders the page must load it. With the CMS mostly used headless, **the CMS cannot do it alone**. Split:

### 3.1 `@broberg/webmcp` — generic core (new, small package)
- Feature detection (`document.modelContext`, fallback to older `navigator.modelContext`)
- Register/unregister tools, clean-up on route change (SPA)
- Optional polyfill loading
- Helpers for declarative forms (attributes on `<form>`)
- Shared safety layer: confirmation for write actions, idempotency keys, rate limiting hooks
- No dependency on the CMS → usable by appkit and any other app
- Zero cost when not supported (lazy loaded)

### 3.2 `@webhouse/cms` — tool definitions (the source of truth)
- Tool definitions generated from the content schema (JSON Schema already exists) + plugins (forms, shop, booking)
- Published as a **tool manifest** (JSON) via the headless SDK, so any frontend can fetch it
- Same manifest feeds `cms-mcp-client`, ACP, WebMCP and Schema.org output → one source of truth
- Editor UI: toggle per tool ("expose to agents"), description text (AI can draft, AI Lock applies)

### 3.3 Framework adapters + boilerplates — the "last mile"
- Next.js adapter: one `<AgentTools />` component (client island) that reads the manifest and registers tools
- Static/Preact boilerplate: same as an Interactive Island (~few KB)
- Both also emit the Schema.org JSON-LD for the same tools (see §8.3)
- Boilerplates ship with it on by default → every new customer site gets it free

### 3.4 appkit — client apps (logged-in)
- Imports `@broberg/webmcp` directly, tools defined in code (not from CMS)
- Relevant for dashboards: `createInvoice()`, `inviteMember()`, `generateReport()`
- Tied to BID login + RBAC: an agent can only do what the logged-in user may do
- Lower priority than public sites (phase 4)

## 4. Phases

### Phase 0 — Spike (1–2 days)
- Verify current spec state (API location, declarative attributes) against https://webmachinelearning.github.io/webmcp/
- Test in Chrome with the flag (chrome://flags/#enable-webmcp-testing) or origin trial on one demo site — docs: https://developer.chrome.com/docs/ai/webmcp
- Find out which real agents actually call WebMCP tools today (Claude in Chrome, Gemini in Chrome, Atlas)
- Output: short findings note; go/no-go on API shape

### Phase 1 — Core package
- Build `@broberg/webmcp` (feature detection, register, declarative forms, safety layer)
- Tests incl. "browser without support = no errors, no extra load"

### Phase 2 — CMS tool manifest
- Tool registry in the engine, generated from schema + plugins
- Manifest endpoint in headless SDK
- `cms-mcp-client` reads from the same registry (refactor, no new behaviour)
- Editor toggle + descriptions

### Phase 3 — Adapters + boilerplates
- Next.js adapter component + static/Preact island
- On by default in webhousecode boilerplates
- Pilot on 1–2 customer sites: **sanneandersen.dk (booking)** + one with forms or shop

### Phase 4 — appkit
- Integrate core package, example tools in the demo apps, BID/RBAC binding

### Phase 5 — Rollout & measurement
- Log tool calls (which agent, which tool, success/fail) into upmetrics
- Customer-facing story: "your site is agent-ready / bookable from AI" — sales argument for CMS

## 5. Security

- Write actions (submit, book, buy) require user confirmation in the browser
- Never expose tools that bypass existing validation or price integrity (reuse Shop rules)
- Only tools registered from our own origin; audit what is registered per page
- Idempotency on all write tools (agents retry)
- Rate limiting shared with ACP/MCP
- Deep links never complete a booking on their own — they only prefill; the human confirms

## 6. Open decisions

1. Package name and home: `@broberg/webmcp` in its own repo vs inside the CMS monorepo
2. Manifest format: our own vs aligning with the WebMCP tool schema directly (prefer the latter)
3. On by default for existing customers, or opt-in per site?
4. Does the polyfill earn its place, or do we only serve native support?
5. (v2) Which booking backend(s) does the CMS booking plugin talk to — own, or adapters to existing systems the customers already use?

## 7. Risks

- Spec is still moving (API already moved once) → keep the browser-specific part thin and isolated in the core package
- No major agent consumes WebMCP at scale yet → keep cost low; the value is the shared tool registry, which also serves MCP, ACP and Schema.org today
- Firefox/Safari may not ship before late 2027 → irrelevant thanks to progressive enhancement
- (v2) WebMCP only works in a live browser tab — not in pure chat (claude.ai/ChatGPT without a browser) and not in headless browsers → §8.3 covers the gap

## 8. Agent booking — booking from your AI without installing anything (v2)

### 8.1 Problem
Users will never install an MCP connection per website, and per-site connectors would bloat the chat context. Per-site server MCP (`/mcp`) is therefore **not** the consumer booking channel. It stays relevant only for platform-level apps (one app covering many businesses) and for B2B/internal use.

### 8.2 Primary channel: WebMCP
- The user's agent opens the site itself; the page registers `bookAppointment` (and helpers like `listAvailableSlots`, `listServices`)
- Tools exist only while the page is open → zero install, zero standing context cost
- Agent calls the tool with structured input (date, service, party size, contact) → site validates → user confirms in browser → structured confirmation returned
- Timeline: origin trial from Chrome 149; native Chrome targeted around Chrome 157 (~Nov 2026) — verify in Phase 0
- Limitation: needs an agent with a real browser (Claude in Chrome, Gemini in Chrome, Atlas, Copilot in Edge)

### 8.3 Fallback that works today: Schema.org + prefilled deep link
- JSON-LD on the page: business, services, opening hours, and a `ReserveAction`/`potentialAction` pointing at the booking URL template
- Booking URL accepts query parameters, e.g. `https://sanneandersen.dk/book?date=2026-10-14&time=10:00&service=...`
- Optional read-only availability endpoint so a chat can see free slots
- Result: a pure chat can find the slot and hand the user a link that lands directly on the confirm step — one click
- Generated from the same tool manifest (§3.2), so no extra definition work

### 8.4 Platform channel (later, optional)
- Consumer reach in chat directories comes from platforms, not single sites (cf. Google + EasyTable)
- If wanted: one broberg.ai-level booking app where every customer is a tenant ("book a physio in Aalborg") — fed by the same manifests
- Not part of this plan's scope; separate decision

### 8.5 Pilot: sanneandersen.dk
- Expose `listServices`, `listAvailableSlots`, `bookAppointment` via WebMCP
- Emit JSON-LD + deep-link URL template
- Test end-to-end with Claude in Chrome and in a pure chat (deep-link path)
- Measure via upmetrics: agent bookings vs human bookings
