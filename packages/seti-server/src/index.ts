import { Hono } from "hono";

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

  return app;
}
