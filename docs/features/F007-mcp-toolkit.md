# F007 — MCP Server Toolkit

> L0 Rails · hybrid · effort **M** · impact **high** · owner `cms`. Status: Backlog.
> Graduate-candidate: no — stays in `components`.

## Motivation
A @broberg/mcp-toolkit encapsulating the repeating MCP-server scaffolding: server instantiation via @modelcontextprotocol/sdk, transport wiring (stdio + Streamable-HTTP), API-key + OAuth 2.1 auth helpers, scope-gated tool registration, and an audit-log hook. Every repo that ships an MCP surface (dns-mcp, cardmem, cms-mcp-server, trail, buddy-channel) rebuilds this skeleton from scratch. The toolkit extracts the stable, framework-agnostic plumbing so new MCP projects start from a battle-tested base.

## Solution
**hybrid.** Auth primitives, transport factory, and the tool-registration loop are ~identical across 5+ repos (cms-mcp-server/auth.ts, cardmem/auth-mcp-key.ts, dns-mcp/auth/provider.ts, buddy/channel) — those stable primitives qualify as runtime-package. The tool definitions (switch/case handlers + inputSchema objects) are 100% domain-specific (dns-mcp DNS/R2; cardmem 50+ PM tools; cms content CRUD) and stay copy-owned/scaffold-generated. Result: engine ships as a runtime package, tool definitions stay per project.

## Scope

### In scope
- Extract from `webhouse/cms` `packages/cms-mcp-server/src/{server,auth,tools,index}.ts`.
- Transport factories (stdio + WebStandard HTTP), validateBearerKey + hasScope, defineTools, withAudit, scaffoldMcpJson + Hono/Next adapters.

### Out of scope
- Domain tool definitions (copy-owned per app).
- OAuth 2.1 PKCE (dns-mcp) in v1 — evaluate later.
- DB-backed hashed-key auth (cardmem) if too coupled to its Drizzle schema.

## Architecture

### Best source (reference implementation)
`webhouse/cms` — `packages/cms-mcp-server/src/`: createAdminMcpServer() factory (cleanest engine/domain separation), auth.ts timing-safe validateApiKey + hasScope (<50 lines, no DB), writeAudit one-liner hook, TOOL_SCOPES map. The only source already shipped as a discrete npm package — closest analog to the toolkit.

### Other implementations seen (contract cross-check)
- `broberg/cardmem` `apps/server/src/{mcp,auth-mcp-key}.ts` + `packages/mcp-tools/src/index.ts` — registerTools(server,deps) with per-tool modules; 3-tier auth ladder (Bearer pa_<hex> → session → local bootstrap); WebStandard HTTP transport with per-session registry + lifecycle.
- `webhouse/dns-mcp` `src/{server,transports/http,auth/provider}.ts` — full OAuth 2.1 PKCE via mcpAuthRouter; stateless HMAC-signed tokens (no DB); cleanest registerXxxTools decomposition.
- `webhouse/buddy` `packages/channel/src/index.ts` + `apps/server/src/routes/mcp-server.ts` — stdio + HTTP in one repo; subagent guard (detect `claude -p` parent via ps, exit 0); globalThis session persistence across bun --hot.

### Headless core vs. adapters
- **Core (no React/next/Hono):** createStdioMcpServer(opts) (Server + StdioServerTransport + subagent guard); createHttpMcpHandler(opts) ((Request)=>Response via WebStandardStreamableHTTPServerTransport, per-session registry + lifecycle); validateBearerKey(header,keys[]) (timingSafeEqual), hasScope, resolveMcpAuth 3-tier; defineTools(defs) (Zod → JSON-schema via zod-to-json-schema); withAudit(handler,auditFn); scaffoldMcpJson(opts).
- **Stack B (Hono):** mountMcpRoute(app,handler) = app.all('/mcp', ...) (~20 lines, cardmem pattern). Hono types only.
- **Stack A (Next.js):** exports { GET, POST } wrapping createHttpMcpHandler for app/api/mcp/route.ts. No Hono dep.

