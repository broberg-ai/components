import { defineConfig } from "tsup";

// stripe stays external — it's a peer the consumer provides (one pinned version).
const EXTERNAL = ["stripe"];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    // no per-config `clean` — it races the sibling DTS emit + wipes their .d.ts
    // (F061; dropped .d.ts in pwa 0.2.1 + auth 0.1.2). dist is cleaned ONCE in the
    // build script (rm -rf dist && tsup); verify-exports.mjs seals it.
    sourcemap: true,
    treeshake: true,
    external: EXTERNAL,
  },
  {
    // Web-standard Request/Response route factory (named /next, but runtime-agnostic).
    entry: { next: "src/next.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: EXTERNAL,
  },
]);
