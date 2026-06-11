// @broberg/lens/hono — Stack B (Bun/Hono) adapter.
//
//   import { Hono } from "hono";
//   import { lensSessionHandler } from "@broberg/lens/hono";
//   app.post("/api/lens-session", lensSessionHandler({
//     principal: "lens@myapp.local",
//     async createSession({ principal, expiresAt }) {
//       const value = await signMySessionCookie(principal, expiresAt);
//       return { name: "myapp_session", value };
//     },
//   }));
//
// `hono` is an optional peer dep — `import type` is erased at build, so the
// package never bundles Hono and only needs it for typecheck.

import type { Context } from "hono";
import { createLensMintHandler, type LensMintOptions } from "./index";

export function lensSessionHandler(
  opts: LensMintOptions,
): (c: Context) => Promise<Response> {
  const handle = createLensMintHandler(opts);
  return async (c: Context): Promise<Response> => {
    const url = new URL(c.req.url);
    const host =
      c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
    const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const res = await handle({
      authorization: c.req.header("authorization") ?? null,
      host,
      secure: proto === "https",
    });
    return c.json(res.body, res.status as 200 | 401 | 429 | 503);
  };
}
