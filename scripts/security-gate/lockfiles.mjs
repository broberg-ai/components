// F427.1 — what a repo SHIPS, read from its lockfiles. No network, no tool: pure parsing, so it can be
// tested with fixtures and cannot be argued with.
//
// «Ships» = reachable from a production dependency of a workspace/importer. Build and test tooling
// (devDependencies and everything only they pull in) is the REST: it is reported, never blocks a release
// (measured in components 20/11: the whole-lockfile gate was red on 53 findings, all tooling; shipped = 0).
// A malicious package is the exception and is judged over the WHOLE tree — it runs on the build machine too.
//
// Three lockfile families are understood: pnpm-lock.yaml (v9), package-lock.json (v2/v3), bun.lock (text).
// F115.9 adds two more: Cargo.lock (Rust, OSV ecosystem crates.io) and Package.resolved (SwiftPM, OSV ecosystem SwiftURL).
// Anything else (yarn.lock, go.sum, requirements.txt …) is NAMED as not covered — never silently skipped.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const SUPPORTED = { "pnpm-lock.yaml": "pnpm", "package-lock.json": "npm", "bun.lock": "bun", "Cargo.lock": "cargo", "Package.resolved": "swiftpm" };
export const UNSUPPORTED = ["yarn.lock", "bun.lockb", "go.sum", "poetry.lock", "Pipfile.lock", "requirements.txt", "Gemfile.lock", "composer.lock"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", ".next", "dist", "build", ".turbo", ".venv", "venv"]);

/** Every lockfile under `root`, as {path (relative, posix), kind, supported}. `exclude` = path prefixes to ignore. */
export function findLockfiles(root, exclude = []) {
  const out = [];
  const ex = exclude.map((e) => e.replace(/\/+$/, ""));
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join("/");
      if (ex.some((e) => rel === e || rel.startsWith(e + "/"))) continue;
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) { walk(abs); continue; }
      if (SUPPORTED[name]) out.push({ path: rel, kind: SUPPORTED[name], supported: true });
      else if (UNSUPPORTED.includes(name)) out.push({ path: rel, kind: name, supported: false });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const key = (name, version) => `${name}@${version}`;
/** A workspace directory the caller says does not ship (examples, demos): its dependencies are not judged. */
const skipped = (dir, prefixes) => prefixes.some((p) => dir === p.replace(/\/+$/, "") || dir.startsWith(p.replace(/\/+$/, "") + "/"));
const isRegistryVersion = (v) => /^\d+\.\d+\.\d+/.test(v) && !/^(link|file|workspace|git|github|npm:|http)/.test(v);

// ---------------------------------------------------------------- pnpm (v9)
/** `lock` = the parsed YAML. For every importer (the root and each workspace package) walk its dependencies
 *  through the lock's snapshots; `shipped` starts from dependencies + optionalDependencies only, `all` adds
 *  devDependencies. A `link:` dependency is a workspace sibling — its own importer is walked on its own. */
export function parsePnpm(lock, skipImporters = [], readPkg = () => null) {
  const snapshots = lock?.snapshots ?? {};
  const walk = (target, seen, name, v) => {
    const raw = String(v);
    const bare = raw.split("(")[0];
    const at = bare.lastIndexOf("@");
    const full = at > 0 ? raw : `${name}@${raw}`; // an npm alias is locked as <real-name>@<ver>
    if (seen.has(full)) return;
    seen.add(full);
    target.add(at > 0 ? bare : key(name, bare));
    const sn = snapshots[full] ?? {};
    for (const [n, cv] of Object.entries({ ...(sn.dependencies ?? {}), ...(sn.optionalDependencies ?? {}) })) walk(target, seen, n, cv);
  };
  const shipped = new Set(), all = new Set();
  const seenShipped = new Set(), seenAll = new Set();
  const nonRegistry = [];
  for (const [dir, imp] of Object.entries(lock?.importers ?? {})) {
    if (skipped(dir, skipImporters)) continue;
    // pnpm's autoInstallPeers writes a package's peer dependencies into the importer's `dependencies`, so the lock alone
    // cannot tell «this library ships X» from «pnpm installed X so the tests run». The package.json can: a library ships
    // what it LISTS in dependencies/optionalDependencies, never its peers (the consumer picks those).
    const pkg = readPkg(dir);
    const declaredProd = pkg ? new Set(Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) })) : null;
    const groups = [["prod", imp.dependencies], ["prod", imp.optionalDependencies], ["dev", imp.devDependencies]];
    for (const [kind, g] of groups) for (const [n, d] of Object.entries(g ?? {})) {
      const v = String(d?.version ?? "");
      if (!v || v.startsWith("link:")) continue;
      if (/^(git|github|https?:)/.test(v) || v.includes("tarball")) { nonRegistry.push(key(n, v)); continue; }
      if (kind === "prod" && (declaredProd === null || declaredProd.has(n))) walk(shipped, seenShipped, n, v);
      walk(all, seenAll, n, v);
    }
  }
  return { shipped, all, nonRegistry };
}

