import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default node; the React suite opts into happy-dom via a file pragma.
    environment: "node",
  },
});
