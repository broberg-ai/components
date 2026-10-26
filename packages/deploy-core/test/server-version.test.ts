// F033.18 — a server fix must reach apps that are already running. The version
// the server reports is a hash of its own code, and flyLiveDeploy re-provisions
// a live app whose server is not this package's.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { FLY_LIVE_SERVER_TS, FLY_LIVE_SERVER_VERSION, FLY_LIVE_DOCKERFILE } from "../src/deploy/fly-live-assets.js";
import { chooseDeployMode, signIcdRequest } from "../src/deploy/fly-live.js";

describe("F033.18 — the server's version is a hash of its own code", () => {
  it("is not the hand-kept 1.0.0, and the shipped server carries it", () => {
    expect(FLY_LIVE_SERVER_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(FLY_LIVE_SERVER_TS).toContain(`const SERVER_VERSION = "${FLY_LIVE_SERVER_VERSION}";`);
    expect(FLY_LIVE_SERVER_TS).not.toContain("__FLY_LIVE_SERVER_VERSION__");
  });

  it("different server code → a different version (it cannot be forgotten)", () => {
    const template = FLY_LIVE_SERVER_TS.replace(FLY_LIVE_SERVER_VERSION, "__FLY_LIVE_SERVER_VERSION__");
    const hash = (t: string) => createHash("sha256").update(t).update(FLY_LIVE_DOCKERFILE).digest("hex").slice(0, 12);
    expect(hash(template)).toBe(FLY_LIVE_SERVER_VERSION);
    expect(hash(template + "\n// a one-line change")).not.toBe(FLY_LIVE_SERVER_VERSION);
  });

  it("the booted server answers /_icd/health with that version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flylive-ver-"));
    mkdirSync(join(dir, "current"), { recursive: true });
    mkdirSync(join(dir, "deploys"), { recursive: true });
    writeFileSync(join(dir, "current", "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "server.ts"), FLY_LIVE_SERVER_TS);
    const port = 9900 + Math.floor(Math.random() * 90);
    const child = spawn("bun", ["run", join(dir, "server.ts")], { env: { ...process.env, PORT: String(port), SITE_DATA_ROOT: dir, SYNC_SECRET: "test-secret-not-a-credential" }, stdio: "ignore" });
    try {
      let body: { version?: string } | undefined;
      for (let i = 0; i < 100 && !body; i++) {
        // Health is behind the same HMAC as every /_icd route — sign it as flyLiveDeploy does.
        const { timestamp, signature } = signIcdRequest("GET", "/_icd/health", new Uint8Array(0), "test-secret-not-a-credential");
        try { body = (await (await fetch(`http://127.0.0.1:${port}/_icd/health`, { headers: { "x-cms-timestamp": timestamp, "x-cms-signature": signature } })).json()) as { version?: string }; } catch { await new Promise((r) => setTimeout(r, 50)); }
      }
      expect(body?.version).toBe(FLY_LIVE_SERVER_VERSION);
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("F033.18 — chooseDeployMode", () => {
  const v = FLY_LIVE_SERVER_VERSION;
  it("a live app on THIS server version → sync, as before", () => {
    expect(chooseDeployMode({ ok: true, version: v }, v)).toEqual({ mode: "sync", reason: `server version ${v} is current` });
  });
  it("a live app on an OLDER server (the 1.0.0 every app runs today) → infra, and says why", () => {
    const d = chooseDeployMode({ ok: true, version: "1.0.0" }, v);
    expect(d.mode).toBe("infra");
    expect(d.reason).toBe(`server version 1.0.0 ≠ ${v}`);
  });
  it("no version at all → infra; unreachable → infra; forceInfra → infra", () => {
    expect(chooseDeployMode({ ok: true }, v).mode).toBe("infra");
    expect(chooseDeployMode(null, v)).toEqual({ mode: "infra", reason: "app not reachable" });
    expect(chooseDeployMode({ ok: true, version: v }, v, true)).toEqual({ mode: "infra", reason: "forceInfra" });
  });
});
