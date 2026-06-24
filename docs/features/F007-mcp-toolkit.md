# F007 — MCP Server Toolkit (@broberg/mcp)

> L0 Rails · hybrid · effort **L** (re-scoped) · impact **high** · owner `components`. Status: **BUILD COMPLETE (2026-06-24) — all 11 stories shipped, 67/67 green, on `main`; epic stays open on the gated rollout (npm-publish + per-repo pilot swaps + a new-build runtime-verify, all Christian-gated).**
> Graduate-candidate: no — stays in `components`.

## Build status (2026-06-24) — package shipped
`packages/mcp/` is built, tested, committed, and pushed. Surface delivered:
- **Transports:** `createStdioMcpServer` (opt-in guard + WAL-safe SIGTERM) · `createHttpMcpHandler` (stateless Streamable-HTTP) · `createSseMcpHandler` (Node SSE) · `createWebSseMcpHandler` (Web-Streams SSE for Next App Router / Bun / Deno) + `SessionRegistry` (TTL sweep).
- **Auth:** `validateBearerKey`/`hasScope`/`parseBearer` · `resolve3TierAuth` (host-callback cascade) · `@broberg/mcp/oauth` (`createOAuthProvider` HS256/jose + PKCE + refresh, `mountOAuthRouter`, `bearerAuth`, `createInMemoryClientStore`).
- **Registry:** `defineTool` + pure `dispatchTool` (write-guard × scopes × envelope × audit) → both `registerTools` (low-level `Server`) and `registerMcpServerTools` (high-level `McpServer`).
- **Ergonomics:** `createJsonlAudit` · `guardSubagents` · `toSseRoutes`/`mountNodeSse` adapters · `definePrompt`/`registerPrompts` · `scaffoldMcpJson`/`starterServerSource` + `broberg-mcp` CLI bin · full README.
- **Decisions in build:** zod `^3` peer locked; express + jose are OPTIONAL peers (oauth only); core bundle verified free of express/jose; SDK installed 1.29.0 (`^1.12` floor). `withAudit` intentionally dropped — auditing is integrated into dispatch.

**Remaining (all Christian-gated, mostly out-of-repo):** npm-publish v0.1.0 · pilot swaps in trail (stdio/high-level) + cms (HTTP-SSE/static-Bearer, test-first byte-identical) in each repo's own session · runtime-verify a NEW build (vn-leker/xrt81) on it (AC #7/#8).

## Re-scope (2026-06-24, Christian) — NOT slim
The original plan (2026-06-08) started minimal: static-key only, OAuth deferred, two transports. **Christian overrode that — "ikke slim for slimheds skyld":** the package must cover the WHOLE estate's MCP surface so new builds (vn-leker order-MCP, xrt81) start FRESH on it — good enough to *build a new MCP server on*, not only to strangler-migrate existing ones. Breadth delivered by COMPOSITION (separate composable factories/providers), never one polymorphic god-object behind a config maze.

## Cross-repo Q&R — COMPLETE (5/5, code-anchored)
Surveyed every MCP-owning repo before freezing the API: **cardmem ✅ · buddy ✅ · musicquiz ✅ (read from source, session down) · trail ✅ · cms ✅.** dns-mcp serves as the documented OAuth2.1-PKCE cross-check.

> **Primary build reference:** cardmem's full code-anchored spec — `broberg-ai/cardmem` → `docs/reference/mcp-server-reference.md` (commit `7bae1c2`). §0 stateless · §1 transport · §2 3-tier auth→principal · §3 defineTool+registerTools · §4 registerPrompts · §5 toolkit-vs-app cut line · §6 zod3/zod4 gotcha.

