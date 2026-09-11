import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { FLY_LIVE_DOCKERFILE, FLY_LIVE_SERVER_TS, FLY_LIVE_TOML_TEMPLATE } from "./fly-live-assets.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FlyLiveConfig {
  /** Fly app name (e.g. "my-site"). */
  appName: string;
  /** Fly region (e.g. "arn"). */
  region: string;
  /** Fly volume name for persistent storage. */
  volumeName: string;
  /** HMAC shared secret — generate with generateSyncSecret(). */
  syncSecret: string;
  /** Custom domain (optional). */
  customDomain?: string;
  /**
   * Answer `index.html` with status **200** on an unknown ROUTE (F033.12).
   *
   * OFF BY DEFAULT, and deliberately: this package deploys live fleet sites, and
   * a static-site consumer relying on a real 404 would silently begin serving a
   * 200 for every typo.
   *
   * WHY IT EXISTS. Without it a single-page app is reachable only on exact file
   * paths — helpdesk measured `/velkommen` 404 in production while `/` answered
   * 200, with their invitation and forgot-password links dead. Every local check
   * was green, INCLUDING a full browser run: Vite's dev server answers
   * index.html on any path, so the test environment is kinder than production in
   * exactly the dimension the test exists to rule out.
   *
   * A MISSING ASSET STILL 404s. The fallback fires only for a request that
   * accepts HTML on an extensionless path, so a dropped `/assets/app-abc.js`
   * keeps failing loudly rather than returning HTML with a 200 — which would
   * make an incomplete deploy look like a working one.
   *
   * Note this lands in fly.toml's `[env]`, so it applies at INFRA-provision
   * time. To flip it on an app that already exists without a re-provision:
   * `flyctl secrets set SPA_FALLBACK=true` (a ~30s machine restart).
   */
  spaFallback?: boolean;
}

export interface FlyLiveDeployResult {
  url: string;
  /** "infra" = full flyctl provision; "sync" = content-only HMAC sync. */
  mode: "infra" | "sync";
  filesUploaded: number;
  filesRemoved: number;
  filesUnchanged: number;
  durationMs: number;
  serverVersion?: string;
}

export interface ManifestRecord {
  [relativePath: string]: string; // sha256 hex
}

export interface IcdSignature {
  timestamp: string;
  /** Full header value, e.g. "sha256=<hex>". */
  signature: string;
}

// ── Pure utilities ───────────────────────────────────────────────────────────

/** Generate a random 32-byte hex sync secret. */
export function generateSyncSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Sign an ICD HTTP request.
 * Payload = `${timestamp}\n${METHOD}\n${pathWithQuery}\n${sha256hex(body)}`.
 */
