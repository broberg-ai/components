# @broberg/local-guard

One guard for a **local HTTP daemon on 127.0.0.1**. Two rules, no token, because a browser cannot break either:

| rule | refused with | closes |
|---|---|---|
| `Host` must be `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` | **421** | DNS rebinding — a rebound page sends its *own* name |
| a write (POST/PUT/PATCH/DELETE) must be `application/json` | **415** | cross-site "simple" POSTs — a form cannot send JSON without a CORS preflight |

curl, MCP clients and agents already send both, so nothing legitimate changes. A **body-less DELETE** (an MCP session close) is allowed: DELETE always needs a preflight cross-site.

Extracted from `@broberg/lens-daemon` (security sweep 2026-10-21) so lens and auth-relay stop carrying copies (F108).

```ts
// Hono
import { localRequestGuard } from "@broberg/local-guard/hono";
app.use("*", localRequestGuard({ port: 7475, name: "lens daemon" }));

// any fetch handler (Bun.serve, Deno, workers)
import { guardResponse } from "@broberg/local-guard";
const refused = guardResponse(req, { port, name: "ARS" });
if (refused) return refused;

// just the verdict
import { checkLocalRequest } from "@broberg/local-guard";
checkLocalRequest(req, { port }); // null | { status: 421, reason: "host", host } | { status: 415, reason: "content-type", contentType }
```

- **`port` is required** — two daemons on one machine must refuse each other's Host. A port outside 1–65535 throws at setup.
- The JSON body defaults to lens-daemon's `{ ok: false, error }`; pass `body: (refusal, message) => …` to keep your own shape (auth-relay uses `{ error }`).
- **`extraHosts`** (0.2.0) — further exact `host:port` values a daemon answers on beyond loopback, e.g. its tailnet address (`localRequestGuard({ port: 7480, extraHosts: ["100.78.170.62:7480"] })`). No wildcard; compared case-insensitively; the write rule still applies.
- **Host is judged before the content type**, so a rebound page learns nothing about the write rule.

Not this package's job: authentication (that is `@broberg/sso` / a token), and CORS configuration beyond refusing.
