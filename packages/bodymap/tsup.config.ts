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
    // F052.4 — the Preact build is the SAME source as ./react: react → preact/hooks and the
    // Preact JSX runtime. Its types come from src/preact-types.ts (the next entry), so a Preact
    // app never needs React's types. check-preact.mjs proves dist/preact.* imports no react.
    entry: { preact: "src/react.tsx" },
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    treeshake: true,
    external: ["preact", "preact/hooks", "preact/jsx-runtime"],
    // tsup marks peer deps (react) external before any plugin sees them — opt react out of
    // that so the plugin below is the one that resolves it.
    noExternal: ["react", "react/jsx-runtime"],
    // react → preact/hooks and react/jsx-runtime → preact/jsx-runtime, BOTH kept external. An
    // esbuild alias would bundle a private copy of preact/hooks into dist — a second hooks
    // instance beside the app's own. This plugin rewrites the specifier and leaves it external.
    esbuildPlugins: [
      {
        name: "react-to-preact",
        setup(build) {
          build.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (args) => ({
            path: args.path === "react" ? "preact/hooks" : "preact/jsx-runtime",
            external: true,
          }));
        },
      },
    ],
    esbuildOptions(options) {
      options.jsx = "automatic";
      options.jsxImportSource = "preact";
    },
  },
  {
    entry: { preact: "src/preact-types.ts" },
    format: ["esm", "cjs"],
    dts: { only: true },
    external: ["preact"],
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
