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

A handler returns a string (auto-wrapped as text) or a `ToolResult` whose
`content` is any MCP block — `text` · `image` · `audio` · `resource_link` ·
`resource`. So a tool can return media an MCP client (Claude/ChatGPT) renders
inline, not just a link:

```ts
import { imageResult } from "@broberg/mcp";
defineTool({
  name: "get_photo",
  description: "Return a photo inline",
  inputSchema: { id: z.string() },
  handler: async ({ id }, { ctx }) => imageResult(await ctx.photoBase64(id), "image/webp"),
});
```

> `ToolResult.content` is a typed union (0.3.0+); reading `.text` off a block now
> needs a narrow (`block.type === "text"`). Returning blocks is unaffected.

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

### claude.ai / ChatGPT remote connector on Stack B — `@broberg/mcp/oauth-web`

A remote MCP a user adds to **claude.ai (incl. iPhone) or ChatGPT** must speak
**OAuth 2.1 + Dynamic Client Registration** (a static key is rejected). The SDK's
OAuth router is Express-only; `@broberg/mcp/oauth-web` is the framework-free
equivalent that mounts in **Hono / Bun / Next** — and the `/authorize` step
delegates to *your* member login, so the token carries the **member's own id**
(`sub`), not a shared key. Needs `jose` (peer), no express.

```ts
import { createOAuthRoutes, createInMemoryClientStore } from "@broberg/mcp/oauth-web";
import { createHttpMcpHandler } from "@broberg/mcp";

const routes = createOAuthRoutes({
  secret: process.env.OAUTH_SECRET!,            // openssl rand -hex 32
  issuer: "https://club.example",               // your origin
  resource: "https://club.example/mcp",         // the MCP endpoint these tokens are for
  scopesSupported: ["club:read"],
  clients: createInMemoryClientStore(),         // DCR — back with your DB so claude.ai's client_id survives a redeploy
  authorize: (req, params) => {
    const member = memberFromSession(req);      // YOUR existing login (cookie / magic-link / Apple / Google)
    if (!member) return { response: Response.redirect(`/login?return=${encodeURIComponent(req.url)}`) };
    return { sub: member.id, scope: "club:read" };   // token now acts for THIS member
  },
});

const mcp = createHttpMcpHandler({
  name: "club", version: "1.0.0", tools,
  authenticate: async (req) => {
    const info = await routes.verifyBearer(req);                    // throws if no/invalid token
    return { principal: { userId: info.extra?.sub as string, scopes: info.scopes }, ctx: { db } };
  },
});

// Hono (Bun): OAuth routes first, then the gated /mcp endpoint.
app.use("*", async (c, next) => (await routes.handle(c.req.raw)) ?? next());
app.all("/mcp", async (c) => {
  try { await routes.verifyBearer(c.req.raw); } catch { return routes.challenge(); } // 401 + WWW-Authenticate bootstraps discovery
  return mcp(c.req.raw);
});
```

`routes.handle()` serves the two `.well-known` metadata docs + `/register` +
`/authorize` + `/token` + `/revoke`; `challenge()` is the 401 that points
claude.ai at the protected-resource metadata. The member id rides every token
(incl. refresh), so your read tools scope to `principal.userId`.

## Audit

```ts
import { createJsonlAudit } from "@broberg/mcp";
const audit = createJsonlAudit("/var/log/mcp-audit.jsonl");   // pass to any transport — one line per call
```

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
