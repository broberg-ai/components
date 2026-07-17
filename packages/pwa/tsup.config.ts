import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Core (zero-dep) + the service-worker helper + the manifest/icon factory.
    // NOTE: no `clean` here. With multiple configs in this array, a per-config
    // `clean` races the sibling react/preact builds and can wipe their freshly
    // emitted .d.ts (the 0.2.1 tarball shipped without react.d.ts because of
    // this). dist is cleaned ONCE up front by the `build` script instead.
    entry: { index: "src/index.ts", sw: "src/sw.ts", manifest: "src/manifest.ts" },
    format: ["esm", "cjs"],
    dts: true,
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
