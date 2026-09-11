// F033.12 — the SPA fallback, asserted against the REAL generated server.
//
// Filed by helpdesk, measured in production: /velkommen answered 404 on
// helpdesk.broberg.ai while / answered 200, with their invitation and
// forgot-password links dead. Every local check was green — including a full
// browser run — because Vite's dev server answers index.html on any path. The
// test environment was kinder than production in exactly the dimension the test
// existed to rule out.
//
// SO THESE TESTS BOOT THE STRING WE ACTUALLY SHIP. Until now nothing in this
// package ever ran FLY_LIVE_SERVER_TS; it was generated, deployed, and never
// executed by a test. Asserting on the source text instead would reproduce the
// original defect one layer up — a check that reads the thing rather than runs
// it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { FLY_LIVE_SERVER_TS } from "../src/deploy/fly-live-assets.js";

const INDEX = "<!doctype html><title>app</title><div id=root></div>";

/** Is this binary on PATH? Asked once, so the failure can say so in words. */
function which(bin: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
}

/** Boot the real server against a temp /srv. Returns its base URL. */
async function boot(env: Record<string, string>): Promise<{ url: string; stop: () => void; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "flylive-"));
  mkdirSync(join(dir, "current"), { recursive: true });
  mkdirSync(join(dir, "deploys"), { recursive: true });
  writeFileSync(join(dir, "current", "index.html"), INDEX);
  writeFileSync(join(dir, "current", "real.css"), "body{}");
  const serverPath = join(dir, "server.ts");
  writeFileSync(serverPath, FLY_LIVE_SERVER_TS);

  // A MISSING RUNTIME MUST NAME ITSELF. Measured 2026-09-11: without this,
  // `spawn bun ENOENT` surfaced as an UNCAUGHT EXCEPTION that took 20 of 38
  // tests down with it, and the visible failure was `ECONNREFUSED` on a port —
  // which names the symptom and hides the cause. One named failure beats a
  // cascade that sends the reader to the wrong place.
  if (!which("bun")) {
    throw new Error(
      "bun is not on PATH, so the server this package SHIPS cannot be booted. " +
        "These tests run the real generated server rather than reading its source. " +
        "Install bun (https://bun.sh) — CI does this with oven-sh/setup-bun.",
    );
  }

  const port = 9000 + Math.floor(Math.random() * 900);
  const child: ChildProcess = spawn("bun", ["run", serverPath], {
    env: { ...process.env, PORT: String(port), SITE_DATA_ROOT: dir, SYNC_SECRET: "test-secret-not-a-credential", ...env },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  // Wait for it to answer rather than sleeping a guess.
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${url}/`); break; } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  return { url, dir, stop: () => { child.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

const HTML = { accept: "text/html,application/xhtml+xml" };

describe("F033.12 — SPA fallback is OFF by default", () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { s = await boot({}); }, 30_000);
  afterAll(() => s?.stop());

  it("answers exactly as it does today — the shapes helpdesk measured in production", async () => {
    // A shared deploy package that changes how fifteen live sites answer is a
    // worse outage than the bug. This is the criterion that says so.
    expect((await fetch(`${s.url}/`, { headers: HTML })).status).toBe(200);
    for (const p of ["/velkommen", "/velkommen/", "/velkommen/index.html", "/assets/"]) {
      expect((await fetch(`${s.url}${p}`, { headers: HTML })).status, p).toBe(404);
    }
  });
});

describe("F033.12 — with the flag ON", () => {
  let s: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => { s = await boot({ SPA_FALLBACK: "true" }); }, 30_000);
  afterAll(() => s?.stop());

  it("an unknown ROUTE answers index.html with STATUS 200", async () => {
    // 200 is the whole point. 404.html already serves the right bytes with the
    // wrong number — a success reported as a failure.
    for (const p of ["/velkommen", "/velkommen/", "/dyb/rute/uden/fil"]) {
      const r = await fetch(`${s.url}${p}`, { headers: HTML });
      expect(r.status, p).toBe(200);
      expect(await r.text(), p).toContain("id=root");
    }
  });

  it("A MISSING ASSET STILL 404s — an incomplete deploy must not look complete", async () => {
    // The trap in the obvious implementation: index.html at 200 for a dropped
    // .js file makes the browser fail on a parse error naming the wrong problem.
    for (const p of ["/assets/app-abc123.js", "/favicon.ico", "/x.css", "/assets/main.css"]) {
      expect((await fetch(`${s.url}${p}`, { headers: HTML })).status, p).toBe(404);
    }
  });

  it("a NON-BROWSER client on an extensionless path still gets its 404", async () => {
    // Half the predicate. Without the Accept clause a fetch() for a missing JSON
    // endpoint receives HTML with a 200 and fails somewhere far away.
    const r = await fetch(`${s.url}/api/ukendt`, { headers: { accept: "application/json" } });
    expect(r.status).toBe(404);
  });

  it("…and a REAL file is still served, flag or no flag", async () => {
    const r = await fetch(`${s.url}/real.css`, { headers: HTML });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("body{}");
  });
});
