/**
 * F033.13 — a Fly.io client: the Machines REST API plus the few GraphQL calls
 * the fleet actually makes. Plain fetch, no dependency.
 *
 * Why it exists: this package's description promised a "Fly Machines REST
 * client" from June 2026 and shipped none, while cms carried TWO of its own
 * and whop a third. What those copies taught, measured 24/9 2026:
 *
 *   · cms's wait loop retried on EVERY non-ok answer, 401 and 404 included,
 *     for up to 30 minutes. A wrong token looked like a slow build.
 *   · A machine that stopped with no exit code was counted as a success.
 *   · whop listed apps with `first: 400` and then deleted its own rows for
 *     apps that were "gone". A silent cap looks exactly like a deletion.
 *
 * And what Fly itself does, measured against the live API the same day:
 *
 *   · `/machines/{id}/wait` answers 408 when its timeout runs out. That is the
 *     same status as "please retry", so the wait loop reads it as "not yet".
 *   · GraphQL answers HTTP 200 for a bad token. The failure is inside the body
 *     (`errors[].extensions.code = "UNAUTHORIZED"`), so a `res.ok` check alone
 *     never sees it.
 *   · GraphQL `apps` reports `totalCount`, so completeness can be PROVEN.
 */

const MACHINES_API = "https://api.machines.dev/v1";
const GRAPHQL_API = "https://api.fly.io/graphql";

// ── Types — the parts of Fly's answers the fleet reads ─────────────────────

export interface FlyGuest {
  cpu_kind: "shared" | "performance" | string;
  cpus: number;
  memory_mb: number;
}

export interface FlyMachineConfig {
  image: string;
  guest?: FlyGuest;
  env?: Record<string, string>;
  services?: unknown[];
  auto_destroy?: boolean;
  restart?: { policy?: "no" | "always" | "on-failure"; max_retries?: number };
  [key: string]: unknown;
}

export interface FlyMachineEvent {
  type?: string;
  status?: string;
  timestamp?: number;
  request?: { exit_event?: { exit_code?: number } } & Record<string, unknown>;
}

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip?: string;
  config: FlyMachineConfig;
  events?: FlyMachineEvent[];
  created_at?: string;
  updated_at?: string;
}

export interface FlyAppSummary {
  id: string;
  name: string;
  machine_count?: number;
}

export interface FlyApp {
  id: string;
  name: string;
  status?: string;
  organization?: { name?: string; slug: string };
}

export interface FlyOrg {
  id: string;
  slug: string;
  name: string;
  type: string;
}

/** One app from `listAllApps` — across every org the token can see. */
export interface FlyAppNode {
  name: string;
  status: string;
  hostname: string | null;
  organization: { slug: string };
}

export interface FlyExit {
  /** The terminal state the machine reached: stopped, destroyed or failed. */
  state: string;
  /**
   * The process's exit code, or null when Fly recorded none. NULL IS NOT
   * SUCCESS — it is the absence of a verdict, and the caller decides.
   */
  exitCode: number | null;
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** A request Fly answered with a failure. Never carries the token. */
export class FlyApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
    /** GraphQL `extensions.code` when the failure came from GraphQL. */
    readonly code?: string,
  ) {
    super(`fly: ${method} ${path} → ${status}${code ? ` ${code}` : ""}: ${body}`);
    this.name = "FlyApiError";
  }
}

/** A wait that ran out of time. Not a Fly failure: the machine may still get there. */
export class FlyTimeoutError extends Error {
  constructor(
    readonly what: string,
    readonly lastState: string | undefined,
  ) {
    super(`fly: timed out waiting for ${what}${lastState ? ` (last state: ${lastState})` : ""}`);
    this.name = "FlyTimeoutError";
  }
}

/**
 * Worth a retry: the network failed, or Fly said "not now" (408, 429, 5xx).
 * Everything else — 401, 403, 404, 422 — will say the same thing again, and
 * retrying it only turns a wrong token into a slow one.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const GQL_CODE_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

// ── Client ─────────────────────────────────────────────────────────────────

export interface FlyClientOptions {
  /** Fly API token. Default: `$FLY_API_TOKEN`. */
  token?: string;
  /** Injected for tests. Default: global fetch. */
  fetch?: typeof fetch;
  /** Attempts per request, first try included. Default 3. */
  maxAttempts?: number;
  /** Injected for tests. Default: a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Give up on ONE request after this long. Default 30 s. Without it a
   * connection that hangs — no error, no answer — never returns, and no wait
   * loop above it ever reaches its own deadline. A timed-out request counts as
   * a network failure, so it is retried like one.
   */
  requestTimeoutMs?: number;
}

interface RequestOptions {
  /** Retry transient failures. Off where the caller handles them itself. */
  retry?: boolean;
  /** Override the per-request timeout (the /wait call needs longer). */
  timeoutMs?: number;
  /** Return null on 404 instead of throwing. */
  nullOn404?: boolean;
}

const MAX_BODY = 500;

