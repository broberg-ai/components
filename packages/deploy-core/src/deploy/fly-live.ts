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

function runFlyctl(args: string[], cwd: string): void {
  execFileSync("flyctl", args, { cwd, stdio: "inherit" });
}

/**
 * Provision (or re-provision) the Fly.io app from scratch.
 * Writes embedded assets to a temp dir, runs flyctl deploy.
 * Requires flyctl on PATH.
 */
export async function flyLiveRebuildInfra(config: FlyLiveConfig): Promise<string> {
  assertFlyctl();
  const tmpDir = join(tmpdir(), `fly-live-infra-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    await writeFile(join(tmpDir, "server.ts"), FLY_LIVE_SERVER_TS, "utf8");
    await writeFile(join(tmpDir, "Dockerfile"), FLY_LIVE_DOCKERFILE, "utf8");
    const toml = FLY_LIVE_TOML_TEMPLATE.replace(/{{APP_NAME}}/g, config.appName)
      .replace(/{{REGION}}/g, config.region)
      .replace(/{{VOLUME_NAME}}/g, config.volumeName);
    await writeFile(join(tmpDir, "fly.toml"), toml, "utf8");

    // Create volume if it doesn't exist (ignore error if already exists)
    try {
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
        tmpDir,
      );
    } catch {}

    // Set sync secret
    runFlyctl(
      [
        "secrets",
        "set",
        `SYNC_SECRET=${config.syncSecret}`,
        "--app",
        config.appName,
        "--stage",
      ],
      tmpDir,
    );

    // Deploy
    runFlyctl(["deploy", "--app", config.appName, "--remote-only"], tmpDir);

    if (config.customDomain) {
      try {
        runFlyctl(["certs", "add", config.customDomain, "--app", config.appName], tmpDir);
      } catch {}
    }

    return `https://${config.appName}.fly.dev`;
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
    await flyLiveRebuildInfra(config);
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