### The estate's MCP surface, mapped (what the toolkit must cover)
| Repo | Transport | Reg style | Auth | State | SDK | Pilot |
|---|---|---|---|---|---|---|
| **cardmem** | Streamable-HTTP (WebStandard) | low-level `Server` + defineTool | hashed **3-tier→principal** + write-guard | **STATELESS/req** | ^1.0.4 | — |
| **cms** | HTTP/**SSE** (Web-Streams, Next) | low-level `Server` + raw switch (38 tools) | **static Bearer** + per-tool TOOL_SCOPES | stateless server; SSE session-Map (no TTL=gap) | ^1.27.1 | **yes** (auth boundary → Christian-gated) |
| **musicquiz** | **SSE + Streamable-HTTP** (Express) | high-level `McpServer.tool()` (33) | **OAuth 2.1** (SDK mcpAuthRouter, JWT/PKCE) | JWT-stateless | ^1.28.0 | — |
| **trail** | **stdio** | high-level `McpServer.tool()` (10) | none (env-injected ctx) | stateless | ^1.12.0 | **yes** (cleanest ref) |
| **buddy** | **stdio** + subagent guard | low-level `Server` | none (local trust) | n/a | ^1.12.0 | — |

### Key findings folded in
- **Transports = 4 shapes, and "stateless" is Streamable-HTTP-specific.** cardmem's stateless-per-request (fresh Server+transport per request, no Map/TTL → leak-free, multi-replica-safe) applies to **Streamable-HTTP**. **SSE is inherently session-stateful** (long-lived connection) and **needs a session registry + TTL-sweep** — cms's missing TTL is a real leak gap the toolkit closes. **Next App Router needs a Web-Streams SSE transport** (the SDK's `SSEServerTransport` assumes Node req/res → breaks in App Router); cms hand-rolled `NextSSETransport` (2-route: GET=SSE+`event: endpoint`, POST=`/message?sessionId=`) — "the most reusable nugget; all Stack-A re-rolls exactly this."
- **defineTool → TWO registration backends from ONE def.** Low-level `Server` (cardmem, cms) = emit `zodToJsonSchema` + manual ListTools/CallTool dispatch. High-level `McpServer.tool(name,desc,rawZodShape,handler)` (trail, musicquiz) = pass the raw Zod shape; the SDK converts internally (no zod-to-json-schema). **Neither path is forced down to the other.** cms (raw switch + hand-written JSON Schema over 38 tools + manual coercion/audit/envelope) is the strongest validation of the typed registry.
- **Auth = 4 models, all resolve to a principal/context two gates read** (`kind` write-guard × optional per-tool `scopes`):
  - **static Bearer + per-tool scopes (cms, the seed):** `validateApiKey(authHeader, keys: ApiKeyConfig[]) → {authenticated:true,label,scopes} | {authenticated:false,error}` (node:crypto `timingSafeEqual`, length-check first); `hasScope(userScopes, required) = required.every(r => userScopes.includes(r))` (AND); `TOOL_SCOPES[tool]: string[]` checked in CallTool; a **token→tenant hook** (`resolveApiKeyToSite→{orgId,siteId,scopes}`) the host supplies.
  - **hashed 3-tier → principal (cardmem):** Bearer `pa_<hex>` (hashed lookup via `@broberg/apikey`) → Better-Auth cookie → local bootstrap; `{userId,orgId,readOnly,viaSession}`. Host supplies the lookup callback → not schema-coupled.
  - **OAuth 2.1 PKCE (musicquiz, dns-mcp):** the SDK SHIPS it — `mcpAuthRouter` (auto-mounts `/.well-known/*`, `/authorize`, `/token`, `/register`, `/revoke`) + `requireBearerAuth` + the `OAuthServerProvider` interface. Toolkit contributes a **ready-made `OAuthServerProvider` impl** (JWT or HMAC, stateless tokens, PKCE `challengeForAuthorizationCode`, `exchangeRefreshToken`), NOT a from-scratch OAuth server.
  - **stdio = no inbound auth (trail, buddy):** trust boundary is process-spawn; trail injects context via ENV (`TRAIL_*`), resolved once (`requireContext`). The **env-injected resolve-once context** is a reusable pattern (the concrete key names stay app-side).
- **Subagent/fork guard = OPT-IN** (`guardSubagents?: boolean`, default false). buddy needs it (prevents `claude -p` registry coin-flip: `ps -o command= -p $ppid` → exit on `claude … -p` / `--fork-session` / orphan `ppid===1`); trail explicitly does not but wants it available ("free security").
- **Uniform result+error envelope** (`{content:[{type:'text',text}], isError}`) — trail AND cms both hand-roll it → toolkit owns it (handler returns raw text/object, toolkit wraps + maps errors).
- **Audit (cms exact):** `writeAudit({timestamp, tool, actor, result:"success"|"error", documentRef?, error?})` → JSONL append, non-fatal try/catch. `withAudit` wrapper + this shape.
- **Prompts:** only cardmem exposes MCP prompts (skills→prompts, `$ARGUMENTS`); trail = tools-only (0 `server.prompt`). → `registerPrompts` is real but **single-consumer → lower priority**.
- **WAL-safe graceful shutdown** on SIGTERM (trail: libSQL checkpoint before parent kills the subprocess) — part of the stdio bootstrap.
- **Pluggable rate-limit** (cms: in-memory fixed-window 60/min + 5×export_all; single-machine only — multi-replica needs a shared store, same caveat as @broberg/apikey) — toolkit owns a pluggable interface.
- **zod3 is universal; the zod4 conflict is cardmem-only.** All five run zod3. Only cardmem hits the zod3/zod4 peer gotcha (better-auth transitively pulls zod4 → duplicate SDK copies → incompatible `Server<>` types → `server as any`). **Lock a single zod major (zod3) in the toolkit's peerDeps + document** — clean for everyone, fixes cardmem.

### Locked design decisions
1. **Stateless-per-request = default for Streamable-HTTP.** SSE is session-stateful → ships WITH a registry + mandatory TTL-sweep. stdio = one session/process.
2. **Dual authz in the interface from day 1:** `defineTool` carries `kind:'read'|'write'` (principal write-guard) AND optional `scopes: string[]` (per-tool gate). All four auth models resolve to a principal/context both gates read.
3. **One `defineTool` def, two registration backends** (low-level `Server` + high-level `McpServer`). Plus uniform result+error envelope + integrated audit + arg-validation — killing the per-repo boilerplate.
4. **OAuth = a provider, not a server** (ship `OAuthServerProvider` impl + `mountOAuthRouter` over the SDK's `mcpAuthRouter`).
5. **Subagent guard = opt-in.**
6. **Web-Streams SSE transport for Stack A** (Next App Router) + Node SSE (Express) + the session registry/TTL both need.
7. **Lock zod3 peer major; document the better-auth conflict.**
8. **Pilot-swap is per-repo, Christian-gated.** Design mandate is green (build against all five); the actual adopt-and-delete-local-code swap gates on Christian's direct go in each repo's own session (cms especially — it's a prod-auth boundary, test-first byte-identical + zero-regression before deleting auth.ts).

## Solution — hybrid
Engine (transports, auth, tool-registration loop, audit, prompts, optional session lifecycle, scaffold) ships as a runtime package; tool DEFINITIONS stay copy-owned/scaffold-generated per app.

### What the toolkit OWNS vs what stays per-app (union of all five cut-lines)
**Owns:** stdio bootstrap (McpServer/Server + StdioServerTransport + connect + WAL-safe SIGTERM shutdown) · opt-in subagent guard · Streamable-HTTP handler (stateless default) · SSE handler + session registry + TTL-sweep + Web-Streams `NextSSETransport` (Stack A) · `validateBearerKey`/`hasScope` (static, timing-safe) · `resolve3TierAuth`→principal · `createOAuthProvider` + `mountOAuthRouter` · token→tenant hook · env-injected resolve-once context helper · `defineTool` (kind+scopes, dual backend, uniform envelope, validate, audit) · `withAudit` (JSONL) · `registerPrompts` (lower-pri) · pluggable rate-limit · `scaffoldMcpJson` + Hono/Next/Express adapters.
**Does NOT own (stays per-app):** the domain tool implementations · data layers (@trail/db, ContentService) · domain services (AdminServices/AiGenerator, CmsConfig) · tenant-resolution logic (wh_→site/F134, the concrete `TRAIL_*` env names) · queue/policy (@trail/core candidate-queue/auto-approval) · connector-stamping.

## Scope
### In scope
- **Transports:** createStdioMcpServer (+ opt-in guard, WAL-safe shutdown) · createHttpMcpHandler (Streamable-HTTP, STATELESS default; opt-in stateful) · createSseMcpHandler (**session-stateful + TTL**, Node + Web-Streams/Next variants).
- **Auth (composable):** validateBearerKey + hasScope · resolve3TierAuth→principal · createOAuthProvider + mountOAuthRouter (over SDK mcpAuthRouter) · env-injected context helper.
- **Authz:** defineTool `kind` (write-guard) + optional `scopes` (per-tool gate).
- **Ergonomics:** defineTool (dual backend, uniform `{content,isError}` envelope, integrated validate + audit) · withAudit (JSONL) · registerPrompts · pluggable rate-limit · scaffoldMcpJson + Hono/Next/Express adapters.
### Out of scope
- Domain tool definitions (copy-owned). · WebSocket transport (no real consumer).

## Stories
**Existing (revise during decomposition):** F007.1 auth helpers (static Bearer — exact cms sigs) · F007.2 createStdioMcpServer (+ **opt-in** guard + WAL-safe shutdown) · F007.3 defineTool (broaden: kind+scopes, **dual backend**, uniform envelope, audit) · F007.4 createHttpMcpHandler (stateless default) · F007.5 withAudit + Hono/Next/**Express** adapters · F007.6 scaffoldMcpJson CLI.
**New (decompose now — Q&R complete):**
- **F007.7** — resolve3TierAuth → principal (hashed 3-tier; host-supplied lookup; @broberg/apikey). _cardmem ref._
- **F007.8** — OAuth 2.1: createOAuthProvider (OAuthServerProvider impl, JWT/HMAC, PKCE, refresh) + mountOAuthRouter over SDK mcpAuthRouter. _musicquiz/dns-mcp ref._
- **F007.9** — high-level McpServer(.tool()) registration backend (same defineTool def → SDK-internal zod→json). _trail/musicquiz ref._
- **F007.10** — SSE transport family: session registry + TTL-sweep + Web-Streams NextSSETransport (Stack A) + Node SSE. _cms/musicquiz ref._
- **F007.11** — registerPrompts (skills→prompts, `$ARGUMENTS`) — lower priority (cardmem-only). _cardmem ref._

## Acceptance criteria (epic)
1. Builds + typechecks clean; core imports no React/next/Hono.
2. Covers stdio + Streamable-HTTP + SSE, AND static + 3-tier + OAuth2.1 — each composable, no config maze.
3. Streamable-HTTP default is stateless; SSE ships a TTL-bounded registry (no leak).
4. defineTool enforces BOTH `kind` write-guard and per-tool `scopes`; works on BOTH the low-level Server and high-level McpServer backends from one def — tests for each.
5. OAuth mounts the SDK `mcpAuthRouter` via a shipped `OAuthServerProvider` impl (PKCE, refresh) — not hand-rolled endpoints.
6. zod3 peer locked; better-auth conflict documented; no `as any` from version skew in the toolkit itself.
7. A NEW MCP server (vn-leker or xrt81) is built ON it from scratch, runtime-verified.
8. ≥2 existing servers migrate off inline wiring with zero regression (runtime-verified) — pilots trail (stdio/high-level) + cms (HTTP-SSE/static-Bearer), each on Christian's per-repo go.

## Dependencies
F010 (API-key + rate-limit, related) · **@broberg/apikey** (3-tier hashing/lookup; rate-limit store). External: @modelcontextprotocol/sdk (floor ≥1.12; document the WebStandard/SSE/auth export-path moves across 1.0.4→1.28), zod3 (locked), zod-to-json-schema `^3.23.5`.

## Rollout
1) Q&R → synthesis ✅ (all 5 folded). 2) Decompose F007.7–F007.11 (now). 3) Build: transports (stdio + HTTP-stateless + SSE-TTL) → auth (static → 3-tier → OAuth-via-mcpAuthRouter) → ergonomics (defineTool dual-backend, withAudit, envelope) → adapters + scaffold. 4) Pilot on a NEW build (vn-leker/xrt81) AND a Christian-gated swap of trail (cleanest) then cms (test-first, byte-identical). 5) Adopt across cardmem/buddy/musicquiz.

## Open questions (mostly resolved)
- ~~SSE first-class or legacy?~~ **Both:** SSE is needed (cms Next App Router + musicquiz cookieless clients) AND session-stateful → it's a first-class *stateful* transport with TTL, not a Streamable-HTTP twin.
- ~~High-level McpServer path?~~ **Yes** (trail + musicquiz). ~~3-tier Drizzle-coupled?~~ **No** (host callback). ~~guard default?~~ **Opt-in.**
- **(minor)** registerPrompts priority — single consumer (cardmem); ship but late.
- **(build-time)** SDK floor: cardmem's ^1.0.4 is the low outlier vs 1.12–1.28 — confirm a floor that carries WebStandard + SSE + auth exports (likely ≥1.12; cardmem may bump on adopt).

## Risks
- **Composability vs config maze** — 3 auth × 4 transport shapes must stay SEPARATE composable exports. The hardest design call.
- **⚠ zod3/zod4 peer conflict (cardmem)** — lock zod3 peerDep + document so better-auth consumers dedupe. Most likely build-time footgun.
- **SDK version spread (1.0.4 ↔ 1.28)** — pin a floor + document export-path moves.
- **SSE session-leak** — mandatory TTL-sweep (cms's current gap); the Streamable-HTTP default sidesteps it entirely.
- **Pilot is a prod-auth boundary (cms)** — never swap on a peer request; Christian-gated, test-first, byte-identical before deleting auth.ts.

## Effort
**L** (re-scoped from M — broadened surface). Owner: components.
