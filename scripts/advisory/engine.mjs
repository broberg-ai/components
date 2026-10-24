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

/** Audit + OSV findings → the report the alarm reads.
 *  @param {{auditError?:string, audit?:any[], osvError?:string, osv?:any[], ack?:any}} r */
export function decide({ auditError, audit = [], osvError, osv = [], ack = {} }) {
  const problems = validateAck(ack);
  const errors = [auditError, osvError, ...problems.map((p) => `ack: ${p}`)].filter(Boolean);
  const byKey = new Map();
  for (const [source, list] of [["audit", audit], ["osv", osv]])
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

/** BID's issue title — the «[id]» prefix is the key, so BID's open issues match. */
export const issueTitle = (f) => `[${f.id}] ${f.severity}: ${f.pkg} — ${f.title}`;
const idOf = (title) => /^\[([^\]]+)\]/.exec(title)?.[1] ?? null;

/** Which issues to open and which to close. An error closes nothing. */
export function planAlarm(report, openIssues) {
  const want = report.status === "error"
    ? [{ id: ERROR_ID, severity: "critical", pkg: "advisory-watch", title: `kunne ikke tjekke — ${report.errors.join(" · ").slice(0, 180)}` }, ...report.blocking]
    : report.blocking;
  const have = new Set(openIssues.map((i) => idOf(i.title)).filter(Boolean));
  const now = new Set(want.map((f) => f.id));
  return {
    open: want.filter((f) => !have.has(f.id)),
    close: report.status === "error" ? [] : openIssues.filter((i) => { const id = idOf(i.title); return id !== null && !now.has(id); }),
  };
}
