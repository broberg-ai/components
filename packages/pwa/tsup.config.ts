import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Core (zero-dep) + the service-worker helper + the manifest/icon factory.
    entry: { index: "src/index.ts", sw: "src/sw.ts", manifest: "src/manifest.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
  },
  {
    // React adapter — react stays external (optional peer).
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
    // Preact adapter — preact stays external (optional peer).
    entry: { preact: "src/preact.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    treeshake: true,
    external: ["preact", "preact/hooks", "preact/jsx-runtime"],
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "preact";
    },
  },
]);
