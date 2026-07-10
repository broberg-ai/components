import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // outside-click wires document/window listeners — run in a DOM.
    environment: "happy-dom",
  },
});
