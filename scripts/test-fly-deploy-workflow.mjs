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
const MACHINES = "Machine-verify (every deployed machine is on ONE release)";

for (const name of [GUARD, DEPLOY, HEALTH, MACHINES]) {
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
// F033.21 — flyctl is pinned, and every deployed machine runs ONE image
// ---------------------------------------------------------------------------

console.log("flyctl pinned (F033.21)");
{
  const inputs = doc.on?.workflow_call?.inputs ?? {};
  const pinned = inputs.flyctl_version?.default;
  check("`flyctl_version` input exists with a concrete default", typeof pinned === "string" && /^\d+\.\d+\.\d+$/.test(pinned), `default is ${pinned}`);
  const setup = (doc.jobs?.deploy?.steps ?? []).find((st) => String(st.uses ?? "").includes("setup-flyctl"));
  check("setup-flyctl is given the pinned version (not latest)", setup?.with?.version === "${{ inputs.flyctl_version }}", JSON.stringify(setup?.with));
  const hygiene = parse(readFileSync(new URL("../.github/workflows/image-hygiene.yml", import.meta.url), "utf8"));
  const hySetups = Object.values(hygiene.jobs ?? {}).flatMap((j) => j.steps ?? []).filter((st) => String(st.uses ?? "").includes("setup-flyctl"));
  check("image-hygiene.yml sets flyctl up at least once", hySetups.length > 0);
  for (const st of hySetups) {
    check("image-hygiene.yml pins the SAME flyctl version as the deploy workflow", String(st.with?.version) === pinned, `hygiene ${st.with?.version} vs deploy ${pinned}`);
  }
}

console.log("machine-verify (F033.21)");
{
  // `rel` is the release Fly's dashboard shows as vNNN; `digest` the image.
  const machine = (id, state, rel, pg = "app", digest = "sha256:same000", region = "arn") => ({
    id, state, region,
    image_ref: { digest },
    config: { image: `registry.fly.io/app:deployment-${rel}`, metadata: pg ? { fly_process_group: pg, fly_release_version: rel } : {} },
  });
  const listing = (rows) => ({ flyctl: `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(rows)}\nJSON\n` });
  const env = { APP: "bid", CONFIG: "fly.toml" };

  const same = runStep(MACHINES, { env, stubs: listing([machine("m1", "started", "7"), machine("m2", "stopped", "7")]) });
  check("all managed machines on one image → green", same.status === 0, same.out.trim());
  check("…and says how many it checked, the release and where they run", same.out.includes("All 2 deploy-managed machines are on one release, v7: arn×2"), same.out.trim());

  // The BID case EXACTLY as Fly's dashboard showed it 1/11 2026: five machines,
  // ONE image digest, three releases (v525 in ams, v524 ×2, v523 ×2).
  const bid = runStep(MACHINES, {
    env,
    stubs: listing([
      machine("7845612c97d098", "started", "525", "app", "sha256:530081be2237", "ams"),
      machine("815311f9755238", "started", "524", "app", "sha256:530081be2237"),
      machine("8901edf6d32148", "started", "524", "app", "sha256:530081be2237"),
      machine("d8d140df931568", "started", "523", "app", "sha256:530081be2237"),
      machine("e825eddf5494d8", "started", "523", "app", "sha256:530081be2237"),
    ]),
  });
  check("BID's measured state (same image, three releases) → RED", bid.status !== 0, bid.out.trim());
  check("…naming the releases as the dashboard does", bid.out.includes("3 DIFFERENT releases (v523 v524 v525)"), bid.out.trim());
  check("…and every machine id with its region, so it can be acted on", ["7845612c97d098", "e825eddf5494d8", "d8d140df931568"].every((id) => bid.out.includes(id)) && bid.out.includes("ams"), bid.out.trim());

  // Fly's list is flaky (measured): a left-behind machine missing from ONE read must still be caught.
  const flaky = runStep(MACHINES, {
    env,
    stubs: {
      flyctl: `#!/bin/sh
n=$(cat "$PWD/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$PWD/n"
if [ "$n" = 2 ]; then
cat <<'JSON'
${JSON.stringify([machine("m1", "started", "8"), machine("old1", "started", "7")])}
JSON
else
cat <<'JSON'
${JSON.stringify([machine("m1", "started", "8")])}
JSON
fi
`,
    },
  });
  check("a machine missing from one flaky read is still found (union of 3 reads) → RED", flaky.status !== 0 && flaky.out.includes("old1"), flaky.out.trim());
  const dup = runStep(MACHINES, { env, stubs: listing([machine("m1", "started", "7")]) });
  check("the same machine seen in all 3 reads is counted ONCE", dup.out.includes("All 1 deploy-managed"), dup.out.trim());

  // F033.22 — the count.
  const twenty = Array.from({ length: 20 }, (_, i) => machine(`d${String(i).padStart(2, "0")}`, i === 0 ? "started" : "stopped", "691"));
  const many = runStep(MACHINES, { env: { ...env, EXPECTED_MACHINES: "2" }, stubs: listing(twenty) });
  // The default stub answers every call with the same 20, so the trim "succeeds"
  // and the re-read still shows 20: the result must be checked, not assumed.
  check("Discovery's 20 machines with expected_machines 2 → a trim is attempted, and when Fly still holds 20 → RED", many.status !== 0 && many.out.includes("Trimming 20 → 2") && many.out.includes("holds 20 deploy-managed machines; this app expects 2"), many.out.trim());
  check("…listing every machine", many.out.includes("d19") && many.out.includes("d00"), many.out.trim());
  // Owner 1/11: the deploy trims surplus itself — one region + one group only.
  const trimmer = (before, after, scaleExit = 0) => ({
    flyctl: `#!/bin/sh
printf '%s\\n' "$*" >> "$PWD/calls.log"
case "$1 $2" in
  "scale count") [ -f "$PWD/scaled" ] || touch "$PWD/scaled"; exit ${scaleExit} ;;
esac
if [ -f "$PWD/scaled" ]; then
cat <<'JSON'
${JSON.stringify(after)}
JSON
else
cat <<'JSON'
${JSON.stringify(before)}
JSON
fi
`,
  });
  const trimmed = runStep(MACHINES, {
    env: { ...env, EXPECTED_MACHINES: "1" },
    stubs: trimmer([machine("a1", "started", "694"), machine("a2", "started", "694"), machine("a3", "stopped", "694")], [machine("a1", "started", "694")]),
  });
  check("single-region surplus (3 → 1) is trimmed with scale count and ends GREEN", trimmed.status === 0 && trimmed.out.includes("Trimming 3 → 1") && trimmed.out.includes("After trimming: 1"), trimmed.out.trim());

  const scaleArgs = runStep(MACHINES, { env: { ...env, EXPECTED_MACHINES: "1" }, stubs: { flyctl: `#!/bin/sh
printf '%s\\n' "$*" >> "$PWD/args"
case "$1 $2" in "scale count") echo "$*" > "$PWD/scale"; exit 0;; esac
if [ -f "$PWD/scale" ]; then echo '${JSON.stringify([machine("a1", "started", "694")])}'; else echo '${JSON.stringify([machine("a1", "started", "694"), machine("a2", "stopped", "694")])}'; fi
` } });
  check("…asking for the expected count, in that one region and process group, without a prompt", scaleArgs.out.includes("Trimming 2 → 1 machines (region arn, group app)") && scaleArgs.status === 0, scaleArgs.out.trim());

  const multi = runStep(MACHINES, {
    env: { ...env, EXPECTED_MACHINES: "3" },
    stubs: trimmer([
      machine("b1", "started", "525", "app", "sha256:x", "ams"),
      machine("b2", "started", "525"), machine("b3", "started", "525"), machine("b4", "started", "525"), machine("b5", "started", "525"),
    ], []),
  });
  check("surplus across TWO regions (BID: arn + ams) is NOT trimmed — RED for a human", multi.status !== 0 && !multi.out.includes("Trimming") && multi.out.includes("holds 5") && multi.out.includes("one region"), multi.out.trim());

  const scaleFails = runStep(MACHINES, {
    env: { ...env, EXPECTED_MACHINES: "1" },
    stubs: trimmer([machine("c1", "started", "7"), machine("c2", "started", "7")], [machine("c1", "started", "7")], 1),
  });
  check("a failing trim → RED, saying it could not trim", scaleFails.status !== 0 && scaleFails.out.includes("Could not trim"), scaleFails.out.trim());

  const stillMany = runStep(MACHINES, {
    env: { ...env, EXPECTED_MACHINES: "1" },
    stubs: trimmer([machine("d1", "started", "7"), machine("d2", "started", "7")], [machine("d1", "started", "7"), machine("d2", "started", "7")]),
  });
  check("trim reported success but Fly still holds too many → RED (re-read, not trusted)", stillMany.status !== 0 && stillMany.out.includes("After trimming: 2") && stillMany.out.includes("holds 2"), stillMany.out.trim());

  const few = runStep(MACHINES, { env: { ...env, EXPECTED_MACHINES: "3" }, stubs: listing([machine("m1", "started", "7"), machine("m2", "started", "7")]) });
  check("fewer machines than expected → RED", few.status !== 0 && few.out.includes("holds 2") && few.out.includes("expects 3"), few.out.trim());
  const exact = runStep(MACHINES, { env: { ...env, EXPECTED_MACHINES: "2" }, stubs: listing([machine("m1", "started", "7"), machine("m2", "stopped", "7")]) });
  check("exactly as expected → green, and says so", exact.status === 0 && exact.out.includes("2 machines, as expected (2)"), exact.out.trim());
  const unset = runStep(MACHINES, { env: { ...env, EXPECTED_MACHINES: "0" }, stubs: listing(twenty) });
  check("expected_machines unset (0) → count reported, not a failure (no change for existing consumers)", unset.status === 0 && unset.out.includes("20 deploy-managed machines. Set expected_machines"), unset.out.trim());
  const inputs2 = doc.on?.workflow_call?.inputs ?? {};
  check("`expected_machines` defaults to 0", inputs2.expected_machines?.default === 0 && inputs2.expected_machines?.type === "number", JSON.stringify(inputs2.expected_machines));

  const oneOff = runStep(MACHINES, { env, stubs: listing([machine("m1", "started", "7"), machine("cron1", "started", "3", null)]) });
  check("a machine with no fly_process_group (fly machine run) is not counted", oneOff.status === 0, oneOff.out.trim());

  const cannot = runStep(MACHINES, { env, stubs: { flyctl: "#!/bin/sh\necho 'Error: token expired' >&2\nexit 1\n" } });
  check("flyctl cannot list → RED", cannot.status !== 0);
  check("…saying it could NOT look, never «ok»", cannot.out.includes("did NOT verify") && cannot.out.includes("token expired") && !cannot.out.includes("✓"), cannot.out.trim());

  const none = runStep(MACHINES, { env, stubs: listing([]) });
  check("no managed machines at all → RED (nothing was verified)", none.status !== 0 && none.out.includes("did NOT verify"), none.out.trim());

  const garbage = runStep(MACHINES, { env, stubs: { flyctl: "#!/bin/sh\necho 'not json'\n" } });
  check("unreadable listing → RED, not «ok»", garbage.status !== 0 && garbage.out.includes("did NOT verify"), garbage.out.trim());

  const rec = runStep(MACHINES, { env: { APP: "", CONFIG: "fly.toml" } });
  check("without an app name it asks flyctl by --config", rec.flyctlArgs.includes("machine list --config fly.toml --json"), rec.flyctlArgs);
  const recApp = runStep(MACHINES, { env });
  check("with an app name it asks for that app", recApp.flyctlArgs.includes("machine list --app bid --json"), recApp.flyctlArgs);
}

// ---------------------------------------------------------------------------

console.log("");
if (failures) {
  console.error(`✗ ${failures} of ${ran} checks failed`);
  process.exit(1);
}
console.log(`✓ ${ran} checks passed against the shipped workflow`);
