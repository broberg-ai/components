# @broberg/lens

Make any app **Cardmem-Lens-compliant** in a few lines: expose the fleet-standard
**mint endpoint** so Lens can log *past the auth wall* and screenshot the **real
authed surface** — including in production — instead of a login page.

```bash
npm i @broberg/lens
```

## What it is

Cardmem **Lens** verifies the surface users actually see, which is almost always
**behind a login**. Lens can't hard-code every app's auth, so each app exposes one
endpoint that mints a **short-lived, read-only** session on demand; Lens calls it
just before capture, uses the session, and discards it.

The contract is identical in every repo — only *how you mint the session* differs.
So this package ships the uniform, security-sensitive **~80%** as a headless core;
you supply the auth-specific **20%** (a `createLensSession` hook that mints + signs
your own session cookie).

> Implements the fleet F098.1 mint standard (cardmem `docs/LENS-MINT-ENDPOINT.md`).
> `components` owns + publishes it; cardmem owns the spec.

## The contract

`POST /api/lens-session`, header `Authorization: Bearer <LENS_MINT_SECRET>` →
**200** with a Playwright **storageState** JSON the Lens daemon injects verbatim:

```json
{ "cookies": [ { "name": "<session-cookie>", "value": "<signed>", "domain": "<host>",
    "path": "/", "httpOnly": true, "secure": true, "sameSite": "Lax",
    "expires": 1733430000 } ],
  "origins": [] }
```

`expires` is **unix seconds**. The core fills every field except `name`/`value`.

## Next.js 16 (Stack A)

`app/api/lens-session/route.ts`:

```ts
import { createLensRoute } from "@broberg/lens/next";
import { signLensCookie } from "@/lib/auth"; // your app's signing

export const { POST } = createLensRoute({
  principal: "lens@myapp.local", // dedicated, read-only — NEVER cb@webhouse.dk
  async createSession({ principal, expiresAt }) {
    const value = await signLensCookie(principal, expiresAt);
    return { name: "myapp.session_token", value };
  },
});
```

## Hono (Stack B)

```ts
import { Hono } from "hono";
import { lensSessionHandler } from "@broberg/lens/hono";

const app = new Hono();
app.post("/api/lens-session", lensSessionHandler({
  principal: "lens@myapp.local",
  async createSession({ principal, expiresAt }) {
    return { name: "myapp_session", value: await mintSession(principal, expiresAt) };
  },
}));
```

## Any other framework

Call the core handler directly with a normalized request:

```ts
import { createLensMintHandler } from "@broberg/lens";

const handle = createLensMintHandler({ principal, createSession });
const res = await handle({ authorization, host, secure }); // → { status, body }
```

## Minting the session (the part you write)

> ⚠️ **Issue a REAL session cookie your own auth accepts** — the same one your
> SPA's auth-gate checks (`getSession()` / your JWT middleware). A synthetic token
> can authenticate API routes (so `curl` looks green) yet the SPA still bounces to
> login, and Lens captures a login wall. Mint via your framework's real session
> machinery.

- **Better Auth:** the cookie is signed (`<token>.<sig>`). Create the session via
  `auth.$context → internalAdapter.createSession(userId, ctx)`, clamp its expiry to
  `expiresAt`, then serialize the signed cookie. Cookie name = `<prefix>.session_token`.
- **Supabase:** mint server-side with the service-role key for the dedicated lens
  user; return the `sb-<ref>-auth-token` cookie `@supabase/ssr` reads.
- **Custom JWT (jose/HS256):** sign a short-lived read-only JWT for the lens
  principal; return it as your session cookie.

## What the core guarantees

- **Ships dark:** `503` until `LENS_MINT_SECRET` is set (read per-request — flip it
  on without a restart).
- **`401` + constant-time** bearer compare (`crypto.timingSafeEqual` over SHA-256
  digests — length-independent, never throws).
- **Never cb@:** constructing with `principal: "cb@webhouse.dk"` (or a blank
  principal) **throws** — the lens identity must be a dedicated read-only user.
- **TTL clamp** to `[60s, 10min]` (default 10min); `expiresAt` is handed to your
  hook so you clamp your session row to the same TTL.
- **Basic rate-limit** (default 30/min) → `429`.
- **Cookie domain** = `cookieDomain ?? LENS_COOKIE_DOMAIN ?? request host` — never
  the bound socket address (which is `0.0.0.0` on Fly/proxy hosts → the browser
  never sends the cookie → a silent false-green).

## Read-only is enforced by YOUR app

This package mints the session; it does **not** enforce read-only from inside the
endpoint. Add a server-side **write-guard**: if the authenticated principal is the
lens user, reject every mutating request (`POST`/`PUT`/`PATCH`/`DELETE` + write
RPC/tools) with `403`. Give the lens principal enough *read* access to render the
target surfaces (often admin-level read). For PII surfaces, capture `no_diff`
smoke — never a stored pixel baseline.

> Runs on the **Node runtime** (the core uses `node:crypto`) — not Next's Edge
> runtime. Mint endpoints hit a DB to create a session anyway, so Node is correct.

## API

```ts
interface LensCookie { name: string; value: string; domain?: string; path?: string;
  httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None"; expires?: number; }
interface LensSessionContext { principal: string; host: string; secure: boolean; ttlMs: number; expiresAt: number; }
type CreateLensSession = (ctx: LensSessionContext) => Promise<LensCookie | LensCookie[]> | LensCookie | LensCookie[];
interface LensMintOptions { secret?: string; createSession: CreateLensSession; principal: string;
  ttlMs?: number; cookieDomain?: string; maxPerMinute?: number; }

function createLensMintHandler(opts: LensMintOptions): (req: { authorization: string | null; host: string; secure: boolean }) => Promise<{ status: number; body: unknown }>;
// @broberg/lens/next → createLensRoute(opts): { POST(req: Request): Promise<Response> }
// @broberg/lens/hono → lensSessionHandler(opts): (c: Context) => Promise<Response>
```

MIT · part of the [`@broberg/*`](https://github.com/broberg-ai/components) shared-library family.
