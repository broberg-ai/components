// @broberg/lens/next — Next.js 16 route-handler adapter.
//
// Mount at `app/api/lens-session/route.ts`:
//
//   import { createLensRoute } from "@broberg/lens/next";
//   export const { POST } = createLensRoute({
//     principal: "lens@myapp.local",
//     async createSession({ principal, expiresAt }) {
//       const value = await signMySessionCookie(principal, expiresAt);
//       return { name: "myapp.session_token", value };
//     },
//   });
//
// Uses Web `Request`/`Response` — no `next`/`react` import, so it runs on the
// Node runtime route handlers serve from. (node:crypto in the core means this is
// NOT for the Edge runtime — mint endpoints hit a DB anyway, so Node is right.)

import { createLensMintHandler, type LensMintOptions } from "./index";

export function createLensRoute(opts: LensMintOptions): {
  POST: (req: Request) => Promise<Response>;
} {
  const handle = createLensMintHandler(opts);
  return {
    async POST(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const host =
        req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
      const proto =
        req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
      const res = await handle({
        authorization: req.headers.get("authorization"),
        host,
        secure: proto === "https",
      });
      return Response.json(res.body, { status: res.status });
    },
  };
}
