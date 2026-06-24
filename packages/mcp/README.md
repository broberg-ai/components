# @broberg/mcp

Genuinely-reusable MCP-server toolkit for the broberg.ai fleet. **Not slim** — it
covers the whole estate's real MCP surface, by composition:

- **Transports** *(composable, separate exports)*: stdio · Streamable-HTTP
  (stateless per-request) · SSE (session-stateful + TTL). _(stdio/HTTP/SSE land
  across F007.2/.4/.10.)_
- **Auth** *(composable)*: static Bearer · hashed 3-tier → principal · OAuth 2.1
  PKCE (via the SDK's `mcpAuthRouter`). _(3-tier/OAuth land in F007.7/.8.)_
- **One typed `defineTool` registry** drives BOTH the low-level `Server` and the
  high-level `McpServer` paths from a single definition — with a `kind`
  write-guard, optional per-tool `scopes`, a uniform `{ content, isError }`
  envelope, and an audit hook. Kills the per-repo switch/JSON-schema/coercion
  boilerplate.

Design is driven by a code-anchored cross-repo Q&R of every MCP-owning repo
(cardmem · cms · musicquiz · trail · buddy). Plan: `docs/features/F007-mcp-toolkit.md`.

> **zod is a peer dependency, pinned to `^3`.** better-auth pulls zod4 while the
> MCP SDK peers zod3; two SDK copies → incompatible `Server<>` types → `as any`.
> Locking a single zod major here is the fix — dedupe zod3 in your consumer.

## Core (today)

```ts
import { defineTool, dispatchTool, validateBearerKey, hasScope } from "@broberg/mcp";
import { z } from "zod";

const tools = [
  defineTool({
    name: "get_user",
    description: "Fetch a user by id",
    kind: "read",
    inputSchema: { id: z.string() },                 // raw Zod shape, not z.object(...)
    handler: async ({ id }, { ctx }) => JSON.stringify(await ctx.db.user(id)),
  }),
  defineTool({
    name: "delete_user",
    description: "Delete a user",
    kind: "write",                                   // a read-only principal is refused
    scopes: ["users:write"],                         // AND scope-gate
    inputSchema: { id: z.string() },
    handler: async ({ id }, { ctx }) => { await ctx.db.del(id); return "deleted"; },
  }),
];

// dispatchTool is pure: find → write-guard → scope-gate → validate → handle → envelope → audit.
const result = await dispatchTool(tools, "get_user", { id: "u_1" }, { principal, ctx });
```

Status: core (registry + dispatch + static auth + audit + opt-in subagent guard)
shipped; transports and advanced auth land per the F007 stories. Built + tested
with Bun and Node.

MIT · part of the [broberg.ai shared inventory](https://discovery.broberg.ai).
