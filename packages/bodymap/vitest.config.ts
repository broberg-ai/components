import { defineConfig } from "vitest/config";

// The default run (React + core + three). The Preact run is vitest.preact.config.ts —
// it needs react aliased to preact, which must not leak into these tests.
export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/dist/**", "test/preact.test.ts"] },
});
