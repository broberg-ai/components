import { Hono, type Context } from "hono";

/**
 * @broberg/seti-server — mountable Hono proxy for buddycloud.cc's SETI API v1.
 *
 * The host app gates with its OWN auth, then mounts:
 *
 *   app.use('/api/seti/*', hostAuthMiddleware);
 *   app.route('/api/seti', createSetiProxy({ cloudUrl, token }));
 *
 * The consumer token never reaches the browser: the page talks same-origin to
 * the host (so EventSource works with the host's cookie auth and no CORS is
 * needed), and this proxy injects the bearer token server-to-server.
 *
 * Routes (1:1 against `${cloudUrl}/api/seti/v1/*`):
 *   GET  /sessions  — fleet roster ({ edges: [{ edgeId, connected, tmuxSessions, sessions }] })
 *   GET  /stream    — SSE pass-through (hello / frame / ping events)
 *   POST /input     — { edge, session, text? | key? }
 */
export interface SetiProxyOptions {
  /** The buddy cloud hub, e.g. "https://buddycloud.cc". */
  cloudUrl: string;
  /** A SETI consumer token (one of the cloud's BUDDY_SETI_TOKENS). */
  token: string;
  /** Override fetch (tests). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

/** tmux key names accepted by POST /input's `key` field. */
export const SETI_KEYS = [
  "Escape",
  "Up",
  "Down",
  "Left",
  "Right",
  "Enter",
  "BSpace",
  "Tab",
] as const;

export function createSetiProxy(opts: SetiProxyOptions): Hono {
  const base = opts.cloudUrl.replace(/\/$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const auth = { Authorization: `Bearer ${opts.token}` };
  const app = new Hono();

  app.get("/sessions", async (c) => {
    try {
      const res = await doFetch(`${base}/api/seti/v1/sessions`, { headers: auth });
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return c.json({ edges: [], error: "cloud_unreachable" }, 502);
    }
  });

  app.get("/stream", async (c) => {
    const edge = c.req.query("edge") ?? "";
    const session = c.req.query("session") ?? "";
    if (!edge || !session) return c.json({ error: "edge_and_session_required" }, 400);
    let upstream: Response;
    try {
      upstream = await doFetch(
        `${base}/api/seti/v1/stream?edge=${encodeURIComponent(edge)}&session=${encodeURIComponent(session)}`,
        // Propagate the client abort so the upstream attach heartbeat stops
        // (and the edge's capture loop expires) when the viewer leaves.
        { headers: auth, signal: c.req.raw.signal },
      );
    } catch {
      return c.json({ error: "cloud_unreachable" }, 502);
    }
    if (!upstream.ok || !upstream.body) {
      return c.json({ error: `upstream_${upstream.status}` }, 502);
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.post("/input", async (c) => {
    const body = await c.req.text();
    try {
      const res = await doFetch(`${base}/api/seti/v1/input`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body,
      });
      const out = await res.text();
      return new Response(out, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return c.json({ ok: false, error: "cloud_unreachable" }, 502);
    }
  });

  // === LSD (live-stream dashboard) — passthroughs to ${cloudUrl}/api/seti/v1/lsd/*
  // (buddy F071.11 / cardmem F082+F144). All are clean passthroughs (query + JSON
  // body forwarded, upstream status returned) EXCEPT /lsd/stream, which is an SSE
  // pipe with abort-propagation like /stream above.
  async function forward(
    c: Context,
    method: string,
    upstreamPath: string,
    withBody = false,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...auth };
    const init: RequestInit = { method, headers };
    if (withBody) {
      headers["content-type"] = "application/json";
      init.body = await c.req.text();
    }
    try {
      const res = await doFetch(`${base}/api/seti/v1/${upstreamPath}${new URL(c.req.url).search}`, init);
      const out = await res.text();
      // 204/304 must carry a null body (e.g. DELETE /lsd/rules/:id).
      const noBody = res.status === 204 || res.status === 304;
      return new Response(noBody ? null : out, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return c.json({ error: "cloud_unreachable" }, 502);
    }
  }

  app.get("/lsd/stream", async (c) => {
    let upstream: Response;
    try {
      upstream = await doFetch(`${base}/api/seti/v1/lsd/stream${new URL(c.req.url).search}`, {
        headers: auth,
        signal: c.req.raw.signal,
      });
    } catch {
      return c.json({ error: "cloud_unreachable" }, 502);
    }
    if (!upstream.ok || !upstream.body) return c.json({ error: `upstream_${upstream.status}` }, 502);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.get("/lsd/view", (c) => forward(c, "GET", "lsd/view"));
  app.get("/lsd/search", (c) => forward(c, "GET", "lsd/search"));
  app.get("/lsd/info", (c) => forward(c, "GET", "lsd/info"));
  app.get("/lsd/markers", (c) => forward(c, "GET", "lsd/markers"));
  app.get("/lsd/flags", (c) => forward(c, "GET", "lsd/flags"));
  app.get("/lsd/fires", (c) => forward(c, "GET", "lsd/fires"));
  app.get("/lsd/notifications", (c) => forward(c, "GET", "lsd/notifications"));
  app.get("/lsd/rules", (c) => forward(c, "GET", "lsd/rules"));
  app.post("/lsd/rules", (c) => forward(c, "POST", "lsd/rules", true));
  app.delete("/lsd/rules/:id", (c) =>
    forward(c, "DELETE", `lsd/rules/${encodeURIComponent(c.req.param("id"))}`),
  );
  app.post("/lsd/rules/:id/action", (c) =>
    forward(c, "POST", `lsd/rules/${encodeURIComponent(c.req.param("id"))}/action`, true),
  );
  app.get("/lsd/artifacts", (c) => forward(c, "GET", "lsd/artifacts"));
  app.get("/lsd/artifact", (c) => forward(c, "GET", "lsd/artifact"));
  app.patch("/lsd/turn", (c) => forward(c, "PATCH", "lsd/turn", true));
  app.post("/lsd/command", (c) => forward(c, "POST", "lsd/command", true));
  app.post("/lsd/decision/answer", (c) => forward(c, "POST", "lsd/decision/answer", true));

  return app;
}
