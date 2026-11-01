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
const MACHINES = "Machine-verify (every deployed machine is on THIS release)";
const PLAN = "Machine-plan (count before deploy, so flyctl creates nothing)";

for (const name of [GUARD, DEPLOY, HEALTH, MACHINES, PLAN]) {
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

console.log("machine-verify (F033.21 + F033.22)");
{
  // `rel` is the release Fly's dashboard shows as vNNN; `digest` the image.
  const machine = (id, state, rel, pg = "app", digest = "sha256:same000", region = "arn") => ({
    id, state, region,
    image_ref: { digest },
    config: { image: `registry.fly.io/app:deployment-${rel}`, metadata: pg ? { fly_process_group: pg, fly_release_version: rel } : {} },
  });
  // A stateful fake Fly: machines live in state.json; `machine destroy` and
  // `scale count` change it; `hide` drops ids from the Nth list read (Fly's list
  // is measured flaky); `scaleKeeps` decides WHICH machines scale count keeps —
  // like Fly, it does not care about releases.
  const fakeFly = (machines, { latest, hide = {}, fail = [], scaleKeeps = "first" } = {}) => ({
    files: { "state.json": JSON.stringify(machines) },
    stubs: {
      flyctl: `#!/bin/bash
echo "$*" >> "$PWD/calls.log"
S="$PWD/state.json"
case " ${fail.join(" ")} " in *" $1 "*|*" $1-$2 "*) echo "Error: simulated $1 failure" >&2; exit 1;; esac
case "$1 $2" in
  "releases --json"|"releases --app"|"releases --config") echo '[{"Version": ${latest}}]';;
  "machine list")
    n=$(cat "$PWD/reads" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$PWD/reads"
    case "$n" in ${Object.entries(hide).map(([k, ids]) => `${k}) jq -c --argjson h '${JSON.stringify(ids)}' '[.[] | select(.id as $i | $h | index($i) | not)]' "$S";;`).join(" ")} *) cat "$S";; esac;;
  "machine destroy") jq -c --arg id "$3" '[.[] | select(.id != $id)]' "$S" > "$S.n" && mv "$S.n" "$S";;
  "scale count") jq -c --argjson n "$3" '${scaleKeeps === "first" ? ".[0:$n]" : ".[-$n:]"}' "$S" > "$S.n" && mv "$S.n" "$S";;
esac
`,
    },
  });
  const run = (machines, opts = {}, env = {}) => {
    const f = fakeFly(machines, opts);
    return runStep(MACHINES, { env: { APP: "bid", CONFIG: "fly.toml", EXPECTED_MACHINES: "0", ...env }, files: f.files, stubs: f.stubs });
  };

  const same = run([machine("m1", "started", "7"), machine("m2", "stopped", "7")], { latest: 7 });
  {
    const sumDir = mkdtempSync(join(tmpdir(), "sum-"));
    const sum = join(sumDir, "summary.md");
    writeFileSync(sum, "");
    const f = fakeFly([machine("m1", "started", "7")], { latest: 7 });
    const r = runStep(MACHINES, { env: { APP: "up", CONFIG: "fly.toml", EXPECTED_MACHINES: "1", GITHUB_STEP_SUMMARY: sum }, files: f.files, stubs: f.stubs });
    const written = readFileSync(sum, "utf8");
    check("Machine-verify writes its proof to the job summary (count, release, expected)", r.status === 0 && written.includes("Machine-verify:** ✓ 1 machine(s) on v7 (arn×1), expected 1"), written);
  }
  check("every machine on THIS deploy's release → green", same.status === 0, same.out.trim());
  check("…saying how many, which release and where", same.out.includes("All 2 deploy-managed machines are on the new release, v7: arn×2"), same.out.trim());

  // BID EXACTLY as Fly's dashboard showed it 1/11 2026: one image, three releases.
  const bid = run([
    machine("7845612c97d098", "started", "525", "app", "sha256:530081be2237", "ams"),
    machine("815311f9755238", "started", "524", "app", "sha256:530081be2237"),
    machine("8901edf6d32148", "started", "524", "app", "sha256:530081be2237"),
    machine("d8d140df931568", "started", "523", "app", "sha256:530081be2237"),
    machine("e825eddf5494d8", "started", "523", "app", "sha256:530081be2237"),
  ], { latest: 525 });
  check("BID's measured state (same image, three releases) → RED", bid.status !== 0, bid.out.trim());
  check("…naming the releases as the dashboard does", bid.out.includes("3 DIFFERENT releases (v523 v524 v525)"), bid.out.trim());
  check("…and every machine id with its region", ["7845612c97d098", "e825eddf5494d8", "d8d140df931568"].every((id) => bid.out.includes(id)) && bid.out.includes("ams"), bid.out.trim());

  // Discovery EXACTLY as measured 1/11 2026: the deploy made v695 on a NEW
  // machine beside the v694 one, and scale count kept the OLD one.
  const disc = run([machine("e784ee609c31d8", "started", "694"), machine("newv695", "started", "695")], { latest: 695, scaleKeeps: "first" }, { EXPECTED_MACHINES: "1" });
  check("Discovery's case: the OLD-release machine is removed, the new one kept → GREEN on v695", disc.status === 0 && disc.out.includes("removed e784ee609c31d8 (older release)") && disc.out.includes("on the new release, v695"), disc.out.trim());

  const stale = run([machine("m1", "started", "694")], { latest: 695 }, { EXPECTED_MACHINES: "1" });
  check("one machine, one release — but not the NEW one → RED", stale.status !== 0 && stale.out.includes("Every machine is on v694, but the newest release is v695"), stale.out.trim());

  const surplus = run([machine("a1", "started", "9"), machine("a2", "started", "9"), machine("a3", "stopped", "9")], { latest: 9 }, { EXPECTED_MACHINES: "1" });
  check("surplus on the new release (3 → 1) is trimmed with scale count → GREEN", surplus.status === 0 && surplus.out.includes("Trimming 3 → 1") && surplus.out.includes("After trimming: 1"), surplus.out.trim());

  const twenty = Array.from({ length: 20 }, (_, i) => machine(`d${String(i).padStart(2, "0")}`, i === 0 ? "started" : "stopped", "691"));
  const disc20 = run(twenty, { latest: 691 }, { EXPECTED_MACHINES: "2" });
  check("Discovery's 20 machines with expected_machines 2 → trimmed to 2, GREEN", disc20.status === 0 && disc20.out.includes("Trimming 20 → 2") && disc20.out.includes("After trimming: 2"), disc20.out.trim());

  const multi = run([
    machine("b1", "started", "525", "app", "sha256:x", "ams"),
    machine("b2", "started", "525"), machine("b3", "started", "525"), machine("b4", "started", "525"), machine("b5", "started", "525"),
  ], { latest: 525 }, { EXPECTED_MACHINES: "3" });
  check("surplus across TWO regions (BID: arn + ams) is NOT trimmed — RED for a human", multi.status !== 0 && !multi.out.includes("Trimming") && multi.out.includes("holds 5"), multi.out.trim());

  const noneNew = run([machine("o1", "started", "4"), machine("o2", "started", "4")], { latest: 5 }, { EXPECTED_MACHINES: "1" });
  check("no machine on the new release → nothing is removed, RED", noneNew.status !== 0 && !noneNew.out.includes("removed") && !noneNew.out.includes("Trimming"), noneNew.out.trim());

  const scaleFails = run([machine("c1", "started", "7"), machine("c2", "started", "7")], { latest: 7, fail: ["scale"] }, { EXPECTED_MACHINES: "1" });
  check("a failing scale count → RED, saying it could not trim", scaleFails.status !== 0 && scaleFails.out.includes("Could not trim"), scaleFails.out.trim());

  const destroyFails = run([machine("c1", "started", "7"), machine("old", "started", "6")], { latest: 7, fail: ["machine-destroy"] }, { EXPECTED_MACHINES: "1" });
  check("a failing removal of an old machine → RED, naming it", destroyFails.status !== 0 && destroyFails.out.includes("Could not remove old"), destroyFails.out.trim());

  const few = run([machine("m1", "started", "7"), machine("m2", "started", "7")], { latest: 7 }, { EXPECTED_MACHINES: "3" });
  check("fewer machines than expected → RED", few.status !== 0 && few.out.includes("holds 2") && few.out.includes("expects 3"), few.out.trim());

  const unset = run(twenty, { latest: 691 });
  check("expected_machines unset → count reported, not a failure, nothing removed", unset.status === 0 && unset.out.includes("20 deploy-managed machines. Set expected_machines") && !unset.out.includes("Trimming"), unset.out.trim());
  const inputs2 = doc.on?.workflow_call?.inputs ?? {};
  check("`expected_machines` defaults to 0", inputs2.expected_machines?.default === 0 && inputs2.expected_machines?.type === "number", JSON.stringify(inputs2.expected_machines));

  const flaky = run([machine("m1", "started", "8"), machine("old1", "started", "7")], { latest: 8, hide: { 1: ["old1"], 3: ["old1"] } });
  check("a machine missing from two of three flaky reads is still found → RED", flaky.status !== 0 && flaky.out.includes("old1"), flaky.out.trim());
  const once = run([machine("m1", "started", "7")], { latest: 7 });
  check("the same machine seen in all 3 reads is counted ONCE", once.out.includes("All 1 deploy-managed"), once.out.trim());

  const oneOff = run([machine("m1", "started", "7"), machine("cron1", "started", "3", null)], { latest: 7 });
  check("a machine with no fly_process_group (fly machine run) is not counted", oneOff.status === 0, oneOff.out.trim());

  const cannot = run([machine("m1", "started", "7")], { latest: 7, fail: ["machine"] });
  check("flyctl cannot list → RED, saying it could NOT look", cannot.status !== 0 && cannot.out.includes("did NOT verify") && !cannot.out.includes("✓"), cannot.out.trim());
  const noRel = run([machine("m1", "started", "7")], { latest: 7, fail: ["releases"] });
  check("flyctl cannot read releases → RED, saying it could NOT look", noRel.status !== 0 && noRel.out.includes("newest release") && noRel.out.includes("did NOT verify"), noRel.out.trim());
  const none = run([], { latest: 7 });
  check("no managed machines at all → RED", none.status !== 0 && none.out.includes("did NOT verify"), none.out.trim());

  // ---- F033.23 — Machine-plan: count BEFORE deploy, so flyctl creates nothing.
  const planRun = (machines, opts = {}, env = {}) => {
    const out = join(mkdtempSync(join(tmpdir(), "plan-out-")), "gh_output");
    writeFileSync(out, "");
    const f = fakeFly(machines, { latest: 1, ...opts });
    const r = runStep(PLAN, { env: { APP: "disc", CONFIG: "fly.toml", EXPECTED_MACHINES: "0", GITHUB_OUTPUT: out, ...env }, files: f.files, stubs: f.stubs });
    const lines = readFileSync(out, "utf8").trim().split("\n");
    r.only = (lines.filter((l) => l.startsWith("only_machines=")).pop() ?? "").slice("only_machines=".length);
    return r;
  };
  const mc = (id, state, created, region = "arn", vols = 0) => {
    const m = machine(id, state, "1", "app", "sha256:x", region);
    m.created_at = created;
    if (vols) m.config.mounts = [{ name: "data" }];
    return m;
  };
  console.log("machine-plan (F033.23)");
  const p0 = planRun([mc("a", "started", "2026-11-01T10:00:00Z")]);
  check("expected_machines unset → no plan, flyctl decides as before", p0.status === 0 && p0.only === "", p0.out.trim());
  const pNew = planRun([], {}, { EXPECTED_MACHINES: "1" });
  check("no machines yet → normal first deploy (no ids)", pNew.status === 0 && pNew.only === "" && pNew.out.includes("first deploy"), pNew.out.trim());
  const pFew = planRun([mc("a", "started", "2026-11-01T10:00:00Z")], {}, { EXPECTED_MACHINES: "2" });
  check("fewer than expected → normal deploy may add them (no ids)", pFew.status === 0 && pFew.only === "", pFew.out.trim());
  {
    const sum = join(mkdtempSync(join(tmpdir(), "sum-")), "summary.md");
    writeFileSync(sum, "");
    planRun([mc("a", "started", "2026-11-01T10:00:00Z")], {}, { EXPECTED_MACHINES: "1", GITHUB_STEP_SUMMARY: sum });
    check("Machine-plan writes the ids it deploys to into the job summary", readFileSync(sum, "utf8").includes("deploying to exactly 1 machine(s): `a`"), readFileSync(sum, "utf8"));
  }
  const pExact = planRun([mc("a", "started", "2026-11-01T10:00:00Z"), mc("b", "stopped", "2026-11-01T09:00:00Z")], {}, { EXPECTED_MACHINES: "2" });
  check("exactly as expected → deploy to exactly those ids", pExact.status === 0 && pExact.only.split(",").sort().join(",") === "a,b", pExact.only);
  const pTrim = planRun([
    mc("new-started", "started", "2026-11-01T11:00:00Z"),
    mc("old-started", "started", "2026-10-01T11:00:00Z"),
    mc("stopped1", "stopped", "2026-11-01T12:00:00Z"),
  ], {}, { EXPECTED_MACHINES: "1" });
  check("surplus (3 → 1): stopped first, then oldest; keeps the newest started", pTrim.status === 0 && pTrim.only === "new-started" && pTrim.out.includes("removed surplus stopped1") && pTrim.out.includes("removed surplus old-started"), `${pTrim.only} | ${pTrim.out.trim()}`);
  const pFlaky = planRun([mc("a", "started", "2026-11-01T10:00:00Z"), mc("hidden", "stopped", "2026-10-01T10:00:00Z")], { hide: { 1: ["hidden"], 2: ["hidden"] } }, { EXPECTED_MACHINES: "1" });
  check("a machine the list hides on two of three reads is still found and removed", pFlaky.status === 0 && pFlaky.only === "a" && pFlaky.out.includes("removed surplus hidden"), `${pFlaky.only} | ${pFlaky.out.trim()}`);
  const pRegions = planRun([mc("a", "started", "2026-11-01T10:00:00Z"), mc("b", "started", "2026-11-01T10:00:00Z", "ams"), mc("c", "started", "2026-11-01T10:00:00Z")], {}, { EXPECTED_MACHINES: "2" });
  check("surplus across regions → RED, nothing removed", pRegions.status !== 0 && !pRegions.out.includes("removed surplus") && pRegions.out.includes("NOT removed automatically"), pRegions.out.trim());
  const pVol = planRun([mc("a", "started", "2026-11-01T10:00:00Z", "arn", 1), mc("b", "stopped", "2026-10-01T10:00:00Z", "arn", 1)], {}, { EXPECTED_MACHINES: "1" });
  check("surplus with volumes (data) → RED, nothing removed", pVol.status !== 0 && !pVol.out.includes("removed surplus") && pVol.out.includes("volume"), pVol.out.trim());
  const pBlind = planRun([mc("a", "started", "2026-11-01T10:00:00Z")], { fail: ["machine"] }, { EXPECTED_MACHINES: "1" });
  check("cannot list before deploying → RED, not deploying blind", pBlind.status !== 0 && pBlind.out.includes("Not deploying blind"), pBlind.out.trim());

  const dOnly = runStep(DEPLOY, { env: { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "disc", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "", HA: "false", ONLY_MACHINES: "a,b" } });
  check("deploy with counted ids → --only-machines a,b --update-only", dOnly.flyctlArgs.includes("--only-machines a,b --update-only"), dOnly.flyctlArgs);
  // jam 1/11 (run 41312647489): flyctl did not see the given ids, planned to CREATE, --update-only blocked it.
  const blindThenOk = { flyctl: `#!/bin/bash
echo "$*" >> "$PWD/deploys"
n=$(wc -l < "$PWD/deploys")
if [ "$n" -lt 2 ]; then printf 'This deployment will:\n * create 2 "app" machines\n'; else printf 'Updating existing machines in app with rolling strategy\n'; fi
` };
  const dRetry = runStep(DEPLOY, { env: { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "jam", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "", HA: "true", ONLY_MACHINES: "a,b" }, stubs: { ...blindThenOk, sleep: "#!/bin/sh\nexit 0\n" } });
  check("flyctl blind to the given ids (plans to create) → retried, then GREEN when it sees them", dRetry.status === 0 && dRetry.out.includes("Attempt 1: flyctl could not see") && !dRetry.out.includes("Attempt 2"), dRetry.out.trim());
  const alwaysBlind = { flyctl: `#!/bin/bash\nprintf 'This deployment will:\\n * create 2 "app" machines\\n'\n` };
  const dBlind = runStep(DEPLOY, { env: { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "jam", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "", HA: "true", ONLY_MACHINES: "a,b" }, stubs: { ...alwaysBlind, sleep: "#!/bin/sh\nexit 0\n" } });
  check("blind three times → RED, saying the release reached no machine", dBlind.status !== 0 && dBlind.out.includes("Three deploy attempts") && dBlind.out.includes("Attempt 3"), dBlind.out.trim());
  const failing = { flyctl: `#!/bin/bash\necho "Error: build failed"\nexit 3\n` };
  const dFail = runStep(DEPLOY, { env: { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "jam", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "", HA: "true", ONLY_MACHINES: "a,b" }, stubs: failing });
  check("a failing flyctl deploy keeps its own exit code (not retried, not hidden by tee)", dFail.status === 3, String(dFail.status));
  const dNone = runStep(DEPLOY, { env: { GITHUB_SHA: "abc1234def", CONFIG: "fly.toml", APP: "disc", DOCKERFILE: "", EXTRA_DEPLOY_ARGS: "", HA: "true", ONLY_MACHINES: "" } });
  check("deploy without ids → no --only-machines (unchanged)", !dNone.flyctlArgs.includes("--only-machines") && !dNone.flyctlArgs.includes("--update-only"), dNone.flyctlArgs);

  const byConfig = runStep(MACHINES, { env: { APP: "", CONFIG: "fly.toml" } });
  check("without an app name it asks flyctl by --config", byConfig.flyctlArgs.includes("--config fly.toml"), byConfig.flyctlArgs);
  const byApp = runStep(MACHINES, { env: { APP: "bid", CONFIG: "fly.toml" } });
  check("with an app name it asks for that app", byApp.flyctlArgs.includes("--app bid"), byApp.flyctlArgs);
}

// ---------------------------------------------------------------------------

console.log("");
if (failures) {
  console.error(`✗ ${failures} of ${ran} checks failed`);
  process.exit(1);
}
console.log(`✓ ${ran} checks passed against the shipped workflow`);
