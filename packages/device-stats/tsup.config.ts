import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Headless core. NOTE: no `clean` here — with multiple configs a per-config
    // clean races its siblings and can wipe freshly emitted .d.ts (F061; it
    // shipped @broberg/pwa 0.2.1 without react.d.ts). dist is cleaned ONCE by
    // the `build` script, then verify-exports.mjs proves nothing is missing.
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
  },
]);