// ---------------------------------------------------------------- npm (package-lock v2/v3)
export function parseNpm(lock) {
  const all = new Set();
  const shipped = new Set();
  const nonRegistry = [];
  for (const [path, p] of Object.entries(lock?.packages ?? {})) {
    if (path === "" || p.link) continue;
    const name = p.name ?? path.split("node_modules/").pop();
    if (!p.version) continue;
    if (p.resolved && !/^https?:\/\/registry\./.test(p.resolved) && !/^https?:\/\/.*\/-\//.test(p.resolved)) { nonRegistry.push(key(name, p.version)); continue; }
    all.add(key(name, p.version));
    if (!p.dev && !p.devOptional && !p.peer) shipped.add(key(name, p.version)); // peer: reachable only through a peer dependency — the consumer picks it
  }
  return { shipped, all, nonRegistry };
}

// ---------------------------------------------------------------- bun (text lockfile, JSONC)
export function parseJsonc(text) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === "\\") out += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function parseBun(lock, skipImporters = []) {
  const pkgs = lock?.packages ?? {};
  const all = new Set();
  const shipped = new Set();
  const nonRegistry = [];
  const idOf = (entry) => {
    const spec = String(entry?.[0] ?? "");
    const at = spec.lastIndexOf("@");
    if (at <= 0) return null;
    const name = spec.slice(0, at), version = spec.slice(at + 1);
    return isRegistryVersion(version) ? key(name, version) : { skip: spec };
  };
  // bun nests a conflicting version under "<parent>/<name>"; resolve a dependency by walking up the parents.
  const resolve = (parentKey, dep) => {
    let scope = parentKey;
    for (;;) {
      const k = scope ? `${scope}/${dep}` : dep;
      if (pkgs[k]) return k;
      if (!scope) return null;
      const cut = scope.lastIndexOf("/");
      scope = cut > 0 && scope[cut - 1] !== "@" ? scope.slice(0, cut) : "";
    }
  };
  const walk = (target, k, seen) => {
    if (seen.has(k)) return;
    seen.add(k);
    const entry = pkgs[k];
    if (!entry) return;
    const id = idOf(entry);
    if (!id) return;
    if (typeof id === "object") { nonRegistry.push(id.skip); return; }
    target.add(id);
    const meta = entry[2] ?? {};
    for (const d of Object.keys({ ...(meta.dependencies ?? {}), ...(meta.optionalDependencies ?? {}) })) {
      const r = resolve(k, d);
      if (r) walk(target, r, seen);
    }
  };
  const seenProd = new Set(), seenAll = new Set();
  for (const [dir, w] of Object.entries(lock?.workspaces ?? {})) {
    if (skipped(dir, skipImporters)) continue;
    for (const d of Object.keys({ ...(w.dependencies ?? {}), ...(w.optionalDependencies ?? {}) })) { const r = resolve("", d); if (r) walk(shipped, r, seenProd); }
    for (const d of Object.keys({ ...(w.dependencies ?? {}), ...(w.optionalDependencies ?? {}), ...(w.devDependencies ?? {}) })) { const r = resolve("", d); if (r) walk(all, r, seenAll); }
  }
  return { shipped, all, nonRegistry };
}

// ---------------------------------------------------------------- Cargo.lock (F115.9)
/** A dependency key for an ecosystem other than npm: `<OSV ecosystem>::name@version`. npm keeps plain `name@version`, so
 *  every existing key, ack and test is unchanged; dependency-health.mjs's queryOsv reads the prefix back. */
export const ecoKey = (eco, name, version) => `${eco}::${name}@${version}`;

