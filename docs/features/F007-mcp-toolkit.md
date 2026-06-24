# F007 — MCP Server Toolkit (@broberg/mcp)

> L0 Rails · hybrid · effort **L** (re-scoped) · impact **high** · owner `components`. Status: **Active — re-scoped 2026-06-24; Q&R 3/5 in (cardmem · buddy · musicquiz), synthesis pass-1 folded.**
> Graduate-candidate: no — stays in `components`.

## Re-scope (2026-06-24, Christian) — NOT slim
The original plan (2026-06-08) deliberately started minimal: static-key auth only, OAuth 2.1 deferred, two transports. **Christian has overridden that.** This package must be GENUINELY reusable across the whole estate's MCP surface — **not slim for slimness' sake.** It must cover, by design:
- **All transports:** stdio · Streamable-HTTP (WebStandard) · SSE (legacy back-compat — see musicquiz finding) — WebSocket only if a real consumer needs it.
- **All auth models:** static Bearer · hashed DB-backed 3-tier (cardmem) · **OAuth 2.1 PKCE** (dns-mcp, Apple Music) — composable, never a config maze.
- **New consumers are first-class:** vn-leker (order-MCP, coming) + xrt81 (Christian building one) start FRESH on this — so the package must be good enough to *build a new MCP server on*, not only to strangler-migrate existing ones.

The design is **driven by a fresh cross-repo Q&R** so we capture ALL real scenarios before freezing the API — not a guess.

### Cross-repo Q&R (design input)
Sent 2026-06-24: cms #5982 · trail #5983 · cardmem #5984 · buddy #5985. **Done:** cardmem ✅ (+ a full code-anchored reference doc) · buddy ✅ · **musicquiz ✅ (surveyed by reading the source directly — session stayed down; Christian pointed cc at the repo).** **Pending:** cms ⏳ · trail ⏳ (sessions offline, queued). Each repo asked: transports + SDK class/import-path, auth model, tool-registration boilerplate, session/state lifecycle, toolkit-vs-app cut line, SDK version + stack.

> **Primary build reference:** cardmem committed a full code-anchored spec — `broberg-ai/cardmem` → `docs/reference/mcp-server-reference.md` (commit `7bae1c2`). Sections: §0 stateless headline · §1 transport · §2 3-tier auth→principal · §3 `defineTool`+`registerTools` dispatch · §4 `registerPrompts` (skills→prompts) · §5 toolkit-vs-app cut line · §6 zod3/zod4 gotcha. The engine is built against this.

### Q&R findings folded in (confirmed — pass-1)
**cardmem (busiest HTTP server) — corrects two stale assumptions in the old plan:**
- **STATELESS per-request is the prod reality, not per-session state.** Fresh `Server` + `WebStandardStreamableHTTPServerTransport` PER REQUEST in `router.all('/')` — **no session Map, no TTL, no globalThis** → leak-free + multi-replica-safe; all tool-state in the DB. **Decision: stateless-per-request is the toolkit DEFAULT; session-registry + TTL is explicit opt-in for resumable-session consumers.**
- **Auth = 3-tier `resolveMcpAuth` → principal** `{userId, orgId, readOnly, viaSession}`: Bearer `pa_<hex>` → hashed key lookup (via `@broberg/apikey`) · Better-Auth cookie · local bootstrap. Host provides the lookup callback → **not** Drizzle-coupled.
- **Authz = principal-flag × `tool.kind` write-guard** (NOT per-tool scopes) — but dns-mcp/Apple Music DO use per-tool scopes, so **the authz interface must support BOTH from day one**.
- **Tool reg:** `defineTool({name, kind:'read'|'write', description, inputSchema:Zod, handler:(input,ctx)})` → `ALL_TOOLS[]`; `registerTools` wires `ListTools`→`zodToJsonSchema` and `CallTool`→find + resolveCtx + write-guard + zod-parse + handler + `McpError` + audit. zod-to-json-schema `^3.23.5`. SDK `^1.0.4`. Transport import: `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`.
- **⚠ zod3/zod4 peer gotcha:** better-auth pulls **zod4**, MCP SDK peers **zod3** → two SDK copies → incompatible `Server<>` types → forces `server as any`. **The toolkit MUST lock a single zod major + document the peer.** (See Risks.)