export function signIcdRequest(
  method: string,
  pathWithQuery: string,
  body: Uint8Array | Buffer,
  secret: string,
): IcdSignature {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const payload = `${timestamp}\n${method}\n${pathWithQuery}\n${bodyHash}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return { timestamp, signature: `sha256=${sig}` };
}

/**
 * Compute a SHA-256 manifest for a flat map of relative-path → Buffer.
 * Pure: no filesystem I/O.
 */
export function buildManifest(files: Map<string, Uint8Array>): ManifestRecord {
  const out: ManifestRecord = {};
  for (const [path, buf] of files) {
    out[path] = createHash("sha256").update(buf).digest("hex");
  }
  return out;
}

/**
 * Diff two manifests, returning what must be uploaded, deleted, and what is unchanged.
 */
export function diffManifests(
  remote: ManifestRecord,
  local: ManifestRecord,
): { upload: string[]; remove: string[]; unchanged: string[] } {
  const upload: string[] = [];
  const unchanged: string[] = [];
  for (const [path, hash] of Object.entries(local)) {
    if (remote[path] === hash) unchanged.push(path);
    else upload.push(path);
  }
  const remove = Object.keys(remote).filter((p) => !(p in local));
  return { upload, remove, unchanged };
}

// ── HTTP helpers (no flyctl dependency) ──────────────────────────────────────

async function icdFetch(
  baseUrl: string,
  method: string,
  path: string,
  body: Uint8Array | Buffer,
  secret: string,
  query?: Record<string, string>,
): Promise<Response> {
  const pathWithQuery =
    Object.keys(query ?? {}).length > 0
      ? `${path}?${new URLSearchParams(query!).toString()}`
      : path;
  const { timestamp, signature } = signIcdRequest(method, pathWithQuery, body, secret);
  const res = await fetch(`${baseUrl}${pathWithQuery}`, {
    method,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    headers: {
      "x-cms-timestamp": timestamp,
      "x-cms-signature": signature,
      "content-type": "application/octet-stream",
    },
  });
  return res;
}

async function icdJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`ICD HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

// ── Content sync (no flyctl) ─────────────────────────────────────────────────

/**
 * Push a flat file map to an already-running Fly Live endpoint.
 * No flyctl required — pure HMAC HTTPS sync.
 */
export async function syncContent(
  config: Pick<FlyLiveConfig, "appName" | "syncSecret">,
  files: Map<string, Uint8Array>,
  options?: { baseUrl?: string },
): Promise<Pick<FlyLiveDeployResult, "filesUploaded" | "filesRemoved" | "filesUnchanged" | "mode">> {
  const baseUrl = options?.baseUrl ?? `https://${config.appName}.fly.dev`;
  const secret = config.syncSecret;
  const empty = new Uint8Array(0);

  // 1. Fetch remote manifest
  const manifestRes = await icdFetch(baseUrl, "GET", "/_icd/manifest", empty, secret);
  const { files: remoteManifest } = await icdJson<{
    deployId: string | null;
    files: ManifestRecord;
  }>(manifestRes);

  // 2. Build local manifest + diff
  const localManifest = buildManifest(files);
  const { upload, remove, unchanged } = diffManifests(remoteManifest, localManifest);

  if (upload.length === 0 && remove.length === 0) {
    return { filesUploaded: 0, filesRemoved: 0, filesUnchanged: unchanged.length, mode: "sync" };
  }

  // 3. Begin deploy
  const beginRes = await icdFetch(baseUrl, "POST", "/_icd/deploys", empty, secret);
  const { deployId } = await icdJson<{ deployId: string }>(beginRes);

  try {
    // 4. Upload changed/new files
    for (const relPath of upload) {
      const buf = files.get(relPath)!;
      const res = await icdFetch(baseUrl, "PUT", `/_icd/deploys/${deployId}/files`, buf, secret, {
        path: relPath,
      });
      await icdJson(res);
    }

    // 5. Delete removed files
    for (const relPath of remove) {
      const res = await icdFetch(
        baseUrl,
        "DELETE",
        `/_icd/deploys/${deployId}/files`,
        empty,
        secret,
        { path: relPath },
      );
      await icdJson(res);
    }

    // 6. Commit
    const commitRes = await icdFetch(
      baseUrl,
      "POST",
      `/_icd/deploys/${deployId}/commit`,
      empty,
      secret,
    );
    await icdJson(commitRes);
  } catch (err) {
    // Best-effort abort so we don't leave a dangling staging dir
    try {
      await icdFetch(baseUrl, "DELETE", `/_icd/deploys/${deployId}`, empty, secret);
    } catch {}
    throw err;
  }

  return {
    filesUploaded: upload.length,
    filesRemoved: remove.length,
    filesUnchanged: unchanged.length,
    mode: "sync",
  };
}

// ── Infra provision (requires flyctl) ────────────────────────────────────────

function assertFlyctl(): void {
  try {
    execFileSync("flyctl", ["version"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "flyctl is not installed or not on PATH — required for infra provisioning.\n" +
        "Install: https://fly.io/docs/flyctl/install/",
    );
  }
}

/**
 * Remove a secret value from text.
 *
 * Defence in depth ONLY. The value is never put into argv (see `stageSyncSecret`),
 * so nothing we construct can carry it — this exists for the output we do not
 * control: flyctl's own stdout/stderr.
 */
export function redactSyncSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("«SYNC_SECRET redacted»");
}

function runFlyctl(args: string[], cwd: string): void {
  execFileSync("flyctl", args, { cwd, stdio: "inherit" });
}

/**
 * Run flyctl and capture its output instead of throwing.
 *
 * The caller decides what a failure means. That is the point: a swallowed error
 * makes "already exists" and "the region is full" the same answer.
 */
function runFlyctlCapture(
  args: string[],
  cwd: string,
): { ok: true; stdout: string } | { ok: false; stderr: string } {
  try {
    const stdout = execFileSync("flyctl", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout ?? "" };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : (e.message ?? "unknown flyctl failure");
    return { ok: false, stderr };
  }
}

function parseFlyJson<T>(stdout: string, what: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`flyctl ${what} did not return JSON — got: ${stdout.slice(0, 200)}`);
  }
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/**
 * Hand the sync secret to flyctl over STDIN.
 *
 * `secrets set KEY=value` puts the value in the argument list, where any process
 * on the machine can read it with `ps`, the shell keeps it in history, and Node's
 * own "Command failed: …" error prints it back. `secrets import` reads KEY=value
 * from stdin, so none of those three can see it.
 */
