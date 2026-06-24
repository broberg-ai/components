# F007 — MCP Server Toolkit (@broberg/mcp)

> L0 Rails · hybrid · effort **L** (re-scoped) · impact **high** · owner `components`. Status: **Active — re-scoped 2026-06-24; cross-repo Q&R in flight (2/5 in, synthesis pass-1 folded).**
> Graduate-candidate: no — stays in `components`.

## Re-scope (2026-06-24, Christian) — NOT slim
The original plan (2026-06-08) deliberately started minimal: static-key auth only, OAuth 2.1 deferred, two transports. **Christian has overridden that.** This package must be GENUINELY reusable across the whole estate's MCP surface — **not slim for slimness' sake.** It must cover, by design:
- **All transports:** stdio · Streamable-HTTP (WebStandard) · **SSE** (Apple Music MCP) — honest about WebSocket only if a real consumer needs it.
- **All auth models:** static Bearer · hashed DB-backed 3-tier (cardmem) · **OAuth 2.1 PKCE** (dns-mcp, Apple Music) — composable, never a config maze.
- **New consumers are first-class:** vn-leker (order-MCP, coming) + xrt81 (Christian building one) start FRESH on this — so the package must be good enough to *build a new MCP server on*, not only to strangler-migrate existing ones.

The design is **driven by a fresh cross-repo Q&R** so we capture ALL real scenarios before freezing the API — not a guess.

### Cross-repo Q&R (design input)
Sent 2026-06-24: cms #5982 · trail #5983 · cardmem #5984 · buddy #5985. **Replied:** cardmem ✅ (+ a full code-anchored reference doc) · buddy ✅. **Pending:** cms ⏳ · trail ⏳ (sessions offline, queued) · **musicquiz** 🔴 (Apple Music MCP, OAuth2.1+SSE — session DOWN; the only OAuth2.1+SSE consumer; dns-mcp's OAuth2.1-PKCE is the documented stand-in until it answers). Each repo asked: transports + SDK class/import-path, auth model, tool-registration boilerplate, session/state lifecycle, toolkit-vs-app cut line, SDK version + stack.

> **Primary build reference:** cardmem committed a full code-anchored spec — `broberg-ai/cardmem` → `docs/reference/mcp-server-reference.md` (commit `7bae1c2`). Sections: §0 stateless headline · §1 transport · §2 3-tier auth→principal · §3 `defineTool`+`registerTools` dispatch · §4 `registerPrompts` (skills→prompts) · §5 toolkit-vs-app cut line · §6 zod3/zod4 gotcha. The engine is built against this.

