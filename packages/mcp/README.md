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

> **Peers you must install yourself.** `@modelcontextprotocol/sdk` (`>=1.12`) is a
> **required** peer and is *not* installed automatically — a missing one shows up
> only when the server fails to boot. `express` + `jose` are optional (OAuth only).

> **zod `^3 || ^4` (since 0.5.0).** Both majors work: on zod 4 the toolkit uses
> zod's own `z.toJSONSchema()` (draft-2020-12, what MCP wants); on zod 3 it uses
> `zod-to-json-schema`. Still **dedupe to a single zod major** in your consumer —
> better-auth pulls zod4 while older MCP SDKs peer zod3, and two SDK copies give
> incompatible `Server<>` types. If a shape ever fails to convert, the toolkit
> now **throws `EmptyInputSchemaError`** instead of quietly registering a tool
> with no declared inputs; `inputJsonSchema` on a tool def bypasses conversion
> entirely if you already hold a JSON Schema.

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

### Annotations: `readOnlyHint` follows `kind` (0.8.0, F007.15)

`tools/list` now sends MCP `annotations` on every tool. `readOnlyHint` is **derived from `kind`** (read, the default → `true`; write → `false`) and cannot be set by hand, so a write tool can never advertise itself as read-only to a client that trusts the hint (Scout attaches only `readOnlyHint === true` tools). Add the other hints yourself:

```ts
defineTool({ name: "delete_note", kind: "write", annotations: { destructiveHint: true, idempotentHint: true }, … })
```

Both registration paths (`registerTools` on a `Server`, `registerMcpServerTools` on an `McpServer`) send the same annotations.

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

Every transport factory also accepts **`instructions?: string`** (0.4.0+) —
server-level intro text ("what this server is + how to use it") passed straight
into the MCP `initialize` result, so the connecting client/model sees it on
connect, alongside the per-tool descriptions:

```ts
createHttpMcpHandler({
  name: "club", version: "1.0.0", tools, authenticate,
  instructions: "Read-only club MCP. Search, read, list — never writes.",
});
```

They also accept **`icons`** and **`websiteUrl`** (0.10.0, F007.17), sent in
`serverInfo` (MCP 2025-11-25) so a client can show your app's own icon:

```ts
createHttpMcpHandler({
  name: "jam", version: "1.0.0", tools,
  icons: [{ src: "https://jam.example/apple-touch-icon.png", mimeType: "image/png", sizes: ["180x180"] }],
  websiteUrl: "https://jam.example",
});
```

Without them `serverInfo` is exactly `{ name, version }`, as before. **Not
measured:** whether claude.ai shows `serverInfo.icons` or the favicon of the
registrable domain.

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
  approve: async (client, params) => isAllowed(client, params), // REQUIRED since 0.9.1 — `() => true` only if you mean it
});
mountOAuthRouter(app, { provider, issuerUrl: "https://mcp.example" });
app.post("/mcp", bearerAuth(provider, ["read"]), mcpRoute);
```

The SDK ships the endpoints (`/authorize`, `/token`, `/register`, `/revoke`,
`/.well-known/*`) and does the PKCE S256 compare; this provider issues stateless
HS256 tokens (auth-code / access / refresh) so there's no token database.

### SECURITY — 0.9.1: `approve` is required in `@broberg/mcp/oauth` (2026-W41 H1)

Up to 0.8.0 `createOAuthProvider` approved every authorization request when you did not pass
`approve` — anyone who asked got a code and a token with the scope they asked for, with no login.
Now it refuses to build without `approve`, and only an answer of exactly `true` approves. If
auto-approval is what you want (a first-party client behind something else), say so:
`approve: () => true`. `@broberg/mcp/oauth-web` was never affected — it has its own signed consent.

### SECURITY — 0.7.0 closes a one-click token theft in `oauth-web` (F007.14)

**Upgrade if you use `@broberg/mcp/oauth-web`.** Up to 0.6.0, `/register` took any
`redirect_uri` and `/authorize` issued a code the moment your `authorize`
callback returned `{ sub }`. Your callback reads a session cookie, and
`SameSite=Lax` sends it on a click — so a link with an attacker's own client and
redirect gave the attacker a token for a logged-in member who saw nothing. PKCE
does not help: the attacker owns the verifier. Measured at xrt81 (4 Oct 2026).

What 0.7.0 does, and what it changes for you:

- **Redirect allowlist.** `allowedRedirectHosts` (default `claude.ai`, `claude.com`,
  `chatgpt.com`, `chat.openai.com`; loopback always allowed; other hosts must be
  https), checked at `/register` **and** `/authorize` (clients registered before
  0.7.0 included). A connector on another host must be added.
- **Consent page.** When your callback approves, the member now sees which
  client, which redirect host and which scopes, and presses **Godkend / Allow**.
  The code is issued only on that POST, which carries a signed token bound to
  the member, client, redirect and PKCE challenge (5 minutes). The page cannot
  be framed. Change the language with `consentLang: "en"`, or render your own
  with `renderConsent` (keep every `fields` entry as a hidden input).
  **Your `authorize` callback is called on both the GET and the POST**; it
  already reads the session, so nothing changes there.
- **Single-use codes.** `/token` redeems a code once. The default memory store
  is right for one instance; with several replicas, pass `consumeCode(jti, expiresAt)`
  backed by your database.

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

**Claude's published identity (CIMD, 0.10.0, F007.16).** claude.ai's "Add custom
connector" now defaults to a `client_id` that is an https URL to a client
metadata document instead of registering (DCR). `oauth-web` fetches that
document — only from `allowedClientMetadataHosts` (default `claude.ai`,
`claude.com`; `[]` turns CIMD off), only over https, never following a
redirect, with a 5 s timeout and a 64 KB cap, cached `clientMetadataCacheMs`
(default 10 min) — requires `client_id` in the document to equal the URL, and
accepts only a `redirect_uri` that is in the document AND on
`allowedRedirectHosts`. The consent page is unchanged; DCR still works.
Refusals name their reason in `error_description`
(`client_metadata_host_not_allowed`, `client_metadata_fetch_failed`,
`client_metadata_mismatch`).

**Your own consent page with the signed-in member (0.10.0, F007.18).**
`renderConsent(info, { request, sub })` may be async: `sub` is exactly what your
`authorize` callback returned and `request` is the incoming /authorize request
(cookies, Accept-Language), so you can look the member up and use their
language. A one-argument synchronous `renderConsent(info)` keeps working. If it
throws, no page and no code are produced.

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
