import { defineConfig } from "tsup";

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
  },
  {
    entry: { react: "src/react.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["react", "react/jsx-runtime"],
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "react";
    },
  },
  {
    entry: { three: "src/three.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    // react + three stay external (peers); the ./react re-exports (LABELS_*) are
    // bundled in, but the 2D SVG renderer tree-shakes out (unused here).
    external: ["react", "react/jsx-runtime", "three", "three/*"],
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "react";
    },
  },
]);
