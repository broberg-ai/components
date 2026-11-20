// F427.1 — the decisions of the fleet security gate. PURE: tool output + ack file + a date in, verdicts out.
// No network, no clock of its own (the caller passes `today`), so every rule below can be tested and mutated.
//
// Five checks, each named — a red run says WHICH one, and the selftest requires each to go red by name:
//   deps-vuln       a high/critical vulnerability in what the repo SHIPS
//   deps-malicious  a malicious package ANYWHERE in the tree (it runs on the build machine too)
//   sast            a Semgrep ERROR finding
//   workflows       a zizmor high finding in .github/workflows
//   install         a lockfile that is missing, or that the install does not accept frozen
//
// «Could not check» is its own state and is RED: a gate that did not look must never read as clean.
// An ack silences ONE id (and optionally ONE path) until its date, with a written reason, and not for
// longer than MAX_ACK_DAYS. An expired or malformed ack silences nothing.

export const CHECKS = ["deps-vuln", "deps-malicious", "sast", "workflows", "install"];
export const MAX_ACK_DAYS = 180;
export const MIN_REASON = 10;
const BLOCKING_SEVERITY = new Set(["high", "critical"]);

const DAY = 86_400_000;
const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayNumber = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / DAY);

/** Split the ack file into the acks that count today and the ones that do not (with the reason why). */
export function validateAcks(raw, today) {
  const valid = [], rejected = [];
  const list = Array.isArray(raw?.acks) ? raw.acks : raw === undefined || raw === null ? [] : null;
  if (list === null) return { valid, rejected: [{ ack: raw, why: "the ack file must be {\"acks\": [...]}" }] };
  for (const a of list) {
    if (typeof a?.id !== "string" || a.id.trim() === "") { rejected.push({ ack: a, why: "no id" }); continue; }
    if (typeof a.reason !== "string" || a.reason.trim().length < MIN_REASON) { rejected.push({ ack: a, why: `reason must be at least ${MIN_REASON} characters — say why it cannot reach a user` }); continue; }
    if (!isIsoDate(a.expires)) { rejected.push({ ack: a, why: "expires must be a date, YYYY-MM-DD" }); continue; }
    const left = dayNumber(a.expires) - dayNumber(today);
    if (left < 0) { rejected.push({ ack: a, why: `expired ${a.expires}` }); continue; }
    if (left > MAX_ACK_DAYS) { rejected.push({ ack: a, why: `expires ${a.expires}, more than ${MAX_ACK_DAYS} days away — an ack is a deadline, not a permanent exemption` }); continue; }
    valid.push(a);
  }
  return { valid, rejected };
}

/** Does a valid ack cover this finding? `ids` = the finding's id and aliases; `path` = where, when it has one. */
export function acked(finding, acks) {
  const ids = (finding.ids ?? [finding.id]).map((i) => String(i).toLowerCase());
  return acks.find((a) => ids.includes(a.id.toLowerCase()) && (a.path === undefined || a.path === finding.path)) ?? null;
}

function verdict(name, findings, acks, extra = {}) {
  const blocking = [], acknowledged = [];
  for (const f of findings) { const a = acked(f, acks); (a ? acknowledged : blocking).push(a ? { ...f, ack: a } : f); }
  return { name, status: blocking.length ? "red" : "green", blocking, acknowledged, errors: [], warnings: [], ...extra };
}
const errored = (name, why) => ({ name, status: "error", blocking: [], acknowledged: [], errors: [why], warnings: [] });

// ------------------------------------------------------------------ OSV (deps-vuln + deps-malicious)

/** A malicious-package record: an OpenSSF MAL id, an alias that is one, or GitHub's own malware advisory wording. */
export function isMalicious(v) {
  if (String(v?.id ?? "").startsWith("MAL-")) return true;
  if ((v?.aliases ?? []).some((a) => String(a).startsWith("MAL-"))) return true;
  return /^(malicious package|malware) in\b/i.test(String(v?.summary ?? ""));
}

/** `deps` = { findings: [{id, aliases, dep, severity, malicious, shipped, lock, summary, kev}], errors: [string] } */
export function decideDeps(deps, acks) {
  if (!deps || (deps.errors ?? []).length) {
    const why = (deps?.errors ?? ["no dependency result"]).join(" · ");
    return [errored("deps-vuln", why), errored("deps-malicious", why)];
  }
  const asFinding = (f) => ({ id: f.id, ids: [f.id, ...(f.aliases ?? [])], dep: f.dep, severity: f.severity, lock: f.lock, summary: f.summary, kev: f.kev });
  const malicious = deps.findings.filter((f) => f.malicious).map(asFinding);
  const vulns = deps.findings.filter((f) => !f.malicious && f.shipped && BLOCKING_SEVERITY.has(f.severity)).map(asFinding);
  const tooling = deps.findings.filter((f) => !f.malicious && !f.shipped && BLOCKING_SEVERITY.has(f.severity)).length;
  const unrated = deps.findings.filter((f) => !f.malicious && f.shipped && f.severity === "unrated").length;
  const v = verdict("deps-vuln", vulns, acks);
  if (tooling) v.warnings.push(`${tooling} high/critical finding(s) only in build/test tooling — reported, not blocking (they never reach a user)`);
  if (unrated) v.warnings.push(`${unrated} shipped finding(s) OSV has not rated — read them, they do not block`);
  for (const lf of deps.unsupported ?? []) v.warnings.push(`${lf} is not covered by this gate (no parser) — its dependencies were NOT checked`);
  return [v, verdict("deps-malicious", malicious, acks)];
}

