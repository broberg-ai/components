/**
 * `@broberg/seti-client/sse` — a generic read-idle SSE watchdog, shared across
 * the fleet (cardmem chat/roster stream, buddy cloud-relay). Ported verbatim
 * from buddy's proven impl (commit 7000038); the fleet shares ONE watchdog
 * instead of re-rolling it per consumer.
 *
 * Why it exists: an SSE stream can go half-open (NAT drop / sleep / blip with no
 * FIN) → `reader.read()` blocks forever → a zombie stream that NEVER reconnects
 * while the hub has long since marked it dead (cardmem "nothing live" / stale
 * roster; buddy zombie-edges). The watchdog aborts a stream that received no
 * frame for `idleTimeoutMs` so the caller's reconnect loop fires within ~one
 * timeout window. The hub MUST send a frame (a comment/ping) at least every
 * ~30s; buddycloud's /cloud/relay-stream already does.
 *
 * Zero runtime deps, framework-agnostic — runs in Node, Bun, Deno and the
 * browser (anywhere `fetch` + WHATWG streams exist).
 */

export const SSE_IDLE_TIMEOUT_MS = 90_000;

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Read an SSE response stream frame-by-frame until it closes — or goes
 * idle-dead (no frame for `idleTimeoutMs`), in which case it aborts so the
 * caller's reconnect loop fires. `onConnected` fires once the stream is
 * established (lets the caller reset its backoff so a long-healthy connection
 * that drops reconnects promptly). Resolves when the stream closes; rejects
 * when it is aborted (idle) or the response is not OK.
 *
 * @param url           the SSE endpoint
 * @param token         bearer token (empty string ⇒ no Authorization header)
 * @param onEvent       called per dispatched SSE frame: (event, data)
 * @param opts.onConnected   fired after the response is OK
 * @param opts.idleTimeoutMs read-idle abort window (default 90_000)
 */
export async function consumeSSE(
  url: string,
  token: string,
  onEvent: (event: string, data: string) => void,
  opts?: { onConnected?: () => void; idleTimeoutMs?: number },
): Promise<void> {
  const idleTimeoutMs = opts?.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  let lastRecvMs = Date.now();
  const watchdog = setInterval(
    () => {
      if (Date.now() - lastRecvMs > idleTimeoutMs) {
        console.warn(`[sse] stream idle >${idleTimeoutMs}ms (silent/half-open) — aborting to reconnect`);
        controller.abort();
      }
    },
    Math.max(1_000, Math.floor(idleTimeoutMs / 3)),
  );
  (watchdog as unknown as { unref?: () => void }).unref?.();
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream", ...authHeaders(token) },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`sse HTTP ${res.status}`);
    opts?.onConnected?.();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lastRecvMs = Date.now();
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        onEvent(event, dataLines.join("\n"));
      }
    }
  } finally {
    clearInterval(watchdog);
  }
}
