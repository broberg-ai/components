import { defineConfig } from "vitest/config";
// F074.4 — the React wrapper's tests are TSX. The core suites stay in the node
// environment; react.test.tsx opts into happy-dom with its own docblock. Same
// network lock-down as app-shell: a test must never follow a link off the box.
export default defineConfig({
  test: {
    environment: "node",
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
          navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true, disableFallbackToSetURL: true },
        },
      },
    },
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
