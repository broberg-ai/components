// F021.10 — the CLASSIC build, tested as the browser loads it: the built file
// evaluated as a plain script in a fake worker scope (importScripts semantics),
// not the TypeScript source.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const FILE = new URL("../dist/pwa-sw.global.js", import.meta.url);

describe("dist/pwa-sw.global.js", () => {
  it("is a classic script that attaches the listener and exposes self.BrobergPwa", () => {
    expect(existsSync(FILE)).toBe(true); // build first (the test script runs after build in CI)
    const src = readFileSync(FILE, "utf8");
    expect(/^\s*(import|export)\s/m.test(src)).toBe(false);
    const listeners: Array<(e: { data: unknown }) => void> = [];
    let skipped = 0;
    const self: Record<string, unknown> = {
      addEventListener: (type: string, fn: (e: { data: unknown }) => void) => type === "message" && listeners.push(fn),
      skipWaiting: async () => void skipped++,
    };
    runInNewContext(src, { self, globalThis: self });
    const api = self.BrobergPwa as { SKIP_WAITING: string; listenForSkipWaiting: unknown };
    expect([api.SKIP_WAITING, typeof api.listenForSkipWaiting, listeners.length]).toEqual(["SKIP_WAITING", "function", 1]);
    listeners[0]!({ data: { type: "OTHER" } });
    expect(skipped).toBe(0);
    listeners[0]!({ data: { type: "SKIP_WAITING" } });
    expect(skipped).toBe(1);
  });

  it("does not collide with @broberg/webpush's sw.global.js, and is exported as ./sw.global", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.exports["./sw.global"]).toEqual({ default: "./dist/pwa-sw.global.js" });
    expect(pkg.exports["./sw.global"].default.endsWith("/sw.global.js")).toBe(false);
  });
});
