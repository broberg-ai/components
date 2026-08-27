// F033.10 — tests for the SHIPPED bash in .github/workflows/fly-server-deploy.yml.
//
// A reusable workflow runs inside the CALLER's checkout, so this logic cannot
// move into a script file in this repo — it has to stay inline in the YAML.
// Re-typing it into a test would test a copy, and a fix and its proof would
// drift apart the first time someone edited one of them.
//
// So this extracts the `run:` blocks straight out of the workflow file and
// executes them against fixtures, with `flyctl`, `curl` and `sleep` stubbed on
// PATH. Edit the YAML and this either follows or goes red.
//
//   node scripts/test-fly-deploy-workflow.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

const WORKFLOW = new URL("../.github/workflows/fly-server-deploy.yml", import.meta.url);
const doc = parse(readFileSync(WORKFLOW, "utf8"));

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const STEPS = Object.fromEntries(
  (doc.jobs?.deploy?.steps ?? []).filter((s) => s.name && s.run).map((s) => [s.name, s.run]),
);

const GUARD = "Single-writer guard (a volume + two machines is silent data loss)";
const DEPLOY = "Deploy (flyctl --remote-only)";
const HEALTH = "Health-verify (prove the NEW version serves 200)";

for (const name of [GUARD, DEPLOY, HEALTH]) {
  if (!STEPS[name]) {
    console.error(`✗ the workflow has no step named "${name}" — it was renamed or removed, and these tests are no longer testing what ships.`);
    process.exit(1);
  }
}

let failures = 0;
let ran = 0;

function check(label, cond, detail = "") {
  ran++;
  if (cond) return;
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
}

/** Run one step's shell verbatim, in a scratch dir, with stubs on PATH. */
function runStep(stepName, { env = {}, files = {}, stubs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flydeploy-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // Every stub records what it was called with, so a test can assert on the
  // ARGUMENTS the workflow composed rather than on our idea of them.
  const calls = join(dir, "calls.txt");
  const defaults = {
    // sleep is stubbed to nothing: the poll loop sleeps 5s per attempt and a
    // test that takes 30 seconds is a test nobody runs.
    sleep: "#!/bin/sh\nexit 0\n",
    flyctl: `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`,
  };
  for (const [name, body] of Object.entries({ ...defaults, ...stubs })) {
    const f = join(bin, name);
    writeFileSync(f, body);
    chmodSync(f, 0o755);
  }
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);

  const script = join(dir, "step.sh");
  writeFileSync(script, STEPS[stepName]);

  let stdout = "";
  let status = 0;
  try {
    stdout = execFileSync("bash", [script], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    });
  } catch (err) {
    status = err.status ?? 1;
    stdout = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  let flyctlArgs = "";
  try {
    flyctlArgs = readFileSync(calls, "utf8").trim();
  } catch {
    /* never called */
  }
  rmSync(dir, { recursive: true, force: true });
  return { status, out: stdout, flyctlArgs };
}

const MOUNTS_TOML = `app = "coverletter"\nprimary_region = "arn"\n\n[mounts]\n  source = "data"\n  destination = "/data"\n`;
const PLAIN_TOML = `app = "stateless"\nprimary_region = "arn"\n\n[http_service]\n  internal_port = 3000\n`;
const COMMENTED_TOML = `app = "stateless"\n# [mounts]\n#   source = "data"\nsummary = "no mounts here"\n`;

// ---------------------------------------------------------------------------
// AC 1 — ha defaults to true and changes nothing
// ---------------------------------------------------------------------------

console.log("ha input");
{
  const inputs = doc.on?.workflow_call?.inputs ?? {};
  check("`ha` input exists", Boolean(inputs.ha));
  check("`ha` is a boolean", inputs.ha?.type === "boolean", `type is ${inputs.ha?.type}`);
  check("`ha` DEFAULTS TO TRUE (no naked cutover)", inputs.ha?.default === true, `default is ${inputs.ha?.default}`);
  check("`extra_deploy_args` input exists", Boolean(inputs.extra_deploy_args));
  check("`health_commit_path` input exists", Boolean(inputs.health_commit_path));

  const base = { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "" };

  const dflt = runStep(DEPLOY, { env: { ...base, HA: "true" } });
  check("default composes NO --ha flag (byte-identical to before)", !dflt.flyctlArgs.includes("--ha"), dflt.flyctlArgs);
  check(
    "default command is exactly the pre-change one",
    dflt.flyctlArgs === 'deploy --remote-only --config fly.toml --build-arg GIT_SHA=abc1234',
    dflt.flyctlArgs,
  );

  const off = runStep(DEPLOY, { env: { ...base, HA: "false" } });
  check("`ha: false` composes --ha=false", off.flyctlArgs.includes("--ha=false"), off.flyctlArgs);
}

// ---------------------------------------------------------------------------
// AC 2 + 3 + 4 — the single-writer guard
// ---------------------------------------------------------------------------

