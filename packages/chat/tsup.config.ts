import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    // No `clean` here — a per-config clean in a tsup ARRAY races its siblings
    // and can wipe freshly emitted .d.ts (F061). dist is cleaned once by the
    // build script, then verify-exports.mjs proves every target exists.
  },
]);
