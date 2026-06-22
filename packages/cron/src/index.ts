/**
 * @broberg/cron — typed self-service client for cronjobs.webhouse.net.
 *
 * The fleet's hosted HTTP-cron exposes a Bearer-authed REST API at /api/jobs.
 * This wraps it so a repo registers + manages its scheduled jobs in a few typed
 * calls instead of hitting the NextAuth login wall (the browser UI redirects;
 * the API does not) or hand-rolling a scheduler. Dependency-free (raw fetch →
 * Node, Bun and edge alike).
 *
 * Pair it with a per-repo SCOPED token: a scoped CRONJOBS_API_TOKEN only ever
 * sees + touches its own repo's jobs (cross-scope → 404). Put any target secret
 * in a per-job `headers` entry — it is stored server-side and forwarded verbatim
 * on each tick, never placed in the URL or a log.
 *
 * SCAFFOLD NOTE (F041): built against the verified, stable /api/jobs routes.
 * Three spots are flagged `SEAM:` because the cronjobs service is shipping
 * changes (a stable error envelope, idempotent externalId upsert, and an
 * OpenAPI export → generated types). They land when cronjobs deploys rollout
 * step 5; until then the hand-written types + tolerant error parsing stand in.
 */

const DEFAULT_BASE_URL = "https://cronjobs.webhouse.net";

export type CronProtocol = "https" | "http" | "wss" | "ws";
export type CronMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
/** SEAM: confirm the full retry-strategy enum against the OpenAPI export. */
export type RetryStrategy = "fixed" | "exponential";

export interface JobSpec {
  /** Human label for the job. */
  name: string;
  /** Cron expression, e.g. "0 9 * * 1" (every Monday 09:00). */
  schedule: string;
  /** Target URL the cron calls on each tick. */
  url: string;
  /** Defaults to the URL's own scheme, else "https". */
  protocol?: CronProtocol;
  /** HTTP method for the target call. Server default: GET. */
  method?: CronMethod;
  /**
   * Headers forwarded verbatim to the target on every tick — put a target
   * secret here, e.g. `{ Authorization: "Bearer <secret>" }`. Stored
   * server-side, never placed in the URL or a log. Pass an object; the client
   * serialises it to the API's JSON-string `headers` field.
   */
  headers?: Record<string, string>;
  /** IANA timezone. Server default: Europe/Copenhagen. */
  timezone?: string;
  /** Per-tick request timeout in ms. Server default: 30000. */
  timeout?: number;
  /** Retry attempts on a failed tick. Server default: 0. */
  retryCount?: number;
  /** Server default: "fixed". */
  retryStrategy?: RetryStrategy;
  /** Whether the job runs. Server default: true. */
  enabled?: boolean;
  tags?: string[];
  /**
   * Stable client-supplied key for idempotent upsert — re-running a deploy
   * updates the same job instead of duplicating it.
   * SEAM: upsert semantics land in the cronjobs service (rollout step 5). Until
   * then a repeated create with the same externalId still makes a new job.
   */
  externalId?: string;
}

export interface ListFilter {
  search?: string;
  tag?: string;
  status?: string;
  protocol?: CronProtocol;
  sort?: string;
  order?: "asc" | "desc";
}

/**
 * A job as returned by the API. SEAM: permissive (open index signature) until
 * cronjobs exports its zod / OpenAPI types — swap this for the generated `Job`
 * type then so a contract change surfaces as a type error.
 */
