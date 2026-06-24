# @broberg/mcp

Genuinely-reusable MCP-server toolkit for the broberg.ai fleet. **Not slim** — it
covers the whole estate's real MCP surface by composition, so a new server starts
fresh on it (not only a strangler-migration of an existing one). It owns the
plumbing — transports, auth, the tool-dispatch loop, audit — and never your domain
tools.

Designed from a code-anchored cross-repo survey of every MCP-owning repo
(cardmem · cms · musicquiz · trail · buddy). Plan: `docs/features/F007-mcp-toolkit.md`.

```bash
npm i @broberg/mcp @modelcontextprotocol/sdk zod
# for the OAuth sub-entry only:  npm i express jose
```

- **Transports** *(separate composable factories)*: `createStdioMcpServer` · `createHttpMcpHandler` (Streamable-HTTP, **stateless** per-request) · `createSseMcpHandler` (Node SSE) · `createWebSseMcpHandler` (Web-Streams SSE for Next App Router / Bun / Deno). SSE is session-stateful with a **TTL-swept registry** (no leak); Streamable-HTTP needs no session state at all.
- **Auth** *(composable, all resolve to one `Principal`)*: `validateBearerKey` + `hasScope` (static, timing-safe) · `resolve3TierAuth` (API-key → session → bootstrap cascade, host callbacks) · `@broberg/mcp/oauth` (OAuth 2.1 PKCE via the SDK's `mcpAuthRouter`).
- **One typed `defineTool` registry** drives BOTH the low-level `Server` and the high-level `McpServer` from a single definition — with a `kind` write-guard, optional per-tool `scopes` (AND), a uniform `{ content, isError }` envelope, arg-validation, and an audit hook. Kills the per-repo switch / JSON-schema / coercion boilerplate.

> **zod is a peer dependency, pinned to `^3`.** better-auth pulls zod4 while the
> MCP SDK peers zod3; two SDK copies → incompatible `Server<>` types → `as any`.
> Locking a single zod major here is the fix — dedupe zod3 in your consumer.

## Define tools once

```ts
import { defineTool } from "@broberg/mcp";
import { z } from "zod";

export const tools = [
  defineTool({
    name: "get_user",
    description: "Fetch a user by id",
    kind: "read",
    inputSchema: { id: z.string() },                  // raw Zod shape, not z.object(...)
    handler: async ({ id }, { ctx }) => JSON.stringify(await ctx.db.user(id)),
  }),
  defineTool({
    name: "delete_user",
    description: "Delete a user",
    kind: "write",                                    // a read-only principal is refused
    scopes: ["users:write"],                          // AND scope-gate
    inputSchema: { id: z.string() },
    handler: async ({ id }, { ctx }) => { await ctx.db.del(id); return "deleted"; },
  }),
];
```

The same `tools` array feeds every transport below. Dispatch is pure and shared:
*find → write-guard → scope-gate → validate → handle → envelope → audit.*

## Pick a transport

**stdio** (trail / buddy shape — `.mcp.json` subprocess):

```ts
import { createStdioMcpServer } from "@broberg/mcp";
const { start } = createStdioMcpServer({
  name: "my-mcp", version: "1.0.0", tools,
  getContext: () => ({ principal: {}, ctx: { db } }),  // env-injected, resolved once
  guardSubagents: true,                                // opt-in: exit under `claude -p` / fork
  onShutdown: () => db.checkpoint(),                   // WAL-safe SIGTERM
});
await start();
```

**Streamable-HTTP** (cardmem shape — stateless, leak-free, multi-replica-safe).
The handler already IS a Web route handler:

```ts
import { createHttpMcpHandler } from "@broberg/mcp";
const handler = createHttpMcpHandler({ name: "my-mcp", version: "1.0.0", tools, authenticate });
// Next App Router:  export const POST = handler;
// Hono / Bun:       app.all("/mcp", (c) => handler(c.req.raw));
```

**SSE** (session-stateful, TTL-swept). Stack A (Web-Streams) and Node:

```ts
import { createWebSseMcpHandler, toSseRoutes } from "@broberg/mcp";
const mcp = createWebSseMcpHandler({ name: "my-mcp", version: "1.0.0", tools, authenticate });
export const { GET, POST } = toSseRoutes(mcp);          // Next App Router route.ts

// Express (Node):
import { createSseMcpHandler, mountNodeSse } from "@broberg/mcp";
mountNodeSse(app, createSseMcpHandler({ name: "my-mcp", version: "1.0.0", tools }));
```

## Pick an auth model

`authenticate(req)` resolves a `ToolContext` ({ principal, ctx }); throw to 401.

```ts
// 1 — static Bearer + scopes
import { validateBearerKey } from "@broberg/mcp";
const authenticate = (req: Request) => {
  const r = validateBearerKey(req.headers.get("authorization"), KEYS);
  if (!r.authenticated) throw new Error(r.error);
  return { principal: { scopes: r.scopes }, ctx: { db } };
};

// 2 — hashed 3-tier cascade (host supplies each lookup; e.g. @broberg/apikey hashKey)
import { resolve3TierAuth } from "@broberg/mcp";
const authenticate = resolve3TierAuth<Request>({
  apiKeyPrefix: "pa_",
  apiKey: async (tok) => lookupHashedKey(hashKey(tok)),   // → Principal | null
  session: async (req) => sessionFromCookie(req),         // → Principal | null
});
```

```ts
// 3 — OAuth 2.1 PKCE  (sub-entry; needs express + jose)
import { createOAuthProvider, mountOAuthRouter, bearerAuth, createInMemoryClientStore } from "@broberg/mcp/oauth";
const provider = createOAuthProvider({
  secret: process.env.OAUTH_SECRET!,                      // openssl rand -hex 32
  issuer: "https://mcp.example",
  clients: createInMemoryClientStore(),                   // DCR; back with shared storage for multi-replica
});
mountOAuthRouter(app, { provider, issuerUrl: "https://mcp.example" });
app.post("/mcp", bearerAuth(provider, ["read"]), mcpRoute);
```

The SDK ships the endpoints (`/authorize`, `/token`, `/register`, `/revoke`,
`/.well-known/*`) and does the PKCE S256 compare; this provider issues stateless
HS256 tokens (auth-code / access / refresh) so there's no token database.

## Audit

```ts
import { createJsonlAudit } from "@broberg/mcp";
const audit = createJsonlAudit("/var/log/mcp-audit.jsonl");   // pass to any transport — one line per call
```

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