### Public API
```ts
export function createStdioMcpServer(opts: StdioMcpOpts): StdioMcpServer
export function createHttpMcpHandler(opts: HttpMcpOpts): (req: Request) => Promise<Response>
export function defineTools<T extends ToolDef[]>(defs: T): ToolRegistry
export function validateBearerKey(authHeader: string|null, keys: ApiKeyConfig[]): AuthResult
export function hasScope(userScopes: string[], required: string[]): boolean
export function withAudit(handler: ToolHandler, audit: AuditFn): ToolHandler
export function scaffoldMcpJson(opts: McpJsonOpts): McpJson
```

## Stories
- **F007.1** — Extract + publish auth helpers — _AC:_ validateBearerKey + hasScope match cms auth.ts; timingSafeEqual from node:crypto; tests cover valid/wrong/missing/scope-match/mismatch; cms-mcp-server adopts + removes its local copy.
- **F007.2** — createStdioMcpServer with subagent guard — _AC:_ returns {start()} booting StdioServerTransport; guardSubagents:true checks ps for the `claude -p` pattern (buddy) + exit 0; trail/apps/mcp migrates, removing direct SDK wiring.
- **F007.3** — defineTools registry helper — _AC:_ array of {name,description,inputSchema(Zod),handler} → correct ListTools/CallTool handlers; Zod→JSON-schema via zod-to-json-schema; missing required arg returns isError:true with a Zod message, not a throw.
- **F007.4** — createHttpMcpHandler (WebStandard transport) — _AC:_ (Request)=>Response with per-session registry + onsessioninitialized/closed (cardmem pattern); mcp-session-id resumes the correct session; cardmem adopts + removes inline wiring.
- **F007.5** — withAudit + Hono/Next adapters — _AC:_ withAudit calls auditFn({tool,actor,result,error?}) fire-and-forget; mountMcpRoute(app,handler) for Hono; { GET, POST } for Next; neither adapter imports the other stack.
- **F007.6** — Scaffold generator scaffoldMcpJson — _AC:_ returns a .mcp.json object; `npx @broberg/mcp-toolkit scaffold` emits .mcp.json + a starter src/server.ts using createStdioMcpServer with one example tool; shape matches Claude Desktop + cc.

## Acceptance criteria
1. @broberg/mcp-toolkit builds + typechecks clean; core imports no React/next/Hono.
2. Each story (F007.1–F007.6) meets its own AC.
3. Piloted in cms (cms-mcp-server) and adopted back with no regression (runtime-verified).
4. A second consumer (trail or cardmem) migrates off its inline wiring with identical behaviour.

## Dependencies
- F010 — API-key + rate-limit helper (related).
- External: @modelcontextprotocol/sdk, zod, zod-to-json-schema.

## Rollout
Strangler: 1) extract auth.ts (validateBearerKey+hasScope) from cms-mcp-server, publish @0.1; 2) add createStdioMcpServer + subagent guard + defineTools, @0.2; 3) pilot back in cms-mcp-server + trail (smallest); 4) add createHttpMcpHandler (cardmem pattern), @0.3; 5) adopt in cardmem then buddy; 6) dns-mcp stays on OAuth 2.1 for now.

Graduate-candidate: no — stays in `components`.

## Open Questions
- DB-backed hashed-key auth (cardmem pa_<hex>, 3-tier) in the package, or too tied to @projects/db?
- Include SimpleOAuthProvider (dns-mcp stateless HMAC) so public MCP servers get OAuth 2.1 free, or too much surface for v1?
- Bake globalThis session-persistence-across-bun--hot into createHttpMcpHandler, or leave as a buddy-specific hack?
- Offer an McpServer-based (.tool()) path alongside the low-level Server path (trail uses McpServer)?

## Effort estimate
**M** — owner session: `cms`. Reuse model: hybrid.

## Risks
Three distinct auth patterns in the estate (static Bearer; hashed DB-backed 3-tier; full OAuth 2.1 PKCE) — covering all without a config maze is the hardest call; start static-key only. stdio vs WebStandard HTTP transports share no SDK interface — keep two separate exports. HTTP session registry leaks on unclean disconnect — implement TTL eviction. SDK version skew (1.11–1.12) — pin a minimum + document the WebStandardStreamableHTTPServerTransport export path (changed between minors).
