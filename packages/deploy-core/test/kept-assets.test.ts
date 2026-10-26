// F033.20 — an old page must still find its own hashed assets after a deploy.
//
// Owner-reported 26/10: every INSTALLED app on his Mac went white after a
// deploy, and Cmd+Shift+R did not help. Helpdesk measured why: the page the app
// holds asks for /assets/<old-hash>.js, the deploy removed it from current/, and
// a 404 on the JS draws nothing. The server keeps the last deploys on disk, so
// the file exists — it just was never served.
//
// Boots the REAL generated server (as spa-fallback.test.ts does), with the same
// layout a live app has: deploys/<A>, deploys/<B>, and current -> deploys/<B>.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { FLY_LIVE_SERVER_TS } from "../src/deploy/fly-live-assets.js";

const A = "1000-aaaaaaaa";
const B = "2000-bbbbbbbb";
const OLD_JS = "assets/app-OLDhash12.js";
const NEW_JS = "assets/app-NEWhash12.js";

let url = "";
let child: ChildProcess;
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "flylive-kept-"));
  for (const [id, js] of [[A, OLD_JS], [B, NEW_JS]] as const) {
    mkdirSync(join(dir, "deploys", id, "assets"), { recursive: true });
    writeFileSync(join(dir, "deploys", id, "index.html"), `<script src="/${js}"></script>`);
    writeFileSync(join(dir, "deploys", id, js), `/* ${id} */`);
  }
  // unhashed file that only the OLD deploy had — must never come back
  writeFileSync(join(dir, "deploys", A, "robots-old.txt"), "old");
  writeFileSync(join(dir, "deploys", A, "assets", "plain.js"), "old unhashed");
  symlinkSync(join(dir, "deploys", B), join(dir, "current"));
  writeFileSync(join(dir, "server.ts"), FLY_LIVE_SERVER_TS);

  const port = 9000 + Math.floor(Math.random() * 900);
  child = spawn("bun", ["run", join(dir, "server.ts")], {
    env: { ...process.env, PORT: String(port), SITE_DATA_ROOT: dir, SYNC_SECRET: "test-secret-not-a-credential" },
    stdio: "ignore",
  });
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${url}/`); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
}, 30_000);

afterAll(() => {
  child?.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

describe("F033.20 — an old page still finds its hashed assets after a deploy", () => {
  it("an asset only in the PREVIOUS deploy is served with its own bytes and the immutable header", async () => {
    const res = await fetch(`${url}/${OLD_JS}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`/* ${A} */`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("the current deploy's assets are served as before", async () => {
    const res = await fetch(`${url}/${NEW_JS}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`/* ${B} */`);
  });

  it("NEGATIVE: an UNHASHED file only in the old deploy stays 404 (an old robots.txt must never come back)", async () => {
    expect((await fetch(`${url}/robots-old.txt`)).status).toBe(404);
    expect((await fetch(`${url}/assets/plain.js`)).status).toBe(404);
  });

  it("NEGATIVE: a hashed asset in NO kept deploy is still 404", async () => {
    expect((await fetch(`${url}/assets/app-NOWHERE123.js`)).status).toBe(404);
  });
});
