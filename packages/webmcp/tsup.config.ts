import { defineConfig } from "tsup";

export default defineConfig({
  entry: { testing: "src/testing.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  treeshake: true,
});
