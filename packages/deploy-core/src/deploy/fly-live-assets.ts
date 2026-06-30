// Embedded assets for the Fly Live sync-endpoint server.
// Written to a temp dir at infra-provision time; never required for content-sync.

export const FLY_LIVE_SERVER_TS = `// Fly Live sync-endpoint server. Runs inside the Docker image on Fly.io.
// Serves static files from /srv/current AND handles HMAC-signed /_icd/* endpoints.
// Auth: HMAC-SHA256 over \`\${timestamp}\\n\${method}\\n\${pathWithQuery}\\n\${sha256(body)}\`.
// Atomic deploys: staging dir under /srv/deploys/<id>/, symlink swap at /srv/current.

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  access, cp, lstat, mkdir, readdir, readFile, rename,
  rm, stat, symlink, unlink, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const SERVER_VERSION = "1.0.0";
const PORT = Number(process.env.PORT || 8080);
const DATA_ROOT = process.env.SITE_DATA_ROOT || "/srv";
const CURRENT = join(DATA_ROOT, "current");
const DEPLOYS = join(DATA_ROOT, "deploys");
const SYNC_SECRET = process.env.SYNC_SECRET;
const MAX_SKEW_SECONDS = 300;
const KEEP_DEPLOYS = 5;

if (!SYNC_SECRET) { console.error("[fly-live] SYNC_SECRET env var is required"); process.exit(1); }

await ensureDirs();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/_icd/")) return handleIcd(req, url);
    return serveStatic(url.pathname);
  },
  error(err) { console.error("[fly-live] server error", err); return new Response("Internal error", { status: 500 }); },
});

console.log(\`[fly-live] v\${SERVER_VERSION} listening on :\${PORT} (data root: \${DATA_ROOT})\`);

async function handleIcd(req, url) {
  const body = req.method === "GET" || req.method === "HEAD" ? new Uint8Array() : new Uint8Array(await req.arrayBuffer());
  const authErr = verifyAuth(req, url, body);
  if (authErr) return authErr;
  if (req.method === "GET" && url.pathname === "/_icd/health") return json({ ok: true, version: SERVER_VERSION });
  if (req.method === "GET" && url.pathname === "/_icd/manifest") return json({ deployId: await readCurrentDeployId(), files: await buildManifest(CURRENT) });
  if (req.method === "POST" && url.pathname === "/_icd/deploys") return json({ deployId: await beginDeploy() });
  const putMatch = url.pathname.match(/^\\/_icd\\/deploys\\/([\\w-]+)\\/files$/);
  if (putMatch && req.method === "PUT") { const p = url.searchParams.get("path"); if (!p) return json({ error: "path required" }, 400); return (await writeDeployFile(putMatch[1], p, body)) ?? json({ ok: true }); }
  if (putMatch && req.method === "DELETE") { const p = url.searchParams.get("path"); if (!p) return json({ error: "path required" }, 400); return (await deleteDeployFile(putMatch[1], p)) ?? json({ ok: true }); }
  const commitMatch = url.pathname.match(/^\\/_icd\\/deploys\\/([\\w-]+)\\/commit$/);
  if (commitMatch && req.method === "POST") return (await commitDeploy(commitMatch[1])) ?? json({ ok: true, deployId: commitMatch[1] });
  const abortMatch = url.pathname.match(/^\\/_icd\\/deploys\\/([\\w-]+)$/);
  if (abortMatch && req.method === "DELETE") { await abortDeploy(abortMatch[1]); return json({ ok: true }); }
  if (req.method === "POST" && url.pathname === "/_icd/rollback") { try { const { deployId } = body.length > 0 ? JSON.parse(new TextDecoder().decode(body)) : {}; return json({ ok: true, deployId: await rollback(deployId) }); } catch (e) { return json({ error: e.message }, 400); } }
  return json({ error: "not found" }, 404);
}

async function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname.replace(/^\\/+/, ""));
  if (rel === "") rel = "index.html";
  const full = resolve(CURRENT, rel);
  if (!full.startsWith(resolve(CURRENT) + "/") && full !== resolve(CURRENT)) return new Response("Forbidden", { status: 403 });
  try {
    const s = await stat(full);
    if (s.isDirectory()) { try { await access(join(full, "index.html")); return fileResponse(join(full, "index.html")); } catch { return new Response("Not found", { status: 404 }); } }
    return fileResponse(full);
  } catch {
    try { await access(\`\${full}.html\`); return fileResponse(\`\${full}.html\`); } catch {}
    try { await access(join(CURRENT, "404.html")); return fileResponse(join(CURRENT, "404.html"), 404); } catch {}
    return new Response("Not found", { status: 404 });
  }
}

function fileResponse(p, status = 200) { return new Response(Bun.file(p), { status }); }

function verifyAuth(req, url, body) {
  const sig = req.headers.get("x-cms-signature"), ts = req.headers.get("x-cms-timestamp");
  if (!sig || !ts) return json({ error: "missing auth headers" }, 401);
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > MAX_SKEW_SECONDS) return json({ error: "bad timestamp" }, 401);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const payload = \`\${ts}\\n\${req.method}\\n\${url.pathname + url.search}\\n\${bodyHash}\`;
  const expected = createHmac("sha256", SYNC_SECRET).update(payload).digest("hex");
  const given = sig.replace(/^sha256=/, "");
  if (expected.length !== given.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return json({ error: "invalid signature" }, 401);
  return null;
}

async function buildManifest(rootResolved) {
  const out = {};
  try { await walkDir(rootResolved, rootResolved, out); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return out;
}

async function walkDir(rootResolved, dir, out) {
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return; throw e; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkDir(rootResolved, full, out);
    else if (e.isFile()) out[relative(rootResolved, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
}

async function ensureDirs() {
  await mkdir(DEPLOYS, { recursive: true });
  try { await lstat(CURRENT); } catch {
    const initial = join(DEPLOYS, "initial");
    await mkdir(initial, { recursive: true });
    await writeFile(join(initial, "index.html"), '<!doctype html><meta charset="utf-8"><title>Awaiting first deploy</title><body style="font-family:system-ui;padding:2rem;color:#666"><h1>Fly Live — awaiting first content deploy</h1></body>');
    await symlink(initial, CURRENT);
  }
}

async function readCurrentDeployId() {
  try { const { readlink } = await import("node:fs/promises"); const t = await readlink(CURRENT); return t.split("/").pop() ?? null; } catch { return null; }
}

async function beginDeploy() {
  const id = \`\${Date.now()}-\${randomUUID().slice(0, 8)}\`;
  const dir = join(DEPLOYS, id);
  await mkdir(dir, { recursive: true });
  try { const { readlink } = await import("node:fs/promises"); const t = await readlink(CURRENT); if (t) { const src = t.startsWith("/") ? t : join(DATA_ROOT, t); await cp(src, dir, { recursive: true, errorOnExist: false, force: true }); } } catch (e) { if (e.code !== "ENOENT") console.warn("[fly-live] begin: could not copy current tree:", e.message); }
  return id;
}

function safeJoin(root, rel) { const full = resolve(root, rel), r = resolve(root); return (full === r || !full.startsWith(r + "/")) ? null : full; }
async function pathExists(p) { try { await access(p); return true; } catch { return false; } }

async function writeDeployFile(deployId, relPath, body) {
  const deployDir = join(DEPLOYS, deployId);
  if (!await pathExists(deployDir)) return json({ error: "deploy not found" }, 404);
  const guarded = safeJoin(deployDir, relPath);
  if (!guarded) return json({ error: "path traversal rejected" }, 400);
  await mkdir(dirname(guarded), { recursive: true });
  const tmp = \`\${guarded}.tmp-\${process.pid}-\${Date.now()}\`;
  await writeFile(tmp, body); await rename(tmp, guarded);
  return null;
}

async function deleteDeployFile(deployId, relPath) {
  const deployDir = join(DEPLOYS, deployId);
  if (!await pathExists(deployDir)) return json({ error: "deploy not found" }, 404);
  const guarded = safeJoin(deployDir, relPath);
  if (!guarded) return json({ error: "path traversal rejected" }, 400);
  try { await unlink(guarded); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return null;
}

async function commitDeploy(deployId) {
  const deployDir = join(DEPLOYS, deployId);
  if (!await pathExists(deployDir)) return json({ error: "deploy not found" }, 404);
  const tmp = \`\${CURRENT}.swap-\${Date.now()}\`;
  await symlink(deployDir, tmp); await rename(tmp, CURRENT);
  await pruneOldDeploys();
  return null;
}

async function abortDeploy(deployId) { await rm(join(DEPLOYS, deployId), { recursive: true, force: true }); }

async function rollback(explicitId) {
  const entries = await readdir(DEPLOYS, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const currentId = await readCurrentDeployId();
  let target = null;
  if (explicitId) { if (!dirs.includes(explicitId)) throw new Error(\`deploy \${explicitId} not found\`); target = explicitId; }
  else { const idx = currentId ? dirs.indexOf(currentId) : -1; target = idx > 0 ? dirs[idx - 1] : null; }
  if (!target) throw new Error("no previous deploy to roll back to");
  const tmp = \`\${CURRENT}.swap-\${Date.now()}\`;
  await symlink(join(DEPLOYS, target), tmp); await rename(tmp, CURRENT);
  return target;
}

async function pruneOldDeploys() {
  const entries = await readdir(DEPLOYS, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
  const keep = new Set([...dirs.slice(0, KEEP_DEPLOYS), await readCurrentDeployId()].filter(Boolean));
  for (const name of dirs) { if (!keep.has(name)) await rm(join(DEPLOYS, name), { recursive: true, force: true }); }
}

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
`;

export const FLY_LIVE_DOCKERFILE = `FROM oven/bun:1.1-alpine
WORKDIR /app
COPY server.ts ./
RUN mkdir -p /srv/deploys
ENV PORT=8080
ENV SITE_DATA_ROOT=/srv
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
`;

export const FLY_LIVE_TOML_TEMPLATE = `# Generated by @broberg/deploy-core Fly Live provider. Do not edit by hand.
app = "{{APP_NAME}}"
primary_region = "{{REGION}}"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"

[mounts]
  source = "{{VOLUME_NAME}}"
  destination = "/srv"
  initial_size = "1gb"
`;
