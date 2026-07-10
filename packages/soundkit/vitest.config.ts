import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The kit touches document + localStorage; run the suite in a DOM.
    environment: "happy-dom",
  },
});
