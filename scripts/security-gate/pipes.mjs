// F427.1 — a gate piped into `tee` must still FAIL the step. See scripts/check-workflow-pipes.mjs for the story.
// Lives in the engine directory so the reusable security-gate workflow ships it with the rest.
const PIPE_TO_TEE = /\|\s*tee\b/;

/** → [{ job, step, why }] for every step in one workflow's parsed YAML that can swallow a failure. */
export function swallowing(wf) {
  const bad = [];
  const wfShell = String(wf?.defaults?.run?.shell ?? "");
  for (const [job, j] of Object.entries(wf?.jobs ?? {})) {
    const jobShell = String(j?.defaults?.run?.shell ?? wfShell);
    for (const [i, s] of (j?.steps ?? []).entries()) {
      const run = typeof s?.run === "string" ? s.run : "";
      if (!PIPE_TO_TEE.test(run)) continue;
      const shell = String(s.shell ?? jobShell);
      if (/^bash\b/.test(shell) || /set\s+-[a-z]*o\s+pipefail/.test(run) || /PIPESTATUS/.test(run) || /#[ \t]*pipe-ok:[ \t]*\S/.test(run)) continue;
      bad.push({ job, step: s.name ?? `#${i + 1}`, why: "pipes into tee without pipefail — a failing check would read as green" });
    }
  }
  return bad;
}

