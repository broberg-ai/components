// @broberg/lens-client — a thin client for the HOSTED Lens (lens.cardmem.com).
// NO Playwright, NO browser — it just speaks HTTP to the hosted service. For the
// local browser engine use @broberg/lens-engine; for mint/compliance use
// @broberg/lens.

import {
  LensClientError,
  type CaptureRequest,
  type CaptureResult,
  type FlowRequest,
  type FlowResult,
} from "./types";

const DEFAULT_BASE = "https://lens.cardmem.com";

export interface LensClientOptions {
  /** Hosted Lens base. Default: env LENS_CLOUD_URL, else https://lens.cardmem.com.
   *  In a browser, point this at the same-origin proxy mount (createLensProxy). */
  baseUrl?: string;
  /** Bearer service token. Default: env LENS_CLOUD_TOKEN. Server-side only —
   *  never ship it to a browser (use the proxy there). */
  token?: string;
  /** Override fetch (tests / custom runtimes). */
  fetch?: typeof fetch;
  /** Cold-start retries on 502 / network error. Default 2. */
  retries?: number;
  /** Backoff base (ms), multiplied by attempt number. Default 1000. */
  retryBackoffMs?: number;
  /** Pre-warm GET /health before capture/flow to dodge cold-start. Default true. */
  prewarm?: boolean;
}

export interface LensClient {
  /** Screenshot a page. Returns the service result (screenshot_url → /artifact). */
  capture(body: CaptureRequest): Promise<CaptureResult>;
  /** Drive a multi-step flow. A `failed` flow comes back as data (read steps);
   *  only transport/auth errors throw a LensClientError. */
  runFlow(body: FlowRequest): Promise<FlowResult>;
  /** GET /health (no auth) — true if the service is up. */
  health(): Promise<boolean>;
  /** Fetch an artifact URL, attaching the Bearer ONLY when the URL is same-origin
   *  as baseUrl (never leaks the token to a foreign host). Returns PNG bytes. */
  fetchArtifact(url: string): Promise<Uint8Array>;
  readonly baseUrl: string;
}

function envVar(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[key] : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createLensClient(opts: LensClientOptions = {}): LensClient {
  const base = (opts.baseUrl ?? envVar("LENS_CLOUD_URL") ?? DEFAULT_BASE).replace(/\/$/, "");
  const token = opts.token ?? envVar("LENS_CLOUD_TOKEN");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const retries = opts.retries ?? 2;
  const backoff = opts.retryBackoffMs ?? 1000;
  const prewarm = opts.prewarm ?? true;
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  async function health(): Promise<boolean> {
    try {
      const res = await doFetch(`${base}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // POST with cold-start retry. Retries ONLY on 502 / network error (Fly booting
  // after idle). NEVER retries 401 (bad token) or 503 (ship-dark) — terminal.
  async function post<T>(path: string, body: unknown): Promise<T> {
    if (prewarm) await health(); // best-effort warm; ignore the result
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(backoff * attempt);
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, {
          method: "POST",
          headers: { ...authHeaders, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastErr = err; // network / connection reset — a cold-start symptom
        continue;
      }
      if (res.status === 401) {
        throw new LensClientError(`lens ${path}: 401 unauthorized — check LENS_CLOUD_TOKEN`, { status: 401, kind: "auth" });
      }
      if (res.status === 503) {
        throw new LensClientError(`lens ${path}: 503 — Lens is ship-dark / not configured`, { status: 503, kind: "unavailable" });
      }
      if (res.status === 502) {
        lastErr = new LensClientError(`lens ${path}: 502 (cold start)`, { status: 502, kind: "http" });
        continue;
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new LensClientError(
          `lens ${path}: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`,
          { status: res.status, kind: "http" },
        );
      }
      return (await res.json()) as T;
    }
    if (lastErr instanceof LensClientError) throw lastErr;
    throw new LensClientError(
      `lens ${path}: failed after ${retries + 1} tries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      { kind: "network", cause: lastErr },
    );
  }

  async function fetchArtifact(url: string): Promise<Uint8Array> {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === new URL(base).origin;
    } catch {
      sameOrigin = false;
    }
    const res = await doFetch(url, { headers: sameOrigin ? authHeaders : {} });
    if (!res.ok) {
      throw new LensClientError(`lens artifact: ${res.status} ${res.statusText}`, { status: res.status, kind: "http" });
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  return {
    baseUrl: base,
    health,
    fetchArtifact,
    capture: (body) => post<CaptureResult>("/capture", body),
    runFlow: (body) => post<FlowResult>("/flow", body),
  };
}
