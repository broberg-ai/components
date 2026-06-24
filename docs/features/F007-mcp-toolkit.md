# F007 — MCP Server Toolkit (@broberg/mcp)

> L0 Rails · hybrid · effort **L** (re-scoped) · impact **high** · owner `components`. Status: **Active — re-scoped 2026-06-24; cross-repo Q&R in flight.**
> Graduate-candidate: no — stays in `components`.

## Re-scope (2026-06-24, Christian) — NOT slim
The original plan (2026-06-08) deliberately started minimal: static-key auth only, OAuth 2.1 deferred, two transports. **Christian has overridden that.** This package must be GENUINELY reusable across the whole estate's MCP surface — **not slim for slimness' sake.** It must cover, by design:
- **All transports:** stdio · Streamable-HTTP (WebStandard) · **SSE** (Apple Music MCP) — honest about WebSocket only if a real consumer needs it.
- **All auth models:** static Bearer · hashed DB-backed 3-tier (cardmem) · **OAuth 2.1 PKCE** (dns-mcp, Apple Music) — composable, never a config maze.
- **New consumers are first-class:** vn-leker (order-MCP, coming) + xrt81 (Christian building one) start FRESH on this — so the package must be good enough to *build a new MCP server on*, not only to strangler-migrate existing ones.

The design is **driven by a fresh cross-repo Q&R** so we capture ALL real scenarios before freezing the API — not a guess.

### Cross-repo Q&R (design input — in flight)
Sent 2026-06-24: cms #5982 · trail #5983 · cardmem #5984 · buddy #5985. **musicquiz (Apple Music MCP, OAuth2.1+SSE) — session DOWN, survey pending** (the only OAuth2.1+SSE consumer; dns-mcp's OAuth2.1-PKCE is documented below as a stand-in until musicquiz answers). Each repo asked: transports + SDK class/import-path, auth model, tool-registration boilerplate, session/state lifecycle, what a shared toolkit should own vs what stays app-specific, SDK version + stack. The synthesis refines the architecture + decomposes the additional stories below.

## Motivation
Every repo that ships an MCP surface rebuilds the same skeleton: server instantiation (@modelcontextprotocol/sdk), transport wiring, auth, scope-gated tool registration, audit hook, session lifecycle. Known servers: cms-mcp-server, cardmem, dns-mcp, buddy-channel, trail, Apple Music MCP — plus vn-leker + xrt81 coming. One battle-tested toolkit replaces N divergent re-rolls (the reuse-first thesis).

## Solution — hybrid
Engine (transports, auth, tool-registration loop, audit, session lifecycle, scaffold) ships as a runtime package; tool DEFINITIONS stay copy-owned/scaffold-generated per app (domain-specific). The breadth (multi-transport, multi-auth) is delivered by COMPOSITION — separate composable factories/providers, never one polymorphic god-object behind a config maze.

## Scope

### In scope (broadened)
- **Transports:** createStdioMcpServer (+ subagent guard) · createHttpMcpHandler (WebStandard Streamable-HTTP, per-session registry + TTL) · **createSseMcpHandler (SSE)**.
- **Auth (all three, composable):** validateBearerKey + hasScope (static, timing-safe) · **hashed 3-tier resolver** (cardmem pa_<hex> → session → local bootstrap) · **OAuth 2.1 PKCE provider** (dns-mcp SimpleOAuthProvider, stateless HMAC — a public MCP server gets OAuth free).
- **Ergonomics:** defineTools (Zod→JSON-schema) · withAudit · scaffoldMcpJson + Hono/Next adapters. Optional high-level McpServer(.tool()) path alongside the low-level Server path (trail uses McpServer).

