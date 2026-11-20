// F427.1 — per-repo gate configuration: .github/security-gate.json, committed IN the repo and reviewed like code.
//
// Why a file and not workflow inputs: cardmem WRITES every repo's caller workflow, so a repo-specific exception
// (vendored code, demo apps, test fixtures) has nowhere to live there. Why this file cannot become an off switch:
//   · every path needs a written reason (≥ 10 characters), like an ack;
//   · the effective exclusions are PRINTED on every run (`::notice::`), so a reviewer sees what the gate did not look at;
//   · some paths can never be excluded — the workflows and the lockfiles are exactly what the gate exists to read.
//
//   { "exclude":        [ { "path": "vendor/",   "reason": "vendored upstream code, reviewed on import" } ],
//     "skipImporters":  [ { "path": "examples",  "reason": "demo apps no consumer installs" } ],
//     "sastExclude":    [ { "path": "docs/",     "reason": "generated documentation" } ] }
export const MIN_REASON = 10;
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json", "bun.lock", "bun.lockb", "yarn.lock"]);

/** The path the way the filesystem reads it: no `./`, no doubled or trailing slash, `..` resolved, case folded.
 *  null when it climbs out of the repo. (Comparing the RAW string let `.github/`, `./.github//` and `a/../.github` through.) */
export function normalizeExcludePath(raw) {
  const out = [];
  for (const seg of String(raw).trim().toLowerCase().split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

/** True when excluding `raw` would hide what the gate exists to read: the repo root, `.github` or anything the workflows
 *  live in or under, and any lockfile. A DIRECTORY that merely contains a lockfile is what skipImporters/exclude are for. */
export function isProtectedPath(raw) {
  const n = normalizeExcludePath(raw);
  if (n === null || n === "" || /[*\\]/.test(String(raw))) return true;
  if (n === ".github" || n === ".github/workflows" || n.startsWith(".github/workflows/")) return true;
  return LOCKFILES.has(n.split("/").pop());
}
const KEYS = ["exclude", "skipImporters", "sastExclude"];

/** raw = parsed JSON (or undefined when there is no file) → { exclude, skipImporters, sastExclude, notes, errors } */
export function parseGateConfig(raw) {
  const out = { exclude: [], skipImporters: [], sastExclude: [], notes: [], errors: [] };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) { out.errors.push("the file must be a JSON object"); return out; }
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) out.errors.push(`unknown key «${k}» (allowed: ${KEYS.join(", ")}) — a typo here would silently exclude nothing`);
  for (const key of KEYS) {
    if (raw[key] === undefined) continue;
    if (!Array.isArray(raw[key])) { out.errors.push(`${key} must be a list of {path, reason}`); continue; }
    for (const e of raw[key]) {
      const path = typeof e?.path === "string" ? e.path.trim().replace(/^\.\//, "") : "";
      if (path.startsWith("/") || isProtectedPath(path)) { out.errors.push(`${key}: «${e?.path}» can never be excluded (the workflows, lockfiles and the repo root are what the gate exists to read; no globs, no paths outside the repo)`); continue; }
      if (typeof e.reason !== "string" || e.reason.trim().length < MIN_REASON) { out.errors.push(`${key}: «${path}» needs a reason of at least ${MIN_REASON} characters`); continue; }
      out[key].push(path);
      out.notes.push(`${key}: ${path} — ${e.reason.trim()}`);
    }
  }
  return out;
}
