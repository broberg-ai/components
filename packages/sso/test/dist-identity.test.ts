// F084.155 — against the BUILT dist, because the defect only exists there: tsup
// built index and hono as separate bundles, each inlining src/client.ts, so the
// SsoReauthError that getAccessToken (from /hono) throws was not the class an app
// imports from the package root. `e instanceof SsoReauthError` was false and the
// app's "log in again" branch never ran (appkit #2498, measured on 0.14.1).
// The test builds nothing itself; the gate builds before it tests.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const dist = join(__dirname, "../dist");
const ENV = {
  BID_ISSUER: "https://id.example",
  SSO_CLIENT_ID: "app",
  SSO_REDIRECT_URI: "https://app.example/auth/callback",
  SSO_COOKIE_SECRET: "s".repeat(64),
} as NodeJS.ProcessEnv;

type Root = typeof import("../src/index");
type HonoEntry = typeof import("../src/hono");

async function reauthErrorFromHono(root: Root, hono: HonoEntry): Promise<unknown> {
  const config = root.loadSsoConfig(ENV);
  const sso = hono.ssoRoutes({ config, tokenStore: root.memoryTokenStore({ quiet: true }) });
  let caught: unknown;
  const { Hono } = await import("hono");
  const app = new Hono();
  app.get("/t", async (c) => {
    try {
      await sso.getAccessToken(c);
    } catch (e) {
      caught = e;
    }
    return c.text("ok");
  });
  await app.request("https://app.example/t");
  return caught;
}

describe("F084.155 — one set of error classes across the entries", () => {
  test("esm: the error /hono throws is instanceof SsoReauthError and SsoError from the root", async () => {
    const root = (await import(/* @vite-ignore */ join(dist, "index.js"))) as Root;
    const hono = (await import(/* @vite-ignore */ join(dist, "hono.js"))) as HonoEntry;
    const e = await reauthErrorFromHono(root, hono);
    expect([(e as Error)?.name, e instanceof root.SsoReauthError, e instanceof root.SsoError]).toEqual(["SsoReauthError", true, true]);
  });

  test("cjs: the same through require()", async () => {
    const req = createRequire(import.meta.url);
    const root = req(join(dist, "index.cjs")) as Root;
    const hono = req(join(dist, "hono.cjs")) as HonoEntry;
    const e = await reauthErrorFromHono(root, hono);
    expect([(e as Error)?.name, e instanceof root.SsoReauthError, e instanceof root.SsoError]).toEqual(["SsoReauthError", true, true]);
  });

  test("each format defines SsoReauthError exactly once in dist", () => {
    for (const ext of [".js", ".cjs"]) {
      const files = readdirSync(dist).filter((f) => f.endsWith(ext));
      const defs = files.filter((f) => /\bSsoReauthError = class\b|class SsoReauthError\b/.test(readFileSync(join(dist, f), "utf8")));
      expect([ext, defs.length]).toEqual([ext, 1]);
    }
  });
});
