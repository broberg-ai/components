import { defineWorkspace } from "vitest/config";

// F074.4 AC#12 — ONE behaviour suite, run against BOTH wrappers.
//
// The Preact wrapper is not a second implementation: it is the same
// src/react.tsx compiled against preact/compat. So the proof that the two
// cannot disagree is to run the SAME test file twice — once on React, once with
// every React import resolved to Preact. F052.22's lesson: two renderers over
// one core disagreed because only one of them was ever asserted.
export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: { name: "react" },
  },
  {
    extends: "./vitest.config.ts",
    test: { name: "preact", include: ["test/react.test.tsx"] },
    esbuild: { jsx: "automatic", jsxImportSource: "preact" },
    resolve: {
      alias: [
        { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
        { find: /^react-dom$/, replacement: "preact/compat" },
        { find: /^react$/, replacement: "preact/compat" },
        { find: /^@testing-library\/react$/, replacement: "@testing-library/preact" },
      ],
    },
  },
]);