### Out of scope
- Domain tool definitions (copy-owned per app).
- WebSocket transport — unless the Q&R surfaces a real consumer (don't speculate).

## Architecture

### Sources (reference implementations)
- **cms** `packages/cms-mcp-server` — createAdminMcpServer factory + timing-safe auth.ts + TOOL_SCOPES (the seed; only one already a discrete npm pkg).
- **cardmem** `apps/server/src/{mcp,auth-mcp-key}` + `packages/mcp-tools` — busiest HTTP server: WebStandard Streamable-HTTP + per-session registry + lifecycle; 3-tier auth; registerTools(server,deps) modular pattern.
- **buddy** `packages/channel` + `apps/server/.../mcp-server.ts` — only dual stdio+HTTP; the prod-hardened subagent guard (ps-based `claude -p` detection); globalThis session persistence across bun --hot.
- **dns-mcp** `src/{server,transports/http,auth/provider}` — full OAuth 2.1 PKCE (mcpAuthRouter), stateless HMAC tokens (no DB).
- **trail** `apps/mcp` — smallest stdio-only; uses the high-level McpServer(.tool()) path.
- **musicquiz / Apple Music MCP** — OAuth 2.1 + SSE, 33 tools (survey pending; the only OAuth2.1+SSE consumer).

### Headless core (no React/next/Hono)
createStdioMcpServer · createHttpMcpHandler · **createSseMcpHandler** · validateBearerKey · hasScope · **resolve3TierAuth** · **createOAuthProvider** (PKCE) · defineTools (Zod→JSON-schema) · withAudit · scaffoldMcpJson.
Adapters: Hono `mountMcpRoute(app, handler)`; Next `{ GET, POST }`. Separate entry points (Hono adapter never pulls Next types, and vice versa).

## Stories
Existing (keep): F007.1 auth helpers · F007.2 createStdioMcpServer + subagent guard · F007.3 defineTools · F007.4 createHttpMcpHandler (WebStandard) · F007.5 withAudit + Hono/Next adapters · F007.6 scaffoldMcpJson CLI.
**To decompose after Q&R synthesis (the broadened surface):** OAuth 2.1 PKCE provider · SSE transport factory · hashed 3-tier auth resolver · optional McpServer(.tool()) high-level path. Carded once the Q&R locks the exact shapes — don't freeze prematurely.

## Acceptance criteria (epic)
1. @broberg/mcp builds + typechecks clean; core imports no React/next/Hono.
2. Covers stdio + Streamable-HTTP + SSE, AND static + 3-tier + OAuth2.1 auth — each composable, no config maze.
3. A NEW MCP server (vn-leker or xrt81) is built ON it from scratch, runtime-verified.
4. ≥2 existing servers (cms + cardmem/buddy) migrate off inline wiring with no regression (runtime-verified).
5. Cross-repo Q&R synthesized + reflected in the final API.

## Dependencies
F010 (API-key + rate-limit, related). External: @modelcontextprotocol/sdk, zod, zod-to-json-schema.

## Rollout
1) Cross-repo Q&R (in flight) → synthesis. 2) Decompose the broadened stories (OAuth/SSE/3-tier). 3) Build the engine: transports first (stdio + HTTP + SSE), then auth (static → 3-tier → OAuth), then ergonomics + adapters + scaffold. 4) Pilot on a NEW build (vn-leker or xrt81) AND migrate one existing (cms). 5) Adopt across cardmem/buddy/trail; musicquiz adopts the OAuth2.1+SSE path.

## Open questions (pending Q&R)
- musicquiz session down — need its OAuth2.1+SSE specifics (SSE transport class, token-refresh lifecycle) before locking the SSE+OAuth path.
- Is standalone SSE still worth a first-class factory, or is everyone except Apple Music on Streamable-HTTP? (MCP deprecated standalone SSE in favour of Streamable-HTTP — confirm Apple Music can't move.)
- 3-tier hashed auth: in-package generic, or too tied to cardmem's Drizzle schema? (cardmem Q&R answers this.)
- High-level McpServer(.tool()) path alongside low-level Server — both, or pick one? (trail Q&R answers this.)

## Risks
Three auth patterns + three transports = the breadth Christian wants; the hard part is keeping it COMPOSABLE (separate exports) not a config maze. SDK version skew (1.11–1.12) — pin a minimum + document the WebStandardStreamableHTTPServerTransport + SSE export paths (they moved between minors). HTTP/SSE session registries leak on unclean disconnect — TTL eviction mandatory.

## Effort
**L** (re-scoped from M — broadened surface). Owner: components.