/**
 * Cargo.lock is TOML, but only a flat, regular slice of it matters: every `[[package]]` table's `name`, `version` and `source`.
 * A tiny line reader is enough and keeps the gate free of a TOML dependency. Cargo.lock does not say which crates are dev-only,
 * so every registry crate counts as SHIPPED — the safe side: a vulnerable dev crate is reported rather than missed.
 * A crate with no `source` is the project's own (a path/workspace member) and is not a dependency to check; a git crate has no
 * registry version OSV can answer for, so it is named in `nonRegistry`, like the npm git/tarball cases.
 */
export function parseCargo(text) {
  const pkgs = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "[[package]]") { cur = {}; pkgs.push(cur); continue; }
    if (line.startsWith("[")) { cur = null; continue; } // [metadata] and friends
    if (!cur) continue;
    const m = /^(name|version|source)\s*=\s*"([^"]*)"\s*$/.exec(line);
    if (m) cur[m[1]] = m[2];
  }
  if (pkgs.length === 0) throw new Error("Cargo.lock holds no [[package]] table");
  const all = new Set(), nonRegistry = [];
  for (const p of pkgs) {
    if (!p.name || !p.version || !p.source) continue; // incomplete table, or the project's own crate
    if (/^(registry|sparse)\+/.test(p.source)) all.add(ecoKey("crates.io", p.name, p.version));
    else nonRegistry.push(`${p.name}@${p.version}`);
  }
  return { shipped: new Set(all), all, nonRegistry };
}

// ---------------------------------------------------------------- Package.resolved (SwiftPM, F115.9)
/** `https://github.com/apple/swift-nio.git` / `git@github.com:apple/swift-nio.git` → `github.com/apple/swift-nio`, the name OSV's
 *  SwiftURL ecosystem uses. (Measured 21 Nov 2026: OSV answers for that form and returns nothing for the full URL.) */
const swiftName = (location) =>
  String(location).trim().replace(/^[a-z+]+:\/\//i, "").replace(/^[^@/]+@/, "").replace(/^([^/:]+):/, "$1/").replace(/\.git$/i, "").replace(/\/+$/, "");

/** v2/v3 keep `pins[]` with `location` and `state.version`; v1 keeps `object.pins[]` with `repositoryURL`. All pins count as shipped. */
export function parseSwiftPm(json) {
  const pins = Array.isArray(json?.pins) ? json.pins : Array.isArray(json?.object?.pins) ? json.object.pins : null;
  if (!pins) throw new Error("Package.resolved has no pins list");
  const all = new Set(), nonRegistry = [];
  for (const p of pins) {
    if (p?.kind === "localSourceControl" || p?.kind === "fileSystem") continue; // a path on this machine: not a published dependency
    const name = swiftName(p?.location ?? p?.repositoryURL ?? "");
    if (!name) continue;
    const version = p?.state?.version;
    if (typeof version === "string" && version) all.add(ecoKey("SwiftURL", name, version));
    else nonRegistry.push(`${name} (no released version)`); // pinned to a branch or revision: OSV has no version to answer for
  }
  return { shipped: new Set(all), all, nonRegistry };
}

/** Read and parse one lockfile. `yamlParse` is injected (the `yaml` package is installed by the workflow, not imported here). */
export function readLockfile(root, lf, yamlParse, skipImporters = []) {
  const text = readFileSync(join(root, lf.path), "utf8");
  if (lf.kind === "pnpm") {
    const base = join(root, lf.path, "..");
    const readPkg = (dir) => { try { return JSON.parse(readFileSync(join(base, dir, "package.json"), "utf8")); } catch { return null; } };
    // `yamlParse` returns every YAML document of the file (pnpm 11/12 writes two); a single parsed value is accepted too.
    const docs = [].concat(yamlParse(text)).filter((d) => d && typeof d === "object");
    if (docs.length === 0) throw new Error("pnpm-lock.yaml holds no readable YAML document");
    const merged = { shipped: new Set(), all: new Set(), nonRegistry: [] };
    for (const doc of docs) {
      const r = parsePnpm(doc, skipImporters, readPkg);
      for (const x of r.shipped) merged.shipped.add(x);
      for (const x of r.all) merged.all.add(x);
      merged.nonRegistry.push(...r.nonRegistry);
    }
    return merged;
  }
  if (lf.kind === "npm") return parseNpm(JSON.parse(text));
  if (lf.kind === "bun") return parseBun(parseJsonc(text), skipImporters);
  if (lf.kind === "cargo") return parseCargo(text);
  if (lf.kind === "swiftpm") return parseSwiftPm(JSON.parse(text));
  throw new Error(`no parser for ${lf.kind}`);
}
