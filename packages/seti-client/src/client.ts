import type {
  SetiInputResult,
  SetiKey,
  SetiRoster,
  SetiStreamHandle,
  SetiStreamHandlers,
} from "./types";

export interface SetiClientOptions {
  /**
   * Base URL of the SETI surface. In a browser this is the host app's proxy
   * mount (same-origin, e.g. "/api/seti" via @broberg/seti-server). Server-side
   * it can be the cloud directly ("https://buddycloud.cc/api/seti/v1") together
   * with `token`.
   */
  baseUrl: string;
  /** Bearer token — only for server-side/direct use. NEVER ship to a browser. */
  token?: string;
  /** Override fetch (tests / custom runtimes). */
  fetch?: typeof fetch;
  /**
   * Timeout (ms) for POST /input (sendText / sendKey) before the client aborts
   * the wait. Default 30000. A busy or slow edge daemon can take well over 8s to
   * ACK an injected line; too short a budget surfaces a false "not sent" and
   * provokes user retries — which risk duplicates, since an abort only ends the
   * CLIENT's wait while the edge may still inject the message. Override a single
   * call via sendText's `timeoutMs`.
   */
  inputTimeoutMs?: number;
  /**
   * Read-idle watchdog (ms) for the live stream: if no frame arrives for this
   * long the connection is treated as half-open (NAT drop / sleep / blip with no
   * FIN — where `reader.read()` would block forever) and aborted so the
   * auto-reconnect fires. Default 90000. The SETI hub pings well within it.
   * Shares the contract of `@broberg/seti-client/sse`'s `consumeSSE`.
   */
  idleTimeoutMs?: number;
}

/**
 * Typed client for the SETI API (roster + SSE stream + input). One code path
 * for browser and server: fetch-based SSE with automatic reconnect (1s → 5s
 * backoff), so bearer headers work everywhere and no EventSource is needed.
 */
export class SetiClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly doFetch: typeof fetch;
  private readonly inputTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(opts: SetiClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.headers = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.inputTimeoutMs = opts.inputTimeoutMs ?? 30_000;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 90_000;
  }

  async listSessions(): Promise<SetiRoster> {
    const res = await this.doFetch(`${this.base}/sessions`, { headers: this.headers });
    if (!res.ok) return { edges: [], error: `http_${res.status}` };
    return (await res.json()) as SetiRoster;
  }

  async sendText(
    edge: string,
    session: string,
    text: string,
    options?: { origin?: string; timeoutMs?: number },
  ): Promise<SetiInputResult> {
    return this.input({ edge, session, text, origin: options?.origin }, options?.timeoutMs);
  }

  async sendKey(edge: string, session: string, key: SetiKey): Promise<SetiInputResult> {
    return this.input({ edge, session, key });
  }

  private async input(
    body: {
      edge: string;
      session: string;
      text?: string;
      key?: SetiKey;
      origin?: string;
    },
    timeoutMs?: number,
  ): Promise<SetiInputResult> {
    try {
      const res = await this.doFetch(`${this.base}/input`, {
        method: "POST",
        headers: { ...this.headers, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.inputTimeoutMs),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<SetiInputResult>;
      return { ok: !!json.ok, edgeConnected: !!json.edgeConnected, error: json.error };
    } catch (err) {
      return { ok: false, edgeConnected: false, error: err instanceof Error ? err.message : "send_failed" };
    }
  }

  /**
   * Open the live frame stream for one edge session. Reconnects automatically
   * until `close()` is called.
   */
  openStream(edge: string, session: string, handlers: SetiStreamHandlers): SetiStreamHandle {
    let closed = false;
    let controller: AbortController | null = null;

    const run = async (): Promise<void> => {
      let attempt = 0;
      while (!closed) {
        handlers.onStateChange?.(attempt === 0 ? "connecting" : "reconnecting");
        controller = new AbortController();
        try {
          const res = await this.doFetch(
            `${this.base}/stream?edge=${encodeURIComponent(edge)}&session=${encodeURIComponent(session)}`,
            { headers: { ...this.headers, accept: "text/event-stream" }, signal: controller.signal },
          );
          if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
          handlers.onStateChange?.("open");
          attempt = 0;
          await this.consume(res.body, handlers, controller);
        } catch {
          /* fall through to reconnect */
        }
        if (closed) break;
        attempt++;
        await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
      }
      handlers.onStateChange?.("closed");
    };
    void run();

    return {
      close: () => {
        closed = true;
        controller?.abort();
      },
    };
  }

  /** Minimal SSE parser: `event:` + `data:` lines, events split on blank lines.
   *  A read-idle watchdog aborts `controller` (→ reconnect) if no frame arrives
   *  for `idleTimeoutMs`, closing the half-open zombie-stream gap. */
  private async consume(
    body: ReadableStream<Uint8Array>,
    handlers: SetiStreamHandlers,
    controller: AbortController,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let lastRecvMs = Date.now();
    const watchdog = setInterval(
      () => {
        if (Date.now() - lastRecvMs > this.idleTimeoutMs) controller.abort();
      },
      Math.max(1_000, Math.floor(this.idleTimeoutMs / 3)),
    );
    (watchdog as unknown as { unref?: () => void }).unref?.();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastRecvMs = Date.now();
        buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.join("\n"));
        } catch {
          continue;
        }
        if (event === "frame") {
          const c = (parsed as { content?: unknown }).content;
          if (typeof c === "string") handlers.onFrame?.(c);
        } else if (event === "hello") {
          handlers.onHello?.(parsed as { edge: string; session: string; edgeConnected: boolean });
        } else if (event === "ping") {
          handlers.onPing?.(parsed as { edgeConnected: boolean });
        }
      }
      }
    } finally {
      clearInterval(watchdog);
    }
  }
}