export interface Job {
  id: string;
  name: string;
  schedule: string;
  url: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface CronClientConfig {
  /** Bearer token. Defaults to `process.env.CRONJOBS_API_TOKEN`. */
  token?: string;
  /** Base URL. Defaults to https://cronjobs.webhouse.net. */
  baseUrl?: string;
  /** Injectable fetch (tests / custom runtimes). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** Thrown on any non-2xx response (and on missing token/fetch). Carries the service error envelope. */
export class CronError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "CronError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface CronClient {
  /** Register a new job. */
  createJob(spec: JobSpec): Promise<Job>;
  getJob(id: string): Promise<Job>;
  listJobs(filter?: ListFilter): Promise<Job[]>;
  updateJob(id: string, patch: Partial<JobSpec>): Promise<Job>;
  deleteJob(id: string): Promise<void>;
  /** Disable a job (PUT enabled=false) without deleting it. */
  pauseJob(id: string): Promise<Job>;
  /** Re-enable a paused job. */
  resumeJob(id: string): Promise<Job>;
  /** Fire the job once, now. */
  runJob(id: string): Promise<Job>;
  /** Lightweight run/health status for a job. */
  getStatus(id: string): Promise<unknown>;
}

function inferProtocol(url: string, explicit?: CronProtocol): CronProtocol {
  if (explicit) return explicit;
  const m = /^(https?|wss?):/i.exec(url);
  return (m ? m[1].toLowerCase() : "https") as CronProtocol;
}

/** Map the ergonomic JobSpec to the API request body (headers object → JSON string). */
function toBody(spec: Partial<JobSpec>): Record<string, unknown> {
  const { headers, url, protocol, ...rest } = spec;
  const body: Record<string, unknown> = { ...rest };
  if (url !== undefined) {
    body.url = url;
    body.protocol = inferProtocol(url, protocol);
  } else if (protocol !== undefined) {
    body.protocol = protocol;
  }
  if (headers !== undefined) body.headers = JSON.stringify(headers);
  return body;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * SEAM: tolerant parse of BOTH today's inconsistent shapes ({error:string} or a
 * zod-flatten) AND the coming stable {error:{code,message,details?}}. Tighten to
 * just the stable shape once cronjobs ships the envelope.
 */
function parseError(status: number, body: unknown): CronError {
  const b = body as { error?: unknown; message?: string } | undefined;
  const e = b?.error;
  if (e && typeof e === "object") {
    const eo = e as { code?: string; message?: string; details?: unknown };
    return new CronError(status, eo.message ?? `cron_http_${status}`, eo.code, eo.details);
  }
  const message = typeof e === "string" ? e : (b?.message ?? `cron_http_${status}`);
  return new CronError(status, message);
}

export function createCron(config: CronClientConfig = {}): CronClient {
  const token =
    config.token ?? (typeof process !== "undefined" ? process.env?.CRONJOBS_API_TOKEN : undefined);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = config.fetch ?? globalThis.fetch?.bind(globalThis);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!token) throw new CronError(0, "no_token (set CRONJOBS_API_TOKEN or pass config.token)");
    if (!doFetch) throw new CronError(0, "no_fetch (no global fetch; pass config.fetch)");
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw parseError(res.status, data);
    return data as T;
  }

  function qs(filter?: ListFilter): string {
    if (!filter) return "";
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v != null) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  const id = (v: string) => encodeURIComponent(v);

  return {
    createJob: (spec) => request<Job>("POST", "/api/jobs", toBody(spec)),
    getJob: (jobId) => request<Job>("GET", `/api/jobs/${id(jobId)}`),
    listJobs: async (filter) => {
      // SEAM: list envelope (bare array vs {jobs}/{data}) — confirm against the OpenAPI.
      const data = await request<Job[] | { jobs?: Job[]; data?: Job[] }>(
        "GET",
        `/api/jobs${qs(filter)}`,
      );
      return Array.isArray(data) ? data : (data.jobs ?? data.data ?? []);
    },
    updateJob: (jobId, patch) => request<Job>("PUT", `/api/jobs/${id(jobId)}`, toBody(patch)),
    deleteJob: async (jobId) => {
      await request<void>("DELETE", `/api/jobs/${id(jobId)}`);
    },
    pauseJob: (jobId) => request<Job>("PUT", `/api/jobs/${id(jobId)}`, { enabled: false }),
    resumeJob: (jobId) => request<Job>("PUT", `/api/jobs/${id(jobId)}`, { enabled: true }),
    runJob: (jobId) => request<Job>("POST", `/api/jobs/${id(jobId)}/run`),
    getStatus: (jobId) => request<unknown>("GET", `/api/jobs/${id(jobId)}/status`),
  };
}
