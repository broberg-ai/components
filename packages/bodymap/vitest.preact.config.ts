import { defineConfig } from "vitest/config";

// F052.4 — run the SAME renderer source (src/react.tsx) under Preact, exactly as the
// ./preact build does: react → preact/hooks, react/jsx-runtime → preact/jsx-runtime.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
      { find: /^react$/, replacement: "preact/hooks" },
    ],
  },
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  test: { include: ["test/preact.test.ts"], environment: "happy-dom" },
});
