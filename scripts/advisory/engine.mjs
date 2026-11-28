// F082.10 — the fleet's shared advisory watch: the pure half (no network, no gh).
//
// Ported from broberg-id's scripts/audit-gate.ts + advisory-alarm.ts (F084.189),
// which caught zod (GHSA-mrhx-c7xc-m3w5) on 23/10. What stays exactly as BID
// proved it in production:
//   - high/critical blocks unless the CALLING repo acknowledged that id, with a reason;
//   - the signal is parseable audit JSON, never the exit code (1 means both
//     "found something" and "could not run");
//   - «could not check» is its own outcome — an [audit-error] issue, red, and it
//     closes NOTHING (we cannot know a hole is gone if we could not look);
//   - one issue per hole, title «[<id>] <severity>: <pkg> — <title>», so BID's
//     open issues match when it switches over.
// Added: OSV.dev as a second source beside the package manager's own audit, and
// npm / pnpm / bun in one engine.
// F082.11: a third source, REPOSITORY advisories. Audit and OSV both read
// GitHub's REVIEWED database; an advisory published only on the source repo is
// in neither (better-auth 1.7.14 ran green for 25 days with 12 published holes,
// one critical — bid #56991). So each direct dependency's own repo is asked too.

export const BLOCKING = new Set(["high", "critical"]);
export const ERROR_ID = "audit-error";

/** Which package manager a repo uses, from its lockfile. */
export function detectPm(files) {
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun";
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("package-lock.json")) return "npm";
  return null;
}

const idFromUrl = (url) => String(url ?? "").split("/").pop() || null;