export class FlyClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestTimeoutMs: number;

  constructor(opts: FlyClientOptions = {}) {
    const token = opts.token ?? process.env.FLY_API_TOKEN;
    if (!token) throw new Error("fly: missing token — pass { token } or set FLY_API_TOKEN");
    this.token = token;
    this.fetchImpl = opts.fetch ?? fetch;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  }

  // ── Apps ──

  /** Apps in one org (Machines API). `org` is the slug, e.g. "personal". */
  async listApps(org: string): Promise<FlyAppSummary[]> {
    const res = await this.rest<{ apps: FlyAppSummary[] }>("GET", `/apps?org_slug=${encodeURIComponent(org)}`);
    return res?.apps ?? [];
  }

  /** One app, or null when it does not exist. */
  getApp(name: string): Promise<FlyApp | null> {
    return this.rest<FlyApp>("GET", `/apps/${encodeURIComponent(name)}`, undefined, { nullOn404: true });
  }

  async createApp(name: string, org: string): Promise<void> {
    await this.rest("POST", "/apps", { app_name: name, org_slug: org });
  }

  async deleteApp(name: string): Promise<void> {
    await this.rest("DELETE", `/apps/${encodeURIComponent(name)}`);
  }

  // ── Machines ──

  async listMachines(app: string): Promise<FlyMachine[]> {
    return (await this.rest<FlyMachine[]>("GET", `/apps/${encodeURIComponent(app)}/machines`)) ?? [];
  }

  getMachine(app: string, id: string): Promise<FlyMachine | null> {
    return this.rest<FlyMachine>("GET", this.machinePath(app, id), undefined, { nullOn404: true });
  }

  async createMachine(
    app: string,
    config: FlyMachineConfig,
    opts: { name?: string; region?: string } = {},
  ): Promise<FlyMachine> {
    return (await this.rest<FlyMachine>("POST", `/apps/${encodeURIComponent(app)}/machines`, { ...opts, config }))!;
  }

  /**
   * Replace a machine's config — e.g. a new `guest.memory_mb`. Fly takes the
   * WHOLE config, so pass the current one with your change applied: a partial
   * config would drop everything you left out.
   */
  async updateMachine(app: string, id: string, config: FlyMachineConfig): Promise<FlyMachine> {
    return (await this.rest<FlyMachine>("POST", this.machinePath(app, id), { config }))!;
  }

  async startMachine(app: string, id: string): Promise<void> {
    await this.rest("POST", `${this.machinePath(app, id)}/start`);
  }

  async stopMachine(app: string, id: string): Promise<void> {
    await this.rest("POST", `${this.machinePath(app, id)}/stop`);
  }

  async destroyMachine(app: string, id: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.rest("DELETE", `${this.machinePath(app, id)}${opts.force ? "?force=true" : ""}`);
  }

  /**
   * Wait until the machine is in `state`. Fly's own `/wait` gives up after at
   * most 60 s and answers 408, so this keeps asking until `timeoutSec` is spent.
   * A 4xx other than 408 throws at once. Throws FlyTimeoutError when time runs out.
   */
  async waitForState(
    app: string,
    id: string,
    state: "started" | "stopped" | "destroyed" | "suspended",
    timeoutSec = 60,
  ): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) throw new FlyTimeoutError(`${app}/${id} to be ${state}`, undefined);
      const serverTimeout = Math.min(60, left);
      const path = `${this.machinePath(app, id)}/wait?state=${state}&timeout=${serverTimeout}`;
      try {
        // Fly holds this request open for up to serverTimeout seconds on
        // purpose, so our own limit must sit above it, not at the default.
        await this.rest("GET", path, undefined, { retry: false, timeoutMs: (serverTimeout + 15) * 1000 });
        return;
      } catch (err) {
        // 408 is Fly's "not yet". A 5xx or a network blip is also worth
        // another round while time is left. Anything else is a real answer.
        const transient = err instanceof FlyApiError ? isRetryableStatus(err.status) : !(err instanceof FlyTimeoutError);
        if (!transient) throw err;
        if (Date.now() >= deadline) throw new FlyTimeoutError(`${app}/${id} to be ${state}`, undefined);
        if (!(err instanceof FlyApiError && err.status === 408)) await this.sleep(1000);
      }
    }
  }

  /**
   * Poll until the machine reaches a terminal state (stopped, destroyed,
   * failed) and report how it ended. A permanent HTTP failure throws at once;
   * a transient one is retried inside getMachine. Throws FlyTimeoutError after
   * `maxMs`.
   */
  async waitForExit(app: string, id: string, opts: { maxMs?: number; pollMs?: number } = {}): Promise<FlyExit> {
    const maxMs = opts.maxMs ?? 30 * 60 * 1000;
    const pollMs = opts.pollMs ?? 5000;
    const deadline = Date.now() + maxMs;
    let last: string | undefined;
    for (;;) {
      const m = await this.getMachine(app, id);
      if (!m) return { state: "destroyed", exitCode: null };
      last = m.state;
      if (m.state === "stopped" || m.state === "destroyed" || m.state === "failed") {
        return { state: m.state, exitCode: exitCodeOf(m) };
      }
      if (Date.now() >= deadline) throw new FlyTimeoutError(`${app}/${id} to exit`, last);
      await this.sleep(pollMs);
    }
  }

  // ── GraphQL: only what the fleet uses ──

  async listOrgs(): Promise<FlyOrg[]> {
    const d = await this.gql<{ organizations: { nodes: FlyOrg[] } }>(
      "query { organizations { nodes { id slug name type } } }",
    );
    return d.organizations.nodes;
  }

  /**
   * Every app the token can see, in every org, all pages. Throws if a page
   * fails, and if the pages add up to fewer apps than Fly's own `totalCount`
   * — a partial list must never look like a complete one, because callers
   * delete what is missing from it.
   */
  async listAllApps(pageSize = 100): Promise<FlyAppNode[]> {
    const out: FlyAppNode[] = [];
    let after: string | null = null;
    let total = 0;
    for (;;) {
      const d: {
        apps: { nodes: FlyAppNode[]; totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } = await this.gql(
        `query($first: Int!, $after: String) {
          apps(first: $first, after: $after) {
            nodes { name status hostname organization { slug } }
            totalCount
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { first: pageSize, after },
      );
      out.push(...d.apps.nodes);
      total = d.apps.totalCount;
      if (!d.apps.pageInfo.hasNextPage) break;
      after = d.apps.pageInfo.endCursor;
    }
    if (out.length !== total) {
      throw new Error(`fly: listAllApps collected ${out.length} apps but Fly reports totalCount ${total}`);
    }
    return out;
  }

  /** Set secrets on an app (they take effect on the next machine update). */
  async setSecrets(app: string, secrets: Record<string, string>): Promise<void> {
    const appId = await this.appId(app);
    await this.gql(
      "mutation($input: SetSecretsInput!) { setSecrets(input: $input) { app { name } } }",
      { input: { appId, secrets: Object.entries(secrets).map(([key, value]) => ({ key, value })) } },
    );
  }

  /** Allocate a public IP. `shared_v4` is free; `v4` is a dedicated, billed address. */
  async allocateIp(app: string, type: "v6" | "v4" | "shared_v4" = "v6"): Promise<{ address: string; type: string }> {
    const appId = await this.appId(app);
    const d = await this.gql<{ allocateIpAddress: { ipAddress: { address: string; type: string } | null; app: { sharedIpAddress: string | null } } }>(
      `mutation($input: AllocateIPAddressInput!) {
        allocateIpAddress(input: $input) { ipAddress { address type } app { sharedIpAddress } }
      }`,
      { input: { appId, type } },
    );
    // A shared v4 is not an ipAddress row — Fly reports it on the app instead.
    const ip = d.allocateIpAddress.ipAddress;
    if (ip) return ip;
    return { address: d.allocateIpAddress.app.sharedIpAddress ?? "", type };
  }

  // ── Internals ──

  private machinePath(app: string, id: string): string {
    return `/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(id)}`;
  }

  private async appId(app: string): Promise<string> {
    const d = await this.gql<{ app: { id: string } }>("query($name: String!) { app(name: $name) { id } }", { name: app });
    return d.app.id;
  }

  private redact(text: string): string {
    return text.split(this.token).join("[redacted]").slice(0, MAX_BODY);
  }

  /** One HTTP call with the retry rule applied. Returns the Response for a 2xx. */
  private async send(
    method: string,
    url: string,
    path: string,
    body: unknown,
    retry: boolean,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const attempts = retry ? this.maxAttempts : 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await this.sleep(250 * 2 ** (i - 1));
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // A network failure never reached Fly: always worth another try.
        lastErr = new Error(`fly: ${method} ${path} failed before an answer: ${this.redact(String(err))}`);
        continue;
      }
      if (res.ok) return res;
      const err = new FlyApiError(res.status, method, path, this.redact(await res.text().catch(() => "")));
      if (!isRetryableStatus(res.status)) throw err;
      lastErr = err;
    }
    throw lastErr;
  }

  private async rest<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T | null> {
    try {
      const res = await this.send(method, MACHINES_API + path, path, body, opts.retry ?? true, opts.timeoutMs);
      const text = await res.text();
      return (text ? JSON.parse(text) : null) as T | null;
    } catch (err) {
      if (opts.nullOn404 && err instanceof FlyApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.send("POST", GRAPHQL_API, "/graphql", { query, variables }, true);
    const json = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    // HTTP 200 does not mean it worked: Fly reports auth and not-found here.
    const first = json.errors?.[0];
    if (first) {
      const code = first.extensions?.code;
      throw new FlyApiError(GQL_CODE_STATUS[code ?? ""] ?? 200, "POST", "/graphql", this.redact(first.message), code);
    }
    if (!json.data) throw new FlyApiError(200, "POST", "/graphql", "no data and no errors in the response");
    return json.data;
  }
}

/** The exit code from a machine's events, or null when Fly recorded none. */
export function exitCodeOf(m: Pick<FlyMachine, "events">): number | null {
  for (const ev of m.events ?? []) {
    const code = ev.request?.exit_event?.exit_code;
    if (ev.type === "exit" && typeof code === "number") return code;
  }
  return null;
}