### Q&R findings folded in (confirmed — pass-1)
**cardmem (busiest HTTP server) — corrects two stale assumptions in the old plan:**
- **STATELESS per-request is the prod reality, not per-session state.** A fresh `Server` + `WebStandardStreamableHTTPServerTransport` is created PER REQUEST in `router.all('/')` — **no session Map, no TTL, no globalThis** → leak-free + multi-replica-safe; all tool-state lives in the DB. The old plan's "per-session registry + TTL" was stale. **Decision: stateless-per-request is the toolkit DEFAULT; session-registry + TTL is an explicit opt-in mode for the rare consumer with genuinely resumable sessions.**
- **Auth = 3-tier `resolveMcpAuth` → principal** `{userId, orgId, readOnly, viaSession}`: Bearer `pa_<hex>` → hashed key lookup (via `@broberg/apikey`) · Better-Auth cookie · local bootstrap. The host provides the lookup callback, so it is **not** tied to cardmem's Drizzle schema.
- **Authz = principal-flag × `tool.kind` write-guard** (`readOnly` principal can't call a `kind:'write'` tool) — NOT per-tool OAuth scopes. But dns-mcp/Apple Music DO use per-tool scopes, so **the authz interface must support BOTH from day one** (see decision below).
- **Tool reg:** `defineTool({name, kind:'read'|'write', description, inputSchema:Zod, handler:(input,ctx)})` → `ALL_TOOLS[]`; `registerTools` wires `ListTools`→`zodToJsonSchema` and `CallTool`→find + resolveCtx + write-guard + zod-parse + handler + `McpError` + audit. zod-to-json-schema `^3.23.5`. SDK `^1.0.4`. Transport import: `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`.
- **⚠ zod3/zod4 peer gotcha (will bite every better-auth consumer):** better-auth pulls **zod4** while the MCP SDK peers **zod3** → two `@modelcontextprotocol/sdk` copies in `node_modules` → incompatible `Server<>` types → forces a `server as any` cast. **The toolkit MUST lock a single zod major + document the peer.** (See Risks.)

**buddy — corrects the "dual-transport" assumption:**
- buddy's MCP is **stdio-ONLY** (its HTTP/SETI/SSE surface is a *separate app*, not an MCP transport). The old plan's "dual stdio+HTTP + globalThis MCP-session-persistence" was wrong — the `globalThis` is a daemon double-start guard, not MCP state.
- Its real shared value = the **prod-hardened subagent/fork guard**, run at module top *before* registration: `ps -o command= -p ${process.ppid}` (identical macOS/Linux) → exit 0 if parent matches `claude … -p` or `--fork-session`, or self-exit if orphaned (`ppid === 1`). Prevents a headless subagent corrupting the parent's JSON-RPC stream / registry coin-flip. SDK `^1.12.0`. stdio = local trust → no inbound auth.

### Design decisions locked from the Q&R
1. **Stateless-per-request = default transport mode.** Opt-in stateful (session registry + TTL) only for resumable-session consumers. The default path is the leak-free one.
2. **Dual authz in the interface from day 1.** `defineTool` carries BOTH `kind:'read'|'write'` (→ principal write-guard, cardmem model) AND optional `scopes: string[]` (→ per-tool capability/OAuth-scope gate, dns-mcp/Apple Music model). `resolveAuth` returns a principal both gates read. No consumer is forced into the other's model; neither is bolted on later.
3. **Lock a single zod major** across the toolkit + peers; document the better-auth/SDK zod conflict prominently.

## Motivation
Every repo that ships an MCP surface rebuilds the same skeleton: server instantiation (@modelcontextprotocol/sdk), transport wiring, auth, scope-gated tool registration, audit hook, session lifecycle. Known servers: cms-mcp-server, cardmem, dns-mcp, buddy-channel, trail, Apple Music MCP — plus vn-leker + xrt81 coming. One battle-tested toolkit replaces N divergent re-rolls (the reuse-first thesis).

## Solution — hybrid
Engine (transports, auth, tool-registration loop, audit, prompts-from-skills, optional session lifecycle, scaffold) ships as a runtime package; tool DEFINITIONS stay copy-owned/scaffold-generated per app (domain-specific). The breadth (multi-transport, multi-auth) is delivered by COMPOSITION — separate composable factories/providers, never one polymorphic god-object behind a config maze.

## Scope

### In scope (broadened)
- **Transports:** createStdioMcpServer (+ subagent guard) · createHttpMcpHandler (WebStandard Streamable-HTTP, **STATELESS per-request by default**; opt-in stateful session registry + TTL for resumable-session consumers) · **createSseMcpHandler (SSE)**.
- **Auth (all three, composable):** validateBearerKey + hasScope (static, timing-safe) · **resolve3TierAuth** → principal (cardmem pa_<hex> → session → local bootstrap; host supplies the key-lookup callback) · **OAuth 2.1 PKCE provider** (dns-mcp SimpleOAuthProvider, stateless HMAC — a public MCP server gets OAuth free).
- **Authz:** `defineTool` carries `kind:'read'|'write'` (principal write-guard) AND optional `scopes` (per-tool capability/OAuth-scope gate) — both models supported by one interface.
- **Ergonomics:** defineTools (Zod→JSON-schema) · withAudit · registerPrompts (skills→prompts, `$ARGUMENTS`) · scaffoldMcpJson + Hono/Next adapters. Optional high-level McpServer(.tool()) path alongside the low-level Server path (trail uses McpServer — confirm in trail Q&R).

### Out of scope
- Domain tool definitions (copy-owned per app).
- WebSocket transport — unless the Q&R surfaces a real consumer (don't speculate).

## Architecture

### Sources (reference implementations)
- **cms** `packages/cms-mcp-server` — createAdminMcpServer factory + timing-safe auth.ts + TOOL_SCOPES (the seed; only one already a discrete npm pkg). _(survey ⏳)_
- **cardmem** `apps/server/src/{mcp,auth-mcp-key}` + `packages/mcp-tools` — busiest HTTP server, **STATELESS per-request** (fresh Server + WebStandard transport per request in `router.all('/')`; NO session Map/TTL/globalThis → leak-free, multi-replica-safe; all state in DB). 3-tier `resolveMcpAuth`→principal; `defineTool({kind})` + write-guard; `registerTools(server,deps)` modular. SDK `^1.0.4`, zod-to-json-schema `^3.23.5`. **Code-anchored reference doc committed (`7bae1c2`).** _(survey ✅)_
- **buddy** `packages/channel` — **stdio-ONLY** MCP; the prod-hardened **subagent/fork guard** (ps-based `claude -p` / `--fork-session` / orphan `ppid===1` detection → exit before registration). Its HTTP/SSE is a separate non-MCP app. SDK `^1.12.0`. _(survey ✅)_
- **dns-mcp** `src/{server,transports/http,auth/provider}` — full OAuth 2.1 PKCE (mcpAuthRouter), stateless HMAC tokens (no DB). _(documented stand-in for the OAuth+scopes model)_
- **trail** `apps/mcp` — smallest stdio-only; uses the high-level McpServer(.tool()) path. _(survey ⏳)_
- **musicquiz / Apple Music MCP** — OAuth 2.1 + SSE, 33 tools. _(survey 🔴 — session down; the only OAuth2.1+SSE consumer)_

### Headless core (no React/next/Hono)
createStdioMcpServer · createHttpMcpHandler · **createSseMcpHandler** · validateBearerKey · hasScope · **resolve3TierAuth** · **createOAuthProvider** (PKCE) · defineTools (Zod→JSON-schema, carries `kind` + optional `scopes`) · withAudit · **registerPrompts** (skills→prompts) · scaffoldMcpJson.
Adapters: Hono `mountMcpRoute(app, handler)`; Next `{ GET, POST }`. Separate entry points (Hono adapter never pulls Next types, and vice versa).

## Stories
Existing (keep, with F007.4 corrected to stateless-default): F007.1 auth helpers · F007.2 createStdioMcpServer + subagent guard · F007.3 defineTools · F007.4 createHttpMcpHandler (WebStandard, **stateless-per-request default**; opt-in stateful) · F007.5 withAudit + Hono/Next adapters · F007.6 scaffoldMcpJson CLI.
**To decompose once cms + trail + musicquiz land (don't freeze prematurely):** OAuth 2.1 PKCE provider · SSE transport factory · 3-tier auth resolver (resolve3TierAuth → principal) · registerPrompts (skills→prompts) · optional McpServer(.tool()) high-level path. _(OAuth provider + 3-tier resolver shapes are already locked by cardmem/dns-mcp; SSE + McpServer-path await musicquiz/trail.)_

## Acceptance criteria (epic)
1. @broberg/mcp builds + typechecks clean; core imports no React/next/Hono.
2. Covers stdio + Streamable-HTTP + SSE, AND static + 3-tier + OAuth2.1 auth — each composable, no config maze.
3. Stateless-per-request is the default HTTP path; stateful+TTL is opt-in and leak-bounded.
4. `defineTool` enforces BOTH the principal write-guard (`kind`) and per-tool scopes — proven by tests for each.
5. A single zod major is locked; the better-auth/SDK zod conflict is documented; no stray `as any` from version skew in the toolkit itself.
6. A NEW MCP server (vn-leker or xrt81) is built ON it from scratch, runtime-verified.
7. ≥2 existing servers (cms + cardmem/buddy) migrate off inline wiring with no regression (runtime-verified).
8. Cross-repo Q&R synthesized + reflected in the final API.

## Dependencies
F010 (API-key + rate-limit, related) · **@broberg/apikey** (3-tier key hashing/lookup). External: @modelcontextprotocol/sdk, zod (single major, locked), zod-to-json-schema `^3.23.5`.

## Rollout
1) Cross-repo Q&R → synthesis (pass-1 done: cardmem+buddy folded; pass-2 on cms+trail+musicquiz). 2) Decompose the broadened stories (OAuth/SSE/3-tier/prompts). 3) Build the engine: transports first (stdio + HTTP stateless + SSE), then auth (static → 3-tier → OAuth), then ergonomics + adapters + scaffold. 4) Pilot on a NEW build (vn-leker or xrt81) AND migrate one existing (cms). 5) Adopt across cardmem/buddy/trail; musicquiz adopts the OAuth2.1+SSE path.