function stageSyncSecret(config: FlyLiveConfig, cwd: string): void {
  try {
    execFileSync("flyctl", ["secrets", "import", "--stage", "--app", config.appName], {
      cwd,
      input: `SYNC_SECRET=${config.syncSecret}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const detail = String(e.stderr ?? "") || String(e.message ?? "");
    throw new Error(
      `flyctl secrets import failed for app "${config.appName}": ` +
        redactSyncSecret(detail, config.syncSecret).trim(),
    );
  }
}

/**
 * Fail early, by name, when the app does not exist.
 *
 * Without this the first flyctl call returns a GraphQL "Could not find App" and
 * the run dies three commands later on something unrelated.
 */
function assertAppExists(appName: string, cwd: string): void {
  const res = runFlyctlCapture(["status", "--app", appName], cwd);
  if (res.ok) return;
  if (/could not find app/i.test(res.stderr)) {
    throw new Error(
      `Fly app "${appName}" does not exist. This function deploys INTO an app that already exists — it does not create one.\n` +
        `Create it first:  flyctl apps create ${appName} --org <your-org>`,
    );
  }
  throw new Error(`flyctl could not read the status of app "${appName}": ${res.stderr.trim()}`);
}

/** Create the volume only when it is genuinely absent — never by ignoring an error. */
function ensureVolume(config: FlyLiveConfig, cwd: string): void {
  const res = runFlyctlCapture(["volumes", "list", "--app", config.appName, "--json"], cwd);
  if (!res.ok) {
    throw new Error(`could not list volumes for app "${config.appName}": ${res.stderr.trim()}`);
  }
  const volumes = parseFlyJson<{ name?: string }>(res.stdout, "volumes list");
  if (volumes.some((v) => v.name === config.volumeName)) return;
  runFlyctl(
    [
      "volumes",
      "create",
      config.volumeName,
      "--app",
      config.appName,
      "--region",
      config.region,
      "--size",
      "1",
      "--yes",
    ],
    cwd,
  );
}

/**
 * Allocate public IP addresses explicitly.
 *
 * A first deploy can report success while the IPv6 allocation inside it failed —
 * the machine runs and <app>.fly.dev resolves nowhere, which then surfaces as a
 * connection refused in whatever the caller does next.
 */
function ensurePublicIps(appName: string, cwd: string): void {
  const res = runFlyctlCapture(["ips", "list", "--app", appName, "--json"], cwd);
  if (!res.ok) {
    throw new Error(`could not list IP addresses for app "${appName}": ${res.stderr.trim()}`);
  }
  const ips = parseFlyJson<{ Type?: string; type?: string }>(res.stdout, "ips list");
  const kinds = new Set(ips.map((i) => String(i.Type ?? i.type ?? "").toLowerCase()));
  if (!kinds.has("v6")) runFlyctl(["ips", "allocate-v6", "--app", appName], cwd);
  if (!kinds.has("v4") && !kinds.has("shared_v4")) {
    runFlyctl(["ips", "allocate-v4", "--shared", "--app", appName], cwd);
  }
}

/** Add the certificate only when it is absent — a failure to add is reported, not swallowed. */
function ensureCert(domain: string, appName: string, cwd: string): void {
  const res = runFlyctlCapture(["certs", "list", "--app", appName, "--json"], cwd);
  if (!res.ok) {
    throw new Error(`could not list certificates for app "${appName}": ${res.stderr.trim()}`);
  }
  const certs = parseFlyJson<{ Hostname?: string; hostname?: string }>(res.stdout, "certs list");
  if (certs.some((c) => (c.Hostname ?? c.hostname) === domain)) return;
  runFlyctl(["certs", "add", domain, "--app", appName], cwd);
}

/**
 * Refuse a config that is missing a field this function cannot work without.
 *
 * Reported by helpdesk from their own wrong call: `{ app: name }` instead of
 * `{ appName: name }`. Plain JS, so no type error — and the run went all the
 * way to the remedy we print, which then read:
 *
 *     flyctl apps create undefined --org <your-org>
 *
 * Right shape, invented content, and copyable. A reader who does not look twice
 * runs it. A message that is WRONG is worse than one that is missing, because
 * the missing one is not actionable.
 */
function assertRequiredConfig(config: FlyLiveConfig): void {
  const missing = (['appName', 'region', 'volumeName', 'syncSecret'] as const).filter(
    (k) => typeof config?.[k] !== 'string' || config[k].trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `flyLiveRebuildInfra: missing required config field(s): ${missing.join(', ')}. ` +
        `Nothing was run — a remedy built from a missing app name would name an app that does not exist.`,
    );
  }
}

/**
 * Ask the URL whether it is live before we hand it back as a fact.
 *
 * The returned URL IS the claim "this is running". Returning it unchecked is how
 * a missing IP address, a crashed boot and a healthy app all look identical.
 */
async function verifyLive(
  baseUrl: string,
  secret: string,
  attempts: number,
  delayMs: number,
): Promise<void> {
  let last = "no attempt was made";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await icdFetch(baseUrl, "GET", "/_icd/health", new Uint8Array(0), secret);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `the deploy finished but ${baseUrl}/_icd/health never answered (${attempts} attempts, last: ${last}). ` +
      `The app may have no public IP address — check \`flyctl ips list\`.`,
  );
}

/**
 * Deploy the Fly Live server into an EXISTING Fly app: writes the embedded
 * assets to a temp dir, ensures the volume, stages the sync secret, deploys,
 * ensures public IPs, and verifies the URL answers before returning it.
 *
 * It does NOT create the Fly app or the organisation — creating billable
 * infrastructure is the caller's decision, not a library's. A missing app fails
 * with the exact `flyctl apps create` command to run.
 *
 * Requires flyctl on PATH.
 */
export async function flyLiveRebuildInfra(
  config: FlyLiveConfig,
  options?: { baseUrl?: string; verifyAttempts?: number; verifyDelayMs?: number },
): Promise<string> {
  assertRequiredConfig(config);
  assertFlyctl();
  const tmpDir = join(tmpdir(), `fly-live-infra-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    assertAppExists(config.appName, tmpDir);

    await writeFile(join(tmpDir, "server.ts"), FLY_LIVE_SERVER_TS, "utf8");
    await writeFile(join(tmpDir, "Dockerfile"), FLY_LIVE_DOCKERFILE, "utf8");
    const toml = FLY_LIVE_TOML_TEMPLATE.replace(/{{APP_NAME}}/g, config.appName)
      .replace(/{{REGION}}/g, config.region)
      .replace(/{{VOLUME_NAME}}/g, config.volumeName)
      // Written as the literal string the server compares against, so an absent
      // field and an explicit `false` produce the same bytes — there is no third
      // state to read differently at either end.
      .replace(/{{SPA_FALLBACK}}/g, config.spaFallback === true ? "true" : "false");
    await writeFile(join(tmpDir, "fly.toml"), toml, "utf8");

    ensureVolume(config, tmpDir);
    stageSyncSecret(config, tmpDir);

    runFlyctl(["deploy", "--app", config.appName, "--remote-only"], tmpDir);

    ensurePublicIps(config.appName, tmpDir);

    if (config.customDomain) {
      ensureCert(config.customDomain, config.appName, tmpDir);
    }

    const baseUrl = options?.baseUrl ?? `https://${config.appName}.fly.dev`;
    await verifyLive(
      baseUrl,
      config.syncSecret,
      options?.verifyAttempts ?? 12,
      options?.verifyDelayMs ?? 5000,
    );
    return baseUrl;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── High-level deploy entry point ─────────────────────────────────────────────

/**
 * Deploy files to a Fly Live app.
 * - If the app is reachable, uses content-sync (no flyctl required).
 * - If the app is unreachable or `forceInfra` is set, falls back to full infra provision.
 */
export async function flyLiveDeploy(
  config: FlyLiveConfig,
  files: Map<string, Uint8Array>,
  options?: { forceInfra?: boolean; baseUrl?: string },
): Promise<FlyLiveDeployResult> {
  const t0 = Date.now();
  const baseUrl = options?.baseUrl ?? `https://${config.appName}.fly.dev`;

  // Check if the endpoint is alive
  let appAlive = false;
  if (!options?.forceInfra) {
    try {
      const healthRes = await icdFetch(baseUrl, "GET", "/_icd/health", new Uint8Array(0), config.syncSecret);
      appAlive = healthRes.ok;
    } catch {}
  }

  if (!appAlive) {
    // Provision infra first
    await flyLiveRebuildInfra(config, { baseUrl });
  }

  const syncResult = await syncContent(config, files, { baseUrl });
  let serverVersion: string | undefined;
  try {
    const healthRes = await icdFetch(baseUrl, "GET", "/_icd/health", new Uint8Array(0), config.syncSecret);
    if (healthRes.ok) {
      const body = (await healthRes.json()) as { version?: string };
      serverVersion = body.version;
    }
  } catch {}

  return {
    url: config.customDomain ? `https://${config.customDomain}` : baseUrl,
    mode: appAlive ? "sync" : "infra",
    filesUploaded: syncResult.filesUploaded,
    filesRemoved: syncResult.filesRemoved,
    filesUnchanged: syncResult.filesUnchanged,
    durationMs: Date.now() - t0,
    serverVersion,
  };
}