/** Audit JSON of any of the three → [{ pkg, id, severity, title }]. Throws if it is not an audit report. */
export function parseAudit(pm, raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`${pm} audit printed no JSON`);
  const j = JSON.parse(raw.slice(start));
  const out = [];
  if (pm === "bun") {
    // { "<pkg>": [{ id, url, title, severity }] }
    for (const [pkg, list] of Object.entries(j)) {
      if (!Array.isArray(list)) throw new Error("bun audit: unexpected shape");
      for (const a of list) out.push({ pkg, id: idFromUrl(a.url) ?? String(a.id), severity: a.severity, title: a.title });
    }
  } else if (pm === "pnpm") {
    if (!j.advisories) throw new Error(j.error?.message ? `pnpm audit: ${j.error.message}` : "pnpm audit: no advisories field");
    for (const a of Object.values(j.advisories)) out.push({ pkg: a.module_name, id: a.github_advisory_id || idFromUrl(a.url), severity: a.severity, title: a.title });
  } else if (pm === "npm") {
    if (!j.vulnerabilities) throw new Error(j.error?.summary ? `npm audit: ${j.error.summary}` : "npm audit: no vulnerabilities field");
    // `via` holds the advisory objects on the package they are filed against;
    // string entries only point at another package's row.
    for (const v of Object.values(j.vulnerabilities))
      for (const a of v.via ?? []) if (a && typeof a === "object") out.push({ pkg: a.name, id: idFromUrl(a.url) ?? String(a.source), severity: a.severity, title: a.title });
  } else throw new Error(`unknown package manager ${pm}`);
  // One row per (pkg, id): npm and pnpm repeat an advisory per path.
  const seen = new Set();
  return out.filter((f) => { const k = `${f.pkg} ${f.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Every locked name@version in a lockfile — the question OSV is asked. Workspace links are skipped. */
export function lockedFromLockfile(pm, text) {
  const out = new Set();
  if (pm === "npm") {
    for (const [path, p] of Object.entries(JSON.parse(text).packages ?? {})) {
      if (!path || p.link || !p.version) continue;
      out.add(`${p.name ?? path.slice(path.lastIndexOf("node_modules/") + 13)}@${p.version}`);
    }
  } else if (pm === "pnpm") {
    // v9: "packages:" holds one "  <name>@<version>:" key per locked package.
    const sec = text.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
    for (const m of sec.matchAll(/^  '?((?:@[^@\s'/]+\/)?[^@\s'/]+)@([^\s'(:]+)/gm)) if (!m[2].includes(":")) out.add(`${m[1]}@${m[2]}`);
  } else if (pm === "bun") {
    // bun.lock: "packages": { "<key>": ["<name>@<version>", …] }
    for (const m of text.matchAll(/^\s*"[^"]+": \["((?:@[^@"/]+\/)?[^@"/]+)@([^"]+)"/gm)) if (!m[2].includes(":")) out.add(`${m[1]}@${m[2]}`);
  }
  return out;
}

/** The calling repo's acknowledgements: { "<pkg>": { ids: [..], reason: ".." } }.
 *  Returns the list of problems — an entry without a reason is not an acknowledgement. */
export function validateAck(ack) {
  const problems = [];
  if (ack === null || typeof ack !== "object" || Array.isArray(ack)) return ["the ack file must be a JSON object { pkg: { ids, reason } }"];
  for (const [pkg, e] of Object.entries(ack)) {
    if (!e || typeof e.reason !== "string" || e.reason.trim().length < 10) problems.push(`${pkg}: no reason — an entry without a reason is not an acknowledgement`);
    if (!Array.isArray(e?.ids) || e.ids.length === 0 || e.ids.some((i) => typeof i !== "string" || !i)) problems.push(`${pkg}: ids must list the advisory ids it covers`);
  }
  return problems;
}

/** A package.json `repository` (string or { url }) → "owner/repo" on GitHub, else null. */
export function githubRepo(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^github:([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:#.*)?$/.exec(s) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
  if (m) return `${m[1]}/${m[2]}`;
  m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** SemVer precedence (2.0.0 §11): -1, 0 or 1. Build metadata is ignored. */
function cmpSemver(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
    if (!m) throw new Error(`not a version: ${v}`);
    return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] < y.n[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** One comparator ("<= 1.2", ">=8.3.0", a bare "1.2.3") against a version. A
 *  partial version is a wildcard as in npm's semver ("< 20" = below 20.0.0,
 *  "<= 1.2" = every 1.2.x, a bare "1" = every 1.x), so a hole is never
 *  under-matched. */
function cmpOk(version, op, v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(v);
  if (m && m[3] === undefined) {
    const lo = `${m[1]}.${m[2] ?? 0}.0`;
    const hi = m[2] === undefined ? `${Number(m[1]) + 1}.0.0` : `${m[1]}.${Number(m[2]) + 1}.0`;
    const below = (x) => cmpSemver(version, x) < 0;
    if (op === "<") return below(lo);
    if (op === ">=") return !below(lo);
    if (op === "<=") return below(hi);
    if (op === ">") return !below(hi);
    return !below(lo) && below(hi);
  }
  const c = cmpSemver(version, v);
  return { "<": c < 0, "<=": c <= 0, ">": c > 0, ">=": c >= 0, "=": c === 0 }[op];
}

/** GitHub's vulnerable_version_range — free text on repository advisories, so
 *  read strictly. Measured 28/11 across components' 56 dependency repos:
 *    ">= 1.8.0-beta.0, < 1.8.0-beta.5"   comma = AND (GitHub's own form)
 *    ">= 2.0.0 < 2.8.3", ">15.0.4 and <15.2.0"   space / "and" = AND
 *    "1 <=1.28.1 || 2 <=2.0.5"           "||" = OR
 *    "15.0.0 - 15.4.4"                    hyphen = inclusive range
 *    "8.4.0-beta.1"                       a bare version = exactly it
 *  Ambiguous text — a comma next to a hyphen range ("< 14.2.31, 15.0.0 - 15.4.4"
 *  reads as OR), "16.3.?" — throws: shown as not checked, never guessed. */
export function inRange(version, range) {
  const text = String(range).trim();
  const fail = () => { throw new Error(`unsupported version range: ${range}`); };
  const V = "v?\\d[0-9A-Za-z.+-]*";
  return text.split("||").some((alt) => {
    let a = alt.trim();
    if (!a) fail();
    const hyphen = new RegExp(`(${V})\\s+-\\s+(${V})`, "g");
    if (hyphen.test(a) && a.includes(",")) fail();
    a = a.replace(hyphen, ">= $1 <= $2").replace(/\band\b/g, " ");
    const TOKEN = new RegExp(`(<=|>=|<|>|=)?\\s*(${V})`, "g");
    const parts = [...a.matchAll(TOKEN)].map(([, op, v]) => [op ?? "=", v]);
    if (!parts.length || a.replace(TOKEN, "").replace(/[\s,]/g, "") !== "") fail();
    return parts.every(([op, v]) => cmpOk(version, op, v));
  });
}

const fixes = (patched) => String(patched ?? "").split(",").map((p) => p.trim().replace(/^v/, ""))
  .filter((p) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(p));
const majorOf = (v) => Number(v.split(".")[0]);

/** Does the locked version already have the fix of ONE matching entry? Judged on
 *  that entry's own patched_versions; `others` are the same package's other
 *  entries in the same advisory. Repository advisories often carry a sloppy
 *  range while the patched list is right (measured 28/11, components' deps):
 *    next.js GHSA-9qr9 ">=14.3.0-canary.77, >=15, >=16", fixed "v16.0.7, v15.5.7, …"
 *    next.js GHSA-gp8f ">=13.5.1", fixed in 13.5.7 (other entry 14.2.10)
 *    drizzle GHSA-gpj5 "<= 1.0.0-beta.19", fixed "1.0.0-beta.20" — also matches
 *                      0.45.2, which the other entry names as the 0.45.x fix
 *  Cleared when:
 *   (a) a fix on the locked major is ≤ the locked version and NO fix on that
 *       major is above it ("1.6.11, 1.7.16" does not clear 1.7.7 — the 1.7 fix
 *       is 1.7.16; better-auth GHSA-fmh4);
 *   (b) every fix is on an OLDER major (a later line inherits it);
 *   (c) the entry's fixes are all prereleases of a NEWER major (a beta line)
 *       and another entry already clears the locked version by (a).
 *  vite 5.4.21 against fixes 6.4.6 / 7.3.8 stays red: 5.x has none of these. */
function fixedBy(version, own, others = []) {
  const pre = version.includes("-");
  const major = majorOf(version);
  const lineFix = (list) => {
    const usable = list.filter((p) => pre || !p.includes("-")).filter((p) => majorOf(p) === major);
    return usable.some((p) => cmpSemver(version, p) >= 0) && !usable.some((p) => cmpSemver(version, p) < 0);
  };
  const ownFixes = fixes(own);
  if (!ownFixes.length) return false;
  if (lineFix(ownFixes)) return true;
  const stable = ownFixes.filter((p) => pre || !p.includes("-"));
  if (!pre && stable.length && stable.every((p) => majorOf(p) < major)) return true;
  if (!pre && ownFixes.every((p) => p.includes("-") && majorOf(p) > major)) return others.some((o) => lineFix(fixes(o)));
  return false;
}
/** Exported for tests: the single-entry form of fixedBy. */
export const patchedOnLine = (version, patched, others = []) => fixedBy(version, patched, others);

/** Repository advisories (GitHub's REST shape) × locked name@version → findings.
 *  A range we cannot read (a repo wrote "16.3.?", measured 28/11) is pushed to
 *  `unparsed` for a package we lock — shown as not checked, never as clean, and
 *  never a reason to stop reading every other repo. */
export function repoFindings(advisories, locked, unparsed = []) {
  const versions = new Map();
  for (const nv of locked) {
    const at = nv.lastIndexOf("@");
    if (at <= 0) continue;
    const name = nv.slice(0, at);
    versions.set(name, [...(versions.get(name) ?? []), nv.slice(at + 1)]);
  }
  const out = [];
  for (const a of advisories) {
    if (a.withdrawn_at || (a.state && a.state !== "published")) continue;
    for (const v of a.vulnerabilities ?? []) {
      if (v.package?.ecosystem !== "npm" || !v.vulnerable_version_range) continue;
      for (const ver of versions.get(v.package.name) ?? []) {
        let hit;
        try { const others = (a.vulnerabilities ?? []).filter((x) => x !== v && x.package?.name === v.package.name).map((x) => x.patched_versions);
          hit = inRange(ver, v.vulnerable_version_range) && !fixedBy(ver, v.patched_versions, others); }
        catch { unparsed.push({ pkg: v.package.name, id: a.ghsa_id, range: v.vulnerable_version_range }); continue; }
        if (hit) out.push({ pkg: v.package.name, id: a.ghsa_id, severity: a.severity, title: a.summary ?? a.ghsa_id, ...(a.html_url ? { url: a.html_url } : {}) });
      }
    }
  }
  const seen = new Set();
  return out.filter((f) => { const k = `${f.pkg} ${f.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Direct dependency names from the repo's package.json files (root + workspaces). */
export function directDeps(pkgJsons) {
  const out = new Set();
  for (const p of pkgJsons)
    for (const f of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
      for (const [name, spec] of Object.entries(p?.[f] ?? {})) if (!String(spec).startsWith("workspace:")) out.add(name);
  return out;
}

/** Audit + OSV + repository findings → the report the alarm reads.
 *  @param {{auditError?:string, audit?:any[], osvError?:string, osv?:any[], repoError?:string, repo?:any[], ack?:any}} r */
export function decide({ auditError, audit = [], osvError, osv = [], repoError, repo = [], ack = {} }) {
  const problems = validateAck(ack);
  const errors = [auditError, osvError, repoError, ...problems.map((p) => `ack: ${p}`)].filter(Boolean);
  const byKey = new Map();
  for (const [source, list] of [["audit", audit], ["osv", osv], ["repo", repo]])
    for (const f of list) {
      const k = `${f.pkg} ${f.id}`;
      const cur = byKey.get(k);
      if (cur) { if (!cur.sources.includes(source)) cur.sources.push(source); cur.kev ||= f.kev ?? false; }
      else byKey.set(k, { ...f, sources: [source] });
    }
  const blocking = [], acknowledged = [];
  for (const f of byKey.values()) {
    if (!BLOCKING.has(f.severity)) continue;
    (problems.length === 0 && ack[f.pkg]?.ids?.includes(f.id) ? acknowledged : blocking).push(f);
  }
  const status = errors.length ? "error" : blocking.length ? "blocking" : "clean";
  return { status, errors, blocking, acknowledged };
}

/** A run on any ref but the default branch is a TEST (bid #4336: Christian read a
 *  pilot's incident as the real hole returning, because the title was identical). */
export const TEST_PREFIX = "TEST — ";
export const isTestRun = (ref, defaultBranch) => Boolean(ref && defaultBranch && ref !== defaultBranch);

/** BID's issue title — the «[id]» prefix is the key, so BID's open issues match. */
export const issueTitle = (f, test = false) => `${test ? TEST_PREFIX : ""}[${f.id}] ${f.severity}: ${f.pkg} — ${f.title}`;
const idOf = (title) => /^\[([^\]]+)\]/.exec(title)?.[1] ?? null;

/** Which issues to open and which to close. An error closes nothing. A test run
 *  sees only TEST issues and a real run only real ones — a pilot can neither
 *  close a real alarm nor be mistaken for one. */
export function planAlarm(report, allOpen, test = false) {
  const openIssues = allOpen.filter((i) => i.title.startsWith(TEST_PREFIX) === test)
    .map((i) => ({ ...i, title: test ? i.title.slice(TEST_PREFIX.length) : i.title }));
  const want = report.status === "error"
    ? [{ id: ERROR_ID, severity: "critical", pkg: "advisory-watch", title: `kunne ikke tjekke — ${report.errors.join(" · ").slice(0, 180)}` }, ...report.blocking]
    : report.blocking;
  const have = new Set(openIssues.map((i) => idOf(i.title)).filter(Boolean));
  const now = new Set(want.map((f) => f.id));
  return {
    open: want.filter((f) => !have.has(f.id)),
    close: report.status === "error" ? [] : openIssues.filter((i) => { const id = idOf(i.title); return id !== null && !now.has(id); })
      .map((i) => ({ ...i, title: test ? TEST_PREFIX + i.title : i.title })),
  };
}
