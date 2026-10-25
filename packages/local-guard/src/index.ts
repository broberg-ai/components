// @broberg/local-guard — extracted from @broberg/lens-daemon's local-guard.ts
// (security sweep 2026-10-21, findings H1–H4), F108.
//
// A daemon on 127.0.0.1 takes a call from anyone who can make a BROWSER send
// one: a DNS-rebound page (if Host is never checked) or any site's "simple"
// text/plain POST (if the body is parsed whatever its type). Two rules close
// that without a token, because a browser cannot break either:
//
//   · Host must name THIS loopback service on THIS port — a rebound page sends
//     its own name, so it is refused (421 Misdirected Request).
//   · A write (POST/PUT/PATCH/DELETE) must be application/json — a cross-site
//     page cannot send that without a CORS preflight, which a local daemon does
//     not grant to strangers (415 Unsupported Media Type).
//
// A non-browser caller (curl, an MCP client, an agent) already sends both, so
// nothing legitimate changes. A body-less DELETE (an MCP session close) carries
// no content type and is allowed: DELETE is not a "simple" method, so a
// cross-site page cannot send one without a preflight either.

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface LocalGuardOptions {
  /** The port this daemon listens on. Required: two daemons on one machine must refuse each other's Host. */
  port: number;
}

export type LocalGuardRefusal =
  | { status: 421; reason: "host"; host: string }
  | { status: 415; reason: "content-type"; contentType: string };

/** The loopback names a request to this daemon may carry in Host. */
export function allowedHosts(port: number): Set<string> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`@broberg/local-guard: port must be an integer 1–65535, got ${String(port)}`);
  }
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/**
 * Decide whether a request may reach this local daemon. Returns null when it may,
 * or the refusal (status + the exact value that was refused) when it may not.
 * Framework-free: works on a Web `Request` (Bun.serve, Hono, Deno, workers).
 */
export function checkLocalRequest(req: Request, opts: LocalGuardOptions): LocalGuardRefusal | null {
  const hosts = allowedHosts(opts.port);
  // A server request carries Host; Bun builds req.url from it, so the URL's host
  // is the same value when the header is not on the Request object.
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  if (!hosts.has(host)) return { status: 421, reason: "host", host };
  if (WRITE.has(req.method)) {
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const empty = req.method === "DELETE" && !req.headers.get("content-length") && !type;
    if (type !== "application/json" && !empty) return { status: 415, reason: "content-type", contentType: type };
  }
  return null;
}

/** The default human sentence for a refusal. `name` is the daemon's name in the message. */
export function describeRefusal(r: LocalGuardRefusal, name = "this daemon"): string {
  return r.reason === "host"
    ? `${name}: refused Host "${r.host}" — only this machine's loopback address may call it`
    : `${name}: a write must be Content-Type: application/json`;
}

/**
 * Plain `fetch`-handler form: returns a JSON refusal Response, or null to continue.
 *   const refused = guardResponse(req, { port }); if (refused) return refused;
 */
export function guardResponse(
  req: Request,
  opts: LocalGuardOptions & { name?: string; body?: (r: LocalGuardRefusal, message: string) => unknown },
): Response | null {
  const r = checkLocalRequest(req, opts);
  if (!r) return null;
  const message = describeRefusal(r, opts.name);
  const body = opts.body ? opts.body(r, message) : { ok: false, error: message };
  return new Response(JSON.stringify(body), { status: r.status, headers: { "content-type": "application/json" } });
}