// ------------------------------------------------------------------ Semgrep (sast)

/** `semgrep` = the JSON of `semgrep scan --json`, or null when the tool did not produce one. */
export function decideSast(semgrep, acks) {
  if (!semgrep || !Array.isArray(semgrep.results)) return errored("sast", "Semgrep produced no result — it did not run, so nothing was checked");
  const findings = semgrep.results
    .filter((r) => String(r.extra?.severity ?? "").toUpperCase() === "ERROR")
    .map((r) => ({ id: r.check_id, path: r.path, line: r.start?.line, summary: String(r.extra?.message ?? "").split("\n")[0].slice(0, 200) }));
  const v = verdict("sast", findings, acks);
  const lower = semgrep.results.length - semgrep.results.filter((r) => String(r.extra?.severity ?? "").toUpperCase() === "ERROR").length;
  if (lower) v.warnings.push(`${lower} lower-severity Semgrep finding(s) — reported, not blocking`);
  const parse = (semgrep.errors ?? []).filter((e) => String(e.level ?? "").toLowerCase() === "error").length;
  if (parse) v.warnings.push(`${parse} file(s) Semgrep could not parse — those files were not analysed`);
  return v;
}

// ------------------------------------------------------------------ zizmor (workflows)

/** `zizmor` = the JSON array of `zizmor --format json`, or null. */
export function decideWorkflows(zizmor, acks, pipes = []) {
  if (!Array.isArray(zizmor)) return errored("workflows", "zizmor produced no result — it did not run, so nothing was checked");
  if (!Array.isArray(pipes)) return errored("workflows", "the workflow files could not be read for the pipe check — nothing was checked");
  const sev = (z) => String(z.determinations?.severity ?? "").toLowerCase();
  const where = (z) => {
    const loc = z.locations?.[0];
    return { path: loc?.symbolic?.key?.Local?.given_path ?? loc?.symbolic?.key?.Local?.verbatim_path, line: (loc?.concrete?.location?.start_point?.row ?? -1) + 1 };
  };
  // `pipes`: steps that pipe a check into tee without pipefail — a red check would exit green (scripts/check-workflow-pipes.mjs).
  const findings = [...zizmor.filter((z) => BLOCKING_SEVERITY.has(sev(z))).map((z) => ({ id: z.ident, ...where(z), summary: String(z.desc ?? "") })), ...pipes];
  const v = verdict("workflows", findings, acks);
  const lower = zizmor.length - zizmor.filter((z) => BLOCKING_SEVERITY.has(sev(z))).length;
  if (lower) v.warnings.push(`${lower} lower-severity zizmor finding(s) — reported, not blocking`);
  return v;
}

// ------------------------------------------------------------------ install (lockfile present and frozen)

/** `install` = { projects: [{dir, manager, lockfile: bool, frozen: "ok"|"failed"|"skipped", detail}] } */
export function decideInstall(install, acks) {
  if (!install || !Array.isArray(install.projects)) return errored("install", "no install result — the check did not run");
  const findings = [];
  for (const p of install.projects) {
    if (!p.lockfile) findings.push({ id: "install-no-lockfile", path: p.dir, summary: `${p.dir || "."} has a package.json and no lockfile — nothing pins what gets installed` });
    else if (p.frozen === "failed") findings.push({ id: "install-lockfile-drift", path: p.dir, summary: `${p.dir || "."}: the frozen install failed (lockfile out of date or unreadable): ${p.detail ?? ""}`.slice(0, 300) });
  }
  const v = verdict("install", findings, acks);
  if (install.projects.length === 0) v.warnings.push("no package.json found — nothing to install-check");
  return v;
}

// ------------------------------------------------------------------ the whole gate

export function overall(verdicts) {
  const states = verdicts.map((v) => v.status);
  return states.includes("error") ? "error" : states.includes("red") ? "red" : "green";
}

/** One printable block per check; `::error::` lines so GitHub shows them, the check name first. */
export function render(verdicts, rejectedAcks = []) {
  const lines = [];
  for (const v of verdicts) {
    lines.push(`${v.name.padEnd(15)} ${v.status.toUpperCase().padEnd(5)} blocking ${v.blocking.length} · acknowledged ${v.acknowledged.length}`);
    for (const e of v.errors) lines.push(`::error::[${v.name}] could not check: ${e}`);
    for (const f of v.blocking) lines.push(`::error::[${v.name}] ${f.id}${f.dep ? ` ${f.dep}` : ""}${f.path ? ` ${f.path}${f.line > 0 ? `:${f.line}` : ""}` : ""}${f.severity ? ` (${f.severity})` : ""}${f.summary ? ` — ${f.summary}` : ""}`);
    for (const f of v.acknowledged) lines.push(`  acknowledged ${f.id} until ${f.ack.expires}: ${f.ack.reason}`);
    for (const w of v.warnings) lines.push(`::warning::[${v.name}] ${w}`);
  }
  for (const r of rejectedAcks) lines.push(`::error::[ack] ${r.ack?.id ?? "(no id)"} does not count: ${r.why}`);
  return lines.join("\n");
}
