import { defineConfig } from "vitest/config";
// happy-dom FOLLOWS links: a test that clicks <a href="https://id.broberg.ai/account">
// made it fetch the live page from the network and run its module scripts, which
// failed as «Cannot use import statement outside a module» — an unhandled
// rejection that turned the suite red only when the fetch won the race (it broke
// two publish runs on 2026-10-08). Tests must never touch the network, so
// navigation and script loading are switched off for every happy-dom file here.
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
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
});
