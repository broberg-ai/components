import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
  },
  {
    entry: { preact: "src/preact.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["preact", "preact/hooks", "preact/jsx-runtime", "@broberg/ui-controls-core"],
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "preact";
    },
  },
]);