**buddy — corrects the "dual-transport" assumption:**
- buddy's MCP is **stdio-ONLY** (its HTTP/SETI/SSE is a *separate app*, not an MCP transport). Real shared value = the **prod-hardened subagent/fork guard**, run at module top *before* registration: `ps -o command= -p ${process.ppid}` → exit 0 if parent matches `claude … -p` / `--fork-session`, or self-exit if orphaned (`ppid === 1`). SDK `^1.12.0`. stdio = local trust → no inbound auth.

**musicquiz / Apple Music MCP (read from source — the ONLY OAuth2.1+SSE consumer) — answers the OAuth+SSE shape AND simplifies it:**
- **The SDK already ships OAuth 2.1.** Uses the SDK's built-in `mcpAuthRouter` (auto-mounts `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/authorize`, `/token`, `/register`, `/revoke`) + `requireBearerAuth` middleware + the `OAuthServerProvider` interface (`@modelcontextprotocol/sdk/server/auth/provider.js`). So the toolkit's OAuth contribution is a **ready-made `OAuthServerProvider` implementation**, NOT a from-scratch OAuth server.
- **`AppleMusicOAuthProvider implements OAuthServerProvider`** — JWT-based (jsonwebtoken; survives restarts), PKCE via `challengeForAuthorizationCode`, `exchangeAuthorizationCode` (access 90d) + `exchangeRefreshToken` (refresh 30d), auto-approve `authorize` (personal server). Clients/codes in-memory Maps; tokens stateless via signed JWT. (dns-mcp does the same job with stateless HMAC tokens — both align to `OAuthServerProvider`.)
- **Scopes are coarse:** `scopesSupported: ["mcp:tools"]`; per-tool gating enforced through `requireBearerAuth`. Confirms the `scopes`-on-`defineTool` model is real but can be a single scope.
- **Transport: BOTH `SSEServerTransport` AND `StreamableHTTPServerTransport` are imported** (`/server/sse.js` + `/server/streamableHttp.js`) → **SSE is legacy back-compat, not the headline**; Apple Music already carries Streamable-HTTP. → **standalone SSE drops to a back-compat shim, not a first-class factory.**
- **Tool registration: high-level `McpServer` + `server.tool(name, desc, zodShape, handler)`** — SAME path trail uses. → **2+ consumers confirm the toolkit must offer the high-level McpServer(.tool()) path** alongside the low-level Server path.
- **Stack: Express 5** (not Hono), **SDK `^1.28.0`** (newest in the fleet), zod `^3.23.8`. → an **Express adapter** is warranted too (the SDK's `mcpAuthRouter`/`requireBearerAuth` are Express middleware).

### Design decisions locked from the Q&R
1. **Stateless-per-request = default transport mode.** Opt-in stateful (session registry + TTL) only for resumable-session consumers.
2. **Dual authz in the interface from day 1.** `defineTool` carries BOTH `kind:'read'|'write'` (principal write-guard, cardmem) AND optional `scopes: string[]` (per-tool OAuth-scope gate, dns-mcp/Apple Music). `resolveAuth` returns a principal both gates read.
3. **Lock a single zod major** across the toolkit + peers; document the better-auth/SDK zod conflict.
4. **OAuth = a provider, not a server.** Ship an `OAuthServerProvider` impl (JWT or HMAC, stateless tokens) + a `mountOAuthRouter` helper over the SDK's `mcpAuthRouter` — don't reinvent the OAuth endpoints the SDK already gives us.
5. **Offer the high-level McpServer(.tool()) path** (trail + musicquiz) alongside the low-level Server path. New builds (vn-leker/xrt81) likely prefer the ergonomic high-level path.
6. **SSE = back-compat shim only.** Streamable-HTTP is the modern default; SSE exists because Apple Music still advertises it, not because new builds need it.

## Motivation
Every repo that ships an MCP surface rebuilds the same skeleton: server instantiation (@modelcontextprotocol/sdk), transport wiring, auth, scope-gated tool registration, audit hook, session lifecycle. Known servers: cms-mcp-server, cardmem, dns-mcp, buddy-channel, trail, Apple Music MCP — plus vn-leker + xrt81 coming. One battle-tested toolkit replaces N divergent re-rolls (the reuse-first thesis).

## Solution — hybrid
Engine (transports, auth, tool-registration loop, audit, prompts-from-skills, optional session lifecycle, scaffold) ships as a runtime package; tool DEFINITIONS stay copy-owned/scaffold-generated per app (domain-specific). Breadth (multi-transport, multi-auth) is delivered by COMPOSITION — separate composable factories/providers, never one polymorphic god-object behind a config maze.

## Scope

### In scope (broadened)
- **Transports:** createStdioMcpServer (+ subagent guard) · createHttpMcpHandler (WebStandard Streamable-HTTP, **STATELESS per-request by default**; opt-in stateful+TTL) · createSseMcpHandler (**back-compat shim** — Apple Music; not the default).
- **Auth (composable):** validateBearerKey + hasScope (static, timing-safe) · **resolve3TierAuth** → principal (cardmem; host supplies the key-lookup callback) · **OAuth 2.1** = an `OAuthServerProvider` impl (JWT/HMAC, stateless tokens, PKCE) + `mountOAuthRouter` over the SDK's `mcpAuthRouter` (dns-mcp + Apple Music).
- **Authz:** `defineTool` carries `kind:'read'|'write'` (principal write-guard) AND optional `scopes` (per-tool gate via `requireBearerAuth`) — both models, one interface.
- **Ergonomics:** defineTools (Zod→JSON-schema) · **high-level McpServer(.tool()) path** (trail + musicquiz) alongside low-level Server · withAudit · registerPrompts (skills→prompts, `$ARGUMENTS`) · scaffoldMcpJson + Hono/Next/**Express** adapters.

### Out of scope
- Domain tool definitions (copy-owned per app).
- WebSocket transport — unless the Q&R surfaces a real consumer (don't speculate).

## Architecture

### Sources (reference implementations)
- **cms** `packages/cms-mcp-server` — createAdminMcpServer factory + timing-safe auth.ts + TOOL_SCOPES (the seed; only one already a discrete npm pkg). _(survey ⏳)_
- **cardmem** `apps/server/src/{mcp,auth-mcp-key}` + `packages/mcp-tools` — busiest HTTP server, **STATELESS per-request**; 3-tier `resolveMcpAuth`→principal; `defineTool({kind})` + write-guard; `registerTools(server,deps)` modular. SDK `^1.0.4`, zod-to-json-schema `^3.23.5`. **Reference doc `7bae1c2`.** _(survey ✅)_
- **buddy** `packages/channel` — **stdio-ONLY**; the prod-hardened **subagent/fork guard**. SDK `^1.12.0`. _(survey ✅)_
- **dns-mcp** `src/{server,transports/http,auth/provider}` — full OAuth 2.1 PKCE (mcpAuthRouter), stateless HMAC tokens (no DB). _(documented OAuth+scopes reference)_
- **trail** `apps/mcp` — smallest stdio-only; high-level McpServer(.tool()) path. _(survey ⏳)_
- **musicquiz / Apple Music MCP** `packages/mcp-server/src/index.ts` + `packages/quiz-engine/src/oauth.ts` — **OAuth 2.1 (SDK `mcpAuthRouter` + `OAuthServerProvider`, JWT/PKCE, access 90d/refresh 30d) · both SSE + Streamable-HTTP (SSE legacy) · high-level `McpServer.tool()` · Express 5 · SDK `^1.28.0` · 33 tools.** _(survey ✅ — read from source)_

### Headless core (no React/next/Hono)
createStdioMcpServer · createHttpMcpHandler · createSseMcpHandler (shim) · validateBearerKey · hasScope · **resolve3TierAuth** · **createOAuthProvider** (OAuthServerProvider impl: JWT/HMAC, PKCE) + **mountOAuthRouter** (over SDK mcpAuthRouter) · defineTools (Zod→JSON-schema, carries `kind` + optional `scopes`) · **registerMcpServerTools** (high-level McpServer path) · withAudit · registerPrompts · scaffoldMcpJson.
Adapters: Hono `mountMcpRoute(app, handler)`; Next `{ GET, POST }`; **Express** (musicquiz/dns-mcp — where the SDK's OAuth middleware lives). Separate entry points; no adapter pulls another stack's types.

## Stories
Existing (keep, F007.4 corrected to stateless-default): F007.1 auth helpers · F007.2 createStdioMcpServer + subagent guard · F007.3 defineTools · F007.4 createHttpMcpHandler (stateless default; opt-in stateful) · F007.5 withAudit + adapters · F007.6 scaffoldMcpJson CLI.
**To decompose once cms + trail land (shapes now mostly locked):** OAuth 2.1 provider (OAuthServerProvider impl + mountOAuthRouter) · SSE back-compat shim · 3-tier auth resolver (resolve3TierAuth → principal) · registerPrompts (skills→prompts) · high-level McpServer(.tool()) path · Express adapter.

## Acceptance criteria (epic)
1. @broberg/mcp builds + typechecks clean; core imports no React/next/Hono.
2. Covers stdio + Streamable-HTTP + SSE(shim), AND static + 3-tier + OAuth2.1 — each composable, no config maze.
3. Stateless-per-request is the default HTTP path; stateful+TTL is opt-in and leak-bounded.
4. `defineTool` enforces BOTH the principal write-guard (`kind`) and per-tool scopes — tests for each.
5. OAuth path mounts the SDK `mcpAuthRouter` via a shipped `OAuthServerProvider` impl (PKCE, refresh) — not a hand-rolled server.
6. Both the low-level Server and high-level McpServer(.tool()) registration paths work from the same defineTool defs.
7. A single zod major is locked; the better-auth/SDK zod conflict is documented; no stray `as any` from version skew in the toolkit itself.
8. A NEW MCP server (vn-leker or xrt81) is built ON it from scratch, runtime-verified.
9. ≥2 existing servers (cms + cardmem/buddy) migrate off inline wiring with no regression (runtime-verified).
10. Cross-repo Q&R synthesized + reflected in the final API.

## Dependencies
F010 (API-key + rate-limit, related) · **@broberg/apikey** (3-tier key hashing/lookup). External: @modelcontextprotocol/sdk (floor ≥1.12; document export-path moves up to 1.28), zod (single major, locked), zod-to-json-schema `^3.23.5`.

## Rollout
1) Q&R → synthesis (pass-1 done: cardmem+buddy+musicquiz folded; pass-2 on cms+trail). 2) Decompose the broadened stories (OAuth/SSE-shim/3-tier/prompts/McpServer-path/Express). 3) Build the engine: transports first (stdio + HTTP stateless + SSE-shim), then auth (static → 3-tier → OAuth-via-mcpAuthRouter), then ergonomics + adapters + scaffold. 4) Pilot on a NEW build (vn-leker or xrt81) AND migrate one existing (cms). 5) Adopt across cardmem/buddy/trail; musicquiz adopts the OAuth2.1 path.

## Open questions
- ~~SSE first-class or legacy?~~ **Resolved (musicquiz):** Apple Music carries BOTH SSE + Streamable-HTTP → SSE is a **back-compat shim**, not a headline factory. New builds use Streamable-HTTP.
- ~~High-level McpServer(.tool()) path — offer it?~~ **Resolved (trail + musicquiz both use it):** YES — offer it alongside the low-level Server path.
- ~~3-tier hashed auth: in-package or Drizzle-coupled?~~ **Resolved (cardmem):** generic — host supplies the key-lookup callback; hashing via @broberg/apikey.
- **(pending cms/trail)** Final tool-registration ergonomics: does the low-level Server path stay primary (cardmem) or does the high-level McpServer path become the recommended default for new builds?

## Risks
- **Composability vs config maze** — three auth patterns + three transports must stay SEPARATE composable exports, never one polymorphic god-interface. The hardest design call.
- **⚠ zod3/zod4 peer conflict** — better-auth pulls zod4, MCP SDK peers zod3 → duplicate SDK copies → incompatible `Server<>` types forcing `as any`. **Mitigation: lock a single zod major in peerDeps + document so consumers dedupe.** The single most likely build-time footgun.
- **SDK version spread is wide (1.0.4 cardmem ↔ 1.12 buddy ↔ 1.28 musicquiz)** — pin a floor (≥1.12) + document the `WebStandardStreamableHTTPServerTransport` / SSE / auth export paths (they moved between minors).
- **Session-leak** — eliminated on the default path by stateless-per-request. Only the opt-in stateful mode carries the Map-leak risk → TTL eviction mandatory there.

## Effort
**L** (re-scoped from M — broadened surface). Owner: components.
