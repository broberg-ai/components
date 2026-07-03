// @broberg/lens-client/hono — a mountable Hono proxy for the hosted Lens.
//
// Mount it on a product's own server so the browser hits /api/lens/* SAME-ORIGIN
// and the LENS_CLOUD_TOKEN never reaches the client:
//
//   import { createLensProxy } from "@broberg/lens-client/hono";
//   app.route("/api/lens", createLensProxy());   // token from env, server-side
//
// Mirrors @broberg/seti-server's createSetiProxy. `hono` is an OPTIONAL peer —
// only needed if you use the proxy; the core client ('.') has zero deps.

import { Hono, type Context } from "hono";

export interface LensProxyOptions {
  /** Hosted Lens base. Default: env LENS_CLOUD_URL, else https://lens.cardmem.com. */
  baseUrl?: string;
  /** Bearer service token. Default: env LENS_CLOUD_TOKEN. Stays server-side. */
  token?: string;
  /** Override fetch (tests / custom runtimes). */
  fetch?: typeof fetch;
}

function envVar(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[key] : undefined;
}

export function createLensProxy(opts: LensProxyOptions = {}): Hono {
  const base = (opts.baseUrl ?? envVar("LENS_CLOUD_URL") ?? "https://lens.cardmem.com").replace(/\/$/, "");
  const token = opts.token ?? envVar("LENS_CLOUD_TOKEN");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const app = new Hono();

  const forwardPost = async (c: Context, path: string): Promise<Response> => {
    const body = await c.req.text();
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body,
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  };

  app.post("/capture", (c) => forwardPost(c, "/capture"));
  app.post("/flow", (c) => forwardPost(c, "/flow"));

  app.get("/health", async () => {
    const res = await doFetch(`${base}/health`);
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  });

  app.get("/artifact", async (c: Context) => {
    const key = c.req.query("key") ?? "";
    const res = await doFetch(`${base}/artifact?key=${encodeURIComponent(key)}`, { headers: authHeaders });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "image/png" },
    });
  });

  return app;
}
