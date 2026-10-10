import { defineConfig } from "tsup";

// ONE config, splitting on for esm and cjs (F084.155's lesson): /preact imports
// the bus from the core, and two separate bundles would each carry their own
// settingsBus — a Save button from one and panels from the other would never meet.
// No `clean` here: the build script cleans dist once, verify-exports refuses an
// incomplete one (F061).
export default defineConfig({
  entry: { index: "src/core.ts", preact: "src/preact.tsx" },
  format: ["esm", "cjs"],
  splitting: true,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ["preact", "preact/hooks", "preact/jsx-runtime"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "preact";
  },
});