## Open questions
- **(pending musicquiz)** SSE specifics — exact SSE transport class + token-refresh lifecycle — before locking the SSE+OAuth path.
- **(pending — confirm)** Is standalone SSE still worth a first-class factory, or is everyone except Apple Music on Streamable-HTTP? MCP deprecated standalone SSE in favour of Streamable-HTTP — confirm Apple Music can't move (if it can, SSE drops from scope).
- **(pending trail)** High-level McpServer(.tool()) path alongside low-level Server — both, or pick one?
- ~~3-tier hashed auth: in-package or too tied to cardmem's Drizzle?~~ **Resolved (cardmem):** generic — host supplies the key-lookup callback; hashing via @broberg/apikey. Not schema-coupled.

## Risks
- **Composability vs config maze** — three auth patterns + three transports must stay SEPARATE composable exports, never one polymorphic god-interface. The hardest design call.
- **⚠ zod3/zod4 peer conflict** — better-auth pulls zod4, MCP SDK peers zod3 → duplicate SDK copies → incompatible `Server<>` types forcing `as any`. **Mitigation: lock a single zod major in the toolkit's peerDeps + document the conflict in the README so consumers dedupe.** This is the single most likely build-time footgun.
- **SDK version skew (1.0.4 cardmem ↔ 1.12 buddy)** — pin a minimum + document the `WebStandardStreamableHTTPServerTransport` + SSE export paths (they moved between minors).
- **Session-leak** — eliminated on the default path by stateless-per-request. Only the opt-in stateful mode carries the Map-leak risk → TTL eviction is mandatory there.

## Effort
**L** (re-scoped from M — broadened surface). Owner: components.
