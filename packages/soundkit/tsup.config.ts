import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Core (zero-dep) + tree-shakeable presets.
    entry: { index: "src/index.ts", presets: "src/presets.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
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