console.log("single-writer guard");
{
  const stop = runStep(GUARD, { env: { CONFIG: "fly.toml", HA: "true" }, files: { "fly.toml": MOUNTS_TOML } });
  check("[mounts] + ha:true FAILS the job", stop.status !== 0, `exit ${stop.status}`);
  check("…as an ::error::, not a warning", stop.out.includes("::error::"), stop.out.trim());
  check("…and names the input to set", /ha:\s*false/.test(stop.out), stop.out.trim());

  const allowed = runStep(GUARD, { env: { CONFIG: "fly.toml", HA: "false" }, files: { "fly.toml": MOUNTS_TOML } });
  check("[mounts] + ha:false proceeds", allowed.status === 0, allowed.out.trim());

  const stateless = runStep(GUARD, { env: { CONFIG: "fly.toml", HA: "true" }, files: { "fly.toml": PLAIN_TOML } });
  check("no mounts + ha:true proceeds (no false positive)", stateless.status === 0, stateless.out.trim());

  const commented = runStep(GUARD, { env: { CONFIG: "fly.toml", HA: "true" }, files: { "fly.toml": COMMENTED_TOML } });
  check(
    "a commented-out `# [mounts]` and the WORD mounts do not trigger the stop",
    commented.status === 0,
    commented.out.trim(),
  );

  // "there is no [mounts]" and "I could not look" are different facts.
  const missing = runStep(GUARD, { env: { CONFIG: "fly.toml", HA: "true" } });
  check("a missing config does not fail the job", missing.status === 0, missing.out.trim());
  check("…but says SKIPPED out loud", /SKIPPED/.test(missing.out), missing.out.trim());
  check(
    "…and does not claim the app was verified",
    missing.out !== stateless.out,
    "the unreadable-config message is identical to the no-mounts one",
  );
}

// ---------------------------------------------------------------------------
// AC 5 — extra_deploy_args composes with ha
// ---------------------------------------------------------------------------

console.log("extra_deploy_args");
{
  const r = runStep(DEPLOY, {
    env: {
      GITHUB_SHA: "abc1234def",
      CONFIG: "fly.toml",
      APP: "",
      DOCKERFILE: "",
      HA: "false",
      EXTRA_DEPLOY_ARGS: "--strategy immediate --wait-timeout 300",
    },
  });
  check("extra args reach flyctl", r.flyctlArgs.includes("--strategy immediate"), r.flyctlArgs);
  check("…as SEPARATE words, not one blob", r.flyctlArgs.includes("--wait-timeout 300"), r.flyctlArgs);
  check("…and compose with --ha=false", r.flyctlArgs.includes("--ha=false"), r.flyctlArgs);
}

// ---------------------------------------------------------------------------
// AC 6 + 7 — health-verify proves the NEW commit
// ---------------------------------------------------------------------------

console.log("health-verify");

/** A curl stub that serves one fixed body with HTTP 200. */
const curlServing = (body) =>
  `#!/bin/sh\nprintf '%s' ${JSON.stringify(body)}\nprintf '\\n200'\nexit 0\n`;

{
  const env = { GITHUB_SHA: "abc1234def", HEALTH_URL: "https://x/health", HEALTH_TIMEOUT: "1" };

  // THE NEGATIVE CONTROL. This is the acceptance, not a nicety: a green verify
  // that would also be green without the fix verifies nothing.
  const stale = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: curlServing('{"ok":true,"commit":"0000fff"}') },
  });
  check("a 200 from a STALE commit fails the job", stale.status !== 0, `exit ${stale.status}\n${stale.out.trim()}`);
  check("…and names both commits", /0000fff/.test(stale.out) && /abc1234/.test(stale.out), stale.out.trim());
  check("…and says the OLD version is still up", /OLD version/.test(stale.out), stale.out.trim());

  const fresh = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: curlServing('{"ok":true,"commit":"abc1234"}') },
  });
  check("the deployed commit passes", fresh.status === 0, fresh.out.trim());

  const full = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: curlServing('{"commit":"abc1234def567890"}') },
  });
  check("a FULL sha matches the 7-char one", full.status === 0, full.out.trim());

  // Three outcomes, three messages — collapsing them is how F033.9 sent
  // someone to fix secrets that were already set.
  const absent = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: curlServing('{"ok":true}') },
  });
  check("a MISSING commit field fails", absent.status !== 0, absent.out.trim());
  check("…with its own message naming the path", /NO commit at '\.commit'/.test(absent.out), absent.out.trim());
  check("…distinct from 'never returned 200'", !/never returned 200/.test(absent.out), absent.out.trim());

  const down = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: `#!/bin/sh\nprintf '\\n503'\nexit 0\n` },
  });
  check("a non-200 still fails as a timeout", down.status !== 0 && /never returned 200/.test(down.out), down.out.trim());

  // Found by a flake, not by design: a `while [now < deadline]` head can be
  // false on entry, and then the step fails having made NO request — reporting
  // "never returned 200" about a URL it never called. Deterministic now.
  const zero = runStep(HEALTH, {
    env: { ...env, HEALTH_TIMEOUT: "0", HEALTH_COMMIT_PATH: ".commit" },
    stubs: { curl: curlServing('{"commit":"abc1234"}') },
  });
  check("a zero timeout still makes ONE attempt and can succeed", zero.status === 0, zero.out.trim());

  // Old behaviour is untouched for consumers that do not set the path.
  const anyOk = runStep(HEALTH, {
    env: { ...env, HEALTH_COMMIT_PATH: "" },
    stubs: { curl: curlServing('{"commit":"0000fff"}') },
  });
  check("without health_commit_path any 200 still passes (unchanged)", anyOk.status === 0, anyOk.out.trim());
}

// ---------------------------------------------------------------------------

console.log("");
if (failures) {
  console.error(`✗ ${failures} of ${ran} checks failed`);
  process.exit(1);
}
console.log(`✓ ${ran} checks passed against the shipped workflow`);
