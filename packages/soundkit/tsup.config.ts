import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Core (zero-dep) + tree-shakeable presets.
    entry: { index: "src/index.ts", presets: "src/presets.ts" },
    format: ["esm", "cjs"],
    dts: true,
    // no per-config `clean` — it races the sibling DTS emit + wipes their .d.ts
    // (F061; dropped .d.ts in pwa 0.2.1 + auth 0.1.2). dist is cleaned ONCE in the
    // build script (rm -rf dist && tsup); verify-exports.mjs seals it.
    sourcemap: true,
    treeshake: true,
  },
  {
    // React adapter — react stays external (optional peer).
    entry: { react: "src/react.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["react"],
  },
  {
    // Preact-signals adapter — preact/@preact/signals stay external.
    entry: { preact: "src/preact.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["preact", "preact/hooks", "@preact/signals"],
  },
]);
