// F033.13 — the Fly client against the REAL Fly API. Not part of `vitest run`:
// it creates and deletes a throwaway app, so it runs on purpose, by hand.
//
//   FLY_API_TOKEN=$(flyctl auth token) FLY_LIVE_ORG=personal \
//     FLY_LIVE_READ_APP=<an existing app> bun test/live/fly-api.live.ts
//
// READ half: read-only against an app that already exists, compared with
// flyctl's own answer. WRITE half: only inside an app this script creates and
// always deletes, even when a step fails. It never writes to an existing app.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { FlyClient, FlyTimeoutError, type FlyMachineConfig } from "../../src/index.js";

const org = process.env.FLY_LIVE_ORG ?? "personal";
const readApp = process.env.FLY_LIVE_READ_APP;
const fly = new FlyClient();
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

console.log("── READ (existing apps, no writes)");
const orgs = await fly.listOrgs();
check(orgs.some((o) => o.slug === org), `listOrgs includes "${org}"`, orgs.map((o) => o.slug).join(", "));

const all = await fly.listAllApps();
check(all.length > 0, "listAllApps returned apps and passed its own totalCount check", `${all.length} apps`);

if (readApp) {
  const machines = await fly.listMachines(readApp);
  const viaFlyctl = JSON.parse(execFileSync("flyctl", ["machines", "list", "-a", readApp, "--json"]).toString()) as {
    id: string;
    config: { guest: { memory_mb: number } };
  }[];
  const mine = machines.map((m) => `${m.id}:${m.config.guest?.memory_mb}`).sort().join(",");
  const theirs = viaFlyctl.map((m) => `${m.id}:${m.config.guest.memory_mb}`).sort().join(",");
  check(mine === theirs, `listMachines(${readApp}) == flyctl machines list`, `${mine}  vs  ${theirs}`);
  check((await fly.getApp(readApp))?.name === readApp, `getApp(${readApp})`);
}
check((await fly.getApp(`no-such-app-${randomBytes(4).toString("hex")}`)) === null, "getApp on a missing app is null");

console.log(`── WRITE (throwaway app in "${org}", deleted at the end)`);
const app = `bdc-f03313-${randomBytes(3).toString("hex")}`;
const base: FlyMachineConfig = {
  image: "alpine:3.20",
  init: { cmd: ["sleep", "600"] },
  guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
  restart: { policy: "no" },
  auto_destroy: false,
};
try {
  await fly.createApp(app, org);
  check((await fly.getApp(app))?.name === app, `createApp ${app}`);

  const m = await fly.createMachine(app, base, { region: "arn" });
  await fly.waitForState(app, m.id, "started", 120);
  check((await fly.getMachine(app, m.id))?.state === "started", "createMachine + waitForState started");

  const current = (await fly.getMachine(app, m.id))!;
  await fly.updateMachine(app, m.id, { ...current.config, guest: { ...current.config.guest!, memory_mb: 512 } });
  await fly.waitForState(app, m.id, "started", 120);
  const resized = (await fly.getMachine(app, m.id))!;
  check(resized.config.guest?.memory_mb === 512, "updateMachine resize, read back from a fresh GET", `memory_mb=${resized.config.guest?.memory_mb}`);

  await fly.stopMachine(app, m.id);
  await fly.waitForState(app, m.id, "stopped", 120);
  check((await fly.getMachine(app, m.id))?.state === "stopped", "stopMachine + waitForState stopped");

  // A process that exits 3 — waitForExit must report 3, not "success".
  const e = await fly.createMachine(app, { ...base, init: { cmd: ["sh", "-c", "exit 3"] } }, { region: "arn" });
  const exit = await fly.waitForExit(app, e.id, { pollMs: 2000, maxMs: 120_000 });
  check(exit.exitCode === 3, "waitForExit reports the real exit code", JSON.stringify(exit));

  // A wait that cannot succeed must time out, not hang.
  const t0 = Date.now();
  const timedOut = await fly.waitForState(app, m.id, "started", 3).then(() => false, (err) => err instanceof FlyTimeoutError);
  check(timedOut && Date.now() - t0 < 20_000, "waitForState on an unreachable state times out", `${Date.now() - t0} ms`);

  await fly.destroyMachine(app, m.id, { force: true });
  await fly.destroyMachine(app, e.id, { force: true });
  check((await fly.listMachines(app)).every((x) => x.state === "destroyed" || x.state === "destroying"), "destroyMachine");
} catch (err) {
  check(false, "write half threw", String(err));
} finally {
  await fly.deleteApp(app).catch((err) => console.log(`  cleanup: deleteApp failed: ${err}`));
  // Deletion is asynchronous on Fly's side; ask until it is gone.
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) {
    gone = (await fly.getApp(app)) === null;
    if (!gone) await new Promise((r) => setTimeout(r, 3000));
  }
  check(gone, `deleteApp ${app} — the app no longer exists`);
}

console.log(failed ? `\nFAIL — ${failed} check(s) failed` : "\nOK — all live checks passed");
process.exit(failed ? 1 : 0);
