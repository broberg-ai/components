/**
 * @broberg/cron — typed self-service client for cronjobs.webhouse.net.
 *
 * The fleet's hosted HTTP-cron exposes a Bearer-authed REST API at /api/jobs.
 * This wraps it so a repo registers + manages its scheduled jobs in a few typed
 * calls instead of hitting the NextAuth login wall (the browser UI redirects;
 * the API does not) or hand-rolling a scheduler. Dependency-free (raw fetch →
 * Node, Bun and edge alike).
 *
 * Types are generated from the service's published OpenAPI (`pnpm gen` →
 * `src/schema.ts`), so the client stays byte-aligned with the contract and a
 * spec change surfaces as a type error.
 *
 * Pair it with a per-repo SCOPED token: a scoped CRONJOBS_API_TOKEN only ever
 * sees + touches its own repo's jobs (cross-scope → 404). Put any target secret
 * in a per-job `headers` entry — it is stored server-side and forwarded verbatim
 * on each tick, never placed in the URL or a log.
 */

import type { components, paths } from "./schema";

/** A job as returned by the API. */
export type Job = components["schemas"]["Job"];
/** A single run record. */
export type Execution = components["schemas"]["Execution"];
/** An API key (metadata only; the plaintext `key` is present once, on mint). */
export type ApiKey = components["schemas"]["ApiKey"];
type ApiError = components["schemas"]["Error"];
/** The closed set of service error codes. */
export type CronErrorCode = ApiError["error"]["code"];

type JobInput = components["schemas"]["JobInput"];
export type CronProtocol = NonNullable<JobInput["protocol"]>;
export type CronMethod = NonNullable<JobInput["method"]>;
/** Query filters for `listJobs` (search / tag / status / protocol / sort / order / …). */
export type ListFilter = NonNullable<paths["/api/jobs"]["get"]["parameters"]["query"]>;

/**
 * Ergonomic job spec — only `name`, `schedule` and `url` are required; the
 * server fills the rest from its defaults. (The generated `JobInput` marks the
 * default-bearing fields as always-present, which fits a *response*, not what a
 * caller must supply — hence the explicit Partial here.) `headers` is an object
 * (serialised to the API's JSON-string field so target secrets stay server-side)
 * and `protocol` is optional (inferred from the URL scheme).
 */
export interface JobSpec
  extends Partial<Omit<JobInput, "name" | "schedule" | "url" | "headers" | "protocol">> {
  name: string;
  schedule: string;
  url: string;
  /** Headers forwarded verbatim to the target on each tick — e.g.
   * `{ Authorization: "Bearer <secret>" }`. Stored server-side; never in the
   * URL or a log. Pass an object; it's serialised to the API's `headers` field. */
  headers?: Record<string, string>;
  /** Defaults to the URL's own scheme, else "https". */
  protocol?: CronProtocol;
}

/** Mint response: the key metadata plus the one-time plaintext `key`. */
export type MintedKey = ApiKey & { key: string };

const DEFAULT_BASE_URL = "https://cronjobs.webhouse.net";

/** Thrown on any non-2xx response (and on a missing token/fetch). Carries the service error envelope. */
export class CronError extends Error {
  readonly status: number;
  readonly code?: CronErrorCode;
  readonly details?: unknown;
  constructor(status: number, message: string, code?: CronErrorCode, details?: unknown) {
    super(message);
    this.name = "CronError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface CronClientConfig {
  /** Bearer token. Defaults to `process.env.CRONJOBS_API_TOKEN`. */
  token?: string;
  /** Base URL. Defaults to https://cronjobs.webhouse.net. */
  baseUrl?: string;
  /** Injectable fetch (tests / custom runtimes). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

export interface CronClient {
  /**
   * Register a job. Pass a stable `externalId` to make it idempotent: re-running
   * a deploy upserts the SAME job (200 updated / 201 created) instead of
   * duplicating it. This is also the canonical *update* path — re-`createJob`
   * with the same `externalId` rather than tracking ids.
   */
  createJob(spec: JobSpec): Promise<Job>;
  getJob(id: string): Promise<Job>;
  listJobs(filter?: ListFilter): Promise<Job[]>;
  deleteJob(id: string): Promise<void>;
  /** Idempotently disable a job (no-op if already disabled). */
  pauseJob(id: string): Promise<boolean>;
  /** Idempotently enable a job (no-op if already enabled). */
  resumeJob(id: string): Promise<boolean>;
  /** Flip enabled; returns the new state. */
  toggleJob(id: string): Promise<boolean>;
  /** Fire the job once, now; returns the resulting run. */
  runJob(id: string): Promise<Execution>;
  /** Recent run history (newest first). */
  getExecutions(id: string): Promise<Execution[]>;
  /**
   * Mint a new API key. Requires a session/admin token (scoped tokens get 403).
   * Omit `scope` for a full-access token (session only). The plaintext `key` is
   * returned ONCE — store it immediately; it is never retrievable again.
   */
  mintKey(input: { name: string; scope?: string }): Promise<MintedKey>;
}

function inferProtocol(url: string, explicit?: CronProtocol): CronProtocol {
  if (explicit) return explicit;
  const m = /^(https?|wss?):/i.exec(url);
  return m ? (m[1].toLowerCase() as CronProtocol) : "https";
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

function parseError(status: number, body: unknown): CronError {
  const env = (body as Partial<ApiError> | undefined)?.error;
  if (env && typeof env === "object") {
    return new CronError(status, env.message ?? `cron_http_${status}`, env.code, env.details);
  }
  return new CronError(status, `cron_http_${status}`);
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

  const eid = (v: string) => encodeURIComponent(v);
  const jobPath = (id: string) => `/api/jobs/${eid(id)}`;

  const toggle = (id: string) =>
    request<{ enabled: boolean }>("POST", `${jobPath(id)}/toggle`).then((r) => r.enabled);

  // Idempotent enable/disable: only flip when the current state differs, so
  // calling pause twice is a no-op rather than re-enabling.
  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const job = await request<Job>("GET", jobPath(id));
    if (job.enabled === enabled) return enabled;
    return toggle(id);
  }

  return {
    createJob: (spec) => request<Job>("POST", "/api/jobs", toBody(spec)),
    getJob: (id) => request<Job>("GET", jobPath(id)),
    listJobs: (filter) => request<Job[]>("GET", `/api/jobs${qs(filter)}`),
    deleteJob: async (id) => {
      await request<void>("DELETE", jobPath(id));
    },
    pauseJob: (id) => setEnabled(id, false),
    resumeJob: (id) => setEnabled(id, true),
    toggleJob: (id) => toggle(id),
    runJob: (id) => request<Execution>("POST", `${jobPath(id)}/run`),
    getExecutions: (id) =>
      request<{ executions?: Execution[] }>("GET", `${jobPath(id)}/executions`).then(
        (r) => r.executions ?? [],
      ),
    mintKey: (input) => request<MintedKey>("POST", "/api/keys", input),
  };
}
