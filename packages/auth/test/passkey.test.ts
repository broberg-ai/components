import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { buildAuthOptions } from "../src/index.js";
// F008.9 — the passkey plugin lives behind its own subpath. Importing it from
// the core entry is what made @better-auth/passkey mandatory for every
// consumer, including ones with no passkeys at all.
import { buildPasskeyPlugin } from "../src/passkey.js";

describe("passkey is composed, not configured", () => {
  it("registers when the built plugin is passed through `plugins`", () => {
    const plugin = buildPasskeyPlugin({ rpID: "example.com", rpName: "Example" });
    const opts = buildAuthOptions({ database: memoryAdapter({}), plugins: [plugin] });
    expect(opts.plugins?.some((p) => p.id === plugin.id)).toBe(true);
  });

  it("nothing is registered when it is not passed", () => {
    // The negative control. Without it, "always register passkey" satisfies the
    // test above — and the dark-ship property is the whole point of the package.
    expect(buildAuthOptions({ database: memoryAdapter({}) }).plugins).toBeUndefined();
  });

  it("builds with rpID/rpName/origin without throwing", () => {
    expect(() =>
      buildPasskeyPlugin({ rpID: "xrt81.com", rpName: "XRT81", origin: "https://xrt81.com" }),
    ).not.toThrow();
  });
});

describe("the core import graph does not reach an optional peer", () => {
  /**
   * The install-time guard (verify-clean-install.mjs) is the real proof — it
   * packs the tarball and imports it with only the required peers. This is the
   * cheap second layer that fires while you are still editing, walking the
   * LOCAL import graph from src/index.ts and failing if any file it can reach
   * pulls in a peer the manifest calls optional.
   *
   * Both layers exist because they fail at different times: this one at
   * `pnpm test`, the other at publish. The defect that motivated F008.9 was
   * invisible to every test the package had, because no test ever asked what
   * the module graph required.
   */
  const OPTIONAL_PEERS = ["@better-auth/passkey", "drizzle-orm", "better-auth/adapters/drizzle"];

  /** Every local .ts file reachable from an entry, following relative imports. */
  function reachable(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [resolve(entry)];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        queue.push(resolve(join(dirname(file), m[1]!.replace(/\.js$/, ".ts"))));
      }
    }
    return [...seen];
  }

  it("src/index.ts reaches no file importing an optional peer", () => {
    const offenders: string[] = [];
    for (const file of reachable("src/index.ts")) {
      const src = readFileSync(file, "utf8");
      for (const peer of OPTIONAL_PEERS) {
        // A `import type` is erased at build and cannot break an install — the
        // distinction matters, since magic-link.ts legitimately type-imports
        // @broberg/mail and always has.
        const re = new RegExp(`^import\\s+(?!type\\s)[^;]*["']${peer.replace(/[/@-]/g, "\\$&")}["']`, "m");
        if (re.test(src)) offenders.push(`${file} → ${peer}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("…and the seal can fail: the passkey ENTRY does import its peer", () => {
    // Proves the detector works rather than that the graph happens to be clean.
    // Without this, a broken regex would pass the test above forever.
    const src = readFileSync("src/passkey.ts", "utf8");
    expect(/^import\s+(?!type\s)[^;]*["']@better-auth\/passkey["']/m.test(src)).toBe(true);
  });
});
